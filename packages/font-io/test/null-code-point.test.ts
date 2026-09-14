import { contour, counterIds, fontDocument, glyph, node } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { opentype } from "../src/opentype.js";
import { exportShapingFont } from "../src/shaping-font.js";
import { exportTrueType } from "../src/truetype.js";

/**
 * A glyph mapped from code point zero.
 *
 * Fonts do carry one — a `NULL` or `uni0000` glyph, from a converter or an old
 * source — and opentype.js refuses to write a font where any glyph but `.null`
 * has that code point, so every binary export of such a font failed outright.
 * The glyph is written; only that one mapping is left out, and said so.
 */

const ids = counterIds("nul");

const drawn = () =>
  contour(
    ids.contour(),
    [
      node(ids.node(), { x: 0, y: 0 }),
      node(ids.node(), { x: 100, y: 0 }),
      node(ids.node(), { x: 50, y: 100 }),
    ],
    true,
  );

const font = () =>
  fontDocument([
    glyph(".notdef", { advance: 500, contours: [drawn()] }),
    glyph("uni0000", { unicodes: [0x0, 0xe000], advance: 0 }),
    glyph("A", { unicodes: [0x41], advance: 600, contours: [drawn()] }),
  ]);

describe("a glyph mapped from code point zero", () => {
  it("does not stop the font being exported, and says what was left out", () => {
    const { bytes, warnings } = exportFont(font());

    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(warnings).toContainEqual(expect.stringMatching(/uni0000.*U\+0000/));
  });

  it("keeps the glyph and its other code points", () => {
    const parsed = opentype.parse(exportFont(font()).bytes);
    expect(parsed.charToGlyph("\u{e000}").name).toBe("uni0000");
    expect(parsed.charToGlyph("A").name).toBe("A");
  });

  it("does not stop the TrueType flavour or the shaping font either", () => {
    expect(exportTrueType(font()).bytes.byteLength).toBeGreaterThan(0);
    expect(exportShapingFont(font()).glyphNames).toContain("uni0000");
  });

  it("keeps code point zero on a glyph named .null, where the format puts it", () => {
    const withNull = fontDocument([
      glyph(".notdef", { advance: 500 }),
      glyph(".null", { unicodes: [0x0], advance: 0 }),
      glyph("A", { unicodes: [0x41], advance: 600, contours: [drawn()] }),
    ]);
    const { warnings } = exportFont(withNull);
    expect(warnings.filter((w) => w.includes("U+0000"))).toEqual([]);
  });
});
