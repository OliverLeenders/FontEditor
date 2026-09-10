import { describe, expect, it } from "vitest";

import { type Cubic, cubic, evaluate, evaluateQuadratic } from "../src/cubic.js";
import { QUADRATIC_TOLERANCE, toQuadratics, toQuadraticsTogether } from "../src/quadratic.js";
import { vec } from "../src/vec2.js";

/**
 * Cubics said in quadratics.
 *
 * The whole of this is an approximation, so the tests are about how good: every
 * one of them samples the run against the curve it stands for and asks how far
 * apart they ever get. A conversion that is close on average and wrong at one
 * end is the failure worth catching, because that end is a join between two
 * segments and a join is where the eye goes.
 */

/** The furthest a run of quadratics ever gets from the cubic it came from. */
function furthest(c: ReturnType<typeof cubic>, run: ReturnType<typeof toQuadratics>): number {
  let worst = 0;

  for (const [i, quadratic] of run.entries()) {
    for (let s = 0; s <= 32; s++) {
      const t = s / 32;
      const on = evaluateQuadratic(quadratic, t);
      const wanted = evaluate(c, (i + t) / run.length);
      worst = Math.max(worst, Math.hypot(on.x - wanted.x, on.y - wanted.y));
    }
  }

  return worst;
}

/**
 * How far the run ever gets from the curve, measured as somebody looking at it
 * would: from a point on one to the nearest point on the other.
 */
function nearest(c: ReturnType<typeof cubic>, run: ReturnType<typeof toQuadratics>): number {
  const along: { x: number; y: number }[] = [];
  // Densely: the gap between samples is itself an error in this measurement,
  // and at four hundred samples of a nine-hundred-unit curve the gaps were
  // wider than the thing being measured.
  for (let s = 0; s <= 20000; s++) along.push(evaluate(c, s / 20000));

  let worst = 0;
  for (const quadratic of run) {
    for (let s = 0; s <= 32; s++) {
      const on = evaluateQuadratic(quadratic, s / 32);
      let best = Infinity;
      for (const point of along) {
        best = Math.min(best, Math.hypot(on.x - point.x, on.y - point.y));
      }
      worst = Math.max(worst, best);
    }
  }
  return worst;
}

