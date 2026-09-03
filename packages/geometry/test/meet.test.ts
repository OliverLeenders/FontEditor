import { describe, expect, it } from "vitest";

import { cubic, evaluate, intersectCubics, lineAsCubic } from "../src/cubic.js";

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
