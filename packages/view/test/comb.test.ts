import { curvature, cubic, vec } from "@typewright/geometry";
import { contour, counterIds, node, reverseContour } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { combFor } from "../src/comb.js";
import type { ViewTransform } from "../src/transform.js";

/**
 * Curvature, and the comb built from it.
 *
 * The numbers are checked against shapes whose curvature is known: a circle
 * turns by the reciprocal of its radius everywhere, a straight line does not
 * turn at all, and an S changes which way it turns exactly once.
 */

const ids = counterIds("comb");
const VIEW: ViewTransform = { scale: 1, tx: 0, ty: 0 };

/** The constant that makes four cubics a circle to within a thousandth. */
const K = 0.5522847498;

/** A circle of radius `r` about the origin, as four cubic quarters. */
function circle(r: number) {
  const k = r * K;
  return contour(
    ids.contour(),
    [
      node(ids.node(), vec(r, 0), { type: "smooth", in: vec(r, -k), out: vec(r, k) }),
      node(ids.node(), vec(0, r), { type: "smooth", in: vec(k, r), out: vec(-k, r) }),
      node(ids.node(), vec(-r, 0), { type: "smooth", in: vec(-r, k), out: vec(-r, -k) }),
      node(ids.node(), vec(0, -r), { type: "smooth", in: vec(-k, -r), out: vec(k, -r) }),
    ],
    true,
  );
}

describe("curvature", () => {
  it("is the reciprocal of the radius, on a circle", () => {
    const quarter = cubic(vec(100, 0), vec(100, 100 * K), vec(100 * K, 100), vec(0, 100));

    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      // Within a couple of percent, which is the shape's error and not the
      // maths': four cubics fit a circle to within a fortieth of a percent in
      // *position*, and curvature is the second derivative of position, so the
      // same fit ripples about two percent. A comb drawn on a Bézier circle
      // really is very slightly wavy.
      expect(curvature(quarter, t)!).toBeCloseTo(1 / 100, 3);
    }
  });

  it("is zero on a straight line, whatever its handles", () => {
    const straight = cubic(vec(0, 0), vec(30, 0), vec(70, 0), vec(100, 0));
    expect(curvature(straight, 0.5)).toBeCloseTo(0, 12);
  });

  it("changes sign where the curve changes hands", () => {
    // An S: it turns one way, then the other.
    const s = cubic(vec(0, 0), vec(100, 0), vec(0, 100), vec(100, 100));
    expect(Math.sign(curvature(s, 0.15)!)).toBe(-Math.sign(curvature(s, 0.85)!));
    // And crosses zero in the middle, which is the inflection.
    expect(curvature(s, 0.5)!).toBeCloseTo(0, 9);
  });

  it("has no answer where the curve has no direction", () => {
    // Both handles on the first anchor: the derivative vanishes at t = 0, so
    // there is no tangent and no circle fitting there.
    const cusped = cubic(vec(0, 0), vec(0, 0), vec(0, 0), vec(100, 0));
    expect(curvature(cusped, 0)).toBeNull();
  });
});

