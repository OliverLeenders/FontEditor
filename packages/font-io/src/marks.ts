import {
  type Anchor,
  type Glyph,
  type GlyphName,
  isMarkAnchor,
  ligaturePart,
} from "@typewright/font-model";

import { SUBTABLE_LIMIT, Writer, coverage } from "./gpos.js";
import type { Lookup } from "./layout.js";

/**
 * Compiling anchors into the part of GPOS that puts accents on letters.
 *
 * The editor places a component by its anchors, which puts the accent in the
 * right place *in the outline*. This is the other half: the rule that lets a
 * shaper do the same thing at typesetting time, for the sequence `a` + combining
 * acute, where there is no composite glyph to place anything into.
 *
 * Three lookups come out of the same anchors. Mark-to-base attaches a mark to a
 * letter — `a` carrying `top`, an accent carrying `_top`. Mark-to-ligature
 * attaches it to one part of a ligature — `f_i` carrying `top_1` and `top_2`,
 * and the accent going over whichever of the two letters it was typed after.
 * Mark-to-mark stacks a second mark on the first, which is why an accent that
 * itself carries `top` is written into both.
 *
 * A `GDEF` glyph class table goes with them. Without it a shaper does not know
 * which glyphs are marks, and mark attachment is not reliably applied — it is
 * not optional scaffolding, it is half of how the feature works.
 */

/** An anchor table: format 1, which is a point and nothing else. */
function anchorTable(a: Anchor): Uint8Array {
  const w = new Writer();
  w.u16(1);
  w.i16(Math.round(a.pt.x));
  w.i16(Math.round(a.pt.y));
  return w.finish();
}

/** One mark glyph: which class it belongs to, and where it attaches by. */
type MarkEntry = { readonly id: number; readonly class: number; readonly anchor: Anchor };

/** One attaching glyph: a letter, or a mark another mark stacks onto. */
type BaseEntry = { readonly id: number; readonly anchors: readonly (Anchor | null)[] };

/**
 * A MarkArray: every mark, its class, and the anchor it attaches by.
 *
 * Written in coverage order, which is glyph id order — a mark record is found by
 * the index its coverage table gives, so the two lists have to agree.
 */
function markArray(marks: readonly MarkEntry[]): Uint8Array {
  const sorted = [...marks].sort((l, r) => l.id - r.id);
  const anchors = sorted.map((m) => anchorTable(m.anchor));

  const head = 2 + sorted.length * 4;
  let at = head;
  const offsets = anchors.map((a) => {
    const here = at;
    at += a.length;
    return here;
  });

  const w = new Writer();
  w.u16(sorted.length);
  for (const [i, mark] of sorted.entries()) {
    w.u16(mark.class);
    w.u16(offsets[i]!);
  }
  for (const a of anchors) w.bytesOf(a);
  return w.finish();
}

/**
 * A BaseArray (or Mark2Array — the format is the same): one row per attaching
 * glyph, one anchor per mark class.
 *
 * A base with no anchor for a class writes a null offset there, which is what
 * the format provides for and what "this letter takes a `top` but not an
 * `ogonek`" means.
 */
function baseArray(bases: readonly BaseEntry[], classCount: number): Uint8Array {
  const sorted = [...bases].sort((l, r) => l.id - r.id);

  const head = 2 + sorted.length * classCount * 2;
  let at = head;
  const tables: Uint8Array[] = [];
  const rows = sorted.map((base) =>
    Array.from({ length: classCount }, (_, c) => {
      const anchor = base.anchors[c] ?? null;
      if (anchor === null) return 0;
      const table = anchorTable(anchor);
      const here = at;
      at += table.length;
      tables.push(table);
      return here;
    }),
  );

  const w = new Writer();
  w.u16(sorted.length);
  for (const row of rows) {
    for (const off of row) w.u16(off);
  }
  for (const t of tables) w.bytesOf(t);
  return w.finish();
}

