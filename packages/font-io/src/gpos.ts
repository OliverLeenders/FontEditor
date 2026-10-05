import type { ValueRecord } from "./fea.js";
import { type Lookup, layoutTable } from "./layout.js";
import {
  type GlyphName,
  type KernIndex,
  type Kerning,
  groupNameOf,
  isGroupKey,
  kernPairs,
} from "@typewright/font-model";

/**
 * Building the GPOS table that makes a font actually kern.
 *
 * opentype.js parses GPOS but does not write it, and its writer emits no `kern`
 * table either — so a font exported through it kerns nowhere, whatever the
 * source contained. This builds the table by hand; `sfnt.ts` splices it in.
 *
 * The shape follows how kerning is written rather than being a flat dump. A
 * class-based subtable carries the group-against-group matrix, which is the bulk
 * of any real font's kerning and would otherwise be a pair for every member of
 * one group against every member of the other. A second, ordinary pair subtable
 * carries the exceptions. Lookups are tried in order, so the exceptions go
 * first: that is the same specificity rule the model uses, expressed the way the
 * format expresses it.
 */

/**
 * A part of a layout table lies further from what points at it than the format
 * can say.
 *
 * Nearly everything in GSUB and GPOS is found by a sixteen-bit offset, and a
 * number that does not fit was once written as its low sixteen bits: the font
 * was made, with a table that pointed into the middle of itself, and nothing
 * said so. What can be large — a font's ligatures, its kerning — is divided
 * before it comes to this, so this is for what cannot be.
 */
export class TableTooLarge extends Error {
  constructor() {
    super(
      "The font's features or kerning are too large for the font file to hold: " +
        "part of a table is more than 65,535 bytes from where it is pointed at.",
    );
    this.name = "TableTooLarge";
  }
}

/** The most a subtable may be for every offset inside it to be sayable. */
export const SUBTABLE_LIMIT = 0xffff;

export class Writer {
  private readonly bytes: number[] = [];

  get length(): number {
    return this.bytes.length;
  }

  u8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  u16(value: number): void {
    if (value < 0 || value > 0xffff) throw new TableTooLarge();
    this.bytes.push((value >>> 8) & 0xff, value & 0xff);
  }

  /** Signed, which every kerning value needs and most are. */
  i16(value: number): void {
    this.u16(value < 0 ? value + 0x10000 : value);
  }

  u32(value: number): void {
    this.bytes.push(
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    );
  }

  tag(value: string): void {
    for (let i = 0; i < 4; i++) this.u8(value.charCodeAt(i));
  }

  bytesOf(other: Uint8Array): void {
    for (const b of other) this.bytes.push(b);
  }

  /** Pad to a two-byte boundary, which every GPOS subtable offset assumes. */
  align(): void {
    while (this.bytes.length % 2 !== 0) this.bytes.push(0);
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/** A run of consecutive glyph ids, which coverage format 2 is built from. */
type Range = { first: number; last: number; startIndex: number };

function rangesOf(sorted: readonly number[]): Range[] {
  const ranges: Range[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = i;
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i]! + 1) i++;
    ranges.push({ first: sorted[start]!, last: sorted[i]!, startIndex: start });
  }
  return ranges;
}

/**
 * A coverage table: the glyphs a lookup applies to, and their order within it.
 *
 * Written as ranges when that is smaller, which for kerning it usually is —
 * groups are built from alphabets, and alphabets are contiguous in most fonts.
 */
export function coverage(glyphIds: readonly number[]): Uint8Array {
  const sorted = [...new Set(glyphIds)].sort((a, b) => a - b);
  const ranges = rangesOf(sorted);

  const listSize = 4 + sorted.length * 2;
  const rangeSize = 4 + ranges.length * 6;

  const w = new Writer();
  if (listSize <= rangeSize) {
    w.u16(1);
    w.u16(sorted.length);
    for (const id of sorted) w.u16(id);
  } else {
    w.u16(2);
    w.u16(ranges.length);
    for (const r of ranges) {
      w.u16(r.first);
      w.u16(r.last);
      w.u16(r.startIndex);
    }
  }
  return w.finish();
}

