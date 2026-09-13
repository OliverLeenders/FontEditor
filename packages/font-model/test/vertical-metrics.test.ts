import { describe, expect, it } from "vitest";

import { component } from "../src/component.js";
import { contour } from "../src/contour.js";
import {
  DEFAULT_FONT_INFO,
  type FontDocument,
  fontDocument,
  setFontInfo,
} from "../src/document.js";
import { glyph } from "../src/glyph.js";
import { counterIds } from "../src/ids.js";
import { node } from "../src/node.js";
import {
  USE_TYPO_METRICS_BIT,
  derivedVerticalMetrics,
  verticalMetrics,
} from "../src/vertical-metrics.js";

/**
 * The three sets of vertical metrics, and what each is when nobody set it.
 *
 * "Derived" has to mean exactly what the exporter wrote before these could be
 * set, or a font that sets none of them would come out differently after this
 * change than before it.
 */

const ids = counterIds("v");

/** A rectangle from y0 to y1, as a closed contour of straight lines. */
const bar = (y0: number, y1: number) =>
  contour(
    ids.contour(),
    [
      node(ids.node(), { x: 0, y: y0 }),
      node(ids.node(), { x: 100, y: y0 }),
      node(ids.node(), { x: 100, y: y1 }),
      node(ids.node(), { x: 0, y: y1 }),
    ],
    true,
  );

const withInfo = (document: FontDocument, patch: Partial<typeof DEFAULT_FONT_INFO>) =>
  setFontInfo(document, { ...document.info, ...patch });

describe("derived vertical metrics", () => {
  it("follows the ascender and descender with no line gap", () => {
    const m = derivedVerticalMetrics(fontDocument());

    expect(m.hheaAscender).toBe(DEFAULT_FONT_INFO.ascender);
    expect(m.hheaDescender).toBe(DEFAULT_FONT_INFO.descender);
    expect(m.hheaLineGap).toBe(0);
    expect(m.typoAscender).toBe(DEFAULT_FONT_INFO.ascender);
    expect(m.typoDescender).toBe(DEFAULT_FONT_INFO.descender);
    expect(m.typoLineGap).toBe(0);
    expect(m.useTypoMetrics).toBe(false);
  });

  it("measures the Windows box from the tallest and deepest glyph", () => {
    const document = fontDocument([
      glyph("H", { contours: [bar(0, 700)] }),
      glyph("p", { contours: [bar(-230, 500)] }),
    ]);
    const m = derivedVerticalMetrics(document);

    expect(m.winAscent).toBe(700);
    // A distance, not a coordinate.
    expect(m.winDescent).toBe(230);
  });

  it("counts what components draw, since an accented capital is usually the tallest", () => {
    const document = fontDocument([
      glyph("A", { contours: [bar(0, 700)] }),
      glyph("acute", { contours: [bar(0, 120)] }),
      glyph("Aacute", {
        components: [
          component(ids.component(), "A"),
          component(ids.component(), "acute", {
            xScale: 1,
            xyScale: 0,
            yxScale: 0,
            yScale: 1,
            xOffset: 0,
            yOffset: 760,
          }),
        ],
      }),
    ]);

    expect(derivedVerticalMetrics(document).winAscent).toBe(880);
  });

  it("falls back to the ascender and descender when nothing is drawn", () => {
    const m = derivedVerticalMetrics(fontDocument());
    expect(m.winAscent).toBe(DEFAULT_FONT_INFO.ascender);
    expect(m.winDescent).toBe(Math.abs(DEFAULT_FONT_INFO.descender));
  });
});

describe("vertical metrics as written", () => {
  it("is the derived set when the font sets nothing", () => {
    const document = fontDocument([glyph("H", { contours: [bar(0, 700)] })]);
    expect(verticalMetrics(document)).toEqual(derivedVerticalMetrics(document));
  });

  it("takes each override the font sets, and only those", () => {
    const document = withInfo(fontDocument(), {
      openTypeOS2TypoLineGap: 200,
      openTypeHheaAscender: 900,
      openTypeOS2WinDescent: 300,
    });
    const m = verticalMetrics(document);

    expect(m.typoLineGap).toBe(200);
    expect(m.hheaAscender).toBe(900);
    expect(m.winDescent).toBe(300);
    // Everything else still derived.
    expect(m.typoAscender).toBe(DEFAULT_FONT_INFO.ascender);
  });

  it("reads the typo metrics flag from its selection bit", () => {
    const document = withInfo(fontDocument(), { openTypeOS2Selection: [USE_TYPO_METRICS_BIT] });
    expect(verticalMetrics(document).useTypoMetrics).toBe(true);
  });
});
