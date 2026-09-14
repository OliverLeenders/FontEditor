import {
  type FontDocument,
  contour,
  counterIds,
  fontDocument,
  glyph,
  glyphForCodePoint,
  node,
  setFontInfo,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { importFont } from "../src/import.js";
import { exportTrueType } from "../src/truetype.js";

/**
 * The TrueType flavour, opened again.
 *
 * A font without a `.notdef` of its own could not be: the export gave it a
 * blank one, but the outlines were rebuilt without it, so every glyph sat one
 * place early and the last character pointed past the end of the font.
 */

const ids = counterIds("tt");

const bar = () =>
  contour(
    ids.contour(),
    [
      node(ids.node(), { x: 50, y: 0 }),
      node(ids.node(), { x: 550, y: 0 }),
      node(ids.node(), { x: 550, y: 700 }),
      node(ids.node(), { x: 50, y: 700 }),
    ],
    true,
  );

function font(withNotdef: boolean): FontDocument {
  const document = fontDocument([
    ...(withNotdef ? [glyph(".notdef", { advance: 500, contours: [bar()] })] : []),
    glyph("H", { unicodes: [0x48], advance: 600, contours: [bar()] }),
    glyph("I", { unicodes: [0x49], advance: 300, contours: [bar()] }),
  ]);
  return setFontInfo(document, { ...document.info, openTypeOS2TypoLineGap: 120 });
}

describe("the TrueType flavour, read back", () => {
  it.each([
    ["without a .notdef of its own", false],
    ["with one", true],
  ])("opens a font %s, with its characters, advances and line metrics", (_, withNotdef) => {
    const { document } = importFont(exportTrueType(font(withNotdef)).bytes, counterIds("r"));

    expect(glyphForCodePoint(document, 0x48)?.advance).toBe(600);
    expect(glyphForCodePoint(document, 0x49)?.advance).toBe(300);
    expect(document.info.openTypeOS2TypoLineGap).toBe(120);
  });
});