/** One ligature: for each of its parts, an anchor per mark class. */
type LigatureEntry = {
  readonly id: number;
  readonly parts: readonly (readonly (Anchor | null)[])[];
};

/**
 * A LigatureAttach: how many parts, and for each a row like a base's.
 *
 * Its anchors are found from its own start, and not from the array's as a
 * base's are, so each ligature is a table to itself.
 */
function ligatureAttach(entry: LigatureEntry, classCount: number): Uint8Array {
  let at = 2 + entry.parts.length * classCount * 2;
  const tables: Uint8Array[] = [];
  const rows = entry.parts.map((part) =>
    Array.from({ length: classCount }, (_, c) => {
      const anchor = part[c] ?? null;
      if (anchor === null) return 0;
      const table = anchorTable(anchor);
      const here = at;
      at += table.length;
      tables.push(table);
      return here;
    }),
  );

  const w = new Writer();
  w.u16(entry.parts.length);
  for (const row of rows) for (const off of row) w.u16(off);
  for (const t of tables) w.bytesOf(t);
  return w.finish();
}

/** A MarkLigPos subtable: the marks, and every ligature given with its parts. */
function ligatureSubtable(
  marks: readonly MarkEntry[],
  ligatures: readonly LigatureEntry[],
  classCount: number,
): Uint8Array {
  const sorted = [...ligatures].sort((l, r) => l.id - r.id);
  const markCoverage = coverage([...marks].map((m) => m.id).sort((a, b) => a - b));
  const ligatureCoverage = coverage(sorted.map((l) => l.id));
  const markTable = markArray(marks);

  const attached = sorted.map((l) => ligatureAttach(l, classCount));
  const array = new Writer();
  array.u16(attached.length);
  let at = 2 + attached.length * 2;
  for (const a of attached) {
    array.u16(at);
    at += a.length;
  }
  for (const a of attached) array.bytesOf(a);
  const ligatureTable = array.finish();

  const markCoverageAt = 12;
  const ligatureCoverageAt = markCoverageAt + markCoverage.length;
  const markArrayAt = ligatureCoverageAt + ligatureCoverage.length;
  const ligatureArrayAt = markArrayAt + markTable.length;

  const w = new Writer();
  w.u16(1); // format 1
  w.u16(markCoverageAt);
  w.u16(ligatureCoverageAt);
  w.u16(classCount);
  w.u16(markArrayAt);
  w.u16(ligatureArrayAt);
  w.bytesOf(markCoverage);
  w.bytesOf(ligatureCoverage);
  w.bytesOf(markTable);
  w.bytesOf(ligatureTable);
  return w.finish();
}

/** Ligatures divided as letters are, each subtable with every mark. */
function ligatureSubtables(
  marks: readonly MarkEntry[],
  ligatures: readonly LigatureEntry[],
  classCount: number,
): Uint8Array[] {
  const fixed = 12 + (4 + marks.length * 2) + (2 + marks.length * 10) + 4 + 2;
  const out: Uint8Array[] = [];
  let taken: LigatureEntry[] = [];
  let size = fixed;
  for (const ligature of [...ligatures].sort((l, r) => l.id - r.id)) {
    // Its place in the coverage, its offset in the array, its count of parts,
    // a row of offsets for each part and an anchor for each place it has.
    const places = ligature.parts.flat().filter((anchor) => anchor !== null).length;
    const more = 2 + 2 + 2 + ligature.parts.length * classCount * 2 + places * 6;
    if (taken.length > 0 && size + more > SUBTABLE_LIMIT) {
      out.push(ligatureSubtable(marks, taken, classCount));
      taken = [];
      size = fixed;
    }
    taken.push(ligature);
    size += more;
  }
  if (taken.length > 0) out.push(ligatureSubtable(marks, taken, classCount));
  return out;
}

