import { describe, expect, it } from "vitest";

import { type Cubic, cubic, evaluate, tangent } from "../src/cubic.js";
import { OFFSET_TOLERANCE, arcCubics, leftNormal, offsetCubic } from "../src/offset.js";
import { vec } from "../src/vec2.js";

/**
 * Moving a curve sideways.
 *
 * The offset of a cubic is not a cubic, so there is no exact answer to compare
 * against in general — but there are two shapes whose offsets are known exactly,
 * and they are the whole test. A straight line offsets to a parallel line. A
 * circular arc offsets to an arc of a different radius, and a quarter circle
 * drawn as a cubic is within a thousandth of one, so every point of its offset
 * has to sit at the new radius from the centre.
 *
 * What is asked of everything else is the promise the function makes: every point
 * of the answer is the stated distance from the curve it came from, to within the
 * stated tolerance.
 */

/** A quarter circle of radius 100 about the origin, from (100,0) to (0,100). */
const K = 0.5522847498307933;
const quarter = (radius: number): Cubic =>
  cubic(vec(radius, 0), vec(radius, radius * K), vec(radius * K, radius), vec(0, radius));

/** How far a point is from the origin. */
const radiusOf = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);

/** Every point sampled along a list of curves. */
function along(curves: readonly Cubic[], per = 8): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const c of curves) for (let i = 0; i <= per; i++) out.push(evaluate(c, i / per));
  return out;
}

/**
 * The worst distance from the offset to where it should be.
 *
 * The true offset of a curve is the set of points a fixed distance from it along
 * the normal, so for each sampled point of the answer the test walks the original
 * looking for the nearest point and asks how far away it is. Nearest rather than
 * same-parameter, for the reason the implementation measures it that way.
 */
function strayFrom(source: Cubic, curves: readonly Cubic[], distance: number): number {
  let worst = 0;
  for (const p of along(curves)) {
    let nearest = Infinity;
    for (let i = 0; i <= 400; i++) {
      const q = evaluate(source, i / 400);
      nearest = Math.min(nearest, Math.hypot(p.x - q.x, p.y - q.y));
    }
    worst = Math.max(worst, Math.abs(nearest - Math.abs(distance)));
  }
  return worst;
}

describe("the left normal", () => {
  it("is the tangent turned a quarter-turn anticlockwise", () => {
    const line = cubic(vec(0, 0), vec(10, 0), vec(20, 0), vec(30, 0));
    const normal = leftNormal(line, 0.5)!;
    expect(normal.x).toBeCloseTo(0, 9);
    expect(normal.y).toBeCloseTo(1, 9);
  });

  it("has nothing to say where there is no tangent", () => {
    const point = cubic(vec(5, 5), vec(5, 5), vec(5, 5), vec(5, 5));
    expect(leftNormal(point, 0.5)).toBeNull();
  });
});

describe("offsetting a straight line", () => {
  it("gives a parallel line, exactly", () => {
    const line = cubic(vec(0, 0), vec(10, 0), vec(20, 0), vec(30, 0));
    const out = offsetCubic(line, 5);

    expect(out).toHaveLength(1);
    for (const p of along(out)) expect(p.y).toBeCloseTo(5, 9);
  });

  it("goes the other way for a negative distance", () => {
    const line = cubic(vec(0, 0), vec(10, 0), vec(20, 0), vec(30, 0));
    for (const p of along(offsetCubic(line, -5))) expect(p.y).toBeCloseTo(-5, 9);
  });
});

describe("offsetting a circular arc", () => {
  it("moves it to the smaller radius on the side its centre is on", () => {
    // Drawn anticlockwise, so the centre is to its left and a positive offset
    // takes it inwards.
    const out = offsetCubic(quarter(100), 20);
    for (const p of along(out)) expect(radiusOf(p)).toBeCloseTo(80, 1);
  });

  it("moves it outwards for a negative distance", () => {
    const out = offsetCubic(quarter(100), -20);
    for (const p of along(out)) expect(radiusOf(p)).toBeCloseTo(120, 1);
  });

  it("costs one halving at most for a quarter turn", () => {
    // Scaling the handles by the change in radius is nearly the whole answer,
    // which is what makes this cheap. Not quite all of it: a quarter circle drawn
    // as a cubic reads 0.009786 for its curvature at the ends where a true circle
    // of that radius reads 0.01, so the first guess is a fraction wide and one
    // halving takes it inside a fiftieth of a unit.
    expect(offsetCubic(quarter(100), 20).length).toBeLessThanOrEqual(2);
    expect(offsetCubic(quarter(100), 20, 1)).toHaveLength(1);
  });

  it("keeps its ends where the normals put them", () => {
    const [first] = offsetCubic(quarter(100), 20);
    expect(first!.a.x).toBeCloseTo(80, 6);
    expect(first!.a.y).toBeCloseTo(0, 6);
  });
});

