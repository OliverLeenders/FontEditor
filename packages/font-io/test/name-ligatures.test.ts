import {
  type FontDocument,
  DEFAULT_FONT_INFO,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
  setFeatures,
} from "@typewright/font-model";
import { Blob, Buffer, Face, Font, shape } from "harfbuzzjs";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { nameLigatureCount, withNameLigatures } from "../src/name-ligatures.js";
import { exportTrueType } from "../src/truetype.js";
import { exportUfo } from "../src/ufo.js";
import { importUfo } from "../src/ufo-import.js";

/**
 * An icon's name as the way to type it, set by HarfBuzz.
 *
 * The rules and the blank letters are made when the font is compiled, so what
 * is asked here is what somebody using the font would see: the word typed, and
 * the icon drawn.
 */

const ids = counterIds("nl");

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

const icon = (name: string, code: number) =>
  glyph(name, { unicodes: [code], advance: 1000, contours: [drawn()] });

/** Four icons, one of them named for a word the feature language uses, and one letter drawn. */
const icons = (spelled = true): FontDocument => ({
  ...fontDocument(
    [
      glyph(".notdef", { advance: 500 }),
      glyph("a", { unicodes: [0x61], advance: 600, contours: [drawn()] }),
      icon("home", 0xe000),
      icon("arrow", 0xe001),
      icon("arrow_left", 0xe002),
      icon("table", 0xe003),
    ],
    { ...DEFAULT_FONT_INFO, familyName: "Icons" },
  ),
  nameLigatures: spelled,
});

function set(bytes: ArrayBuffer, text: string) {
  const font = new Font(new Face(new Blob(bytes)));
  const buffer = new Buffer();
  buffer.addText(text);
  buffer.guessSegmentProperties();
  shape(font, buffer, []);
  const placed = buffer.getGlyphInfosAndPositions();
  return {
    names: placed.map((p) => font.glyphName(p.codepoint)),
    advances: placed.map((p) => p.xAdvance ?? 0),
  };
}

describe("an icon font that spells its names", () => {
  it("draws the icon for its name typed", () => {
    const { bytes } = exportFont(icons());
    expect(set(bytes, "home").names).toEqual(["home"]);
    // A name that is a word of the feature language is a name like any other.
    expect(set(bytes, "table").names).toEqual(["table"]);
  });

  it("takes the longest name that fits, so one icon's name may begin another's", () => {
    const { bytes } = exportFont(icons());
    expect(set(bytes, "arrow_left").names).toEqual(["arrow_left"]);
    expect(set(bytes, "arrow").names).toEqual(["arrow"]);
    expect(set(bytes, "arrow_home").names).toEqual(["arrow", "underscore", "home"]);
  });

  it("gives the letters blank glyphs with no width, and uses a letter the font has drawn", () => {
    const { bytes } = exportFont(icons());
    // Not a name: the letters themselves, which take no room — except the `a`,
    // which is the font's own and keeps its width.
    expect(set(bytes, "ha")).toEqual({ names: ["h", "a"], advances: [0, 600] });
  });

  it("does the same in the TrueType flavour, whose outlines are prepared apart", () => {
    const { bytes } = exportTrueType(icons());
    expect(set(bytes, "arrow_left").names).toEqual(["arrow_left"]);
    expect(set(bytes, "home").names).toEqual(["home"]);
  });

  it("leaves the font's own ligatures working beside them", () => {
    const own = setFeatures(
      {
        ...icons(),
        glyphs: {
          ...icons().glyphs,
          a_a: glyph("a_a", { advance: 900, contours: [drawn()] }),
        },
        glyphOrder: [...icons().glyphOrder, "a_a"],
      },
      "feature liga { sub a a by a_a; } liga;",
    );
    const { bytes } = exportFont(own);
    expect(set(bytes, "aa").names).toEqual(["a_a"]);
    expect(set(bytes, "home").names).toEqual(["home"]);
  });

  it("does none of it for a font that does not ask", () => {
    const plain = icons(false);
    expect(withNameLigatures(plain)).toBe(plain);
    // No glyph for the `h`, so the shaper sets .notdef for each letter.
    expect(set(exportFont(plain).bytes, "home").names).toEqual([
      ".notdef",
      ".notdef",
      ".notdef",
      ".notdef",
    ]);
  });
});

describe("the rules themselves", () => {
  it("are for the glyphs with a private-use code point and a name longer than a letter", () => {
    expect(nameLigatureCount(icons())).toBe(4);
    const mixed = {
      ...icons(),
      glyphs: { ...icons().glyphs, x: glyph("x", { unicodes: [0xe010], advance: 500 }) },
      glyphOrder: [...icons().glyphOrder, "x"],
    };
    expect(nameLigatureCount(mixed)).toBe(4);
  });

  it("are added once, however many times the font is prepared", () => {
    const once = withNameLigatures(icons());
    expect(once.nameLigatures).toBe(false);
    expect(withNameLigatures(once)).toBe(once);
    expect(once.features.match(/feature liga/g)).toHaveLength(1);
    // The source is not touched: nothing was added to the document it came from.
    expect(icons().features).toBe("");
  });
});

describe("the switch, in a UFO", () => {
  it("is kept in the lib and read back, and the made rules are not in the source", async () => {
    const written = exportUfo(icons());
    const back = await importUfo(written.bytes.slice().buffer, ids);
    if ("reason" in back) throw new Error(back.reason);

    expect(back.document.nameLigatures).toBe(true);
    expect(back.document.features).toBe("");
    expect(Object.keys(back.document.glyphs)).not.toContain("h");
    expect(Object.keys(back.document.kept.lib)).toEqual([]);
  });
});