/**
 * The same attachment, in as many subtables as it takes for each to be sayable.
 *
 * Everything in one is found by a sixteen-bit offset, and the letters of a font
 * with wide coverage are past that: three thousand of them with a place or two
 * each for an accent. Divided by the glyphs attached to, each subtable with
 * every mark: a mark is set on a letter by the subtable that covers the
 * letter, which is one of them, so nothing depends on the order.
 */
function attachmentSubtables(
  marks: readonly MarkEntry[],
  bases: readonly BaseEntry[],
  classCount: number,
): Uint8Array[] {
  // What every subtable carries whoever it attaches to: its header, the marks
  // and their coverage. A coverage is at most two bytes a glyph and four of
  // header; a mark is a record of four bytes and an anchor of six.
  const fixed = 12 + (4 + marks.length * 2) + (2 + marks.length * 10) + 4 + 2;
  const out: Uint8Array[] = [];
  let taken: BaseEntry[] = [];
  let size = fixed;
  for (const base of [...bases].sort((l, r) => l.id - r.id)) {
    // Its place in the coverage, its row of offsets, and an anchor for each
    // class it has a place for.
    const more = 2 + classCount * 2 + base.anchors.filter((anchor) => anchor !== null).length * 6;
    if (taken.length > 0 && size + more > SUBTABLE_LIMIT) {
      out.push(attachmentSubtable(marks, taken, classCount));
      taken = [];
      size = fixed;
    }
    taken.push(base);
    size += more;
  }
  if (taken.length > 0) out.push(attachmentSubtable(marks, taken, classCount));
  return out;
}

/**
 * A MarkBasePos or MarkMarkPos subtable — the two have the same shape, and
 * differ only in what the second coverage means.
 */
function attachmentSubtable(
  marks: readonly MarkEntry[],
  bases: readonly BaseEntry[],
  classCount: number,
): Uint8Array {
  const markIds = [...marks].map((m) => m.id).sort((a, b) => a - b);
  const baseIds = [...bases].map((b) => b.id).sort((a, b) => a - b);

  const markCoverage = coverage(markIds);
  const baseCoverage = coverage(baseIds);
  const markTable = markArray(marks);
  const baseTable = baseArray(bases, classCount);

  const head = 12;
  const markCoverageAt = head;
  const baseCoverageAt = markCoverageAt + markCoverage.length;
  const markArrayAt = baseCoverageAt + baseCoverage.length;
  const baseArrayAt = markArrayAt + markTable.length;

  const w = new Writer();
  w.u16(1); // format 1
  w.u16(markCoverageAt);
  w.u16(baseCoverageAt);
  w.u16(classCount);
  w.u16(markArrayAt);
  w.u16(baseArrayAt);
  w.bytesOf(markCoverage);
  w.bytesOf(baseCoverage);
  w.bytesOf(markTable);
  w.bytesOf(baseTable);
  return w.finish();
}

/** GDEF glyph classes. The three the anchors can tell apart. */
const GDEF_BASE = 1;
const GDEF_LIGATURE = 2;
const GDEF_MARK = 3;

/**
 * The places a glyph offers on its parts, where it is a ligature: one row of
 * classes for each part, as far as the highest part any anchor names.
 *
 * An anchor is on a part when its name is a class and a number — `top_2` where
 * something attaches by `_top` — and is not itself a name something attaches
 * by, which is a class of its own and an ordinary place. A glyph with no such
 * anchor is not a ligature, and `null`.
 *
 * As many parts as the highest one named, and not as many as the ligature has
 * letters. A mark typed after a part past the last is set by a shaper on the
 * last, which is what the fonts made from such sources do: a long s and i
 * with one place over the two of them takes its accent there whichever letter
 * it follows.
 */