/**
 * A class definition: which class each glyph belongs to, zero meaning none.
 *
 * Format 2, a list of ranges, because classes come from groups and groups are
 * sets of letters rather than single glyphs.
 */
export function classDef(assignments: ReadonlyMap<number, number>): Uint8Array {
  const sorted = [...assignments.entries()].sort((a, b) => a[0] - b[0]);

  const ranges: Array<{ first: number; last: number; klass: number }> = [];
  for (const [id, klass] of sorted) {
    const last = ranges[ranges.length - 1];
    if (last !== undefined && last.klass === klass && last.last === id - 1) {
      last.last = id;
    } else {
      ranges.push({ first: id, last: id, klass });
    }
  }

  const w = new Writer();
  w.u16(2);
  w.u16(ranges.length);
  for (const r of ranges) {
    w.u16(r.first);
    w.u16(r.last);
    w.u16(r.klass);
  }
  return w.finish();
}

/**
 * PairPos format 2: a matrix of values indexed by two classes.
 *
 * What a group-against-group table compiles to, and why groups are worth having
 * at all — a hundred round letters against a hundred stems is one small matrix
 * here and ten thousand pairs otherwise.
 *
 * ValueFormat 0x0004 is `XAdvance` on the first glyph only, which is what
 * horizontal kerning is; the second glyph's record is empty and takes no space.
 */
export function pairPosClasses(
  firstCoverage: readonly number[],
  class1: ReadonlyMap<number, number>,
  class2: ReadonlyMap<number, number>,
  class1Count: number,
  class2Count: number,
  values: ReadonlyMap<string, number>,
  /** For a cell whose value changes along an axis, which delta set it changes by. */
  varying: ReadonlyMap<string, number> = NO_SETS,
): Uint8Array {
  const coverageBytes = coverage(firstCoverage);
  const class1Bytes = classDef(class1);
  const class2Bytes = classDef(class2);

  // A cell is its value, and where any of them changes, the place of a small
  // table saying by which delta set: nothing, for a cell that does not.
  const varies = [...varying.keys()].some((key) => {
    const [c1, c2] = key.split(",").map(Number);
    return (c1 ?? 0) < class1Count && (c2 ?? 0) < class2Count;
  });
  const header = 16;
  const matrix = class1Count * class2Count * (varies ? 4 : 2);
  const tablesAt = header + matrix + coverageBytes.length + class1Bytes.length + class2Bytes.length;
  const devices = new DeviceTables(tablesAt);

  const w = new Writer();
  w.u16(2); // format
  w.u16(header + matrix); // coverage offset
  w.u16(varies ? 0x0044 : 0x0004); // value format 1: XAdvance, and how it changes
  w.u16(0); // value format 2: nothing
  w.u16(header + matrix + coverageBytes.length); // class def 1
  w.u16(header + matrix + coverageBytes.length + class1Bytes.length); // class def 2
  w.u16(class1Count);
  w.u16(class2Count);

  for (let c1 = 0; c1 < class1Count; c1++) {
    for (let c2 = 0; c2 < class2Count; c2++) {
      const key = `${String(c1)},${String(c2)}`;
      w.i16(values.get(key) ?? 0);
      if (varies) w.u16(devices.at(varying.get(key)));
    }
  }

  w.bytesOf(coverageBytes);
  w.bytesOf(class1Bytes);
  w.bytesOf(class2Bytes);
  w.bytesOf(devices.bytes());
  return w.finish();
}

const NO_SETS: ReadonlyMap<string, number> = new Map();

/** As many delta sets as one part of a variation store holds. */
export const DELTA_SETS_EACH = 0xffff;

/**
 * The small tables that say which delta set a value changes by, gathered at the
 * end of whatever holds the values and found from it by offset.
 *
 * One for each delta set used, however many values use it: pairs that change
 * alike — and across a family most kerning changes in a few ways — share one.
 */
