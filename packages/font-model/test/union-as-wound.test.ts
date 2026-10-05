import { describe, expect, it } from "vitest";

import {
  type Contour,
  contour,
  counterIds,
  node,
  sameInk,
  unionAsWound,
  unionByPolygons,
} from "../src/index.js";

/**
 * The union of polygons by the non-zero rule proper.
 *
 * What stands behind the union of curves, for where that loses its way. It
 * took every contour turning one way for a shape and every one turning the
 * other for a counter, and cut all the counters out of all the shapes — which
 * is the non-zero rule only where nothing overlaps a counter.
 */

const ids = counterIds("wound");

const box = (
  left: number,
  bottom: number,
  right: number,
  top: number,
  anticlockwise = true,
): Contour => {
  const corners = [
    { x: left, y: bottom },
    { x: right, y: bottom },
    { x: right, y: top },
    { x: left, y: top },
  ];
  return contour(
    ids.contour(),
    (anticlockwise ? corners : [...corners].reverse()).map((pt) => node(ids.node(), pt)),
    true,
  );
};

/** The area of the ink, by the polygons through the points: these are all straight. */
const area = (contours: readonly Contour[]): number =>
  contours.reduce((sum, c) => {
    let twice = 0;
    for (let i = 0; i < c.nodes.length; i++) {
      const p = c.nodes[i]!.pt;
      const q = c.nodes[(i + 1) % c.nodes.length]!.pt;
      twice += p.x * q.y - q.x * p.y;
    }
    return sum + twice / 2;
  }, 0);

describe("the union of polygons, as contours wind", () => {
  it("keeps a bar where it crosses a counter", () => {
    // A frame, its counter, and a bar laid across both the same way round as
    // the frame. Where the bar crosses the counter it is wound round once: ink.
    const drawn = [box(0, 0, 400, 400), box(100, 100, 300, 300, false), box(-50, 180, 450, 220)];

    const joined = unionAsWound(drawn, ids)!;
    expect(sameInk(drawn, joined, 2)).toBe(true);
    // The frame, less its counter, with the bar through the counter and out
    // each side: 160000 − 40000 + 200·40 + 2·50·40.
    expect(Math.round(area(joined))).toBe(132000);

    // What it was before: the counter cut out of everything, bar and all.
    const before = unionByPolygons(drawn, ids)!;
    expect(sameInk(drawn, before, 2)).toBe(false);
  });

  it("keeps an island inside a counter", () => {
    const drawn = [box(0, 0, 400, 400), box(100, 100, 300, 300, false), box(180, 180, 220, 220)];
    const joined = unionAsWound(drawn, ids)!;
    expect(sameInk(drawn, joined, 2)).toBe(true);
    expect(joined).toHaveLength(3);
  });

  it("joins a font drawn the other way round as readily", () => {
    // Clockwise shapes and an anticlockwise counter, as a TrueType font has them.
    const drawn = [
      box(0, 0, 300, 300, false),
      box(200, 0, 500, 300, false),
      box(50, 50, 150, 150, true),
    ];
    const joined = unionAsWound(drawn, ids)!;
    expect(sameInk(drawn, joined, 2)).toBe(true);
    // One outline round both, and the counter.
    expect(joined).toHaveLength(2);
    expect(Math.round(Math.abs(area(joined)))).toBe(500 * 300 - 100 * 100);
  });

  it("does not let a counter cut a second shape laid over it", () => {
    // Two shapes over each other and a counter where they overlap: wound round
    // twice one way and once the other, which is still ink.
    const drawn = [box(0, 0, 300, 300), box(0, 0, 300, 300), box(100, 100, 200, 200, false)];
    const joined = unionAsWound(drawn, ids)!;
    expect(joined).toHaveLength(1);
    expect(Math.round(area(joined))).toBe(90000);
  });

  it("has nothing to give of nothing", () => {
    expect(unionAsWound([], ids)).toBeNull();
  });
});
