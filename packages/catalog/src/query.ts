import { glyphNameForCodePoint } from "@typewright/font-model";

import { UNICODE_BLOCKS, blockOf } from "./blocks.js";
import type { CatalogEntry } from "./catalog.js";

/**
 * A named group of glyphs, for the browser's filter list.
 *
 * The predicate is not serializable and is not meant to be — what gets stored,
 * and what appears in a URL or a restored session, is the `id`. That keeps the
 * saved state a short string rather than a snapshot of a function's behaviour.
 */
export type GlyphSet = {
  readonly id: string;
  readonly label: string;
  readonly includes: (entry: CatalogEntry) => boolean;
};

/**
 * The sets that are about a glyph's state rather than its code point.
 *
 * "Drawn" is the one a designer reaches for most — it answers "what have I
 * actually done so far" — which is why it sits near the top rather than after
 * thirty Unicode blocks.
 */
const STATE_SETS: readonly GlyphSet[] = [
  { id: "all", label: "All glyphs", includes: () => true },
  { id: "drawn", label: "Drawn", includes: (e) => e.drawn },
  { id: "undrawn", label: "Not yet drawn", includes: (e) => !e.drawn },
  { id: "encoded", label: "Encoded", includes: (e) => e.codePoint !== null },
  { id: "unencoded", label: "Unencoded", includes: (e) => e.codePoint === null },
  {
    id: "ascii",
    label: "ASCII",
    includes: (e) => e.codePoint !== null && e.codePoint >= 0x20 && e.codePoint <= 0x7e,
  },
];

/** Every set the browser can filter by: states first, then Unicode blocks. */
export const GLYPH_SETS: readonly GlyphSet[] = [
  ...STATE_SETS,
  ...UNICODE_BLOCKS.map((block): GlyphSet => ({
    id: `block:${block.id}`,
    label: block.label,
    includes: (e) => e.block?.id === block.id,
  })),
];

export function glyphSet(id: string): GlyphSet | null {
  return GLYPH_SETS.find((s) => s.id === id) ?? null;
}

/**
 * The code points a set covers, or `null` for one that is about glyph state.
 *
 * "Basic Latin" is a range and can be filled in; "Drawn" is a property of the
 * glyphs already present and cannot. That distinction is what decides whether
 * offering to create the missing ones makes any sense.
 *
 * Control characters are left out of every block. Basic Latin and Latin-1
 * Supplement begin with them — U+0000 to U+001F, U+007F, U+0080 to U+009F — and
 * they are instructions to a terminal, not letters: no font draws them, and a
 * font that maps U+0000 to anything but `.null` is one opentype.js will not
 * write. Offered as missing, they were thirty-three empty glyphs nobody asked
 * for, created by pressing "Add missing" on Basic Latin.
 */
export function codePointsOfSet(id: string): number[] | null {
  if (id === "ascii") return range(0x20, 0x7e);

  if (!id.startsWith("block:")) return null;
  const block = UNICODE_BLOCKS.find((b) => `block:${b.id}` === id);
  if (block === undefined) return null;

  // Whole planes are legitimate blocks and nobody wants twenty thousand empty
  // glyphs by accident, so a very large block declines rather than obliges.
  if (block.last - block.first > 512) return null;
  return range(block.first, block.last).filter((codePoint) => !isControl(codePoint));
}

/** Whether a code point is a control character, general category Cc. */
function isControl(codePoint: number): boolean {
  return /\p{Cc}/u.test(String.fromCodePoint(codePoint));
}

function range(first: number, last: number): number[] {
  const out: number[] = [];
  for (let c = first; c <= last; c++) out.push(c);
  return out;
}

export type CatalogOrder = "font" | "codePoint" | "name";

export type CatalogQuery = {
  /** A set id; an unknown one is treated as "all" rather than showing nothing. */
  readonly set: string;
  readonly search: string;
  readonly order: CatalogOrder;
};

export const DEFAULT_QUERY: CatalogQuery = { set: "all", search: "", order: "font" };

/**
 * Work out what the user meant by what they typed.
 *
 * Three things get typed into a glyph search and they want different matches:
 * a name or part of one, a code point in any of the notations people write, and
 * the character itself. Guessing between them is the difference between a search
 * box that feels obvious and one you have to learn.
 */
type Search =
  | { readonly kind: "empty" }
  | { readonly kind: "codePoint"; readonly value: number }
  | { readonly kind: "text"; readonly value: string; readonly codePoint: number | null };

function parseSearch(raw: string): Search {
  const text = raw.trim();
  if (text === "") return { kind: "empty" };

  // U+0041, u+41, 0x41 — an explicit code point, so match only that.
  const explicit = /^(?:u\+|0x)([0-9a-f]{1,6})$/i.exec(text);
  if (explicit !== null) {
    const value = Number.parseInt(explicit[1]!, 16);
    if (Number.isFinite(value)) return { kind: "codePoint", value };
  }

  // A single typed character means both things at once: someone typing "A"
  // wants U+0041, and someone typing "o" probably wants every name containing
  // an o. Match either, rather than choosing wrong half the time.
  const characters = [...text];
  const single = characters.length === 1 ? (characters[0]?.codePointAt(0) ?? null) : null;
  return { kind: "text", value: text.toLowerCase(), codePoint: single };
}