class DeviceTables {
  private readonly places = new Map<number, number>();
  private readonly w = new Writer();

  constructor(private readonly from: number) {}

  /** Where the table for a delta set is, from the start of what holds it: nothing for none. */
  at(set: number | undefined): number {
    if (set === undefined) return 0;
    const known = this.places.get(set);
    if (known !== undefined) return known;
    const here = this.from + this.w.length;
    this.places.set(set, here);
    // A VariationIndex: which part of the store, which row of it, and the
    // format that says this is that and not a table of pixel sizes.
    this.w.u16(Math.floor(set / DELTA_SETS_EACH));
    this.w.u16(set % DELTA_SETS_EACH);
    this.w.u16(0x8000);
    return here;
  }

  bytes(): Uint8Array {
    return this.w.finish();
  }
}

/**
 * The same matrix, in as many subtables as it takes for each to be sayable.
 *
 * The coverage and the class definitions come after the matrix and are found
 * by sixteen-bit offsets, so the matrix cannot be more than that: two hundred
 * groups against two hundred is already past it. Divided by its rows — the
 * first glyph's classes — each subtable covers the glyphs of some of them and
 * holds their rows against every second class. A pair is in exactly one, since
 * its first glyph is covered by exactly one, so the order they are tried in
 * changes nothing.
 */
export function pairPosClassSubtables(
  firstCoverage: readonly number[],
  class1: ReadonlyMap<number, number>,
  class2: ReadonlyMap<number, number>,
  class1Count: number,
  class2Count: number,
  values: ReadonlyMap<string, number>,
  varying: ReadonlyMap<string, number> = NO_SETS,
): Uint8Array[] {
  const whole = (): Uint8Array =>
    pairPosClasses(firstCoverage, class1, class2, class1Count, class2Count, values, varying);
  const fixed = 16 + classDef(class2).length;
  // A coverage and a class definition are at most six bytes a glyph and four
  // of header. A cell is two bytes; and where the kerning changes, two more for
  // the place of its table and at most six for the table itself.
  const cell = varying.size === 0 ? 2 : 10;
  const sizeOf = (rows: number, glyphs: number): number =>
    fixed + rows * class2Count * cell + 2 * (4 + glyphs * 6);
  if (sizeOf(class1Count, firstCoverage.length) <= SUBTABLE_LIMIT) return [whole()];

  const glyphsOf = new Map<number, number[]>();
  for (const id of firstCoverage) {
    const klass = class1.get(id) ?? 0;
    const list = glyphsOf.get(klass) ?? [];
    list.push(id);
    glyphsOf.set(klass, list);
  }

  const out: Uint8Array[] = [];
  let taken: number[] = [];
  let glyphs = 0;
  const flush = (): void => {
    if (taken.length === 0) return;
    // Renumbered from one: zero is every covered glyph in no class, which here
    // is none of them, and its row is nothing.
    const renumbered = new Map(taken.map((klass, i) => [klass, i + 1]));
    const covered: number[] = [];
    const classes = new Map<number, number>();
    for (const klass of taken) {
      for (const id of glyphsOf.get(klass) ?? []) {
        covered.push(id);
        classes.set(id, renumbered.get(klass)!);
      }
    }
    const moved = (from: ReadonlyMap<string, number>): Map<string, number> => {
      const rows = new Map<string, number>();
      for (const [key, value] of from) {
        const [c1, c2] = key.split(",");
        const row = renumbered.get(Number(c1));
        if (row !== undefined) rows.set(`${String(row)},${c2 ?? "0"}`, value);
      }
      return rows;
    };
    out.push(
      pairPosClasses(
        covered,
        classes,
        class2,
        taken.length + 1,
        class2Count,
        moved(values),
        moved(varying),
      ),
    );
    taken = [];
    glyphs = 0;
  };

  for (const klass of [...glyphsOf.keys()].sort((a, b) => a - b)) {
    const more = glyphsOf.get(klass)?.length ?? 0;
    if (taken.length > 0 && sizeOf(taken.length + 2, glyphs + more) > SUBTABLE_LIMIT) flush();
    taken.push(klass);
    glyphs += more;
  }
  flush();
  return out;
}

