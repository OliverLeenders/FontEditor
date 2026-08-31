import type { Glyph } from "./glyph.js";
import { type Kerning, EMPTY_KERNING } from "./kerning.js";

export type GlyphName = string;

/**
 * The font's own measurements, in design units.
 *
 * These are what the editor draws guides from and what a compiler writes into
 * `head`, `hhea` and `OS/2`. Kept deliberately small for now — the full UFO
 * `fontinfo` has upwards of eighty fields, and adding them before anything reads
 * them would be inventing work.
 */
export type FontInfo = {
  readonly familyName: string;
  readonly styleName: string;
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  readonly xHeight: number;
  readonly capHeight: number;
};

export const DEFAULT_FONT_INFO: FontInfo = {
  familyName: "Untitled",
  styleName: "Regular",
  unitsPerEm: 1000,
  ascender: 750,
  descender: -250,
  xHeight: 500,
  capHeight: 700,
};

/**
 * The part of the editor's state that history versions.
 *
 * Glyphs are held in a map keyed by name, with a separate ordering. That is
 * UFO's arrangement and it earns its keep twice over: lookup by name is what
 * components and the glyph strip need, and ordering is a property of the font
 * rather than of the glyphs, so renaming one does not disturb where it sits.
 *
 * Everything inside is undoable; everything outside — the camera, what is
 * hovered, a gesture in flight — is not.
 */
export type FontDocument = {
  readonly info: FontInfo;
  readonly glyphOrder: readonly GlyphName[];
  readonly glyphs: Readonly<Record<GlyphName, Glyph>>;
  /**
   * Kerning belongs to the font, not to a glyph.
   *
   * A pair is a relationship between two of them, so storing it on either would
   * make one glyph's file the owner of a fact about another — and moving or
   * deleting that glyph would take the pair with it.
   */
  readonly kerning: Kerning;
};

export function fontDocument(
  glyphs: readonly Glyph[] = [],
  info: FontInfo = DEFAULT_FONT_INFO,
): FontDocument {
  const map: Record<GlyphName, Glyph> = {};
  const order: GlyphName[] = [];
  for (const g of glyphs) {
    if (!(g.name in map)) order.push(g.name);
    map[g.name] = g;
  }
  return { info, glyphOrder: order, glyphs: map, kerning: EMPTY_KERNING };
}

export function glyphNamed(document: FontDocument, name: GlyphName): Glyph | null {
  return document.glyphs[name] ?? null;
}

export function glyphCount(document: FontDocument): number {
  return document.glyphOrder.length;
}

/** Every glyph in font order. Order is the font's, not the map's. */
export function orderedGlyphs(document: FontDocument): Glyph[] {
  const out: Glyph[] = [];
  for (const name of document.glyphOrder) {
    const g = document.glyphs[name];
    if (g !== undefined) out.push(g);
  }
  return out;
}

/**
 * Add a glyph, or replace one of the same name in place.
 *
 * Returns the same document when the glyph is already there and unchanged —
 * reference equality, which is what lets the history and autosave layers tell
 * "nothing happened" from "something did" without any bookkeeping.
 */
export function putGlyph(document: FontDocument, glyph: Glyph): FontDocument {
  if (document.glyphs[glyph.name] === glyph) return document;

  const glyphs = { ...document.glyphs, [glyph.name]: glyph };
  const glyphOrder = glyph.name in document.glyphs
    ? document.glyphOrder
    : [...document.glyphOrder, glyph.name];
  return { ...document, glyphOrder, glyphs };
}

export function removeGlyph(document: FontDocument, name: GlyphName): FontDocument | null {
  if (!(name in document.glyphs)) return null;
  const glyphs = { ...document.glyphs };
  delete glyphs[name];
  return {
    ...document,
    glyphOrder: document.glyphOrder.filter((candidate) => candidate !== name),
    glyphs,
  };
}

/**
 * Apply a pure edit to one glyph by name.
 *
 * `null` from the operation means it declined, and that propagates — a failed
 * edit never half-applies.
 */
export function updateGlyph(
  document: FontDocument,
  name: GlyphName,
  operation: (glyph: Glyph) => Glyph | null,
): FontDocument | null {
  const existing = document.glyphs[name];
  if (existing === undefined) return null;
  const next = operation(existing);
  if (next === null) return null;
  return putGlyph(document, next);
}

export function setFontInfo(document: FontDocument, info: FontInfo): FontDocument {
  return { ...document, info };
}

export function setGlyphOrder(
  document: FontDocument,
  glyphOrder: readonly GlyphName[],
): FontDocument {
  return { ...document, glyphOrder };
}

// ---------------------------------------------------------------------------
// character lookup
// ---------------------------------------------------------------------------

/**
 * The glyph carrying a given code point, or `null`.
 *
 * Named for what it takes. It was `glyphForCharacter`, which reads as though a
 * string would do and cost one failing test before anyone noticed.
 *
 * Built by scanning rather than kept as an index, because the map is small and a
 * cached index is one more thing that can fall out of step with the document.
 * Revisit if a real font makes it slow — which would mean thousands of glyphs
 * and a hot loop, neither of which exists yet.
 */
export function glyphForCodePoint(document: FontDocument, codePoint: number): Glyph | null {
  for (const name of document.glyphOrder) {
    const g = document.glyphs[name];
    if (g !== undefined && g.unicodes.includes(codePoint)) return g;
  }
  return null;
}

/**
 * Resolve a string to glyphs, one entry per character, `null` where the font has
 * nothing for it.
 *
 * Iterating the string directly rather than by index so astral characters —
 * anything above U+FFFF, which is two UTF-16 units — resolve as one character
 * instead of two broken halves.
 */
export function glyphsForString(document: FontDocument, text: string): Array<Glyph | null> {
  const out: Array<Glyph | null> = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    out.push(codePoint === undefined ? null : glyphForCodePoint(document, codePoint));
  }
  return out;
}


/** Replace the font's kerning, leaving the glyphs alone. */
export function setKerning(document: FontDocument, kerning: Kerning): FontDocument {
  return kerning === document.kerning ? document : { ...document, kerning };
}
