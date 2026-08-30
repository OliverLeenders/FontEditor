import type { Glyph } from "./glyph.js";

/**
 * The part of the editor's state that history versions.
 *
 * A wrapper around a single glyph today, which looks thin — but drawing the line
 * here is the point. Everything inside is undoable; everything outside it (the
 * camera, what is hovered, a gesture in flight) is not. Without an explicit
 * boundary, undo eventually rewinds someone's zoom.
 *
 * At phase 4 this grows into the whole project — glyph order, kerning, features,
 * font info — and because the boundary already exists, that growth is additive:
 * nothing has to be reclassified as undoable later.
 */
export type FontDocument = {
  readonly glyph: Glyph;
};

export function fontDocument(glyph: Glyph): FontDocument {
  return { glyph };
}

export function withGlyph(document: FontDocument, glyph: Glyph): FontDocument {
  return glyph === document.glyph ? document : { ...document, glyph };
}
