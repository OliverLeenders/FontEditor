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
  /** Mark-to-base, mark-to-ligature and mark-to-mark, in that order; any may be absent. */
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
  readonly warnings: readonly string[];
};

const NOTHING: MarkCompilation = {
  lookups: [],
  features: [],
  classes: new Map(),
  warnings: [],
};

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
  const warnings: string[] = [];

  // A mark is a glyph that attaches by an anchor. Which class it is in is that
  // anchor's name without the underscore.
  const marksOf = new Map<GlyphName, Anchor>();
  const classIndex = new Map<string, number>();

  for (const g of glyphs) {
    const attaching = g.anchors.filter(isMarkAnchor);
    const first = attaching[0];
    if (first === undefined) continue;

    if (attaching.length > 1) {
      // The format gives a mark one class and one anchor. Two would need the
      // glyph in two lookups, which is a different rule than the one drawn.
      warnings.push(
        `${g.name}: has ${String(attaching.length)} attaching anchors; using ${first.name}`,
      );
    }
    marksOf.set(g.name, first);
    const name = first.name.slice(1);
    if (!classIndex.has(name)) classIndex.set(name, classIndex.size);
  }

  if (classIndex.size === 0) return NOTHING;

  const marks: MarkEntry[] = [];
  for (const [name, anchor] of marksOf) {
    const id = glyphIdOf(name);
    if (id === undefined) continue;
    marks.push({ id, class: classIndex.get(anchor.name.slice(1))!, anchor });
  }
  if (marks.length === 0) return NOTHING;

  /** The attaching places a glyph offers, one slot per class. */
  const placesOn = (g: Glyph): (Anchor | null)[] | null => {
    const row = Array.from({ length: classIndex.size }, () => null as Anchor | null);
    let any = false;
    for (const a of g.anchors) {
      if (isMarkAnchor(a)) continue;
      const at = classIndex.get(a.name);
      if (at === undefined) continue;
      row[at] = a;
      any = true;
    }
    return any ? row : null;
  };

  const bases: BaseEntry[] = [];
  const stacked: BaseEntry[] = [];
  const ligatures: LigatureEntry[] = [];
  const ligatureNames = new Set<GlyphName>();
  for (const g of glyphs) {
    const id = glyphIdOf(g.name);
    if (id === undefined) continue;
    // A glyph with a place on a part is a ligature, and a mark is set on it by
    // the part it follows. A place it has that names no part is where a
    // component lands, and is not written: a shaper asks one lookup about a
    // ligature, and it is this one.
    const parts = marksOf.has(g.name)
      ? null
      : ligatureParts(g, (name) => classIndex.get(name), classIndex.size);
    if (parts !== null) {
      ligatures.push({ id, parts });
      ligatureNames.add(g.name);
      continue;
    }
    const row = placesOn(g);
    if (row === null) continue;
    // A mark that also offers a place is where a second mark stacks — an accent
    // with a `top` of its own. It belongs to the mark-to-mark lookup, and a
    // letter belongs to mark-to-base; nothing is in both.
    if (marksOf.has(g.name)) stacked.push({ id, anchors: row });
    else bases.push({ id, anchors: row });
  }

  const lookups: Lookup[] = [];
  const features: string[] = [];

  if (bases.length > 0) {
    // Type 4, and marks are not ignored: the whole job is to position them.
    lookups.push({ type: 4, subtables: attachmentSubtables(marks, bases, classIndex.size) });
    features.push("mark");
  }
  if (ligatures.length > 0) {
    lookups.push({ type: 5, subtables: ligatureSubtables(marks, ligatures, classIndex.size) });
    features.push("mark");
  }
  if (stacked.length > 0) {
    lookups.push({ type: 6, subtables: attachmentSubtables(marks, stacked, classIndex.size) });
    features.push("mkmk");
  }
  if (lookups.length === 0) return NOTHING;

  return {
    lookups,
    features,
    classes: glyphClasses(glyphs, marksOf, ligatureNames, glyphIdOf),
    warnings,
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
  marks: ReadonlyMap<GlyphName, Anchor>,
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