describe("the comb", () => {
  it("stands a hair every few pixels, square to the outline", () => {
    const [comb] = combFor([circle(100)], VIEW, { spacingPixels: 20 });
    expect(comb).toBeDefined();

    // One unbroken run: a circle curves the whole way round, including past the
    // place the walk began.
    expect(comb!.runs).toHaveLength(1);

    // A circle of radius 100 is about 628 units round, so a hair every 20 gives
    // about thirty of them.
    const hairs = comb!.runs.flat();
    expect(hairs.length).toBeGreaterThan(24);
    expect(hairs.length).toBeLessThan(36);

    for (const hair of hairs) {
      expect(Math.hypot(hair.normal.x, hair.normal.y)).toBeCloseTo(1, 9);
      expect(Math.hypot(hair.at.x, hair.at.y)).toBeCloseTo(100, 1);
      expect(hair.k).toBeCloseTo(1 / 100, 3);
      // And it points out of the ink: this circle runs anticlockwise, which is
      // an outer contour, so away from the ink is away from the centre.
      expect(hair.normal.x * hair.at.x + hair.normal.y * hair.at.y).toBeGreaterThan(0);
    }
  });

  it("puts more hairs on the same shape when it is zoomed in", () => {
    const near = combFor([circle(100)], { scale: 4, tx: 0, ty: 0 }, { spacingPixels: 20 });
    const far = combFor([circle(100)], { scale: 1, tx: 0, ty: 0 }, { spacingPixels: 20 });

    // The spacing is in screen pixels, so the comb stays readable at both sizes
    // rather than thinning out as the letter grows.
    expect(near[0]!.runs.flat().length).toBeGreaterThan(far[0]!.runs.flat().length * 3);
  });

  it("draws the tighter turn longer, in proportion", () => {
    const combs = combFor([circle(50), circle(200)], VIEW, {
      spacingPixels: 20,
      depthPixels: 40,
    });

    // Found by the radius each one turns at, allowing for the ripple a Bézier
    // circle has: 1/k is 50 on one and 200 on the other.
    const radiusOf = (c: (typeof combs)[number]) => 1 / Math.abs(c.runs[0]![0]!.k);
    const tight = combs.find((c) => Math.abs(radiusOf(c) - 50) < 5)!;
    const wide = combs.find((c) => Math.abs(radiusOf(c) - 200) < 20)!;

    // Four times the curvature, four times the hair: the two are drawn to one
    // scale, which is what lets them be compared.
    // The root of four: sharper is visibly sharper without one corner sending a
    // spike across the letter.
    expect(tight.runs[0]![0]!.reach / wide.runs[0]![0]!.reach).toBeCloseTo(2, 1);
  });

  it("is not flattened by one corner far sharper than the rest", () => {
    // A wide bowl with a tight spur in it, which is every letter with a join.
    // Scaling by the sharpest hair would leave the bowl a hair high; scaling by
    // the typical one keeps the bowl readable and clamps the spur.
    const combs = combFor([circle(400), circle(8)], VIEW, {
      spacingPixels: 20,
      depthPixels: 40,
    });

    const bowl = combs.find((c) => Math.abs(1 / Math.abs(c.runs[0]![0]!.k) - 400) < 40)!;
    expect(bowl.runs[0]![0]!.reach).toBeGreaterThan(4);

    // The spur is drawn longer, but by the root of how much sharper it is: a
    // corner fifty times the curvature is seven times the hair, not fifty.
    const spur = combs.find((c) => Math.abs(1 / Math.abs(c.runs[0]![0]!.k) - 8) < 2)!;
    expect(spur.runs[0]![0]!.reach / bowl.runs[0]![0]!.reach).toBeLessThan(12);
  });

  it("leaves out a curve too gentle to count as one", () => {
    // A circle whose radius is a hundred times the size of the thing drawn: a
    // stem edge with a whisper of curvature in it. Drawing a hair there puts a
    // second line beside the stem, parallel to it, which reads as an outline
    // rather than as a measurement.
    const gentle = contour(
      ids.contour(),
      [
        node(ids.node(), vec(0, 0), { type: "smooth", out: vec(100, 0.02) }),
        node(ids.node(), vec(300, 0), { type: "smooth", in: vec(200, 0.02) }),
      ],
      false,
    );

    expect(combFor([gentle], VIEW, { spacingPixels: 20 })).toEqual([]);
  });

  it("has nothing to draw for a glyph of straight lines", () => {
    const square = contour(
      ids.contour(),
      [
        node(ids.node(), vec(0, 0)),
        node(ids.node(), vec(100, 0)),
        node(ids.node(), vec(100, 100)),
        node(ids.node(), vec(0, 100)),
      ],
      true,
    );

    // No curvature anywhere, so no comb at all.
    expect(combFor([square], VIEW, { spacingPixels: 20 })).toEqual([]);
  });

  it("turns the hairs the other way on a hole, which is still out of the ink", () => {
    // A counter runs clockwise. Away from the ink is then *into* the counter,
    // which is the direction that keeps the comb clear of the letter.
    const hole = reverseContour(circle(100));
    const [comb] = combFor([hole], VIEW, { spacingPixels: 20 });

    for (const hair of comb!.runs.flat()) {
      expect(hair.normal.x * hair.at.x + hair.normal.y * hair.at.y).toBeLessThan(0);
    }
  });

  it("breaks the comb where the outline goes straight", () => {
    // The shape that reported this: an arch, a straight stretch, another arch —
    // the tip of an `m`'s shoulder. Joined into one run, the envelope leaps the
    // straight part and draws a line alongside it, parallel to the edge, which
    // reads as a second outline.
    const arches = contour(
      ids.contour(),
      [
        node(ids.node(), vec(0, 0), { type: "corner", out: vec(0, 120) }),
        node(ids.node(), vec(120, 200), { type: "corner", in: vec(40, 200) }),
        // A straight run to the next node: no handles either side of it.
        node(ids.node(), vec(220, 200), { type: "corner", out: vec(300, 200) }),
        node(ids.node(), vec(360, 60), { type: "corner", in: vec(360, 140) }),
      ],
      false,
    );

    const [comb] = combFor([arches], VIEW, { spacingPixels: 20 });
    expect(comb!.runs).toHaveLength(2);

    // And each run stops before the straight part: no hair stands on it.
    for (const run of comb!.runs) {
      for (const hair of run) {
        const onTheStraight = hair.at.y > 199.5 && hair.at.x > 120 && hair.at.x < 220;
        expect(onTheStraight).toBe(false);
      }
    }
  });

  it("keeps each contour's hairs apart, so no envelope crosses the letter", () => {
    const combs = combFor([circle(100), circle(40)], VIEW, { spacingPixels: 20 });
    expect(combs).toHaveLength(2);
    expect(combs[0]!.runs.flat().length).toBeGreaterThan(combs[1]!.runs.flat().length);
  });
});
