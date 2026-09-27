import { describe, expect, it } from "vitest";

import { type Cubic, cubic, evaluate, tangent } from "../src/cubic.js";
import {
  halfNib,
  loopArea,
  nibStroke,
  nibTangencies,
  ovalPathStroke,
  ovalStroke,
  reverseLoop,
  runsAlongNib,
} from "../src/nib.js";
import { vec } from "../src/vec2.js";

/**
 * A broad-edged pen, drawn along a curve.
 *
 * The nib's ink along a stretch that never runs in the nib's direction is bounded
 * by the path moved half the nib each way and the nib at the two ends — all of it
 * exact. What is asked here is that the stretches are cut in the right places, that
 * each region is the parallelogram-with-curved-sides it should be, and that a path
 * drawn edge-on leaves no ink.
 */

const line = (x0: number, y0: number, x1: number, y1: number): Cubic =>
  cubic(
    vec(x0, y0),
    vec(x0 + (x1 - x0) / 3, y0 + (y1 - y0) / 3),
    vec(x0 + ((x1 - x0) * 2) / 3, y0 + ((y1 - y0) * 2) / 3),
    vec(x1, y1),
  );

/** Whether two vectors run the same way or directly opposite. */
const parallel = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
  Math.abs(a.x * b.y - a.y * b.x) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y)) < 1e-6;

describe("the nib as a vector", () => {
  it("is half its width, at its angle", () => {
    const h = halfNib(0, 80);
    expect(h.x).toBeCloseTo(40, 9);
    expect(h.y).toBeCloseTo(0, 9);

    const tilted = halfNib(90, 80);
    expect(tilted.x).toBeCloseTo(0, 9);
    expect(tilted.y).toBeCloseTo(40, 9);
  });
});

describe("where a curve runs along the nib", () => {
  it("finds the place a curve turns through the nib's direction", () => {
    // A quarter turn from heading right to heading up. A nib at 45 degrees is
    // passed exactly once, halfway round.
    const K = 0.5522847498307933;
    const quarter = cubic(vec(0, 0), vec(100 * K, 0), vec(100, 100 - 100 * K), vec(100, 100));
    const nib = halfNib(45, 60);

    const found = nibTangencies(quarter, nib);
    expect(found).toHaveLength(1);
    expect(parallel(tangent(quarter, found[0]!)!, nib)).toBe(true);
  });

  it("finds none where the curve never runs that way", () => {
    // Heading right and then up; a nib at minus forty-five degrees points down and
    // to the right, which the curve never does.
    const K = 0.5522847498307933;
    const quarter = cubic(vec(0, 0), vec(100 * K, 0), vec(100, 100 - 100 * K), vec(100, 100));
    expect(nibTangencies(quarter, halfNib(-45, 60))).toHaveLength(0);
  });

  it("finds both places on an S", () => {
    const ess = cubic(vec(0, 0), vec(150, 0), vec(-50, 100), vec(100, 100));
    const nib = halfNib(90, 60);
    const found = nibTangencies(ess, nib);
    expect(found.length).toBe(2);
    for (const t of found) expect(parallel(tangent(ess, t)!, nib)).toBe(true);
  });

  it("knows a straight stroke drawn edge-on", () => {
    expect(runsAlongNib(line(0, 0, 100, 0), halfNib(0, 60))).toBe(true);
    expect(runsAlongNib(line(0, 0, 100, 0), halfNib(30, 60))).toBe(false);
  });
});

