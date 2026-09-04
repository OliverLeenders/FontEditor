import { describe, expect, it } from "vitest";

import {
  cubic,
  evaluate,
  intersectCubics,
  lineAsCubic,
  selfIntersection,
  subcurve,
} from "../src/cubic.js";

const at = (x: number, y: number) => ({ x, y });

describe("intersectCubics", () => {
  it("finds the crossing of two straight segments", () => {
    const a = lineAsCubic(at(0, 0), at(100, 100));
    const b = lineAsCubic(at(0, 100), at(100, 0));
    const met = intersectCubics(a, b)!;

    expect(met).toHaveLength(1);
    expect(met[0]!.point.x).toBeCloseTo(50, 2);
    expect(met[0]!.point.y).toBeCloseTo(50, 2);
  });

  it("finds nothing when they miss", () => {
    const a = lineAsCubic(at(0, 0), at(100, 0));
    const b = lineAsCubic(at(0, 50), at(100, 50));
    expect(intersectCubics(a, b)).toEqual([]);
  });

  it("finds both crossings of a line through an arch", () => {
    const arch = cubic(at(0, 0), at(0, 200), at(200, 200), at(200, 0));
    const line = lineAsCubic(at(-50, 75), at(250, 75));
    const met = intersectCubics(arch, line)!;

    expect(met).toHaveLength(2);
    for (const m of met) expect(m.point.y).toBeCloseTo(75, 2);
  });

  it("reports parameters that really name the points", () => {
    // The whole use of the result: a caller splits both curves at these.
    const arch = cubic(at(0, 0), at(0, 200), at(200, 200), at(200, 0));
    const line = lineAsCubic(at(-50, 75), at(250, 75));

    for (const m of intersectCubics(arch, line)!) {
      const onA = evaluate(arch, m.t1);
      const onB = evaluate(line, m.t2);
      expect(Math.hypot(onA.x - onB.x, onA.y - onB.y)).toBeLessThan(0.05);
    }
  });

  it("finds where two curves cross each other", () => {
    const a = cubic(at(0, 0), at(60, 200), at(140, 200), at(200, 0));
    const b = cubic(at(0, 150), at(60, -50), at(140, -50), at(200, 150));
    const met = intersectCubics(a, b)!;
    expect(met.length).toBeGreaterThanOrEqual(2);
  });

  it("reports one crossing once, not once per subdivision", () => {
    const a = lineAsCubic(at(0, 0), at(100, 100));
    const b = lineAsCubic(at(100, 0), at(0, 100));
    expect(intersectCubics(a, b)!).toHaveLength(1);
  });

  it("refuses two curves that lie along each other", () => {
    // Every point of the shared stretch is a crossing, so there is no finite
    // answer — and a caller told there were four hundred would tear the outline
    // apart trying to split at all of them.
    const a = lineAsCubic(at(0, 0), at(100, 0));
    const b = lineAsCubic(at(20, 0), at(80, 0));
    expect(intersectCubics(a, b)).toBeNull();
  });

  it("says nothing about a curve and itself", () => {
    const a = cubic(at(0, 0), at(0, 100), at(100, 100), at(100, 0));
    expect(intersectCubics(a, a)).toBeNull();
  });
});

describe("selfIntersection", () => {
  it("finds the loop a crossed-over pair of handles makes", () => {
    // Handles that reach past each other: the curve goes out, round, and back
    // through its own path.
    const loop = cubic(at(0, 0), at(150, 100), at(-50, 100), at(100, 0));
    const met = selfIntersection(loop)!;

    expect(met).not.toBeNull();
    expect(met.t1).toBeGreaterThan(0);
    expect(met.t2).toBeLessThan(1);
    expect(met.t1).toBeLessThan(met.t2);

    // The whole claim: two parameters, one place.
    const there = evaluate(loop, met.t2);
    expect(there.x).toBeCloseTo(met.point.x, 6);
    expect(there.y).toBeCloseTo(met.point.y, 6);
  });

  it("finds nothing in the curves a font is actually drawn with", () => {
    expect(selfIntersection(cubic(at(0, 0), at(0, 100), at(100, 100), at(100, 0)))).toBeNull();
    expect(selfIntersection(cubic(at(0, 0), at(100, 0), at(0, 100), at(100, 100)))).toBeNull();
    expect(selfIntersection(cubic(at(0, 0), at(60, 0), at(100, 40), at(100, 100)))).toBeNull();
  });

  it("finds nothing in a curve that is really a line", () => {
    // Every coefficient above the first vanishes, so there is no determinant to
    // divide by.
    expect(selfIntersection(lineAsCubic(at(0, 0), at(100, 100)))).toBeNull();
    expect(selfIntersection(cubic(at(0, 0), at(33, 33), at(66, 66), at(100, 100)))).toBeNull();
  });

  it("finds nothing when the crossing lies outside the segment", () => {
    // The curve this is a piece of loops; this piece of it does not, and
    // splitting here would cut at a point the outline never reaches.
    const whole = cubic(at(0, 0), at(150, 100), at(-50, 100), at(100, 0));
    const met = selfIntersection(whole)!;
    const before = subcurve(whole, 0, (met.t1 + met.t2) / 2);
    expect(selfIntersection(before)).toBeNull();
  });

  it("is not fooled by a cusp", () => {
    // Handles meeting at a point: the curve comes to a stop and turns round,
    // which looks like a loop of zero size and is not one.
    expect(selfIntersection(cubic(at(0, 0), at(50, 0), at(50, 0), at(0, 0)))).toBeNull();
  });
});
