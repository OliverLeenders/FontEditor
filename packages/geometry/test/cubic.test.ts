import { describe, expect, it } from "vitest";

import {
  arcLength,
  bounds,
  controlBounds,
  cubic,
  derivative,
  evaluate,
  extrema,
  flatten,
  isFlat,
  lineAsCubic,
  project,
  reverse,
  split,
  subcurve,
  tangent,
} from "../src/cubic.js";
import { distance, distanceToRect, vec } from "../src/vec2.js";

/** An arch: up from the origin, over, and back down to (100, 0). */
const ARCH = cubic(vec(0, 0), vec(0, 100), vec(100, 100), vec(100, 0));

describe("evaluate", () => {
  it("hits the anchors at the ends", () => {
    expect(evaluate(ARCH, 0)).toEqual(vec(0, 0));
    expect(evaluate(ARCH, 1)).toEqual(vec(100, 0));
  });

  it("agrees with the hand-computed midpoint", () => {
    // B(1/2) = (a + 3c1 + 3c2 + b) / 8
    const m = evaluate(ARCH, 0.5);
    expect(m.x).toBeCloseTo(50, 12);
    expect(m.y).toBeCloseTo(75, 12);
  });
});

describe("derivative and tangent", () => {
  it("points along the outgoing handle at t = 0", () => {
    const d = derivative(ARCH, 0);
    expect(d.x).toBeCloseTo(0, 12);
    expect(d.y).toBeCloseTo(300, 12);
  });

  it("is horizontal at the top of the arch", () => {
    const t = tangent(ARCH, 0.5);
    expect(t).not.toBeNull();
    expect(t!.y).toBeCloseTo(0, 12);
    expect(Math.abs(t!.x)).toBeCloseTo(1, 12);
  });

  it("returns null at a cusp", () => {
    const cusp = cubic(vec(0, 0), vec(0, 0), vec(10, 10), vec(10, 10));
    expect(tangent(cusp, 0)).toBeNull();
  });
});

describe("split and subcurve", () => {
  it("produces halves that trace the original curve", () => {
    const [left, right] = split(ARCH, 0.5);
    expect(left.a).toEqual(ARCH.a);
    expect(right.b).toEqual(ARCH.b);
    expect(left.b).toEqual(right.a);

    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const onLeft = evaluate(left, u);
      const onWhole = evaluate(ARCH, u * 0.5);
      expect(distance(onLeft, onWhole)).toBeCloseTo(0, 10);
    }
  });

  it("extracts an interior span", () => {
    const mid = subcurve(ARCH, 0.25, 0.75);
    expect(distance(mid.a, evaluate(ARCH, 0.25))).toBeCloseTo(0, 10);
    expect(distance(mid.b, evaluate(ARCH, 0.75))).toBeCloseTo(0, 10);
    expect(distance(evaluate(mid, 0.5), evaluate(ARCH, 0.5))).toBeCloseTo(0, 10);
  });

  it("orders its bounds", () => {
    const forward = subcurve(ARCH, 0.2, 0.8);
    const backward = subcurve(ARCH, 0.8, 0.2);
    expect(distance(forward.a, backward.a)).toBeCloseTo(0, 10);
    expect(distance(forward.b, backward.b)).toBeCloseTo(0, 10);
  });
});

describe("extrema and bounds", () => {
  it("finds the single vertical extremum of the arch", () => {
    const roots = extrema(ARCH);
    expect(roots).toHaveLength(1);
    expect(roots[0]!).toBeCloseTo(0.5, 12);
  });

  it("bounds the curve at its true height, not its handle height", () => {
    // The control hull would say 100; the curve only reaches 75.
    const box = bounds(ARCH);
    expect(box.minX).toBeCloseTo(0, 12);
    expect(box.minY).toBeCloseTo(0, 12);
    expect(box.maxX).toBeCloseTo(100, 12);
    expect(box.maxY).toBeCloseTo(75, 12);
  });
});

describe("flatten", () => {
  it("reduces a straight segment to its endpoints", () => {
    const straight = lineAsCubic(vec(0, 0), vec(30, 0));
    expect(isFlat(straight)).toBe(true);
    expect(flatten(straight)).toEqual([vec(0, 0), vec(30, 0)]);
  });

  it("subdivides a curved segment and keeps the endpoints", () => {
    const points = flatten(ARCH, 0.05);
    expect(points.length).toBeGreaterThan(4);
    expect(points[0]!).toEqual(ARCH.a);
    expect(points[points.length - 1]!).toEqual(ARCH.b);
  });

  it("converges towards the true arc length as tolerance tightens", () => {
    const coarse = arcLength(ARCH, 5);
    const fine = arcLength(ARCH, 0.001);
    expect(fine).toBeGreaterThanOrEqual(coarse - 1e-9);
    expect(fine).toBeGreaterThan(100);
  });
});

describe("lineAsCubic", () => {
  it("places the handles at the thirds", () => {
    expect(lineAsCubic(vec(0, 0), vec(30, 0))).toEqual({
      a: vec(0, 0),
      c1: vec(10, 0),
      c2: vec(20, 0),
      b: vec(30, 0),
    });
  });
});

describe("reverse", () => {
  it("traces the same points in the opposite order", () => {
    const back = reverse(ARCH);
    for (const t of [0, 0.3, 0.5, 0.9, 1]) {
      expect(distance(evaluate(back, t), evaluate(ARCH, 1 - t))).toBeCloseTo(0, 10);
    }
  });
});

describe("project", () => {
  it("finds the apex from directly above it", () => {
    const p = project(ARCH, vec(50, 200));
    expect(p.t).toBeCloseTo(0.5, 3);
    expect(p.distance).toBeCloseTo(125, 3);
  });

  it("clamps to the start when the query is behind it", () => {
    const p = project(ARCH, vec(-50, -50));
    expect(p.t).toBeCloseTo(0, 2);
  });

  it("reports a point that lies on the curve", () => {
    const p = project(ARCH, vec(20, 40));
    expect(distance(p.point, evaluate(ARCH, p.t))).toBeCloseTo(0, 10);
  });
});

describe("the control box", () => {
  it("holds the curve, and is looser than the exact bounds", () => {
    // A curve with long handles: its own box stops where the curve does, and the
    // control box goes out to where the handles are.
    const s = { a: vec(0, 0), c1: vec(0, 200), c2: vec(100, 200), b: vec(100, 0) };
    const exact = bounds(s);
    const box = controlBounds(s);

    expect(box.maxY).toBe(200);
    expect(exact.maxY).toBeLessThan(box.maxY);
    expect(box.minX).toBeLessThanOrEqual(exact.minX);
    expect(box.maxX).toBeGreaterThanOrEqual(exact.maxX);
    expect(box.minY).toBeLessThanOrEqual(exact.minY);
  });

  it("never claims a point is far when the curve is near", () => {
    // The property the rejection test depends on: the box distance is a floor
    // under the real one, so anything it dismisses really was out of reach.
    const s = { a: vec(0, 0), c1: vec(50, 150), c2: vec(150, -150), b: vec(200, 0) };
    for (const p of [vec(-40, 20), vec(100, 90), vec(240, -30), vec(100, 0)]) {
      expect(distanceToRect(controlBounds(s), p)).toBeLessThanOrEqual(
        project(s, p).distance + 1e-9,
      );
    }
  });
});