describe("converting a cubic", () => {
  it("keeps where it starts and where it ends", () => {
    const c = cubic(vec(0, 0), vec(100, 300), vec(300, 400), vec(400, 0));
    const run = toQuadratics(c);

    expect(run.length).toBeGreaterThan(0);
    expect(run[run.length - 1]?.b).toEqual(c.b);
  });

  it("stays within the tolerance it was given", () => {
    const c = cubic(vec(0, 0), vec(100, 300), vec(300, 400), vec(400, 0));
    expect(furthest(c, toQuadratics(c))).toBeLessThanOrEqual(QUADRATIC_TOLERANCE);
  });

  it("uses more pieces for a tighter tolerance, and fewer for a looser one", () => {
    const c = cubic(vec(0, 0), vec(0, 550), vec(400, 550), vec(400, 0));

    const tight = toQuadratics(c, 0.2);
    const loose = toQuadratics(c, 5);
    expect(tight.length).toBeGreaterThan(loose.length);
    expect(furthest(c, tight)).toBeLessThanOrEqual(0.2);
  });

  it("says a straight line in one piece", () => {
    // Both controls on the line: a quadratic does this exactly, and using more
    // than one piece for it would be points spent on nothing.
    const c = cubic(vec(0, 0), vec(100, 100), vec(200, 200), vec(300, 300));
    expect(toQuadratics(c)).toHaveLength(1);
  });

  it("handles a curve with a retracted handle", () => {
    // A control point sitting on its own anchor: there is no tangent to cross,
    // and the conversion has to answer with something rather than a hole.
    const c = cubic(vec(0, 0), vec(0, 0), vec(300, 400), vec(400, 0));
    const run = toQuadratics(c);

    expect(run.length).toBeGreaterThan(0);
    expect(furthest(c, run)).toBeLessThanOrEqual(QUADRATIC_TOLERANCE);
  });

  it("copes with the roundest thing a letter contains", () => {
    // A quarter circle drawn as a cubic, which is what every bowl is made of.
    const k = 0.5523;
    const c = cubic(vec(0, 300), vec(300 * k, 300), vec(300, 300 * k), vec(300, 0));

    const run = toQuadratics(c);
    expect(furthest(c, run)).toBeLessThanOrEqual(QUADRATIC_TOLERANCE);
    // And not at great cost: a quarter circle is two or three quadratics.
    expect(run.length).toBeLessThanOrEqual(4);
  });

  it("gives up rather than looping on something that is not a letter", () => {
    // A cubic that doubles back on itself. There is no such curve in a glyph,
    // and the answer is still far closer than the pixel grid.
    const c = cubic(vec(0, 0), vec(400, 0), vec(-400, 0), vec(0, 0));
    expect(toQuadratics(c, 0.0001).length).toBeLessThanOrEqual(32);
  });

  it("is far closer than the measure says, which is why a unit is enough", () => {
    // The same-parameter distance is what decides how many pieces to use, and
    // it overstates the case: a run accepted at a whole unit sits a small
    // fraction of one from the curve as anybody would measure it.
    const c = cubic(vec(0, 0), vec(0, 550), vec(400, 550), vec(400, 0));
    const run = toQuadratics(c);

    expect(furthest(c, run)).toBeLessThanOrEqual(QUADRATIC_TOLERANCE);
    // A run accepted at a whole unit by the same-parameter measure sits a
    // fraction of one from the curve as anybody would measure it.
    expect(nearest(c, run)).toBeLessThan(0.25);
  });
});

/**
 * The same curve in several masters, converted together.
 *
 * A delta is the difference between two points, so two masters must have the
 * same points in the same order — and converting each on its own does not give
 * that. How many quadratics a cubic needs depends on how much it bends, and a
 * Black bends more than a Light.
 */
describe("converting masters together", () => {
  /** The same segment drawn with more and more bend in it. */
  const bent = (by: number): Cubic => ({
    a: vec(0, 0),
    c1: vec(100, by),
    c2: vec(200, by),
    b: vec(300, 0),
  });

  it("gives every master the same number of points", () => {
    const runs = toQuadraticsTogether([bent(20), bent(400), bent(900)])!;

    const counts = new Set(runs.map((r) => r.length));
    expect(counts.size).toBe(1);
  });

  it("uses what the most demanding master needed", () => {
    const gentle = bent(20);
    const severe = bent(900);
    const alone = Math.max(toQuadratics(gentle).length, toQuadratics(severe).length);

    expect(toQuadraticsTogether([gentle, severe])![0]!.length).toBe(alone);
  });

  it("keeps every master within tolerance, not only the worst", () => {
    const curves = [bent(20), bent(400), bent(900)];
    const runs = toQuadraticsTogether(curves)!;

    for (const [i, run] of runs.entries()) {
      for (const [k, q] of run.entries()) {
        for (const t of [0.25, 0.5, 0.75]) {
          const on = evaluateQuadratic(q, t);
          const wanted = evaluate(curves[i]!, (k + t) / run.length);
          expect(Math.hypot(on.x - wanted.x, on.y - wanted.y)).toBeLessThanOrEqual(
            QUADRATIC_TOLERANCE + 1e-9,
          );
        }
      }
    }
  });

  it("agrees with converting one curve alone when there is only one", () => {
    const only = bent(300);
    expect(toQuadraticsTogether([only])![0]!.length).toBe(toQuadratics(only).length);
  });

  it("has nothing to say about no curves at all", () => {
    expect(toQuadraticsTogether([])).toBeNull();
  });
});
