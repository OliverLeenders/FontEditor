import {
  type Contour,
  type EndSerif,
  type SerifStyle,
  DEFAULT_FONT_INFO,
  DEFAULT_SERIF,
  contour,
  contourBounds,
  counterIds,
  fontDocument,
  glyph,
  node,
  scaledFont,
  withNib,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { importFont } from "../src/import.js";
import { exportUfo, ufoFiles } from "../src/ufo.js";
import { importUfo } from "../src/ufo-import.js";
import { entryText } from "../src/zip.js";

/**
 * Serifs through a file and back.
 *
 * A serif is a stroke's, and a stroke is this editor's: the source keeps the
 * font's styles in the lib under this editor's name and each end's serif with
 * the stroke it is on, and the outline written beside them is the ink, serif
 * and all, which is what any other application reads. The compiled font has
 * only the ink.
 */

const ids = counterIds("serif-io");
const FOOT: SerifStyle = {
  name: "Foot",
  left: 50,
  right: 50,
  height: 24,
  bracket: 0.6,
  slope: 0,
  cup: 4,
  round: 0,
};
const { name: _name, ...FOOT_NUMBERS } = FOOT;
const OWN: EndSerif = { ...FOOT_NUMBERS, right: 12, style: "Foot", own: ["right"] };

const stem = (serif: EndSerif): Contour =>
  withNib(
    contour(
      ids.contour(),
      [
        node(ids.node(), { x: 200, y: 600 }),
        node(ids.node(), { x: 200, y: 0 }, { end: { cut: 0, serif } }),
      ],
      false,
    ),
    { angle: 30, width: 80, thickness: 24 },
  );

const font = () => ({
  ...fontDocument(
    [
      glyph(".notdef", { advance: 500 }),
      glyph("l", { advance: 400, unicodes: [0x6c], contours: [stem(OWN)] }),
    ],
    { ...DEFAULT_FONT_INFO, familyName: "Serifed", styleName: "Regular" },
  ),
  serifs: [FOOT, { ...DEFAULT_SERIF, name: "Head" }],
});

describe("a UFO of a font with serifs", () => {
  it("reads back the font's styles and each end's serif", async () => {
    const back = await importUfo(exportUfo(font()).bytes.slice().buffer, ids);
    if ("reason" in back) throw new Error(back.reason);

    expect(back.document.serifs).toEqual([FOOT, { ...DEFAULT_SERIF, name: "Head" }]);
    const l = back.document.glyphs["l"]!;
    expect(l.contours).toHaveLength(1);
    expect(l.contours[0]!.nodes[1]!.end).toEqual({ cut: 0, serif: OWN });
    // Read into the model, so not also carried as somebody else's lib key.
    expect(Object.keys(back.document.kept.lib)).toEqual([]);
  });

  it("writes nothing for a font that has no styles", () => {
    const plain = fontDocument([glyph(".notdef", { advance: 500 })]);
    expect(ufoFiles(plain).map(entryText).join("\n")).not.toContain("org.typewright.serifs");
  });
});

describe("a compiled font with a serif on a stem", () => {
  it("has the serif in its outline: wider at the foot than the stem is", () => {
    const back = importFont(exportFont(font()).bytes, ids);
    const boxes = back.document.glyphs["l"]!.contours.map((c) => contourBounds(c)!);
    const box = {
      x1: Math.min(...boxes.map((b) => b.minX)),
      x2: Math.max(...boxes.map((b) => b.maxX)),
      y1: Math.min(...boxes.map((b) => b.minY)),
    };
    const stemWidth = 80 * Math.cos(Math.PI / 6);
    // Fifty to the left, twelve to the right, of a stem narrower than its pen.
    expect(box.x2 - box.x1).toBeGreaterThan(stemWidth + 50 + 12 - 3);
    expect(box.x2 - box.x1).toBeLessThan(stemWidth + 50 + 12 + 3);
    expect(box.y1).toBe(0);
  });
});

describe("a font with serifs moved to another em", () => {
  it("has its serifs' lengths scaled, on the ends and in the styles, and their shares left", () => {
    const scaled = scaledFont(font(), 2000);
    expect(scaled.serifs[0]).toEqual({ ...FOOT, left: 100, right: 100, height: 48, cup: 8 });
    expect(scaled.glyphs["l"]!.contours[0]!.nodes[1]!.end!.serif).toEqual({
      ...OWN,
      left: 100,
      right: 24,
      height: 48,
      cup: 8,
    });
  });
});