describe("offsetting a curve with an inflection", () => {
  // An S: it turns one way and then the other, so no single scaling of the
  // handles can be right at both ends.
  const ess = cubic(vec(0, 0), vec(100, 0), vec(0, 100), vec(100, 100));

  it("cuts it where it changes direction", () => {
    expect(offsetCubic(ess, 10).length).toBeGreaterThan(1);
  });

  it("stays the stated distance away all along", () => {
    expect(strayFrom(ess, offsetCubic(ess, 10), 10)).toBeLessThan(0.2);
  });

  it("is closer for a finer tolerance, and no worse", () => {
    const rough = offsetCubic(ess, 10, 1);
    const fine = offsetCubic(ess, 10, 0.001);
    expect(fine.length).toBeGreaterThanOrEqual(rough.length);
    expect(strayFrom(ess, fine, 10)).toBeLessThanOrEqual(strayFrom(ess, rough, 10) + 1e-9);
  });
});

describe("what it does with the difficult cases", () => {
  it("hands back the curve itself for no distance at all", () => {
    const s = quarter(100);
    expect(offsetCubic(s, 0)).toEqual([s]);
  });

  it("has nothing to offer a curve with no direction", () => {
    const point = cubic(vec(5, 5), vec(5, 5), vec(5, 5), vec(5, 5));
    expect(offsetCubic(point, 10)).toHaveLength(0);
  });

  it("draws what it can where the curve turns tighter than the distance", () => {
    // A radius of 20 offset inwards by 50 has no offset: every normal overshoots
    // the centre. What must not happen is a spike, a NaN or a hang.
    const out = offsetCubic(quarter(20), 50);
    for (const p of along(out)) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("holds to the default tolerance", () => {
    const ess = cubic(vec(0, 0), vec(120, 0), vec(-20, 90), vec(100, 90));
    expect(strayFrom(ess, offsetCubic(ess, 12), 12)).toBeLessThan(OFFSET_TOLERANCE * 10);
  });
});

describe("an arc as cubics", () => {
  it("draws a quarter turn as one curve", () => {
    const out = arcCubics(vec(0, 0), vec(100, 0), vec(0, 100), true);
    expect(out).toHaveLength(1);
    for (const p of along(out)) expect(radiusOf(p)).toBeCloseTo(100, 0);
  });

  it("draws a half turn as two, because one would be visibly wide", () => {
    expect(arcCubics(vec(0, 0), vec(100, 0), vec(-100, 0), true)).toHaveLength(2);
  });

  it("goes the short way or the long way, as asked", () => {
    const short = arcCubics(vec(0, 0), vec(100, 0), vec(0, 100), true);
    const long = arcCubics(vec(0, 0), vec(100, 0), vec(0, 100), false);
    expect(long.length).toBeGreaterThan(short.length);
    // The long way passes below the origin; the short way never does.
    expect(along(long).some((p) => p.y < -50)).toBe(true);
    expect(along(short).every((p) => p.y >= -1)).toBe(true);
  });

  it("leaves along the tangent, which is what makes a join smooth", () => {
    const [first] = arcCubics(vec(0, 0), vec(100, 0), vec(0, 100), true);
    const at = tangent(first!, 0)!;
    // At (100,0) on a circle about the origin, anticlockwise, the tangent is up.
    expect(at.x / Math.hypot(at.x, at.y)).toBeCloseTo(0, 3);
    expect(at.y / Math.hypot(at.x, at.y)).toBeCloseTo(1, 3);
  });

  it("has nothing to draw between a point and itself", () => {
    expect(arcCubics(vec(0, 0), vec(100, 0), vec(100, 0), true)).toHaveLength(0);
  });
});
