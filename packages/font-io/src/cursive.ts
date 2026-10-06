import { type Anchor, type Glyph, type GlyphName, isMarkAnchor } from "@typewright/font-model";

import { SUBTABLE_LIMIT, Writer, coverage } from "./gpos.js";
import type { Lookup } from "./layout.js";

/**
 * Compiling anchors into the part of GPOS that joins one letter to the next.
 *
 * In a script written joined up and on a slope — Nastaliq, where a word starts
 * high and falls to the baseline — a letter does not sit on the line. It sits
 * where the letter before it left off. Each glyph says where it is joined to
 * and where the next is to join it: an `entry` and an `exit`, the names the
 * sources of other tools keep. A shaper sets each glyph so that its entry is on
 * the exit of the one before, and a word of five letters is five steps down a
 * stair nobody drew.
 *
 * One lookup of cursive attachment, in the `curs` feature. It passes over
 * marks, since a dot between two letters does not come between their joining;
 * and it is read from the end of the word, so that the last letter stays on
 * the line and the ones before it are lifted — the way such a script is
 * written, and the flags the fonts made from such sources carry.
 */

/** The names of the two anchors a glyph is joined by. */
export const ENTRY = "entry";
export const EXIT = "exit";

/** `RightToLeft`, which says which of two joined glyphs is the one moved, and `IgnoreMarks`. */
export const CURSIVE_FLAGS = 0x0001 | 0x0008;

/** Where a glyph is joined: either may be missing, a letter that begins a word having no entry. */
export type Joins = { readonly entry: Anchor | null; readonly exit: Anchor | null };

/**
 * The joins a glyph has, or `null` for one with neither.
 *
 * `isMarkClass` says whether a name is one a mark attaches by — a font in which
 * something carries `_exit` means a place for an accent by it, and no join.
 */
export function joinsOf(g: Glyph, isMarkClass: (name: string) => boolean): Joins | null {
  const named = (name: string): Anchor | null =>
    isMarkClass(name) ? null : (g.anchors.find((a) => a.name === name) ?? null);
  const entry = named(ENTRY);
  const exit = named(EXIT);
  return entry === null && exit === null ? null : { entry, exit };
}

/** The names marks attach by, across a font: what an anchor called `exit` must not be among. */
export function markClassNames(glyphs: readonly Glyph[]): Set<string> {
  const names = new Set<string>();
  for (const g of glyphs) {
    for (const a of g.anchors) if (isMarkAnchor(a)) names.add(a.name.slice(1));
  }
  return names;
}

type Joined = { readonly id: number; readonly joins: Joins };

function anchorTable(a: Anchor): Uint8Array {
  const w = new Writer();
  w.u16(1);
  w.i16(Math.round(a.pt.x));
  w.i16(Math.round(a.pt.y));
  return w.finish();
}

/** A CursivePos subtable: each glyph's entry and exit, found from the subtable's start. */
function cursiveSubtable(glyphs: readonly Joined[]): Uint8Array {
  const sorted = [...glyphs].sort((l, r) => l.id - r.id);
  const covered = coverage(sorted.map((g) => g.id));

  const head = 6 + sorted.length * 4;
  let at = head + covered.length;
  const tables: Uint8Array[] = [];
  const placed = (a: Anchor | null): number => {
    if (a === null) return 0;
    const table = anchorTable(a);
    const here = at;
    at += table.length;
    tables.push(table);
    return here;
  };
  const records = sorted.map((g) => [placed(g.joins.entry), placed(g.joins.exit)] as const);

  const w = new Writer();
  w.u16(1); // format 1
  w.u16(head);
  w.u16(sorted.length);
  for (const [entry, exit] of records) {
    w.u16(entry);
    w.u16(exit);
  }
  w.bytesOf(covered);
  for (const t of tables) w.bytesOf(t);
  return w.finish();
}

/** As many subtables as it takes for each to be sayable, divided by the glyphs joined. */
function cursiveSubtables(glyphs: readonly Joined[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  let taken: Joined[] = [];
  let size = 6 + 4;
  for (const g of [...glyphs].sort((l, r) => l.id - r.id)) {
    // Its place in the coverage, its record, and an anchor for each join it has.
    const more = 2 + 4 + (g.joins.entry === null ? 0 : 6) + (g.joins.exit === null ? 0 : 6);
    if (taken.length > 0 && size + more > SUBTABLE_LIMIT) {
      out.push(cursiveSubtable(taken));
      taken = [];
      size = 6 + 4;
    }
    taken.push(g);
    size += more;
  }
  if (taken.length > 0) out.push(cursiveSubtable(taken));
  return out;
}

/**
 * Compile every glyph's `entry` and `exit` into cursive attachment: one lookup
 * for the `curs` feature, or none where no glyph is joined to another.
 */
export function compileCursive(
  glyphs: readonly Glyph[],
  glyphIdOf: (name: GlyphName) => number | undefined,
): Lookup[] {
  const classes = markClassNames(glyphs);
  const joined: Joined[] = [];
  for (const g of glyphs) {
    const id = glyphIdOf(g.name);
    const joins = joinsOf(g, (name) => classes.has(name));
    if (id !== undefined && joins !== null) joined.push({ id, joins });
  }
  if (joined.length === 0) return [];
  return [{ type: 3, flags: CURSIVE_FLAGS, subtables: cursiveSubtables(joined) }];
}
