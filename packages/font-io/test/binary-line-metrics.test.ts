import {
  type FontDocument,
  type FontInfo,
  USE_TYPO_METRICS_BIT,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
  setFontInfo,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { importFont } from "../src/import.js";

/**
 * The line metrics and the embedding flag, read back out of a font binary.
 *
 * A binary opened here used to come in with every override empty, so a font
 * whose line gap somebody had set came back with the exporter's derived one and
 * lost it on the next export. What is read is kept only where it differs from
 * what the exporter would derive, so a font that set nothing opens as a font
 * that sets nothing, and Font Info greys every field as it would for a new one.
 */

const ids = counterIds("bl");

/** A rectangle from y0 to y1. */
const bar = (y0: number, y1: number) =>
  contour(
    ids.contour(),
    [
      node(ids.node(), { x: 50, y: y0 }),
      node(ids.node(), { x: 550, y: y0 }),
      node(ids.node(), { x: 550, y: y1 }),
      node(ids.node(), { x: 50, y: y1 }),
    ],
    true,
  );

function font(patch: Partial<FontInfo> = {}): FontDocument {
  const document = fontDocument([
    glyph("H", { unicodes: [0x48], advance: 600, contours: [bar(0, 700)] }),
    glyph("p", { unicodes: [0x70], advance: 600, contours: [bar(-230, 500)] }),
  ]);
  return setFontInfo(document, { ...document.info, ...patch });
}

const OVERRIDES = {
  openTypeHheaAscender: 900,
  openTypeHheaDescender: -300,
  openTypeHheaLineGap: 40,
  openTypeOS2TypoLineGap: 200,
  openTypeOS2WinAscent: 950,
  openTypeOS2WinDescent: 300,
} as const;

const read = (bytes: ArrayBuffer): FontInfo => importFont(bytes, counterIds("r")).document.info;

describe("line metrics from a binary", () => {
  it("leaves every override empty for a font that set none", () => {
    const info = read(exportFont(font()).bytes);

    expect(info.openTypeHheaAscender).toBeNull();
    expect(info.openTypeHheaDescender).toBeNull();
    expect(info.openTypeHheaLineGap).toBeNull();
    expect(info.openTypeOS2TypoAscender).toBeNull();
    expect(info.openTypeOS2TypoDescender).toBeNull();
    expect(info.openTypeOS2TypoLineGap).toBeNull();
    expect(info.openTypeOS2WinAscent).toBeNull();
    expect(info.openTypeOS2WinDescent).toBeNull();
    expect(info.openTypeOS2Selection).toEqual([]);
  });

  it("reads back each override a font set", () => {
    const info = read(exportFont(font(OVERRIDES)).bytes);
    expect(info).toMatchObject(OVERRIDES);
  });

  it("takes the ascender and descender from the typographic metrics, not hhea", () => {
    // hhea is one of the overrides; the typographic pair is what the exporter
    // writes from the ascender and descender themselves.
    const info = read(exportFont(font(OVERRIDES)).bytes);
    expect(info.ascender).toBe(font().info.ascender);
    expect(info.descender).toBe(font().info.descender);
  });

  it("reads the flag saying to believe the typographic metrics", () => {
    const info = read(exportFont(font({ openTypeOS2Selection: [USE_TYPO_METRICS_BIT] })).bytes);
    expect(info.openTypeOS2Selection).toEqual([USE_TYPO_METRICS_BIT]);
  });
});

describe("the embedding flag from a binary", () => {
  it("is installable when the font says nothing", () => {
    expect(read(exportFont(font()).bytes).openTypeOS2Type).toEqual([]);
  });

  it("reads the level and the flags the font sets", () => {
    expect(read(exportFont(font({ openTypeOS2Type: [2, 8] })).bytes).openTypeOS2Type).toEqual([
      2, 8,
    ]);
  });
});
