import { counterIds, glyphForCodePoint } from "@fonteditor/font-model";
import { opentype } from "../src/opentype.js";
import { describe, expect, it } from "vitest";

import { documentFrom, importFont } from "../src/import.js";
import { NO_KERNING } from "../src/readkern.js";
import { type SourceFont, FontParseError } from "../src/source.js";

/**
 * A real font binary, built in memory.
 *
 * Worth the trouble over a hand-written command list: it exercises the actual
 * parser, so a change in opentype.js that moves a field or renames a table fails
 * here rather than in the editor. It needs no fixture file and no font from the
 * host machine.
 *
 * Note the writer emits CFF, so quadratics do not survive a round trip — the
 * quadratic path is tested directly in `commands.test.ts` instead.
 */
function buildFont(): ArrayBuffer {
  const square = new opentype.Path();
  square.moveTo(100, 0);
  square.lineTo(400, 0);
  square.lineTo(400, 700);
  square.lineTo(100, 700);
  square.close();

  return new opentype.Font({
    familyName: "Fixture",
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [
      new opentype.Glyph({ name: ".notdef", advanceWidth: 500, path: new opentype.Path() }),
      new opentype.Glyph({ name: "A", unicode: 65, advanceWidth: 600, path: square }),
    ],
  }).toArrayBuffer();
}

describe("importFont", () => {
  it("reads metrics, names, glyphs and outlines from a real binary", () => {
    const { document, warnings } = importFont(buildFont(), counterIds());

    expect(warnings).toEqual([]);
    expect(document.info.familyName).toBe("Fixture");
    expect(document.info.unitsPerEm).toBe(1000);
    expect(document.info.ascender).toBe(800);
    expect(document.info.descender).toBe(-200);

    const a = glyphForCodePoint(document, 0x41);
    expect(a?.name).toBe("A");
    expect(a?.advance).toBe(600);
    expect(a?.unicodes).toContain(65);
    expect(a?.contours).toHaveLength(1);
    expect(a?.contours[0]?.closed).toBe(true);
    expect(a?.contours[0]?.nodes).toHaveLength(4);
  });

  it("keeps coordinates in font units, y up", () => {
    const { document } = importFont(buildFont(), counterIds());
    const points = glyphForCodePoint(document, 0x41)?.contours[0]?.nodes.map((n) => n.pt) ?? [];

    // The same numbers that went in, not scaled to a point size and not flipped.
    expect(points).toContainEqual({ x: 100, y: 0 });
    expect(points).toContainEqual({ x: 400, y: 700 });
    expect(Math.min(...points.map((p) => p.y))).toBe(0);
  });

  it("preserves glyph order, including .notdef", () => {
    const { document } = importFont(buildFont(), counterIds());
    expect(document.glyphOrder).toEqual([".notdef", "A"]);
  });

  it("throws a FontParseError on something that is not a font", () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    expect(() => importFont(junk, counterIds())).toThrow(FontParseError);
  });
});

/** Mapping concerns, tested on source data so no binary has to be built. */
describe("documentFrom", () => {
  const base: SourceFont = {
    familyName: null,
    styleName: null,
    unitsPerEm: 2048,
    ascender: 1600,
    descender: -400,
    xHeight: null,
    capHeight: null,
    outlines: "truetype",
    glyphs: [],
    kerning: NO_KERNING,
  };

  const plain = (name: string | null, unicodes: number[] = []) => ({
    name,
    unicodes,
    advance: 500,
    commands: [],
    components: [],
  });

  it("falls back to proportions of the em for metrics the font omits", () => {
    const { document } = documentFrom(base, counterIds());
    expect(document.info.xHeight).toBe(1024);
    expect(document.info.capHeight).toBeCloseTo(1433.6, 6);
  });

  it("treats a zero x-height as absent rather than as a real value", () => {
    const { document } = documentFrom({ ...base, xHeight: 0 }, counterIds());
    expect(document.info.xHeight).toBe(1024);
  });

  it("names unnamed glyphs by codepoint, in AGL form", () => {
    const { document } = documentFrom(
      { ...base, glyphs: [plain(null, [0x41]), plain(null, [0x1f600]), plain(null)] },
      counterIds(),
    );
    expect(document.glyphOrder).toEqual(["uni0041", "u01F600", "glyph2"]);
  });

  it("renames duplicates rather than letting one glyph replace another", () => {
    const { document, warnings } = documentFrom(
      { ...base, glyphs: [plain("A"), plain("A"), plain("A")] },
      counterIds(),
    );

    expect(document.glyphOrder).toEqual(["A", "A.2", "A.3"]);
    expect(Object.keys(document.glyphs)).toHaveLength(3);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]?.message).toContain("more than once");
  });

  it("warns, rather than throwing, when a font has no glyphs", () => {
    const { document, warnings } = documentFrom(base, counterIds());
    expect(document.glyphOrder).toEqual([]);
    expect(warnings).toEqual([{ glyph: null, message: "This font contains no glyphs." }]);
  });

  it("uses placeholder names when the font names itself nothing", () => {
    const { document } = documentFrom(base, counterIds());
    expect(document.info.familyName).toBe("Untitled");
    expect(document.info.styleName).toBe("Regular");
  });
});
