import type { FontDocument } from "@typewright/font-model";

import { layoutTables, withLayoutTables } from "./export.js";
import { withAdvances } from "./hmtx.js";
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

/**
 * The last font built, and what it was built for.
 *
 * The part opentype.js writes — the character map, the names, the empty
 * outlines — was nearly all of the time a large font took, and after almost
 * every edit it is the same as last time: a spacing nudge changes an advance, a
 * kern changes a pair, and neither touches which glyphs there are or what
 * characters they stand for. So that part is kept, and rebuilt only when the
 * glyphs, their characters or the font's vertical measurements change; the
 * advances and the layout tables are written into it afresh every time.
 */
let base: { readonly key: string; readonly bytes: ArrayBuffer } | null = null;

export function exportShapingFont(document: FontDocument): ShapingFont {
  const names = document.glyphOrder.filter((name) => name !== ".notdef");
  const glyphNames = [".notdef", ...names];
  const notdef = document.glyphs[".notdef"];
  const advances = glyphNames.map((name) => {
    const g = document.glyphs[name];
    return g === undefined ? (notdef?.advance ?? document.info.unitsPerEm / 2) : g.advance;
  });

  const key = structureOf(document, glyphNames);
  if (base === null || base.key !== key) {
    base = { key, bytes: compiled(document, glyphNames, advances) };
  }

  const measured = withAdvances(new Uint8Array(base.bytes), advances);
  const ids = new Map(glyphNames.map((name, id) => [name, id]));
  const layout = layoutTables(document, (name) => ids.get(name));
  const bytes = measured.buffer.slice(
    measured.byteOffset,
    measured.byteOffset + measured.byteLength,
  ) as ArrayBuffer;
  return { bytes: withLayoutTables(bytes, layout), glyphNames };
}

/** Everything the kept part of the font depends on, as one string to compare. */
function structureOf(document: FontDocument, glyphNames: readonly string[]): string {
  const { info } = document;
  return [
    info.unitsPerEm,
    info.ascender,
    info.descender,
    ...glyphNames.map((name) => `${name} ${(document.glyphs[name]?.unicodes ?? []).join(",")}`),
  ].join("\n");
}

/** The font opentype.js writes: every glyph, its characters and its advance, no outlines. */
function compiled(
  document: FontDocument,
  glyphNames: readonly string[],
  advances: readonly number[],
): ArrayBuffer {
  const glyphs: OtGlyph[] = glyphNames.map((name, id) => {
    const unicodes = [...(document.glyphs[name]?.unicodes ?? []), NAMED_GLYPH_BASE + id];
    return new opentype.Glyph({
      name,
      advanceWidth: Math.max(0, Math.round(advances[id] ?? 0)),
      path: new opentype.Path(),
      unicode: unicodes[0]!,
      unicodes,
    });
  });

  const { info } = document;
  return new opentype.Font({
    familyName: "Shaping",
    styleName: "Regular",
    unitsPerEm: Math.round(info.unitsPerEm),
    ascender: Math.round(info.ascender),
    descender: -Math.abs(Math.round(info.descender)),
    glyphs,
  }).toArrayBuffer();
}