/** PairPos format 1: pairs listed per first glyph. Used for the exceptions. */
export function pairPosGlyphs(
  pairs: ReadonlyMap<number, ReadonlyMap<number, number>>,
  /** For a pair whose value changes along an axis, which delta set it changes by. */
  varying: ReadonlyMap<number, ReadonlyMap<number, number>> = NO_PAIR_SETS,
): Uint8Array {
  const firsts = [...pairs.keys()].sort((a, b) => a - b);
  const coverageBytes = coverage(firsts);
  const varies = firsts.some((first) => (varying.get(first)?.size ?? 0) > 0);

  const header = 10 + firsts.length * 2;
  const sets = firsts.map((first) => {
    const seconds = [...pairs.get(first)!.entries()].sort((a, b) => a[0] - b[0]);
    const w = new Writer();
    w.u16(seconds.length);
    if (!varies) {
      for (const [second, value] of seconds) {
        w.u16(second);
        w.i16(value);
      }
      return w.finish();
    }
    // Each pair with the place of the table saying how it changes, which is
    // counted from the start of this set and sits after its pairs.
    const devices = new DeviceTables(2 + seconds.length * 6);
    for (const [second, value] of seconds) {
      w.u16(second);
      w.i16(value);
      w.u16(devices.at(varying.get(first)?.get(second)));
    }
    w.bytesOf(devices.bytes());
    return w.finish();
  });

  let offset = header;
  const setOffsets = sets.map((set) => {
    const at = offset;
    offset += set.length;
    return at;
  });

  const w = new Writer();
  w.u16(1); // format
  w.u16(offset); // coverage offset, after the pair sets
  w.u16(varies ? 0x0044 : 0x0004); // XAdvance on the first glyph, and how it changes
  w.u16(0);
  w.u16(firsts.length);
  for (const at of setOffsets) w.u16(at);
  for (const set of sets) w.bytesOf(set);
  w.bytesOf(coverageBytes);
  return w.finish();
}

/**
 * The same pairs, in as many subtables as it takes for each to be sayable.
 *
 * Divided by first glyph, each with every pair it begins: which subtable a pair
 * is in is decided by its first glyph alone, so nothing depends on the order.
 */
const NO_PAIR_SETS: ReadonlyMap<number, ReadonlyMap<number, number>> = new Map();

export function pairPosGlyphSubtables(
  pairs: ReadonlyMap<number, ReadonlyMap<number, number>>,
  varying: ReadonlyMap<number, ReadonlyMap<number, number>> = NO_PAIR_SETS,
): Uint8Array[] {
  const out: Uint8Array[] = [];
  let taken = new Map<number, ReadonlyMap<number, number>>();
  // The header, and a coverage of at most two bytes a glyph and four of header.
  let size = 14;
  for (const first of [...pairs.keys()].sort((a, b) => a - b)) {
    const seconds = pairs.get(first)!;
    // An offset to the set, the glyph in the coverage, a count, and each pair:
    // four bytes, and where the kerning changes two more for the place of its
    // table and at most six for the table.
    const more = 2 + 2 + 2 + seconds.size * (varying.size === 0 ? 4 : 12);
    if (taken.size > 0 && size + more > SUBTABLE_LIMIT) {
      out.push(pairPosGlyphs(taken, varying));
      taken = new Map();
      size = 14;
    }
    taken.set(first, seconds);
    size += more;
  }
  if (taken.size > 0) out.push(pairPosGlyphs(taken, varying));
  return out;
}

