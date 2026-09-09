import { describe, expect, it } from "vitest";

import { fontDocument } from "../src/document.js";
import { glyph } from "../src/glyph.js";
import { counterIds } from "../src/ids.js";
import { resolvedMetrics, withResolvedMetrics } from "../src/metric-keys.js";
import { sidebearings } from "../src/metrics.js";
import { rectContour } from "../src/shapes.js";

/**
 * Spacing taken from another glyph.
 *
 * Spacing a family by hand means spacing it again after every change. A metric
 * key says the relationship instead of the number, and the number is worked out
 * from whatever the glyph it names is now.
 */

const ids = counterIds("mk");

/** A box glyph: `left` of space, `width` wide, and `right` after it. */
const box = (name: string, left: number, width: number, right: number, keys = {}) =>
  glyph(name, {
    advance: left + width + right,
    contours: [rectContour(ids, { minX: left, minY: 0, maxX: left + width, maxY: 700 })],
    metricKeys: { left: "", right: "", width: "", ...keys },
  });

describe("following a key", () => {
  it("takes a sidebearing from the glyph it names", () => {
    const font = fontDocument([box("n", 40, 300, 50), box("m", 10, 500, 10, { left: "n" })]);

    const out = resolvedMetrics(font, "m");
    expect(out?.left).toBe(40);
    // The outline moves and the advance moves with it, so the right side is
    // where it was: adding space on the left adds space on the left.
    expect(out?.right).toBe(10);
    expect(out?.advance).toBe(550);
  });

  it("takes the whole advance where the key says width", () => {
    const font = fontDocument([
      box("zero", 40, 300, 40),
      box("one", 100, 180, 100, { width: "zero" }),
    ]);

    // Tabular figures: every digit the width of the zero.
    expect(resolvedMetrics(font, "one")?.advance).toBe(380);
  });

  it("follows a chain, because families are built in chains", () => {
    // ü from u from n is ordinary.
    const font = fontDocument([
      box("n", 40, 300, 50),
      box("u", 10, 300, 10, { left: "n" }),
      box("udieresis", 0, 300, 0, { left: "u" }),
    ]);

    expect(resolvedMetrics(font, "udieresis")?.left).toBe(40);
  });

  it("says nothing rather than something wrong about a key pointing nowhere", () => {
    const font = fontDocument([box("m", 10, 500, 10, { left: "n" })]);
    expect(resolvedMetrics(font, "m")).toBeNull();
  });

  it("refuses a loop rather than following it", () => {
    const font = fontDocument([
      box("a", 10, 300, 10, { left: "b" }),
      box("b", 20, 300, 20, { left: "a" }),
    ]);

    expect(resolvedMetrics(font, "a")).toBeNull();
    expect(resolvedMetrics(font, "b")).toBeNull();
  });

  it("lets the width key win where both it and a side key are set", () => {
    // The coarsest goes last: somebody who set a width key meant the width.
    const font = fontDocument([
      box("n", 40, 300, 50),
      box("zero", 0, 400, 0),
      box("m", 10, 500, 10, { left: "n", width: "zero" }),
    ]);

    expect(resolvedMetrics(font, "m")?.advance).toBe(400);
  });

  it("has nothing to say about a glyph that says nothing", () => {
    const font = fontDocument([box("n", 40, 300, 50)]);
    expect(resolvedMetrics(font, "n")).toEqual({ advance: 390, left: 40, right: 50 });
  });
});

describe("resolving a whole font before it is compiled", () => {
  it("moves the glyphs their keys point at, and leaves the rest alone", () => {
    const font = fontDocument([box("n", 40, 300, 50), box("m", 10, 500, 10, { left: "n" })]);

    const { document, problems } = withResolvedMetrics(font);

    expect(problems).toEqual([]);
    expect(sidebearings(document.glyphs["m"]!)?.left).toBe(40);
    // The same object: a glyph with nothing to say was not rebuilt.
    expect(document.glyphs["n"]).toBe(font.glyphs["n"]);
  });

  it("leaves a broken rule as drawn, and says which and why", () => {
    const font = fontDocument([box("m", 10, 500, 10, { left: "n" })]);

    const { document, problems } = withResolvedMetrics(font);

    expect(document.glyphs["m"]).toBe(font.glyphs["m"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.glyph).toBe("m");
    expect(problems[0]?.says).toMatch(/not in this font/);
  });

  it("names a loop as a loop", () => {
    const font = fontDocument([
      box("a", 10, 300, 10, { left: "b" }),
      box("b", 20, 300, 20, { left: "a" }),
    ]);

    expect(withResolvedMetrics(font).problems.map((p) => p.says)).toEqual([
      expect.stringMatching(/round a loop/),
      expect.stringMatching(/round a loop/),
    ]);
  });

  it("says a glyph with no outline has no side to take", () => {
    const font = fontDocument([
      box("n", 40, 300, 50),
      glyph("space", { advance: 200, metricKeys: { left: "n", right: "", width: "" } }),
    ]);

    expect(withResolvedMetrics(font).problems[0]?.says).toMatch(/no outline/);
  });
});