export function ligatureParts(
  g: Glyph,
  classOf: (name: string) => number | undefined,
  classCount: number,
): (Anchor | null)[][] | null {
  const parts: (Anchor | null)[][] = [];
  for (const a of g.anchors) {
    if (isMarkAnchor(a) || classOf(a.name) !== undefined) continue;
    const numbered = ligaturePart(a.name);
    const at = numbered === null ? undefined : classOf(numbered.stem);
    if (numbered === null || at === undefined) continue;
    while (parts.length < numbered.part) {
      parts.push(Array.from({ length: classCount }, () => null));
    }
    parts[numbered.part - 1]![at] ??= a;
  }
  return parts.length === 0 ? null : parts;
}

export type MarkCompilation = {
  /**
   * Mark-to-base and mark-to-ligature, for each round of classes, and then
   * mark-to-mark for each; any may be absent.
   */
  readonly lookups: readonly Lookup[];
  /** The feature tags to register, aligned with `lookups`. */
  readonly features: readonly string[];
  /**
   * Which glyphs are marks and which are bases, for GDEF.
   *
   * The map rather than the table: GDEF also carries what the feature file
   * says — attachment classes, mark sets, ligature carets — and a font has one
   * of it, so it is written where those meet. See `gdef.ts`.
   */
  readonly classes: ReadonlyMap<number, number>;
  /**
   * The sets of marks the mark-to-mark lookups look at, each passing over
   * every other mark: glyph ids, in the order the lookups' `markFilteringSet`
   * counts them from nought. They go into GDEF after whatever sets the feature
   * file names, and the lookups' numbers are moved along by as many.
   */
  readonly markSets: readonly (readonly number[])[];
  readonly warnings: readonly string[];
};

const NOTHING: MarkCompilation = {
  lookups: [],
  features: [],
  classes: new Map(),
  markSets: [],
  warnings: [],
};

/**
 * Which lookup each class of marks is written in, counted from nought.
 *
 * A lookup gives a mark one class and one anchor. A mark that attaches by two
 * — a dot that sits at one height on round letters and another on tall ones,
 * carrying `_top` and `_top2` — is in two classes, and so in two lookups: the
 * classes are sorted into rounds, no mark in two classes of one round, and each
 * round is a lookup. Where a letter offers a place for both, the later lookup
 * is the one that stands, so the order matters and is the order the anchors
 * are in on the mark: a class is put after every class that comes before it on
 * any mark.
 *
 * A font whose marks each attach by one anchor is one round, which is every
 * font there was before a mark could have two.
 */
export function markRounds(glyphs: readonly Glyph[]): Map<string, number> {
  // The classes in the order first met, and for each the classes that come
  // before it on some mark.
  const before = new Map<string, Set<string>>();
  const shared = new Map<string, Set<string>>();
  for (const g of glyphs) {
    const names = [...new Set(g.anchors.filter(isMarkAnchor).map((a) => a.name.slice(1)))];
    for (const [i, name] of names.entries()) {
      if (!before.has(name)) before.set(name, new Set());
      if (!shared.has(name)) shared.set(name, new Set());
      for (const earlier of names.slice(0, i)) before.get(name)!.add(earlier);
      for (const other of names) if (other !== name) shared.get(name)!.add(other);
    }
  }

  // After the latest of the classes before it. Two marks that carry the same
  // two anchors in opposite orders ask for a circle, which is cut where it is
  // come back to.
  const rounds = new Map<string, number>();
  const visiting = new Set<string>();
  const roundOf = (name: string): number => {
    const known = rounds.get(name);
    if (known !== undefined) return known;
    visiting.add(name);
    let round = 0;
    for (const earlier of before.get(name) ?? []) {
      if (!visiting.has(earlier)) round = Math.max(round, roundOf(earlier) + 1);
    }
    visiting.delete(name);
    rounds.set(name, round);
    return round;
  };
  for (const name of before.keys()) roundOf(name);

  // And where a circle was cut, two classes of one mark may have landed in one
  // round: the later met is moved on until it is by itself.
  const settled: string[] = [];
  for (const name of before.keys()) {
    let round = rounds.get(name)!;
    while (settled.some((s) => rounds.get(s) === round && shared.get(name)!.has(s))) round += 1;
    rounds.set(name, round);
    settled.push(name);
  }
  return rounds;
}

