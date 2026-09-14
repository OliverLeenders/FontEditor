import { fontDocument, glyph, putGlyph } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { opentype } from "../src/opentype.js";
import { NAMED_GLYPH_BASE, exportShapingFont } from "../src/shaping-font.js";

/**
 * The shaping font after an edit.
 *
 * Most of it is kept from the last one built, and only what an edit can change
 * without changing the glyphs is written afresh. What has to hold is that the
 * font is still exactly the document: an advance nudged shows, and a glyph
 * added or given a character rebuilds the part that was kept.
 */

const font = () =>
  fontDocument([
    glyph("a", { unicodes: [0x61], advance: 500 }),
    glyph("b", { unicodes: [0x62], advance: 520 }),
  ]);

const parse = (document: ReturnType<typeof font>) =>
  opentype.parse(exportShapingFont(document).bytes);

describe("the shaping font, rebuilt after an edit", () => {
  it("carries a changed advance", () => {
    const before = font();
    parse(before);
    const after = putGlyph(before, { ...before.glyphs["a"]!, advance: 612 });
    expect(parse(after).glyphs.get(1).advanceWidth).toBe(612);
  });

  it("maps a character a glyph was just given", () => {
    const before = font();
    parse(before);
    const after = putGlyph(before, { ...before.glyphs["b"]!, unicodes: [0x62, 0x42] });
    expect(parse(after).charToGlyph("B").index).toBe(2);
  });

  it("takes in a glyph that was just added, with its private code point", () => {
    const before = font();
    parse(before);
    const after = putGlyph(before, glyph("c.alt", { advance: 300 }));
    const { glyphNames } = exportShapingFont(after);
    const parsed = parse(after);

    expect(glyphNames).toEqual([".notdef", "a", "b", "c.alt"]);
    expect(parsed.charToGlyph(String.fromCodePoint(NAMED_GLYPH_BASE + 3)).index).toBe(3);
    expect(parsed.glyphs.get(3).advanceWidth).toBe(300);
  });

  it("does not hand back the kept bytes themselves, so a caller cannot spoil them", () => {
    const document = font();
    const first = exportShapingFont(document).bytes;
    new Uint8Array(first).fill(0);
    expect(parse(document).glyphs.get(1).advanceWidth).toBe(500);
  });
});
