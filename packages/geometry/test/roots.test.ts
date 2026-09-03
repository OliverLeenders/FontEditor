import { describe, expect, it } from "vitest";

import { cubic, intersectSegmentCubic, lineAsCubic, unitRoots } from "../src/cubic.js";

const at = (x: number, y: number) => ({ x, y });
const close = (v: number, want: number) => expect(v).toBeCloseTo(want, 6);

describe("unitRoots", () => {
  it("solves a linear equation", () => {
    // 2t - 1 = 0
    expect(unitRoots(0, 0, 2, -1)).toEqual([0.5]);
  });

  it("solves a quadratic with two roots in range", () => {
    // (t - 0.25)(t - 0.75) = t² - t + 0.1875
    const roots = unitRoots(0, 1, -1, 0.1875);
    close(roots[0]!, 0.25);
    close(roots[1]!, 0.75);
  });

  it("solves a cubic with three real roots", () => {
    // (t - 0.2)(t - 0.5)(t - 0.8)
    const roots = unitRoots(1, -1.5, 0.66, -0.08);
    expect(roots).toHaveLength(3);
    close(roots[0]!, 0.2);
    close(roots[1]!, 0.5);
    close(roots[2]!, 0.8);
  });

  it("solves a cubic with one real root", () => {
    // t³ + t - 0.5, which turns once
    const roots = unitRoots(1, 0, 1, -0.5);
    expect(roots).toHaveLength(1);
    // Verified by substitution rather than by a rounded constant.
    const t = roots[0]!;
    expect(t ** 3 + t - 0.5).toBeCloseTo(0, 12);
  });

  it("finds a doubled root once rather than twice", () => {
    // (t - 0.5)²(t - 0.9)
    const roots = unitRoots(1, -1.9, 1.15, -0.225);
    expect(roots.map((r) => Math.round(r * 100) / 100)).toEqual([0.5, 0.9]);
  });

  it("drops roots outside the curve", () => {
    // (t - 2), whose only root is off the end
    expect(unitRoots(0, 0, 1, -2)).toEqual([]);
  });

  it("keeps a root that floating point put a hair outside", () => {
    // An endpoint crossing is a real crossing, and losing it loses a cut.
    expect(unitRoots(0, 0, 1, 1e-17)).toEqual([0]);
  });

  it("has nothing to say about a constant", () => {
    expect(unitRoots(0, 0, 0, 5)).toEqual([]);
  });
});

describe("intersectSegmentCubic", () => {
  /** A curve arching from (0,0) up and over to (100,0). */
  const arch = cubic(at(0, 0), at(0, 100), at(100, 100), at(100, 0));

  it("finds both crossings of a line through an arch", () => {
    const found = intersectSegmentCubic(at(-50, 50), at(150, 50), arch);
    expect(found).toHaveLength(2);
    close(found[0]!.point.y, 50);
    close(found[1]!.point.y, 50);
  });

  it("reports how far along the line each crossing sits", () => {
    const found = intersectSegmentCubic(at(-50, 50), at(150, 50), arch);
    // The line runs 200 wide from x = -50, so a crossing at x = 25 is u = 0.375.
    for (const c of found) close(c.u, (c.point.x + 50) / 200);
  });

  it("ignores a crossing beyond the end of the stroke", () => {
    // The infinite line would cross twice; this segment stops before the second.
    const found = intersectSegmentCubic(at(-50, 50), at(50, 50), arch);
    expect(found).toHaveLength(1);
  });

  it("finds nothing when the line misses", () => {
    expect(intersectSegmentCubic(at(-50, 200), at(150, 200), arch)).toEqual([]);
  });

  it("crosses a straight segment too", () => {
    // A line stored as a cubic is still a cubic, and reduces cleanly.
    const line = lineAsCubic(at(0, 0), at(100, 100));
    const found = intersectSegmentCubic(at(0, 100), at(100, 0), line);
    expect(found).toHaveLength(1);
    close(found[0]!.point.x, 50);
    close(found[0]!.point.y, 50);
  });

  it("says nothing for a knife of no length", () => {
    expect(intersectSegmentCubic(at(10, 10), at(10, 10), arch)).toEqual([]);
  });
});