/**
 * The marks that have to do with each class of marks that stack: the ones that
 * attach by its anchor, and the ones that offer a place for it. By class, in
 * the order the glyphs are given; a class nothing stacks in is not there.
 *
 * An accent stacks on the accent before it. But "before it" is among the
 * marks of its own kind: with a dot below typed between two accents above,
 * the second accent still belongs on the first. So a class's lookup is told
 * to look at these marks and pass over every other, which is a mark filtering
 * set — what the fonts made from such anchors by other tools carry too.
 */
export function stackingSets(glyphs: readonly Glyph[]): Map<string, GlyphName[]> {
  const marks = glyphs.filter((g) => g.anchors.some(isMarkAnchor));
  const classes = new Set(
    marks.flatMap((g) => g.anchors.filter(isMarkAnchor).map((a) => a.name.slice(1))),
  );
  const sets = new Map<string, GlyphName[]>();
  for (const name of classes) {
    const offering = marks.filter((g) => g.anchors.some((a) => a.name === name));
    if (offering.length === 0) continue;
    sets.set(
      name,
      marks
        .filter((g) => g.anchors.some((a) => a.name === name || a.name === `_${name}`))
        .map((g) => g.name),
    );
  }
  return sets;
}

/** `UseMarkFilteringSet`: the lookup looks only at the marks of the set it names. */
const FILTERING = 0x0010;

/**
 * Compile every glyph's anchors into mark attachment.
 *
 * The classes are the names the marks use: an accent carrying `_top` makes a
 * class called `top`, and every letter with a `top` anchor offers a place for
 * it. A base anchor nobody marks is not a class and is written nowhere — it is
 * a place for a component to land, which is the editor's business rather than
 * the shaper's.
 */