function matches(entry: CatalogEntry, search: Search): boolean {
  if (search.kind === "empty") return true;
  if (search.kind === "codePoint") return entry.unicodes.includes(search.value);

  if (search.codePoint !== null && entry.unicodes.includes(search.codePoint)) return true;
  return entry.name.toLowerCase().includes(search.value);
}

/**
 * Order for display.
 *
 * Font order is the default and is deliberately *not* a sort: it is the order
 * the font itself declares, which is meaningful — `.notdef` first, related
 * glyphs adjacent — and re-sorting it alphabetically throws that away.
 *
 * Unencoded glyphs sort after encoded ones rather than being scattered by a
 * `null`, so a code-point sort reads as one ascending run with the leftovers
 * gathered at the end.
 */
function ordered<T extends CatalogEntry>(entries: T[], order: CatalogOrder): T[] {
  if (order === "font") return entries;
  if (order === "name") return [...entries].sort((a, b) => a.name.localeCompare(b.name));

  return [...entries].sort((a, b) => {
    if (a.codePoint === null && b.codePoint === null) return a.name.localeCompare(b.name);
    if (a.codePoint === null) return 1;
    if (b.codePoint === null) return -1;
    return a.codePoint - b.codePoint;
  });
}

/**
 * A cell of the browser: a glyph the font has, or a code point it has not.
 *
 * The second kind is why this exists. A font is browsed to find what to draw
 * next as much as to find what is drawn, and a list of what is already there
 * cannot answer "which of Latin Extended-A am I missing" — the glyphs that are
 * missing are precisely the ones with nothing to list. So a set that covers a
 * known range of code points lists the whole range, and the holes are cells of
 * their own.
 *
 * Shaped like an entry rather than a second type beside it, so that everything
 * which reads a cell — the grid, the keyboard, the tip — goes on reading one
 * thing. What it does *not* have is stated in the fields it already had: no
 * outline, no advance, no nodes. `inFont` is the one new fact.
 */
export type Listed = CatalogEntry & {
  /** False for a code point the font has no glyph for: a cell to be made, not one to open. */
  readonly inFont: boolean;
};

/** What a code point the font has not got looks like in the list. */
function absentEntry(codePoint: number): Listed {
  return {
    name: glyphNameForCodePoint(codePoint),
    codePoint,
    unicodes: [codePoint],
    advance: 0,
    contourCount: 0,
    nodeCount: 0,
    drawn: false,
    block: blockOf(codePoint),
    inFont: false,
  };
}

/**
 * The cells to show: the glyphs a query keeps, and the code points it covers
 * that the font has not got.
 *
 * Two sources of a hole. A set that is a range — a Unicode block, ASCII — knows
 * every code point it covers, so every one of them with no glyph is listed.
 * And a search that names a character the font has not got offers it: typing
 * `ä` to look for a glyph that is not there should not answer with an empty
 * grid, which says only that the search box works.
 *
 * Whether a code point is in the font is asked of the whole catalog rather than
 * of what the query kept, since a glyph filtered out of sight is still in the
 * font and offering to make a second one would be a bug wearing a feature's
 * clothes.
 *
 * In font order the holes follow the glyphs: a glyph the font has not got has
 * no place in the order the font declares. In the other two orders they fall
 * where they belong — which is what makes a block read as a chart with gaps.
 */
export function listCatalog(entries: readonly CatalogEntry[], query: CatalogQuery): Listed[] {
  const set = glyphSet(query.set);
  const search = parseSearch(query.search);

  const kept: Listed[] = entries
    .filter((entry) => (set === null || set.includes(entry)) && matches(entry, search))
    .map((entry) => ({ ...entry, inFont: true }));

  const held = new Set<number>();
  for (const entry of entries) for (const code of entry.unicodes) held.add(code);

  const wanted = new Set<number>();
  for (const code of codePointsOfSet(query.set) ?? []) {
    if (!held.has(code)) wanted.add(code);
  }
  // The character searched for, whatever set is showing: the search is the more
  // particular thing somebody asked for, and a set is where they happened to be.
  const asked =
    search.kind === "codePoint" ? search.value : search.kind === "text" ? search.codePoint : null;
  if (asked !== null && !held.has(asked)) wanted.add(asked);

  const missing = [...wanted]
    .sort((a, b) => a - b)
    .map(absentEntry)
    .filter((entry) => matches(entry, search));
  if (missing.length === 0) return ordered(kept, query.order);

  return query.order === "font"
    ? [...kept, ...missing]
    : ordered([...kept, ...missing], query.order);
}

/** Apply a query to a catalog. */
export function filterCatalog(
  entries: readonly CatalogEntry[],
  query: CatalogQuery,
): CatalogEntry[] {
  const set = glyphSet(query.set);
  const search = parseSearch(query.search);

  const kept = entries.filter(
    (entry) => (set === null || set.includes(entry)) && matches(entry, search),
  );
  return ordered(kept, query.order);
}

/**
 * How many glyphs each set would show, for counts beside the filter names.
 *
 * Computed in one pass over the entries rather than by running every predicate
 * over every glyph independently — that would be thirty-odd passes over a few
 * thousand glyphs on each keystroke.
 */
export function setCounts(entries: readonly CatalogEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const set of GLYPH_SETS) counts.set(set.id, 0);

  for (const entry of entries) {
    for (const set of GLYPH_SETS) {
      if (set.includes(entry)) counts.set(set.id, (counts.get(set.id) ?? 0) + 1);
    }
  }
  return counts;
}