describe("the ink along a stroke", () => {
  it("is a parallelogram for a straight stroke", () => {
    // A horizontal stroke with the nib held upright: a rectangle as tall as the
    // nib, as long as the stroke.
    const loops = nibStroke(line(0, 0, 200, 0), halfNib(90, 60));
    expect(loops).toHaveLength(1);

    const points = loops[0]!.flatMap((s) => [s.a, s.b]);
    const ys = points.map((p) => p.y);
    const xs = points.map((p) => p.x);
    expect(Math.min(...ys)).toBeCloseTo(-30, 9);
    expect(Math.max(...ys)).toBeCloseTo(30, 9);
    expect(Math.min(...xs)).toBeCloseTo(0, 9);
    expect(Math.max(...xs)).toBeCloseTo(200, 9);
  });

  it("is exactly the path moved, not an approximation of it", () => {
    // Every point of the first side is a point of the path moved by the nib, which
    // is the claim that makes a broad nib the exact case.
    const K = 0.5522847498307933;
    const quarter = cubic(vec(0, 0), vec(100 * K, 0), vec(100, 100 - 100 * K), vec(100, 100));
    const nib = halfNib(-45, 40);
    const [loop] = nibStroke(quarter, nib);
    const side = loop![0]!;
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const want = evaluate(quarter, t);
      const got = evaluate(side, t);
      expect(got.x).toBeCloseTo(want.x + nib.x, 9);
      expect(got.y).toBeCloseTo(want.y + nib.y, 9);
    }
  });

  it("is two regions where the stroke pinches", () => {
    const K = 0.5522847498307933;
    const quarter = cubic(vec(0, 0), vec(100 * K, 0), vec(100, 100 - 100 * K), vec(100, 100));
    expect(nibStroke(quarter, halfNib(45, 60))).toHaveLength(2);
  });

  it("is closed, each region ending where it began", () => {
    const K = 0.5522847498307933;
    const quarter = cubic(vec(0, 0), vec(100 * K, 0), vec(100, 100 - 100 * K), vec(100, 100));
    for (const loop of nibStroke(quarter, halfNib(45, 60))) {
      for (let i = 0; i < loop.length; i++) {
        const here = loop[i]!;
        const next = loop[(i + 1) % loop.length]!;
        expect(here.b.x).toBeCloseTo(next.a.x, 9);
        expect(here.b.y).toBeCloseTo(next.a.y, 9);
      }
    }
  });

  it("is nothing for a stroke drawn edge-on", () => {
    expect(nibStroke(line(0, 0, 200, 0), halfNib(0, 60))).toHaveLength(0);
  });
});

describe("which way round a region runs", () => {
  it("reads a signed area, and turns it round on request", () => {
    const [loop] = nibStroke(line(0, 0, 200, 0), halfNib(90, 60));
    const area = loopArea(loop!);
    expect(area).not.toBe(0);
    expect(Math.sign(loopArea(reverseLoop(loop!)))).toBe(-Math.sign(area));
  });
});

/** Whether a cubic is a straight line: both handles on the chord. */
const isStraight = (c: Cubic): boolean => {
  const span = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y);
  const off = (p: { x: number; y: number }) =>
    Math.abs((c.b.x - c.a.x) * (p.y - c.a.y) - (p.x - c.a.x) * (c.b.y - c.a.y)) / span;
  return span > 0 && off(c.c1) < 1e-9 && off(c.c2) < 1e-9;
};

