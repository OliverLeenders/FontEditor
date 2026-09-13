import { describe, expect, it } from "vitest";

import { contour } from "../src/contour.js";
import { addContour, glyph } from "../src/glyph.js";
import { guide, horizontalGuide, verticalGuide } from "../src/guide.js";
import { counterIds } from "../src/ids.js";
import { sectionAcross } from "../src/measure.js";
import { node } from "../src/node.js";

/**
 * What the section ruler stops at, and the angle it meets each thing at.
 *
 * Two additions to the ruler laid across a letter: it stops at guides as well
 * as at the outline, so it reads how far an edge sits from the line it was
 * drawn against; and every stop carries the angle between the ruler and what it
 * crossed, which is how a diagonal's slope or a stem's lean is read.
 */

const ids = counterIds("st");
const at = (x: number, y: number) => ({ x, y });

/** A crossing is the root of a cubic, so it is compared to within arithmetic. */
const round = (n: number): number => Math.round(n * 1e6) / 1e6 + 0;

/** One upright bar from x = 0 to 100, and one leaning at 45 degrees beside it. */
function bars() {
  const upright = contour(
    ids.contour(),
    [at(0, 0), at(100, 0), at(100, 700), at(0, 700)].map((p) => node(ids.node(), p)),
    true,
  );
  const leaning = contour(
    ids.contour(),
    [at(300, 0), at(400, 0), at(1100, 700), at(1000, 700)].map((p) => node(ids.node(), p)),
    true,
  );
  return addContour(addContour(glyph("n", { advance: 1200 }), upright), leaning);
}

describe("the section ruler at guides", () => {
  it("stops at a guide it crosses, and reads the distances either side", () => {
    const out = sectionAcross(bars(), at(-50, 100), at(250, 100), [
      verticalGuide(ids.guide(), 160),
    ]);

    expect(out.stops.map((s) => [s.kind, round(s.point.x)])).toEqual([
      ["outline", 0],
      ["outline", 100],
      ["guide", 160],
    ]);
    // Stem, then stem-edge to guide.
    expect(out.spans.map((s) => [round(s.distance), s.ink])).toEqual([
      [100, true],
      [60, false],
    ]);
  });

  it("keeps the outline crossings on their own, for whatever reads only those", () => {
    const out = sectionAcross(bars(), at(-50, 100), at(250, 100), [
      verticalGuide(ids.guide(), 160),
    ]);
    expect(out.crossings.map((c) => round(c.x))).toEqual([0, 100]);
  });

  it("does not stop at a guide it runs alongside", () => {
    const out = sectionAcross(bars(), at(-50, 100), at(250, 100), [
      horizontalGuide(ids.guide(), 100),
    ]);
    expect(out.stops.every((s) => s.kind === "outline")).toBe(true);
  });

  it("does not stop at a guide beyond either end", () => {
    const out = sectionAcross(bars(), at(-50, 100), at(250, 100), [
      verticalGuide(ids.guide(), 900),
    ]);
    expect(out.stops.some((s) => s.kind === "guide")).toBe(false);
  });

  it("stops once where a guide lies exactly on an edge", () => {
    const out = sectionAcross(bars(), at(-50, 100), at(250, 100), [
      verticalGuide(ids.guide(), 100),
    ]);
    expect(out.stops).toHaveLength(2);
    expect(out.spans.map((s) => round(s.distance))).toEqual([100]);
  });
});

describe("the angle at each stop", () => {
  it("reads a level ruler across an upright stem as square to it", () => {
    const out = sectionAcross(bars(), at(-50, 100), at(250, 100));
    for (const stop of out.stops) expect(stop.angle).toBeCloseTo(90, 9);
  });

  it("reads the slope of a leaning stem", () => {
    // Level across the leaning bar: its edges run at 45 degrees.
    const out = sectionAcross(bars(), at(200, 100), at(600, 100));
    expect(out.stops).toHaveLength(2);
    for (const stop of out.stops) expect(stop.angle).toBeCloseTo(45, 9);
  });

  it("gives the same reading whichever way the ruler was drawn", () => {
    const forwards = sectionAcross(bars(), at(200, 100), at(600, 100));
    const backwards = sectionAcross(bars(), at(600, 100), at(200, 100));
    expect(backwards.stops.map((s) => s.angle)).toEqual(
      forwards.stops.map((s) => s.angle).reverse(),
    );
  });

  it("reads the angle at a guide from the guide's own direction", () => {
    const leaning = guide(ids.guide(), at(160, 0), 60);
    const out = sectionAcross(bars(), at(-50, 100), at(400, 100), [leaning]);
    const stop = out.stops.find((s) => s.kind === "guide")!;
    expect(stop.angle).toBeCloseTo(60, 9);
  });
});