/**
 * Wrap subtables in the scaffolding GPOS requires.
 *
 * A script list saying "any script", a feature list with one `kern` feature, and
 * a lookup list holding the subtables. `DFLT`/`dflt` is what a font with no
 * language-specific behaviour declares, and shapers fall back to it for
 * everything.
 */
/**
 * The kerning, as one lookup of its subtables.
 *
 * One lookup rather than one each, and the difference is the whole of what an
 * exception means. Within a lookup the subtables are tried in order and the
 * first that has the pair is the one applied, so the exceptions, written first,
 * win over the classes they are exceptions to. As separate lookups every one of
 * them applies, and a pair with an exception was kerned by the exception and by
 * its class together — which is how this was written until a font opened from
 * elsewhere set `To` differently once it had been exported again.
 *
 * `IgnoreMarks`, so an accent standing between two letters does not stop them
 * kerning.
 */
export function kerningLookups(subtables: readonly Uint8Array[]): Lookup[] {
  return subtables.length === 0 ? [] : [{ type: 2, flags: 0x0008, subtables: [...subtables] }];
}

export function gposTable(subtables: readonly Uint8Array[]): Uint8Array {
  return layoutTable(
    [{ tag: "kern", lookups: subtables.length === 0 ? [] : [0] }],
    kerningLookups(subtables),
    undefined,
    [],
    "GPOS",
  );
}

/**
 * Compile a font's kerning into GPOS.
 *
 * Returns an empty array when there is nothing to write, so a font without
 * kerning gets no table rather than an empty one — a `kern` feature that matches
 * nothing is worse than no feature, because it stops a shaper falling back.
 */
export function buildKerningGpos(
  index: KernIndex,
  glyphIdOf: (name: GlyphName) => number | undefined,
): Uint8Array {
  return gposTable(kerningSubtables(index, glyphIdOf));
}

/**
 * The kerning of every master of a variable font, and how to say a change.
 *
 * A variable font is kerned at its default by a value for each pair, as any
 * font is, and away from it by what each value changes by — written once in a
 * store beside the font's classes, and pointed at from the pair. So the pairs
 * are gathered from every master, each with its value in each, and a value
 * that is not the same in all of them is given a delta set.
 */
export type KerningMasters = {
  /** Every whole master's kerning, the default master's first. */
  readonly masters: readonly Kerning[];
  /** From a pair's value in each of those masters, what it changes by in each region. */
  readonly deltasOf: (values: readonly number[]) => readonly number[];
};

/** The kerning as subtables, and the delta sets its values change by: none, for one master. */
export type KerningTables = {
  readonly subtables: Uint8Array[];
  /** One row per delta set, one number per region, in the order the subtables name them. */
  readonly deltaSets: readonly (readonly number[])[];
};

/**
 * The kerning as subtables, for a caller putting a GPOS together from more than
 * one source.
 *
 * The font's kerning and whatever positioning its feature file asks for both
 * belong in one table, and only whoever writes the file can see both.
 */
export function kerningSubtables(
  index: KernIndex,
  glyphIdOf: (name: GlyphName) => number | undefined,
): Uint8Array[] {
  return kerningTables(index, glyphIdOf).subtables;
}

/** What one master's kerning says, by class and by glyph. */
type Gathered = {
  /** Group against group: a value for a class of first glyphs and a class of second. */
  readonly matrix: Map<string, number>;
  /** Everything naming a glyph on either side, as the pairs of glyphs it means. */
  readonly exceptions: Map<number, Map<number, number>>;
};

/**
 * The same, for a font of one master or of several.
 *
 * With several, the groups are the default master's: what is in a group is one
 * of the things a family's masters share, and a family whose masters disagree
 * about it is not given here.
 */