export function compileMarks(
  glyphs: readonly Glyph[],
  glyphIdOf: (name: GlyphName) => number | undefined,
): MarkCompilation {
  const rounds = markRounds(glyphs);
  if (rounds.size === 0) return NOTHING;

  // A mark is a glyph that attaches by an anchor: by each of them, where it
  // has several, the first of a name where a name is there twice.
  const markNames = new Set<GlyphName>();
  for (const g of glyphs) if (g.anchors.some(isMarkAnchor)) markNames.add(g.name);

  // A glyph with a place on a part is a ligature, and a mark is set on it by
  // the part it follows. A place it has that names no part is where a
  // component lands, and is not written: a shaper asks the ligature lookups
  // about a ligature, and no other.
  const ligatureNames = new Set<GlyphName>();
  for (const g of glyphs) {
    if (markNames.has(g.name)) continue;
    const isClass = (name: string): number | undefined => (rounds.has(name) ? 0 : undefined);
    if (ligatureParts(g, isClass, 1) !== null) ligatureNames.add(g.name);
  }

  const attaching: Lookup[] = [];
  const stacking: Lookup[] = [];
  const markSets: number[][] = [];
  const sets = stackingSets(glyphs);
  const count = Math.max(...rounds.values()) + 1;
  for (let round = 0; round < count; round++) {
    // This round's classes, numbered as its lookups number them.
    const classIndex = new Map<string, number>();
    for (const [name, at] of rounds) if (at === round) classIndex.set(name, classIndex.size);

    const marks: MarkEntry[] = [];
    for (const g of glyphs) {
      const id = glyphIdOf(g.name);
      const anchor = g.anchors.find((a) => isMarkAnchor(a) && classIndex.has(a.name.slice(1)));
      if (id === undefined || anchor === undefined) continue;
      marks.push({ id, class: classIndex.get(anchor.name.slice(1))!, anchor });
    }
    if (marks.length === 0) continue;

    /** The attaching places a glyph offers, one slot per class. */
    const placesOn = (g: Glyph): (Anchor | null)[] | null => {
      const row = Array.from({ length: classIndex.size }, () => null as Anchor | null);
      let any = false;
      for (const a of g.anchors) {
        if (isMarkAnchor(a)) continue;
        const at = classIndex.get(a.name);
        if (at === undefined) continue;
        row[at] ??= a;
        any = true;
      }
      return any ? row : null;
    };

    const bases: BaseEntry[] = [];
    const stacked: BaseEntry[] = [];
    const ligatures: LigatureEntry[] = [];
    for (const g of glyphs) {
      const id = glyphIdOf(g.name);
      if (id === undefined) continue;
      if (ligatureNames.has(g.name)) {
        const parts = ligatureParts(g, (name) => classIndex.get(name), classIndex.size);
        if (parts !== null) ligatures.push({ id, parts });
        continue;
      }
      const row = placesOn(g);
      if (row === null) continue;
      // A mark that also offers a place is where a second mark stacks — an
      // accent with a `top` of its own. It belongs to the mark-to-mark lookup,
      // and a letter belongs to mark-to-base; nothing is in both.
      if (markNames.has(g.name)) stacked.push({ id, anchors: row });
      else bases.push({ id, anchors: row });
    }

    if (bases.length > 0) {
      // Type 4, and marks are not ignored: the whole job is to position them.
      attaching.push({ type: 4, subtables: attachmentSubtables(marks, bases, classIndex.size) });
    }
    if (ligatures.length > 0) {
      attaching.push({
        type: 5,
        subtables: ligatureSubtables(marks, ligatures, classIndex.size),
      });
    }
    // Marks on marks, a class at a time: each a lookup of its own, that
    // looks only at the marks of its class and passes over the others.
    for (const [name, at] of classIndex) {
      const onto = stacked.flatMap((s) => {
        const anchor = s.anchors[at] ?? null;
        return anchor === null ? [] : [{ id: s.id, anchors: [anchor] }];
      });
      if (onto.length === 0) continue;
      const stacks = marks.filter((m) => m.class === at).map((m) => ({ ...m, class: 0 }));
      const set = (sets.get(name) ?? []).flatMap((glyph) => {
        const id = glyphIdOf(glyph);
        return id === undefined ? [] : [id];
      });
      stacking.push({
        type: 6,
        flags: FILTERING,
        markFilteringSet: markSets.length,
        subtables: attachmentSubtables(stacks, onto, 1),
      });
      markSets.push(set.sort((a, b) => a - b));
    }
  }
  if (attaching.length + stacking.length === 0) return NOTHING;

  // Every round's letters and ligatures, and then every round's marks on
  // marks: an accent on an accent is set after it has been set on the letter,
  // whichever round either was in.
  return {
    lookups: [...attaching, ...stacking],
    features: [...attaching.map(() => "mark"), ...stacking.map(() => "mkmk")],
    classes: glyphClasses(glyphs, markNames, ligatureNames, glyphIdOf),
    markSets,
    warnings: [],
  };
}

/**
 * Which glyphs are marks, and which are ordinary, for GDEF.
 *
 * Everything that attaches is a mark; a glyph with a place on a part is a
 * ligature; everything else that takes part in the attachment is a base.
 * Glyphs mentioned by none are left out, which class zero already means.
 */
function glyphClasses(
  glyphs: readonly Glyph[],
  marks: ReadonlySet<GlyphName>,
  ligatures: ReadonlySet<GlyphName>,
  glyphIdOf: (name: GlyphName) => number | undefined,
): Map<number, number> {
  const classes = new Map<number, number>();
  for (const g of glyphs) {
    const id = glyphIdOf(g.name);
    if (id === undefined) continue;
    if (marks.has(g.name)) classes.set(id, GDEF_MARK);
    else if (ligatures.has(g.name)) classes.set(id, GDEF_LIGATURE);
    else if (g.anchors.length > 0) classes.set(id, GDEF_BASE);
  }
  return classes;
}
