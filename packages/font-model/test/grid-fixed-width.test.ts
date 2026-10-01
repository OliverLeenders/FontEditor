import { describe, expect, it } from "vitest";

import { component } from "../src/component.js";
import { fontDocument, putGlyph } from "../src/document.js";
import {
  commonAdvance,
  fitToFixedWidth,
  fixedWidthOf,
  offWidthGlyphs,
  setFixedPitch,
} from "../src/fixed-width.js";
import { glyph } from "../src/glyph.js";
import { DEFAULT_GRID, grid, iconGrid, isDefaultGrid, isWholeStep } from "../src/grid.js";
import { counterIds } from "../src/ids.js";
import { parseMetricKey } from "../src/metric-key-text.js";
import { resolvedMetrics } from "../src/metric-keys.js";
import { sidebearings } from "../src/metrics.js";
import { scaledFont } from "../src/scale.js";
import { rectContour } from "../src/shapes.js";

/**
 * What an icon font and a monospaced one are drawn with: a grid that is the
 * font's own, one width for every glyph, and an em that can be changed without
 * changing the size of the drawing.
 */

const ids = counterIds("gw");

/** A box glyph: `left` of space, `width` wide, and `right` after it. */
const box = (name: string, left: number, width: number, right: number, keys = {}) =>
  glyph(name, {
    advance: left + width + right,
    contours: [rectContour(ids, { minX: left, minY: 0, maxX: left + width, maxY: 700 })],
    metricKeys: { left: "", right: "", width: "", ...keys },
  });

describe("the grid", () => {
  it("is whole units unless the font says otherwise", () => {
    expect(fontDocument().grid).toEqual(DEFAULT_GRID);
    expect(isDefaultGrid(DEFAULT_GRID)).toBe(true);
  });

  it("refuses a step that is not one, and a major spacing of fewer than two steps", () => {
    expect(grid(0)).toBeNull();
    expect(grid(-4)).toBeNull();
    expect(grid(Number.NaN)).toBeNull();
    expect(grid(10, 1)).toEqual({ step: 10, major: 0 });
    expect(grid(10, 4.4)).toEqual({ step: 10, major: 4 });
  });

  it("works an icon's pixel out from the em, and says when it is not whole", () => {
    const on960 = iconGrid(960, 24)!;
    expect(on960).toEqual({ step: 40, major: 0 });
    expect(isWholeStep(on960)).toBe(true);

    const halves = iconGrid(960, 24, 2)!;
    expect(halves).toEqual({ step: 20, major: 2 });

    const on1000 = iconGrid(1000, 24)!;
    expect(on1000.step).toBeCloseTo(41.667, 3);
    expect(isWholeStep(on1000)).toBe(false);
  });
});

describe("a fixed width", () => {
  it("is only there when the font says it is fixed", () => {
    const font = fontDocument([box("a", 50, 500, 50), box("b", 50, 500, 50)]);
    expect(fixedWidthOf(font)).toBeNull();
    expect(fixedWidthOf(setFixedPitch(font, true))).toBe(600);
  });

  it("starts at the width most glyphs already have, leaving marks out", () => {
    const font = fontDocument([
      box("a", 50, 500, 50),
      box("b", 50, 500, 50),
      box("m", 20, 660, 20),
      glyph("acutecomb", { advance: 0 }),
      glyph("gravecomb", { advance: 0 }),
      glyph("dieresiscomb", { advance: 0 }),
    ]);
    expect(commonAdvance(font)).toBe(600);
    expect(setFixedPitch(font, true).fixedWidth).toBe(600);
  });

  it("keeps its width when the font is made proportional again", () => {
    const font = setFixedPitch(fontDocument([box("a", 50, 500, 50)]), true, 640);
    const off = setFixedPitch(font, false);
    expect(fixedWidthOf(off)).toBeNull();
    expect(off.fixedWidth).toBe(640);
    expect(fixedWidthOf(setFixedPitch(off, true))).toBe(640);
  });

  it("allows a mark no width and a wide glyph twice the width", () => {
    const font = fontDocument([
      box("a", 50, 500, 50),
      box("m", 20, 660, 20),
      glyph("acutecomb", { advance: 0 }),
      box("ideo", 100, 1000, 100),
    ]);
    expect(offWidthGlyphs(font, 600).map((g) => g.name)).toEqual(["m"]);
  });

  it("fits a glyph by centring its drawing on whole units", () => {
    const font = fitToFixedWidth(fontDocument([box("i", 80, 101, 80), box("m", 20, 660, 20)]), 600);
    const i = font.glyphs["i"]!;
    expect(i.advance).toBe(600);
    expect(sidebearings(i)).toEqual({ left: 250, right: 249 });
    const m = font.glyphs["m"]!;
    expect(m.advance).toBe(600);
    expect(sidebearings(m)).toEqual({ left: -30, right: -30 });
  });

  it("fits a composite after the glyph it is built from, so it is centred where that went", () => {
    const a = box("a", 10, 300, 10);
    const aacute = glyph("aacute", {
      advance: 320,
      components: [component(ids.component(), "a")],
    });
    // The composite first in the font, which is the order that went wrong.
    let font = fontDocument([aacute, a]);
    font = fitToFixedWidth(font, 600);
    expect(sidebearings(font.glyphs["a"]!, font)).toEqual({ left: 150, right: 150 });
    expect(sidebearings(font.glyphs["aacute"]!, font)).toEqual({ left: 150, right: 150 });
  });
});

