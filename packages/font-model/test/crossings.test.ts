import { describe, expect, it } from "vitest";

import { byContour, samePoint, strokeCrossings } from "../src/crossings.js";
import { glyph } from "../src/glyph.js";
import { counterIds } from "../src/ids.js";
import { openContour } from "./fixtures.js";
import { rectContour } from "../src/shapes.js";

/**
 * Where a straight stroke meets an outline — what the knife cuts at and what the
 * measure reads across.
 */

const ids = counterIds("x");
const at = (x: number, y: number) => ({ x, y });

/** A square from (0,0) to (400,400), and the same square with a hole in it. */
const square = () =>
  glyph("a", {
    advance: 500,
    contours: [rectContour(ids, { minX: 0, minY: 0, maxX: 400, maxY: 400 })],
  });

const ring = () =>
  glyph("o", {
    advance: 500,
    contours: [
      rectContour(ids, { minX: 0, minY: 0, maxX: 400, maxY: 400 }),
      rectContour(ids, { minX: 100, minY: 100, maxX: 300, maxY: 300 }),
    ],
  });

describe("crossing an outline with a stroke", () => {
  it("finds both walls of a stem, in the order the stroke meets them", () => {
    const found = strokeCrossings(square(), at(-50, 200), at(450, 200));
    expect(found.map((c) => Math.round(c.point.x))).toEqual([0, 400]);
    // `u` runs 0 at the start of the stroke and 1 at its end, so it is what
    // orders them — and it is what tells the measure how far along each is.
    expect(found[0]!.u).toBeLessThan(found[1]!.u);
  });

  it("counts a crossing on a node once, not once per segment meeting there", () => {
    // Straight through the bottom left corner, where two segments end. Counted
    // twice, an odd number of crossings looks even — which for the knife is the
    // difference between cutting a shape and mangling it.
    const found = strokeCrossings(square(), at(-100, -100), at(100, 100));
    expect(found).toHaveLength(1);
    expect(found[0]!.point.x).toBeCloseTo(0, 6);
    expect(found[0]!.point.y).toBeCloseTo(0, 6);
  });

  it("keeps a point where two contours genuinely touch", () => {
    // Deduping is within a contour, not across them: two contours meeting at a
    // point is a degenerate outline, and hiding it would not make it go away.
    const touching = glyph("t", {
      advance: 500,
      contours: [
        rectContour(ids, { minX: 0, minY: 0, maxX: 200, maxY: 200 }),
        rectContour(ids, { minX: 200, minY: 0, maxX: 400, maxY: 200 }),
      ],
    });
    const found = strokeCrossings(touching, at(200, -50), at(200, 250));
    expect(found.length).toBeGreaterThanOrEqual(2);
    expect(new Set(found.map((c) => c.contourIndex))).toEqual(new Set([0, 1]));
  });

  it("crosses a counter as well as the outside", () => {
    const found = strokeCrossings(ring(), at(-50, 200), at(450, 200));
    expect(found.map((c) => Math.round(c.point.x))).toEqual([0, 100, 300, 400]);
  });

  it("ignores an open contour, which has no inside to cross", () => {
    const g = glyph("open", { advance: 500, contours: [openContour()] });
    expect(strokeCrossings(g, at(-1000, 0), at(1000, 0))).toEqual([]);
  });

  it("finds nothing for a stroke that misses", () => {
    expect(strokeCrossings(square(), at(-50, 900), at(450, 900))).toEqual([]);
  });

  it("groups what it found by contour", () => {
    const grouped = byContour(strokeCrossings(ring(), at(-50, 200), at(450, 200)));
    expect([...grouped.keys()].sort()).toEqual([0, 1]);
    expect(grouped.get(0)).toHaveLength(2);
    expect(grouped.get(1)).toHaveLength(2);
  });
});

describe("telling two points apart", () => {
  it("allows for arithmetic, but not for a real gap", () => {
    expect(samePoint(at(10, 10), at(10 + 1e-9, 10 - 1e-9))).toBe(true);
    expect(samePoint(at(10, 10), at(10.01, 10))).toBe(false);
  });
});
