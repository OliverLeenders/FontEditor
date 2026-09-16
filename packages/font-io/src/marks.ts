import { type Anchor, type Glyph, type GlyphName, isMarkAnchor } from "@typewright/font-model";

import { Writer, coverage } from "./gpos.js";
import type { Lookup } from "./layout.js";

/**
 * Compiling anchors into the part of GPOS that puts accents on letters.
 *
 * The editor places a component by its anchors, which puts the accent in the
 * right place *in the outline*. This is the other half: the rule that lets a
 * shaper do the same thing at typesetting time, for the sequence `a` + combining
 * acute, where there is no composite glyph to place anything into.
 *
 * Two lookups come out of the same anchors. Mark-to-base attaches a mark to a
 * letter — `a` carrying `top`, an accent carrying `_top`. Mark-to-mark stacks a
 * second mark on the first, which is why an accent that itself carries `top` is
 * written into both.
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

/** GDEF glyph classes. The two this font can tell apart are base and mark. */
const GDEF_BASE = 1;
const GDEF_MARK = 3;

export type MarkCompilation = {
  /** Mark-to-base and mark-to-mark, in that order; either may be absent. */
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
  for (const g of glyphs) {
    const row = placesOn(g);
    const id = glyphIdOf(g.name);
    if (row === null || id === undefined) continue;
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
    lookups.push({ type: 4, subtables: [attachmentSubtable(marks, bases, classIndex.size)] });
    features.push("mark");
  }
  if (stacked.length > 0) {
    lookups.push({ type: 6, subtables: [attachmentSubtable(marks, stacked, classIndex.size)] });
    features.push("mkmk");
  }
  if (lookups.length === 0) return NOTHING;

  return { lookups, features, classes: glyphClasses(glyphs, marksOf, glyphIdOf), warnings };
}

/**
 * Which glyphs are marks, and which are ordinary, for GDEF.
 *
 * Everything that attaches is a mark; everything else that takes part in the
 * attachment is a base. Glyphs mentioned by neither are left out, which class
 * zero already means.
 */
function glyphClasses(
  glyphs: readonly Glyph[],
  marks: ReadonlyMap<GlyphName, Anchor>,
  glyphIdOf: (name: GlyphName) => number | undefined,
): Map<number, number> {
  const classes = new Map<number, number>();
  for (const g of glyphs) {
    const id = glyphIdOf(g.name);
    if (id === undefined) continue;
    if (marks.has(g.name)) classes.set(id, GDEF_MARK);
    else if (g.anchors.length > 0) classes.set(id, GDEF_BASE);
  }
  return classes;
}
