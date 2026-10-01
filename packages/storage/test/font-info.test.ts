import {
  DEFAULT_FONT_INFO,
  DEFAULT_GRID,
  USE_TYPO_METRICS_BIT,
  fontDocument,
  setFixedPitch,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { decodeFontInfo, encodeFontInfo } from "../src/schema.js";

/**
 * The font's information, read back out of the working store.
 *
 * Every field falls back on its own default, which is what lets a project
 * saved before a field existed still open. The vertical metrics are the first
 * fields whose default is not a number or a string — `null` for "derive it",
 * and a list of bits — and the reader had to learn both, or it quietly dropped
 * every override a font set each time the font was opened.
 */

describe("font info from the working store", () => {
  it("keeps the overrides a font set", () => {
    const { info } = decodeFontInfo({
      ...DEFAULT_FONT_INFO,
      schema: 1,
      openTypeOS2TypoLineGap: 200,
      openTypeHheaAscender: 900,
      openTypeOS2WinDescent: 300,
      openTypeOS2Selection: [USE_TYPO_METRICS_BIT],
    });

    expect(info.openTypeOS2TypoLineGap).toBe(200);
    expect(info.openTypeHheaAscender).toBe(900);
    expect(info.openTypeOS2WinDescent).toBe(300);
    expect(info.openTypeOS2Selection).toEqual([USE_TYPO_METRICS_BIT]);
  });

  it("reads a project saved before these existed as having set none of them", () => {
    const { info } = decodeFontInfo({
      schema: 1,
      familyName: "Older",
      unitsPerEm: 1000,
      ascender: 750,
      descender: -250,
    });

    expect(info.familyName).toBe("Older");
    expect(info.openTypeHheaAscender).toBeNull();
    expect(info.openTypeOS2TypoLineGap).toBeNull();
    expect(info.openTypeOS2Selection).toEqual([]);
  });

  it("takes a nonsensical override as unset rather than failing the load", () => {
    const { info } = decodeFontInfo({
      ...DEFAULT_FONT_INFO,
      schema: 1,
      openTypeOS2WinAscent: "tall",
      openTypeOS2Selection: [7, "eight", 1.5, 40],
    });

    expect(info.openTypeOS2WinAscent).toBeNull();
    expect(info.openTypeOS2Selection).toEqual([7]);
  });

  it("carries the grid, the fixed width and the flag, and reads an older project as having none", () => {
    const font = setFixedPitch(
      { ...fontDocument([], DEFAULT_FONT_INFO), grid: { step: 40, major: 4 } },
      true,
      600,
    );
    const back = decodeFontInfo(JSON.parse(JSON.stringify(encodeFontInfo(font))));
    expect(back.grid).toEqual({ step: 40, major: 4 });
    expect(back.fixedWidth).toBe(600);
    expect(back.info.postscriptIsFixedPitch).toBe(true);

    const older = decodeFontInfo({ schema: 1, familyName: "Older", unitsPerEm: 1000 });
    expect(older.grid).toEqual(DEFAULT_GRID);
    expect(older.fixedWidth).toBeNull();
    expect(older.info.postscriptIsFixedPitch).toBe(false);

    const odd = decodeFontInfo({ schema: 1, grid: { step: 0 }, fixedWidth: -3 });
    expect(odd.grid).toEqual(DEFAULT_GRID);
    expect(odd.fixedWidth).toBeNull();
  });
});
