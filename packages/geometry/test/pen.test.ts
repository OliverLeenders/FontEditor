import { describe, expect, it } from "vitest";

import { type Cubic, cubic, evaluate, project } from "../src/cubic.js";
import { fitCubics } from "../src/fit.js";
import {
  type PenBlend,
  type PenShape,
  blendPen,
  penPathStroke,
  penProfiles,
  penSupport,
} from "../src/pen.js";
import { vec } from "../src/vec2.js";

/**
 * A pen that changes along a stroke, and the fitting its edges need.
 *
 * Where the pen is the same at both ends of a curve the ink is what it always was,
 * and the tests for that are next door. What is asked here is the new part: that a
 * fitted edge stays within its tolerance of what it was fitted to, that a pen
 * blends the short way round, that the furthest point of a pen is where an oval's
 * is, and that a stroke whose pen grows along it grows.
 */

const line = (x0: number, y0: number, x1: number, y1: number): Cubic =>
  cubic(
    vec(x0, y0),
    vec(x0 + (x1 - x0) / 3, y0 + (y1 - y0) / 3),
    vec(x0 + ((x1 - x0) * 2) / 3, y0 + ((y1 - y0) * 2) / 3),
    vec(x1, y1),
  );

/**
 * How far a point is from the nearest of a list of curves, by projection.
 *
 * Projected rather than sampled: sampling a curve three hundred units long at two
 * hundred points is itself three quarters of a unit out, which is more than any
 * tolerance these tests hold a fit to.
 */
function nearest(curves: readonly Cubic[], p: { x: number; y: number }): number {
  return Math.min(...curves.map((c) => project(c, p).distance));
}

describe("fitting cubics through points", () => {
  it("recovers a curve it was given samples of", () => {
    // Given the directions it leaves and arrives by, as a caller who knows them
    // gives them: guessed from the first two samples, the direction is the chord
    // between them, a little off the curve's own, and no single cubic then fits.
    const source = cubic(vec(0, 0), vec(60, 120), vec(180, 120), vec(240, 0));
    const points = Array.from({ length: 30 }, (_, i) => evaluate(source, i / 29));
    const unit = (x: number, y: number) => vec(x / Math.hypot(x, y), y / Math.hypot(x, y));
    const fitted = fitCubics(points, 0.05, unit(60, 120), unit(60, -120));

    for (const p of points) expect(nearest(fitted, p)).toBeLessThan(0.1);
    // A curve that is one cubic is fitted with one or two, not with dozens.
    expect(fitted.length).toBeLessThanOrEqual(2);
  });

  it("holds to the tolerance on a shape no single cubic draws", () => {
    // Most of a circle: it needs several cubics, and every sample is within reach.
    const points = Array.from({ length: 80 }, (_, i) => {
      const a = (i / 79) * Math.PI * 1.5;
      return vec(100 * Math.cos(a), 100 * Math.sin(a));
    });
    const fitted = fitCubics(points, 0.1);

    expect(fitted.length).toBeGreaterThan(1);
    for (const p of points) expect(nearest(fitted, p)).toBeLessThan(0.2);
  });

  it("joins its pieces end to end", () => {
    const points = Array.from({ length: 60 }, (_, i) => vec(i * 5, 40 * Math.sin(i / 6)));
    const fitted = fitCubics(points, 0.05);
    for (let i = 1; i < fitted.length; i++) {
      expect(fitted[i]!.a.x).toBeCloseTo(fitted[i - 1]!.b.x, 9);
      expect(fitted[i]!.a.y).toBeCloseTo(fitted[i - 1]!.b.y, 9);
    }
  });

  it("leaves along a direction it is given", () => {
    const points = Array.from({ length: 20 }, (_, i) => vec(i * 10, (i * i) / 4));
    const [first] = fitCubics(points, 0.05, vec(1, 0));
    // Leaving level: the first handle is level with the first point.
    expect(first!.c1.y).toBeCloseTo(first!.a.y, 9);
  });

  it("fits nothing through a single point", () => {
    expect(fitCubics([vec(1, 1)], 0.1)).toEqual([]);
    expect(fitCubics([vec(1, 1), vec(1, 1)], 0.1)).toEqual([]);
  });
});

describe("blending one pen into another", () => {
  it("goes halfway at the halfway point", () => {
    const pen = blendPen(
      { angle: 20, width: 40, thickness: 0 },
      { angle: 60, width: 80, thickness: 20 },
      0.5,
    );
    expect(pen).toEqual({ angle: 40, width: 60, thickness: 10 });
  });

  it("turns the short way, over half a turn", () => {
    // A nib at 170° and one at 10° are twenty degrees apart through 180°, since a
    // nib turned half a turn is the same nib. Halfway is 180°, not 90°.
    const pen = blendPen(
      { angle: 170, width: 40, thickness: 0 },
      { angle: 10, width: 40, thickness: 0 },
      0.5,
    );
    expect(((pen.angle % 180) + 180) % 180).toBeCloseTo(0, 9);
  });
});