describe("a key that is a number", () => {
  it("reads digits as units rather than as a glyph", () => {
    expect(parseMetricKey("=600")).toEqual({ glyph: "", opposite: false, offset: 0, units: 600 });
    expect(parseMetricKey("=600+20")?.units).toBe(600);
    expect(parseMetricKey("|600")).toBeNull();
  });

  it("gives a glyph that width whatever its drawing is", () => {
    const font = fontDocument([box("m", 20, 660, 20, { width: "=600" })]);
    expect(resolvedMetrics(font, "m")).toEqual({ advance: 600, left: 20, right: -80 });
  });

  it("holds a sidebearing at a number", () => {
    const font = fontDocument([box("n", 40, 300, 50, { left: "=60" })]);
    expect(resolvedMetrics(font, "n")).toEqual({ advance: 410, left: 60, right: 50 });
  });
});

describe("a font moved to another em", () => {
  it("scales everything counted in units, on whole units", () => {
    let font = fontDocument([
      box("n", 40, 300, 50, { left: "o+10", width: "=600" }),
      box("o", 30, 320, 30),
    ]);
    font = setFixedPitch({ ...font, grid: { step: 41.666666666666664, major: 0 } }, true, 600);
    const scaled = scaledFont(font, 960);

    expect(scaled.info.unitsPerEm).toBe(960);
    expect(scaled.info.ascender).toBe(Math.round(font.info.ascender * 0.96));
    expect(scaled.glyphs["n"]!.advance).toBe(374);
    expect(sidebearings(scaled.glyphs["o"]!)).toEqual({ left: 29, right: 29 });
    expect(scaled.glyphs["n"]!.metricKeys).toEqual({ left: "o+10", right: "", width: "=576" });
    expect(scaled.grid.step).toBe(40);
    expect(scaled.fixedWidth).toBe(576);
  });

  it("scales kerning, and the hinting zones it carried without reading", () => {
    const font = putGlyph(fontDocument([box("A", 0, 600, 0)]), box("V", 0, 600, 0));
    const kerned = {
      ...font,
      kerning: { ...font.kerning, pairs: { A: { V: -80 } } },
      kept: { fontInfo: { postscriptBlueValues: [-12, 0, 500, 512], note: 5 }, lib: {} },
    };
    const scaled = scaledFont(kerned, 2000);
    expect(scaled.kerning.pairs).toEqual({ A: { V: -160 } });
    expect(scaled.kept.fontInfo).toEqual({
      postscriptBlueValues: [-24, 0, 1000, 1024],
      note: 5,
    });
  });

  it("is the document itself when the em does not change", () => {
    const font = fontDocument([box("n", 40, 300, 50)]);
    expect(scaledFont(font, 1000)).toBe(font);
  });
});