export function kerningTables(
  index: KernIndex,
  glyphIdOf: (name: GlyphName) => number | undefined,
  every?: KerningMasters,
): KerningTables {
  const { kerning } = index;
  const others = every === undefined ? [] : every.masters.slice(1);
  if (kernPairs(kerning).length === 0 && others.every((k) => kernPairs(k).length === 0)) {
    return { subtables: [], deltaSets: [] };
  }

  // Class zero means "everything not otherwise mentioned", so real groups start
  // at one — a rule against class zero would apply to the whole font.
  const class1 = new Map<number, number>();
  const class2 = new Map<number, number>();
  const class1Index = new Map<string, number>();
  const class2Index = new Map<string, number>();

  const assign = (
    groups: Readonly<Record<string, readonly GlyphName[]>>,
    classes: Map<number, number>,
    lookup: Map<string, number>,
  ): void => {
    for (const [name, glyphs] of Object.entries(groups)) {
      const ids = glyphs.map(glyphIdOf).filter((id): id is number => id !== undefined);
      if (ids.length === 0) continue;
      const klass = lookup.size + 1;
      lookup.set(name, klass);
      for (const id of ids) if (!classes.has(id)) classes.set(id, klass);
    }
  };
  assign(kerning.firstGroups, class1, class1Index);
  assign(kerning.secondGroups, class2, class2Index);

  const gather = (k: Kerning): Gathered => {
    const matrix = new Map<string, number>();
    const exceptions = new Map<number, Map<number, number>>();

    // The least particular first, so that the most particular is written last
    // and is the one that stands: a group against a glyph, then a glyph against
    // a group, then a glyph against a glyph. Each of the first two is written
    // as the pairs of glyphs it means, and in whatever order the kerning
    // happened to list them a pair named outright could be written over by one
    // that only took it in — `A V` at −10, and `A` against the group `V` is in
    // at −30 after it. The editor says the pair named outright wins, and showed
    // −10 over a font that kerned −30.
    const particular = (pair: { first: string; second: string }): number =>
      (isGroupKey(pair.first) ? 0 : 2) + (isGroupKey(pair.second) ? 0 : 1);
    const ordered = [...kernPairs(k)].sort((l, r) => particular(l) - particular(r));

    for (const pair of ordered) {
      const firstIsGroup = isGroupKey(pair.first);
      const secondIsGroup = isGroupKey(pair.second);

      if (firstIsGroup && secondIsGroup) {
        const c1 = class1Index.get(groupNameOf(pair.first));
        const c2 = class2Index.get(groupNameOf(pair.second));
        if (c1 === undefined || c2 === undefined) continue;
        matrix.set(`${String(c1)},${String(c2)}`, pair.value);
        continue;
      }

      // Anything naming a glyph on either side is an exception, and goes in the
      // pair-by-pair lookup that is tried first. A glyph against a *group* is
      // expanded, because the format has no way to say it in one rule.
      const firsts = firstIsGroup
        ? (kerning.firstGroups[groupNameOf(pair.first)] ?? [])
        : [pair.first];
      const seconds = secondIsGroup
        ? (kerning.secondGroups[groupNameOf(pair.second)] ?? [])
        : [pair.second];

      for (const first of firsts) {
        const firstId = glyphIdOf(first);
        if (firstId === undefined) continue;
        for (const second of seconds) {
          const secondId = glyphIdOf(second);
          if (secondId === undefined) continue;

          let row = exceptions.get(firstId);
          if (row === undefined) {
            row = new Map<number, number>();
            exceptions.set(firstId, row);
          }
          row.set(secondId, pair.value);
        }
      }
    }
    return { matrix, exceptions };
  };

  const home = gather(kerning);
  const { matrix, exceptions } = home;

  // ---- how each value changes, in a font of more than one master ----------------
  const deltaSets: (readonly number[])[] = [];
  const cellSets = new Map<string, number>();
  const pairSets = new Map<number, Map<number, number>>();
  if (every !== undefined && others.length > 0) {
    const all = [home, ...others.map(gather)];
    const known = new Map<string, number>();
    /** The delta set for a value in each master, or nothing where they are all one value. */
    const setOf = (values: readonly number[]): number | undefined => {
      const deltas = every.deltasOf(values).map((d) => Math.round(d));
      if (deltas.every((d) => d === 0)) return undefined;
      const key = deltas.join(",");
      let set = known.get(key);
      if (set === undefined) {
        set = deltaSets.length;
        deltaSets.push(deltas);
        known.set(key, set);
      }
      return set;
    };

    // Every cell any master kerns: its value in each, which is nothing in a
    // master that does not kern it.
    const cells = new Set(all.flatMap((m) => [...m.matrix.keys()]));
    for (const key of cells) {
      const values = all.map((m) => m.matrix.get(key) ?? 0);
      matrix.set(key, values[0] ?? 0);
      const set = setOf(values);
      if (set !== undefined) cellSets.set(key, set);
    }

    // And every pair of glyphs any master names. In a master that does not
    // name it, the pair is kerned as that master's groups kern it — which is
    // what the pair falls back to there, and so what its value there is.
    const byClass = (m: Gathered, first: number, second: number): number =>
      m.matrix.get(`${String(class1.get(first) ?? 0)},${String(class2.get(second) ?? 0)}`) ?? 0;
    const named = new Map<number, Set<number>>();
    for (const m of all) {
      for (const [first, row] of m.exceptions) {
        const seconds = named.get(first) ?? new Set<number>();
        for (const second of row.keys()) seconds.add(second);
        named.set(first, seconds);
      }
    }
    for (const [first, seconds] of named) {
      for (const second of seconds) {
        const values = all.map(
          (m) => m.exceptions.get(first)?.get(second) ?? byClass(m, first, second),
        );
        let row = exceptions.get(first);
        if (row === undefined) {
          row = new Map<number, number>();
          exceptions.set(first, row);
        }
        row.set(second, values[0] ?? 0);
        const set = setOf(values);
        if (set === undefined) continue;
        let sets = pairSets.get(first);
        if (sets === undefined) {
          sets = new Map<number, number>();
          pairSets.set(first, sets);
        }
        sets.set(second, set);
      }
    }
  }

  const firstCoverage = new Set<number>(class1.keys());

  const subtables: Uint8Array[] = [];
  if (exceptions.size > 0) subtables.push(...pairPosGlyphSubtables(exceptions, pairSets));
  if (matrix.size > 0 && firstCoverage.size > 0) {
    subtables.push(
      ...pairPosClassSubtables(
        [...firstCoverage],
        class1,
        class2,
        class1Index.size + 1,
        class2Index.size + 1,
        matrix,
        cellSets,
      ),
    );
  }

  return { subtables, deltaSets };
}