describe("an oval pen", () => {
  /** Every point along the loops, sampled. */
  const along = (loops: readonly Cubic[][]) =>
    loops.flatMap((loop) => loop.flatMap((c) => [0, 0.25, 0.5, 0.75].map((t) => evaluate(c, t))));

  it("leaves a sausage along a straight stroke: parallel sides and round ends", () => {
    // A round pen forty wide drawn from (0,0) to (200,0). Every point of the edge
    // is within twenty of the path, and the ends reach twenty past it.
    // A band and a cap at each end, joined into one outline by the union.
    const loops = ovalStroke(line(0, 0, 200, 0), 0, 40, 40);
    expect(loops).toHaveLength(3);

    const points = along(loops);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(-20, 1);
    expect(Math.max(...xs)).toBeCloseTo(220, 1);
    expect(Math.min(...ys)).toBeCloseTo(-20, 1);
    expect(Math.max(...ys)).toBeCloseTo(20, 1);
  });

  it("keeps every point of a round pen's edge the pen's radius from the path", () => {
    // The one oval whose answer is known exactly: for a round pen the edge of the
    // ink is everywhere its radius from the path, and the ends are half circles.
    // The straight lines across the pieces are where they meet one another, inside
    // the ink, and are left out; every curve is edge.
    const K = 0.5522847498307933;
    const quarter = cubic(vec(0, 0), vec(100 * K, 0), vec(100, 100 - 100 * K), vec(100, 100));
    const curved = ovalStroke(quarter, 0, 30, 30).map((loop) => loop.filter((c) => !isStraight(c)));

    for (const p of along(curved)) {
      let nearest = Infinity;
      for (let i = 0; i <= 400; i++) {
        const q = evaluate(quarter, i / 400);
        nearest = Math.min(nearest, Math.hypot(p.x - q.x, p.y - q.y));
      }
      expect(nearest).toBeCloseTo(15, 0);
    }
  });

  it("is wider along its angle than across it", () => {
    // An oval sixty long and twenty across, held level, drawn straight up: the
    // stroke is sixty wide and its ends reach ten past the path.
    const loops = ovalStroke(line(0, 0, 0, 200), 0, 60, 20);
    const points = along(loops);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(-30, 1);
    expect(Math.max(...xs)).toBeCloseTo(30, 1);
    expect(Math.min(...ys)).toBeCloseTo(-10, 1);
    expect(Math.max(...ys)).toBeCloseTo(210, 1);
  });

  it("is closed, each loop ending where it began", () => {
    const K = 0.5522847498307933;
    const quarter = cubic(vec(0, 0), vec(100 * K, 0), vec(100, 100 - 100 * K), vec(100, 100));
    for (const loop of ovalStroke(quarter, 30, 60, 20)) {
      for (let i = 0; i < loop.length; i++) {
        const here = loop[i]!;
        const next = loop[(i + 1) % loop.length]!;
        expect(here.b.x).toBeCloseTo(next.a.x, 6);
        expect(here.b.y).toBeCloseTo(next.a.y, 6);
      }
    }
  });

  it("does not come apart where the path bends tighter than the pen", () => {
    // A quarter circle of radius ten drawn with a round pen forty wide: the inside
    // of the bend has nowhere to go. What must not happen is a NaN, a spike, or a
    // loop that runs off into the distance.
    const K = 0.5522847498307933;
    const tight = cubic(vec(0, 0), vec(10 * K, 0), vec(10, 10 - 10 * K), vec(10, 10));
    const loops = ovalStroke(tight, 0, 40, 40);
    expect(loops.length).toBeGreaterThan(0);
    for (const p of along(loops)) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(Math.hypot(p.x - 5, p.y - 5)).toBeLessThan(60);
    }
  });

  it("leaves nothing for a pen with no size", () => {
    expect(ovalStroke(line(0, 0, 200, 0), 0, 0, 20)).toHaveLength(0);
    expect(ovalStroke(line(0, 0, 200, 0), 0, 40, 0)).toHaveLength(0);
  });
});

describe("an oval pen along a path", () => {
  it("fills the outside of a corner with a wedge, and only there", () => {
    // Along and then up: a band each, a cap at each open end, and one wedge on the
    // outside of the turn. Five pieces.
    const loops = ovalPathStroke([line(0, 0, 200, 0), line(200, 0, 200, 200)], false, 0, 40, 40);
    expect(loops).toHaveLength(5);
  });

  it("puts no caps on a closed path", () => {
    // A square: four bands and four wedges, and no ends to cap.
    const square = [
      line(0, 0, 300, 0),
      line(300, 0, 300, 300),
      line(300, 300, 0, 300),
      line(0, 300, 0, 0),
    ];
    expect(ovalPathStroke(square, true, 0, 40, 40)).toHaveLength(8);
  });

  it("puts no wedge where the path carries straight on", () => {
    const loops = ovalPathStroke([line(0, 0, 100, 0), line(100, 0, 200, 0)], false, 0, 40, 40);
    // Two bands and two caps: the join is smooth, and the bands meet flush.
    expect(loops).toHaveLength(4);
  });
});
