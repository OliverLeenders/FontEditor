import { EMPTY_KERNING, fontDocument, glyph, setKern, setKerning } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { opentype } from "../src/opentype.js";
import { readTablesOf } from "../src/sfnt.js";
import { NAMED_GLYPH_BASE, exportShapingFont } from "../src/shaping-font.js";

/**
 * The font a preview is shaped with: every glyph, every rule, no outlines.
 */

function document() {
  const font = fontDocument([
    glyph("f", { unicodes: [0x66], advance: 300 }),
    glyph("i", { unicodes: [0x69], advance: 250 }),
    glyph("f_i", { advance: 520 }),
    glyph("i.alt", { advance: 400, metricKeys: { left: "", right: "", width: "f" } }),
  ]);
  return setKerning(
    { ...font, features: "feature liga {\n  sub f i by f_i;\n} liga;\n" },
    setKern(EMPTY_KERNING, "f", "i", -30),
  );
}

const tagsOf = (bytes: ArrayBuffer) => readTablesOf(new Uint8Array(bytes)).map((t) => t.tag);

describe("the shaping font", () => {
  it("puts .notdef first and every glyph after it in the font's order", () => {
    expect(exportShapingFont(document()).glyphNames).toEqual([".notdef", "f", "i", "f_i", "i.alt"]);
  });

  it("maps every glyph from a private code point of its own, and characters as the font does", () => {
    const { bytes, glyphNames } = exportShapingFont(document());
    const parsed = opentype.parse(bytes);

    glyphNames.forEach((_, id) => {
      expect(parsed.charToGlyph(String.fromCodePoint(NAMED_GLYPH_BASE + id)).index).toBe(id);
    });
    expect(parsed.charToGlyph("f").index).toBe(1);
  });

  it("keeps the private code points where every glyph has a character of its own", () => {
    // opentype.js writes the wide half of the character map only when some
    // glyph's first code point needs it, so a font of nothing but letters lost
    // every private code point and `/alpha` set nothing.
    const { bytes, glyphNames } = exportShapingFont(
      fontDocument([
        glyph("A", { unicodes: [0x41], advance: 600 }),
        glyph("alpha", { unicodes: [0x3b1], advance: 500 }),
      ]),
    );
    const parsed = opentype.parse(bytes);

    glyphNames.forEach((_, id) => {
      expect(parsed.charToGlyph(String.fromCodePoint(NAMED_GLYPH_BASE + id)).index).toBe(id);
    });
    expect(parsed.charToGlyph("α").index).toBe(2);
  });

  it("carries the substitutions and the kerning, compiled as the export compiles them", () => {
    const tags = tagsOf(exportShapingFont(document()).bytes);
    expect(tags).toContain("GSUB");
    expect(tags).toContain("GPOS");
  });

  it("uses the advances as drawn, not what the spacing keys would make of them", () => {
    const parsed = opentype.parse(exportShapingFont(document()).bytes);
    expect(parsed.glyphs.get(4).advanceWidth).toBe(400);
  });

  it("gives a font with no .notdef an empty one, so ids still match the names", () => {
    const { glyphNames } = exportShapingFont(document());
    expect(glyphNames[0]).toBe(".notdef");
  });
});
