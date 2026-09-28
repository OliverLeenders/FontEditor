import { describe, expect, it } from "vitest";

import { continuousJoin, parameterAtDistance } from "../src/corner.js";
import { type Cubic, cubic, curvature, evaluate } from "../src/cubic.js";
import { vec } from "../src/vec2.js";

/**
 * The continuous corner: a plain round when it is not smoothed, a curvature that
 * ramps up from nothing when it is, and a curve that settles into a line.
 */

const line = (x0: number, y0: number, x1: number, y1: number): Cubic =>
  cubic(
    vec(x0, y0),
    vec(x0 + (x1 - x0) / 3, y0 + (y1 - y0) / 3),
    vec(x0 + ((x1 - x0) * 2) / 3, y0 + ((y1 - y0) * 2) / 3),
    vec(x1, y1),
  );

// Along the baseline to the origin, then straight up: a left turn of a quarter.
const across = line(-300, 0, 0, 0);
const up = line(0, 0, 0, 300);

describe("a continuous corner between two lines", () => {
  it("is a plain round with no smoothness, spending the size of each side", () => {
    const join = continuousJoin(across, up, true, true, { size: 100, smoothness: 0 })!;
    // A plain round of radius 100 touches each side 100 from the corner.
    expect(evaluate(across, join.before).x).toBeCloseTo(-100, 6);
    expect(evaluate(up, join.after).y).toBeCloseTo(100, 6);
    // Every point of it is the radius from the centre, (-100, 100).
    for (const { curve } of join.pieces) {
      for (let k = 0; k <= 10; k++) {
        const p = evaluate(curve, k / 10);
        expect(Math.hypot(p.x + 100, p.y - 100)).toBeCloseTo(100, 1);
      }
    }
  });

  it("chains its pieces end to end, from one cut to the other", () => {
    const join = continuousJoin(across, up, true, true, { size: 120, smoothness: 0.6 })!;
    const first = join.pieces[0]!.curve;
    const last = join.pieces[join.pieces.length - 1]!.curve;
    expect(first.a.x).toBeCloseTo(evaluate(across, join.before).x, 6);
    expect(last.b.y).toBeCloseTo(evaluate(up, join.after).y, 6);
    for (let i = 1; i < join.pieces.length; i++) {
      expect(join.pieces[i]!.curve.a.x).toBeCloseTo(join.pieces[i - 1]!.curve.b.x, 6);
      expect(join.pieces[i]!.curve.a.y).toBeCloseTo(join.pieces[i - 1]!.curve.b.y, 6);
    }
  });

  it("leaves each side with no curvature when smoothed", () => {
    const join = continuousJoin(across, up, true, true, { size: 120, smoothness: 1 })!;
    const ramp = join.pieces[0]!.curve;
    expect(Math.abs(curvature(ramp, 0)!)).toBeLessThan(1e-9);
    const out = join.pieces[join.pieces.length - 1]!.curve;
    expect(Math.abs(curvature(out, 1)!)).toBeLessThan(1e-9);
  });

  it("ramps into the arc without a jump in curvature", () => {
    const join = continuousJoin(across, up, true, true, { size: 150, smoothness: 0.5 })!;
    const [ramp, arc] = join.pieces;
    expect(curvature(ramp!.curve, 1)!).toBeCloseTo(curvature(arc!.curve, 0)!, 3);
  });

  it("stays inside the corner and within the size along each side", () => {
    const join = continuousJoin(across, up, true, true, { size: 150, smoothness: 0.8 })!;
    for (const { curve } of join.pieces) {
      for (let k = 0; k <= 10; k++) {
        const p = evaluate(curve, k / 10);
        expect(p.x).toBeLessThanOrEqual(1e-9);
        expect(p.y).toBeGreaterThanOrEqual(-1e-9);
        expect(p.x).toBeGreaterThanOrEqual(-150 - 1e-6);
        expect(p.y).toBeLessThanOrEqual(150 + 1e-6);
      }
    }
  });

  it("turns the other way on a right turn", () => {
    const down = line(0, 0, 0, -300);
    const join = continuousJoin(across, down, true, true, { size: 100, smoothness: 0.5 })!;
    for (const { curve } of join.pieces) expect(evaluate(curve, 0.5).y).toBeLessThanOrEqual(1e-9);
  });

  it("does nothing where two lines run on in one line", () => {
    expect(
      continuousJoin(across, line(0, 0, 300, 0), true, true, { size: 50, smoothness: 1 }),
    ).toBeNull();
  });
});

describe("a curve settling into a line", () => {
  // A quarter bowl arriving at the origin level, then the line on along x.
  const bowl = cubic(vec(-200, 200), vec(-200, 90), vec(-110, 0), vec(0, 0));
  const on = line(0, 0, 400, 0);

  it("arrives on the line with no curvature, and leaves the curve with the curve's", () => {
    const join = continuousJoin(bowl, on, false, true, { size: 60, smoothness: 1 })!;
    expect(join.pieces).toHaveLength(1);
    const piece = join.pieces[0]!.curve;
    expect(Math.abs(curvature(piece, 1)!)).toBeLessThan(1e-9);
    expect(curvature(piece, 0)!).toBeCloseTo(curvature(bowl, join.before)!, 6);
    // It ends on the line, the size along it.
    expect(piece.b.y).toBeCloseTo(0, 9);
    expect(piece.b.x).toBeCloseTo(60, 6);
  });

  it("works the other way round, from a line into a curve", () => {
    const off = line(-400, 0, 0, 0);
    const rise = cubic(vec(0, 0), vec(110, 0), vec(200, 90), vec(200, 200));
    const join = continuousJoin(off, rise, true, false, { size: 60, smoothness: 1 })!;
    const piece = join.pieces[0]!.curve;
    expect(Math.abs(curvature(piece, 0)!)).toBeLessThan(1e-9);
    expect(curvature(piece, 1)!).toBeCloseTo(curvature(rise, join.after)!, 6);
  });
});

describe("distance along a curve", () => {
  it("finds the parameter a distance along, and back from the end", () => {
    const s = line(0, 0, 300, 0);
    expect(parameterAtDistance(s, 100, false)).toBeCloseTo(1 / 3, 6);
    expect(parameterAtDistance(s, 100, true)).toBeCloseTo(2 / 3, 6);
    expect(parameterAtDistance(s, 500, false)).toBe(1);
  });
});
