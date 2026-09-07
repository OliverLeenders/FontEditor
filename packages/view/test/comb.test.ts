import { curvature, cubic, vec } from "@fonteditor/geometry";
import { contour, counterIds, node } from "@fonteditor/font-model";
import { describe, expect, it } from "vitest";

import { combFor, combScale } from "../src/comb.js";
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

    // A circle of radius 100 is about 628 units round, so a hair every 20 gives
    // about thirty of them.
    expect(comb!.hairs.length).toBeGreaterThan(24);
    expect(comb!.hairs.length).toBeLessThan(36);

    for (const hair of comb!.hairs) {
      // Every hair is a unit vector, and on a circle it points at the centre.
      expect(Math.hypot(hair.normal.x, hair.normal.y)).toBeCloseTo(1, 9);
      expect(Math.hypot(hair.at.x, hair.at.y)).toBeCloseTo(100, 1);
      expect(hair.k).toBeCloseTo(1 / 100, 3);
    }
  });

  it("puts more hairs on the same shape when it is zoomed in", () => {
    const near = combFor([circle(100)], { scale: 4, tx: 0, ty: 0 }, { spacingPixels: 20 });
    const far = combFor([circle(100)], { scale: 1, tx: 0, ty: 0 }, { spacingPixels: 20 });

    // The spacing is in screen pixels, so the comb stays readable at both sizes
    // rather than thinning out as the letter grows.
    expect(near[0]!.hairs.length).toBeGreaterThan(far[0]!.hairs.length * 3);
  });

  it("scales so the sharpest turn in the glyph is the longest hair", () => {
    const combs = combFor([circle(50), circle(200)], VIEW, { spacingPixels: 20 });
    const scale = combScale(combs, VIEW, { depthPixels: 40 });

    // The tighter circle turns four times as hard, and gets the full depth; the
    // wider one is drawn to scale beside it rather than normalised to itself.
    const sharpest = Math.max(...combs.flatMap((c) => c.hairs.map((h) => Math.abs(h.k))));
    expect(sharpest * scale).toBeCloseTo(40, 6);

    const gentlest = Math.min(...combs.flatMap((c) => c.hairs.map((h) => Math.abs(h.k))));
    expect(gentlest * scale).toBeGreaterThan(9.5);
    expect(gentlest * scale).toBeLessThan(10.5);
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

    const combs = combFor([square], VIEW, { spacingPixels: 20 });
    // No curvature anywhere, so no scale — and the renderer draws nothing.
    expect(combScale(combs, VIEW)).toBe(0);
  });

  it("keeps each contour's hairs apart, so no envelope crosses the letter", () => {
    const combs = combFor([circle(100), circle(40)], VIEW, { spacingPixels: 20 });
    expect(combs).toHaveLength(2);
    expect(combs[0]!.hairs.length).toBeGreaterThan(combs[1]!.hairs.length);
  });
});