describe("the furthest point of a pen", () => {
  it("is the end of a broad nib the direction favours", () => {
    const broad: PenShape = { angle: 0, width: 60, thickness: 0 };
    expect(penSupport(broad, vec(1, 0.2)).x).toBeCloseTo(30, 9);
    expect(penSupport(broad, vec(-1, 0.2)).x).toBeCloseTo(-30, 9);
  });

  it("is the radius in that direction for a round pen", () => {
    const round: PenShape = { angle: 0, width: 40, thickness: 40 };
    const s = penSupport(round, vec(Math.SQRT1_2, Math.SQRT1_2));
    expect(Math.hypot(s.x, s.y)).toBeCloseTo(20, 9);
  });

  it("is the end of the long axis straight along it, and of the short one across", () => {
    const oval: PenShape = { angle: 90, width: 60, thickness: 20 };
    const along = penSupport(oval, vec(0, 1));
    const across = penSupport(oval, vec(1, 0));
    expect(along.y).toBeCloseTo(30, 9);
    expect(across.x).toBeCloseTo(10, 9);
  });
});

describe("a stroke whose pen changes along it", () => {
  /** Every point of every loop, sampled. */
  const edge = (loops: readonly Cubic[][]) =>
    loops.flatMap((loop) =>
      loop.flatMap((c) => Array.from({ length: 101 }, (_, i) => evaluate(c, i / 100))),
    );

  it("grows as a round pen grows", () => {
    // Straight along, the pen twenty across at the start and sixty at the end. At
    // the middle it is forty across, so the ink reaches twenty above the path.
    const loops = penPathStroke(
      [line(0, 0, 300, 0)],
      [
        { angle: 0, width: 20, thickness: 20 },
        { angle: 0, width: 60, thickness: 60 },
      ],
      false,
    );
    const points = edge(loops);
    const topAt = (x: number) =>
      Math.max(...points.filter((p) => Math.abs(p.x - x) < 4).map((p) => p.y));

    expect(topAt(150)).toBeCloseTo(20, 0);
    expect(topAt(5)).toBeLessThan(topAt(295));
  });

  it("fills out from a broad edge to an oval", () => {
    // Drawn along the nib's own angle: a broad edge there is edge-on and draws no
    // width, and as the pen thickens towards the far end the stroke gains some.
    const loops = penPathStroke(
      [line(0, 0, 300, 0)],
      [
        { angle: 0, width: 60, thickness: 0 },
        { angle: 0, width: 60, thickness: 30 },
      ],
      false,
    );
    const points = edge(loops);
    const heightAt = (x: number) => {
      const near = points.filter((p) => Math.abs(p.x - x) < 4);
      return near.length === 0
        ? 0
        : Math.max(...near.map((p) => p.y)) - Math.min(...near.map((p) => p.y));
    };
    expect(heightAt(280)).toBeGreaterThan(heightAt(20));
  });

  it("turns a broad nib from along the path to across it", () => {
    // At the start the nib lies along the path and draws nothing; at the end it
    // stands across it and draws its full width.
    const loops = penPathStroke(
      [line(0, 0, 300, 0)],
      [
        { angle: 0, width: 60, thickness: 0 },
        { angle: 90, width: 60, thickness: 0 },
      ],
      false,
    );
    const points = edge(loops);
    const near = points.filter((p) => p.x > 290);
    expect(Math.max(...near.map((p) => p.y)) - Math.min(...near.map((p) => p.y))).toBeGreaterThan(
      50,
    );
  });

  it("closes every loop", () => {
    const loops = penPathStroke(
      [cubic(vec(0, 0), vec(100, 150), vec(200, -150), vec(300, 0))],
      [
        { angle: 30, width: 40, thickness: 10 },
        { angle: 70, width: 90, thickness: 30 },
      ],
      false,
    );
    expect(loops.length).toBeGreaterThan(0);
    for (const loop of loops) {
      for (let i = 0; i < loop.length; i++) {
        const here = loop[i]!;
        const next = loop[(i + 1) % loop.length]!;
        expect(here.b.x).toBeCloseTo(next.a.x, 6);
        expect(here.b.y).toBeCloseTo(next.a.y, 6);
      }
    }
  });

  it("is what it always was where the pen is the same at both ends", () => {
    // A constant pen takes the exact path: a broad edge is the path moved, and its
    // edge is exactly on the moved path.
    const loops = penPathStroke(
      [line(0, 0, 300, 0)],
      [
        { angle: 90, width: 60, thickness: 0 },
        { angle: 90, width: 60, thickness: 0 },
      ],
      false,
    );
    const ys = edge(loops).map((p) => p.y);
    expect(Math.max(...ys)).toBeCloseTo(30, 9);
    expect(Math.min(...ys)).toBeCloseTo(-30, 9);
  });
});