/**
 * A single adjustment, applied to every glyph it covers.
 *
 * Format 1 rather than 2: one value for the whole coverage is exactly what a
 * rule naming a class and a value says, and format 2's one-value-per-glyph
 * would be the same number written out as many times as the class is long.
 *
 * The value format names only the fields that are not zero, which is what keeps
 * `pos @caps 20;` to two bytes of value rather than eight. All four zero is a
 * rule that does nothing; it is still written, because refusing it here would
 * report a problem about a rule the file is entitled to contain.
 */
export function singlePos(glyphIds: readonly number[], value: ValueRecord): Uint8Array {
  if (glyphIds.length === 0) return new Uint8Array(0);

  const fields = [
    { bit: 0x0001, at: value.x },
    { bit: 0x0002, at: value.y },
    { bit: 0x0004, at: value.xAdvance },
    { bit: 0x0008, at: value.yAdvance },
  ].filter((f) => f.at !== 0);

  const used = fields.length > 0 ? fields : [{ bit: 0x0004, at: 0 }];
  const format = used.reduce((mask, f) => mask | f.bit, 0);

  const cover = coverage(glyphIds);
  const w = new Writer();
  w.u16(1); // format 1: one value for everything covered
  w.u16(6 + used.length * 2); // the coverage follows the value
  w.u16(format);
  for (const field of used) w.i16(field.at);
  w.bytesOf(cover);
  return w.finish();
}
