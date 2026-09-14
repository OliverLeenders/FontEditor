import type { FontDocument } from "@typewright/font-model";

import { layoutTables, withLayoutTables } from "./export.js";
import { opentype } from "./opentype.js";
import type { OtGlyph } from "opentype.js";

/**
 * A font compiled for setting text and nothing else.
 *
 * A shaper needs a font file: the character map, the advances, and the layout
 * tables. It does not need outlines, and outlines are nearly all of what an
 * export costs — joining overlaps and correcting directions for every glyph took
 * most of a second for a few hundred of them, which is not something to do on
 * every nudge of a sidebearing. So this is the same font with every outline
 * left empty: the substitutions, kerning and mark attachment are compiled
 * exactly as the export compiles them, and the preview draws the glyphs from the
 * document by the ids the shaper hands back.
 *
 * The advances are the document's own, not what its spacing keys resolve to,
 * because what is drawn is the document's own outlines at the document's own
 * positions; a proof whose glyphs sat where the keys said and whose outlines sat
 * where they were drawn would disagree with itself.
 */
export type ShapingFont = {
  readonly bytes: ArrayBuffer;
  /** Glyph names by glyph id: what the shaper's ids mean. */
  readonly glyphNames: readonly string[];
};

/**
 * Where each glyph's private code point starts, in Supplementary Private Use
 * Area A.
 *
 * A glyph with no character — `a.001`, a ligature, a `.case` mark — cannot be
 * asked for by typing, and a shaper takes characters, not glyphs. So every
 * glyph is also mapped from a code point of its own here, its id above this
 * base, and a glyph named in a line of text is set by that code point. The area
 * is reserved for private agreements like this one and no real text uses it.
 */
export const NAMED_GLYPH_BASE = 0xf0000;

export function exportShapingFont(document: FontDocument): ShapingFont {
  const names = document.glyphOrder.filter((name) => name !== ".notdef");
  const glyphNames = [".notdef", ...names];
  const notdef = document.glyphs[".notdef"];

  const glyphs: OtGlyph[] = glyphNames.map((name, id) => {
    const g = document.glyphs[name];
    const advance = g === undefined ? (notdef?.advance ?? document.info.unitsPerEm / 2) : g.advance;
    const unicodes = [...(g?.unicodes ?? []), NAMED_GLYPH_BASE + id];
    return new opentype.Glyph({
      name,
      advanceWidth: Math.max(0, Math.round(advance)),
      path: new opentype.Path(),
      unicode: unicodes[0]!,
      unicodes,
    });
  });

  const { info } = document;
  const font = new opentype.Font({
    familyName: "Shaping",
    styleName: "Regular",
    unitsPerEm: Math.round(info.unitsPerEm),
    ascender: Math.round(info.ascender),
    descender: -Math.abs(Math.round(info.descender)),
    glyphs,
  });

  const ids = new Map(glyphNames.map((name, id) => [name, id]));
  const layout = layoutTables(document, (name) => ids.get(name));
  return { bytes: withLayoutTables(font.toArrayBuffer(), layout), glyphNames };
}
