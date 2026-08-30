import type { FontDocument, Glyph, GlyphName } from "@fonteditor/font-model";

import { type UnicodeBlock, blockOf } from "./blocks.js";

/**
 * What the browser needs to know about a glyph to list it.
 *
 * Derived once from the document rather than recomputed per cell. A grid over a
 * few thousand glyphs asks "is this drawn?" and "what block is it in?" on every
 * filter keystroke, and walking each glyph's contours to answer is what turns a
 * responsive filter into a stuttering one.
 */
export type CatalogEntry = {
  readonly name: GlyphName;
  /** The lowest code point mapped to this glyph, or `null` if unencoded. */
  readonly codePoint: number | null;
  readonly unicodes: readonly number[];
  readonly advance: number;
  readonly contourCount: number;
  readonly nodeCount: number;
  /** Has an outline. A space is encoded and perfectly valid, but not drawn. */
  readonly drawn: boolean;
  readonly block: UnicodeBlock | null;
};

function entryFor(g: Glyph): CatalogEntry {
  let nodeCount = 0;
  for (const c of g.contours) nodeCount += c.nodes.length;

  // The lowest, not the first listed: a glyph mapped from several code points
  // should sort and display by the same one every time, whatever order the
  // font's cmap happened to be in.
  const codePoint = g.unicodes.length === 0 ? null : Math.min(...g.unicodes);

  return {
    name: g.name,
    codePoint,
    unicodes: g.unicodes,
    advance: g.advance,
    contourCount: g.contours.length,
    nodeCount,
    drawn: nodeCount > 0,
    block: codePoint === null ? null : blockOf(codePoint),
  };
}

/** Every glyph in the document, in the font's own order. */
export function catalog(document: FontDocument): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const name of document.glyphOrder) {
    const g = document.glyphs[name];
    if (g !== undefined) entries.push(entryFor(g));
  }
  return entries;
}