describe("how a pen changes along a segment", () => {
  const thin: PenShape = { angle: 0, width: 20, thickness: 20 };
  const wide: PenShape = { angle: 0, width: 60, thickness: 60 };

  /** One straight segment, 300 long, blended one way for both parts of the pen. */
  const one = (blend: PenBlend, curve = line(0, 0, 300, 0)) =>
    penProfiles([curve], [thin, wide], false, [{ angle: blend, shape: blend }])[0]!;

  it("goes evenly by distance, not by the curve's parameter", () => {
    // A straight line whose handles bunch towards its start: halfway along the
    // parameter is well past halfway along the line.
    const bunched = cubic(vec(0, 0), vec(10, 0), vec(20, 0), vec(300, 0));
    const profile = one("linear", bunched);
    const halfway = [0.1, 0.3, 0.5, 0.7, 0.9]
      .map((t) => ({ t, x: evaluate(bunched, t).x }))
      .reduce((best, p) => (Math.abs(p.x - 150) < Math.abs(best.x - 150) ? p : best));
    expect(profile.at(halfway.t).width).toBeCloseTo(20 + 40 * (halfway.x / 300), 0);
  });

  it("eases away from one pen and into the other", () => {
    const eased = one("ease");
    const even = one("linear");
    // Barely changed a tenth of the way along, where even has done a tenth.
    expect(eased.at(0.1).width - 20).toBeLessThan((even.at(0.1).width - 20) / 2);
    expect(eased.at(0.5).width).toBeCloseTo(40, 6);
    expect(60 - eased.at(0.9).width).toBeLessThan((60 - even.at(0.9).width) / 2);
  });

  it("holds the first pen the whole way on a step", () => {
    const step = one("step");
    expect(step.at(0.99).width).toBe(20);
    expect(step.constant).toEqual(thin);
  });

  it("carries its rate of change through a point when smooth", () => {
    // Three points along a line, the pen growing 20, 40, 80: linear turns a corner
    // at the middle point, smooth passes through it at one rate.
    const curves = [line(0, 0, 100, 0), line(100, 0, 200, 0)];
    const pens: PenShape[] = [
      { angle: 0, width: 20, thickness: 20 },
      { angle: 0, width: 40, thickness: 40 },
      { angle: 0, width: 80, thickness: 80 },
    ];
    const smooth = { angle: "smooth", shape: "smooth" } as const;
    const [a, b] = penProfiles(curves, pens, false, [smooth, smooth]);
    const h = 1e-3;
    const into = (a!.at(1).width - a!.at(1 - h).width) / h;
    const out = (b!.at(h).width - b!.at(0).width) / h;
    expect(out).toBeCloseTo(into, 1);
  });

  it("never goes past either pen when smooth", () => {
    // Up then down: a spline that is not monotone would overshoot 80 on the way.
    const curves = [line(0, 0, 100, 0), line(100, 0, 200, 0)];
    const pens: PenShape[] = [
      { angle: 0, width: 20, thickness: 0 },
      { angle: 0, width: 80, thickness: 0 },
      { angle: 0, width: 30, thickness: 0 },
    ];
    const smooth = { angle: "smooth", shape: "smooth" } as const;
    const profiles = penProfiles(curves, pens, false, [smooth, smooth]);
    for (const p of profiles) {
      for (let k = 0; k <= 50; k++) expect(p.at(k / 50).width).toBeLessThanOrEqual(80 + 1e-9);
    }
  });

  it("is constant, and exact, where both ends have the same pen whatever the blend", () => {
    const curves = [line(0, 0, 100, 0), line(100, 0, 200, 0)];
    const pens: PenShape[] = [wide, wide, thin];
    for (const blend of ["linear", "smooth", "ease", "step"] as const) {
      const [first] = penProfiles(curves, pens, false, [
        { angle: blend, shape: blend },
        { angle: blend, shape: blend },
      ]);
      expect(first!.constant).toEqual(wide);
    }
  });

  it("blends the angle and the shape each its own way", () => {
    const profile = penProfiles(
      [line(0, 0, 300, 0)],
      [
        { angle: 0, width: 20, thickness: 0 },
        { angle: 90, width: 60, thickness: 0 },
      ],
      false,
      [{ angle: "step", shape: "linear" }],
    )[0]!;
    expect(profile.at(0.5).angle).toBe(0);
    expect(profile.at(0.5).width).toBeCloseTo(40, 6);
  });
});
