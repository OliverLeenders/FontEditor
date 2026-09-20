import { describe, expect, it } from "vitest";

import {
  arcLength,
  bounds,
  controlBounds,
  cubic,
  curvature,
  derivative,
  harmonisedJoin,
  evaluate,
  extrema,
  flatten,
  inflections,
  isFlat,
  lineAsCubic,
  project,
  refitJoin,
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

describe("inflections", () => {
  it("finds the one an s-curve has, where it changes which way it bends", () => {
    // Handles on opposite sides of the chord: the curve leans one way out of
    // the first anchor and the other way into the second.
    const s = cubic(vec(0, 0), vec(0, 100), vec(100, 0), vec(100, 100));
    const roots = inflections(s);

    expect(roots).toHaveLength(1);
    expect(roots[0]!).toBeCloseTo(0.5, 12);
    // Which is where the curvature changes sign, and nowhere else.
    expect(curvature(s, roots[0]! - 0.1)!).toBeLessThan(0);
    expect(curvature(s, roots[0]! + 0.1)!).toBeGreaterThan(0);
  });

  it("finds none on a curve that bends one way throughout", () => {
    expect(inflections(ARCH)).toEqual([]);
  });

  it("finds none on a straight segment, which bends no way at all", () => {
    expect(inflections(lineAsCubic(vec(0, 0), vec(100, 40)))).toEqual([]);
  });
});

describe("refitting a join", () => {
  it("puts back the curve a split took apart", () => {
    // The pair came from one cubic, so one cubic draws them exactly and the fit
    // should find it rather than something near it.
    const [before, after] = split(ARCH, 0.4);
    const joined = refitJoin(before, after)!;

    expect(distance(joined.c1, ARCH.c1)).toBeLessThan(0.05);
    expect(distance(joined.c2, ARCH.c2)).toBeLessThan(0.05);
  });

  it("keeps the directions the curve leaves and arrives by", () => {
    // What the neighbours' own joins are made of: a smooth node either side
    // stays smooth only because these are left alone.
    const [before, after] = split(ARCH, 0.25);
    const joined = refitJoin(before, after)!;

    const leaving = Math.atan2(joined.c1.y - joined.a.y, joined.c1.x - joined.a.x);
    const wanted = Math.atan2(before.c1.y - before.a.y, before.c1.x - before.a.x);
    expect(leaving).toBeCloseTo(wanted, 9);
  });

  it("draws close to a pair that no single cubic can draw exactly", () => {
    // Two quarter arcs of different radius: the fit is an approximation, and
    // what it has to be is close, not exact. Measured as the distance to the
    // nearest point of the curve — which is what the eye judges, where the
    // distance at a matched parameter is an artefact of the matching.
    const before = cubic(vec(0, 0), vec(0, 55), vec(45, 100), vec(100, 100));
    const after = cubic(vec(100, 100), vec(180, 100), vec(240, 60), vec(240, 0));
    const joined = refitJoin(before, after)!;

    let worst = 0;
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const wanted = t < 0.5 ? evaluate(before, t * 2) : evaluate(after, (t - 0.5) * 2);
      worst = Math.max(worst, distance(project(joined, wanted).point, wanted));
    }
    // Two units off a pair spanning 240, which is inside the width of the line
    // the outline is drawn with.
    expect(worst).toBeLessThan(2);
  });

  it("gives back nothing where there is no direction to fit", () => {
    const nowhere = cubic(vec(50, 50), vec(50, 50), vec(50, 50), vec(50, 50));
    expect(refitJoin(nowhere, nowhere)).toBeNull();
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

describe("harmonising a join", () => {
  /** Curvature at the end of a cubic, which is what a join has to agree on. */
  const at = (c: ReturnType<typeof cubic>, t: number) => Math.abs(curvature(c, t)!);

  it("puts the point where the two curvatures meet", () => {
    // Two segments sharing a point, with the point deliberately in the wrong
    // place: the curvatures either side of it differ by a factor of three.
    const from = vec(0, 0);
    const c1 = vec(60, 90);
    const c2 = vec(140, 120);
    const c3 = vec(220, 120);
    const c4 = vec(320, 60);
    const to = vec(380, 0);

    const point = harmonisedJoin(
      cubic(from, c1, c2, vec(180, 120)),
      cubic(vec(180, 120), c3, c4, to),
    )!;
    expect(point).not.toBeNull();

    const before = cubic(from, c1, c2, point);
    const after = cubic(point, c3, c4, to);
    expect(at(before, 1)).toBeCloseTo(at(after, 0), 9);
  });

  it("lands on the line between the two handles, which is what keeps it smooth", () => {
    const before = cubic(vec(0, 0), vec(40, 80), vec(120, 110), vec(170, 110));
    const after = cubic(vec(170, 110), vec(230, 110), vec(300, 70), vec(340, 0));

    const point = harmonisedJoin(before, after)!;
    const span = { x: after.c1.x - before.c2.x, y: after.c1.y - before.c2.y };
    const off = { x: point.x - before.c2.x, y: point.y - before.c2.y };

    // On the line, and between the two handles rather than beyond either.
    expect(Math.abs(span.x * off.y - span.y * off.x)).toBeCloseTo(0, 6);
    const along = (off.x * span.x + off.y * span.y) / (span.x * span.x + span.y * span.y);
    expect(along).toBeGreaterThan(0);
    expect(along).toBeLessThan(1);
  });

  it("leaves an already harmonious join where it is", () => {
    // An arch, symmetric about its apex: the two sides already agree, and the
    // answer is the apex, which is where the point already sits.
    const apex = vec(100, 100);
    const before = cubic(vec(0, 0), vec(0, 60), vec(40, 100), apex);
    const after = cubic(apex, vec(160, 100), vec(200, 60), vec(200, 0));

    const point = harmonisedJoin(before, after)!;
    expect(point.x).toBeCloseTo(apex.x, 6);
    expect(point.y).toBeCloseTo(apex.y, 6);
  });

  it("has nothing to match where a side is straight", () => {
    // A straight side has no curvature; moving the point to agree with it would
    // bend the curve to zero rather than harmonise anything.
    const middle = vec(100, 100);
    const straight = cubic(vec(0, 100), vec(40, 100), vec(60, 100), middle);
    const curved = cubic(middle, vec(160, 100), vec(200, 60), vec(200, 0));
    expect(harmonisedJoin(straight, curved)).toBeNull();
  });

  it("declines where there is nothing to solve", () => {
    // Both inner handles in the same place: no line to slide along.
    const same = vec(100, 100);
    expect(
      harmonisedJoin(
        cubic(vec(0, 0), vec(20, 60), same, same),
        cubic(same, same, vec(180, 60), vec(200, 0)),
      ),
    ).toBeNull();
  });
});
