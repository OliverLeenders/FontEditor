import { Writer, classDef, coverage } from "./gpos.js";

/**
 * `GDEF`: what the other two tables assume a shaper already knows.
 *
 * Four things, and this font can have all of them:
 *
 * - **Glyph classes.** Which glyphs are marks, which are letters, which are
 *   ligatures. Without it mark attachment is not reliably applied, which is why
 *   it is written whenever anchors are.
 * - **Mark attachment classes.** `lookupflag MarkAttachmentType @TOP` means
 *   "skip every mark except those", and the classes it names live here.
 * - **Mark glyph sets.** `lookupflag UseMarkFilteringSet @TOP` says the same
 *   thing the other way round — the marks to *keep* — and may name overlapping
 *   sets, which attachment classes cannot.
 * - **Ligature carets.** Where a text cursor may sit inside a ligature, so that
 *   an application can put it between the f and the i of an `f_i`.
 *
 * The version is the lowest that can hold what is asked for: 1.0 unless there
 * are mark glyph sets, which arrived in 1.2.
 */

export type GdefParts = {
  /** Glyph id to class: 1 base, 2 ligature, 3 mark, 4 component. */
  readonly classes: ReadonlyMap<number, number>;
  /** Glyph id to mark attachment class, 1 to 255. */
  readonly attach?: ReadonlyMap<number, number>;
  /** The mark glyph sets, in the order the lookups refer to them by. */
  readonly markSets?: readonly (readonly number[])[];
  /** Ligature glyph id to the caret positions in it, in design units. */
  readonly carets?: ReadonlyMap<number, readonly number[]>;
};

/** Nothing to say, which is written as no table at all. */
const NOTHING = new Uint8Array(0);

export function gdefTable(parts: GdefParts): Uint8Array {
  const classes = parts.classes.size === 0 ? NOTHING : classDef(parts.classes);
  const attach =
    parts.attach === undefined || parts.attach.size === 0 ? NOTHING : classDef(parts.attach);
  const carets = caretList(parts.carets ?? new Map());
  const sets = parts.markSets ?? [];
  const markSets = sets.length === 0 ? NOTHING : markGlyphSets(sets);

  if (classes.length === 0 && attach.length === 0 && carets.length === 0 && markSets.length === 0) {
    return NOTHING;
  }

  // Version 1.2 has one more offset in its header, so where each table lands
  // depends on which version this is.
  const header = markSets.length === 0 ? 12 : 14;
  let at = header;
  const place = (table: Uint8Array): number => {
    if (table.length === 0) return 0;
    const here = at;
    at += table.length;
    return here;
  };

  // In the order the header lists them, so the offsets come out ascending.
  const classesAt = place(classes);
  const attachListAt = 0; // No attachment points: that is hinting, not shaping.
  const caretsAt = place(carets);
  const markAttachAt = place(attach);
  const markSetsAt = place(markSets);

  const w = new Writer();
  w.u16(1);
  w.u16(markSets.length === 0 ? 0 : 2);
  w.u16(classesAt);
  w.u16(attachListAt);
  w.u16(caretsAt);
  w.u16(markAttachAt);
  if (markSets.length > 0) w.u16(markSetsAt);
  w.bytesOf(classes);
  w.bytesOf(carets);
  w.bytesOf(attach);
  w.bytesOf(markSets);
  return w.finish();
}

/**
 * The ligature caret list: per ligature, where a cursor may sit inside it.
 *
 * Written as coordinates in design units — format 1 — rather than as contour
 * points, which is the other format and ties the caret to an outline that
 * moves when the glyph is redrawn.
 */
function caretList(carets: ReadonlyMap<number, readonly number[]>): Uint8Array {
  const ligatures = [...carets]
    .filter(([, positions]) => positions.length > 0)
    .sort(([left], [right]) => left - right);
  if (ligatures.length === 0) return NOTHING;

  const tables = ligatures.map(([, positions]) => {
    const head = 2 + positions.length * 2;
    const w = new Writer();
    w.u16(positions.length);
    for (const [index] of positions.entries()) w.u16(head + index * 4);
    for (const position of positions) {
      w.u16(1); // format 1: a coordinate in design units
      w.i16(Math.round(position));
    }
    return w.finish();
  });

  const cover = coverage(ligatures.map(([id]) => id));
  const header = 4 + tables.length * 2;
  let at = header + cover.length;
  const offsets = tables.map((table) => {
    const here = at;
    at += table.length;
    return here;
  });

  const w = new Writer();
  w.u16(header); // the coverage sits after the offsets
  w.u16(tables.length);
  for (const off of offsets) w.u16(off);
  w.bytesOf(cover);
  for (const table of tables) w.bytesOf(table);
  return w.finish();
}

/**
 * The mark glyph sets: a coverage table each, reached by 32-bit offsets.
 *
 * Wide offsets because the format says so — the sets are the one part of GDEF
 * that can be long enough to need them.
 */
function markGlyphSets(sets: readonly (readonly number[])[]): Uint8Array {
  const covers = sets.map((ids) => coverage(ids));
  const header = 4 + covers.length * 4;
  let at = header;
  const offsets = covers.map((cover) => {
    const here = at;
    at += cover.length;
    return here;
  });

  const w = new Writer();
  w.u16(1); // format 1, the only one
  w.u16(covers.length);
  for (const off of offsets) w.u32(off);
  for (const cover of covers) w.bytesOf(cover);
  return w.finish();
}
