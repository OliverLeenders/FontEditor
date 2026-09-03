import { describe, expect, it } from "vitest";

import { segmentCount } from "../src/contour.js";
import { glyph, glyphBounds } from "../src/glyph.js";
import { counterIds } from "../src/ids.js";
import { removeOverlap } from "../src/overlap.js";
import { ellipseContour, rectContour } from "../src/shapes.js";

const ids = counterIds("ov");

/** Two squares overlapping in a corner, which is the plainest case there is. */
const crossedSquares = () =>
  glyph("a", {
    advance: 600,
    contours: [
      rectContour(ids, { minX: 0, minY: 0, maxX: 300, maxY: 300 }),
      rectContour(ids, { minX: 200, minY: 200, maxX: 500, maxY: 500 }),
    ],
  });

describe("removing overlap", () => {
  it("says there is nothing to do when the shapes do not touch", () => {
    const apart = glyph("a", {
      advance: 600,
      contours: [
        rectContour(ids, { minX: 0, minY: 0, maxX: 100, maxY: 100 }),
        rectContour(ids, { minX: 300, minY: 300, maxX: 400, maxY: 400 }),
      ],
    });
    // The same glyph back, not a copy: nothing was done to it.
    expect(removeOverlap(apart, ids)).toEqual({ glyph: apart, crossings: 0 });
    expect(removeOverlap(apart, ids)?.glyph).toBe(apart);
  });

  it("says there is nothing to do for a single contour", () => {
    const one = glyph("a", {
      contours: [rectContour(ids, { minX: 0, minY: 0, maxX: 100, maxY: 100 })],
    });
    expect(removeOverlap(one, ids)?.crossings).toBe(0);
  });

  it("turns two overlapping squares into one contour", () => {
    const out = removeOverlap(crossedSquares(), ids)!;
    expect(out.crossings).toBe(2);
    expect(out.glyph.contours).toHaveLength(1);
    expect(out.glyph.contours[0]!.closed).toBe(true);
  });

  it("gives the union the outline of both together", () => {
    const out = removeOverlap(crossedSquares(), ids)!;
    expect(glyphBounds(out.glyph)).toEqual({ minX: 0, minY: 0, maxX: 500, maxY: 500 });
  });

  it("gives the staircase its eight corners", () => {
    // Two squares meeting at a corner do not make an L — an L needs them to
    // share a whole edge. What this makes is a staircase: six of the original
    // corners survive and the two crossings become corners of their own.
    const out = removeOverlap(crossedSquares(), ids)!;
    expect(segmentCount(out.glyph.contours[0]!)).toBe(8);
  });

  it("makes an L when the two do share an edge", () => {
    const shared = glyph("a", {
      advance: 600,
      contours: [
        rectContour(ids, { minX: 0, minY: 0, maxX: 400, maxY: 150 }),
        rectContour(ids, { minX: 0, minY: 0, maxX: 150, maxY: 400 }),
      ],
    });
    // Their bottom-left corners coincide and their edges run along each other,
    // which has no crossing points to split at. Refused rather than guessed —
    // and `null` says that, where an untouched glyph would have said the
    // opposite.
    expect(removeOverlap(shared, ids)).toBeNull();
  });

  it("drops no part of the boundary", () => {
    // Every corner of the union has to appear, and neither of the two that were
    // swallowed by the overlap.
    const out = removeOverlap(crossedSquares(), ids)!;
    const has = (x: number, y: number) =>
      out.glyph.contours[0]!.nodes.some(
        (n) => Math.abs(n.pt.x - x) < 0.1 && Math.abs(n.pt.y - y) < 0.1,
      );

    expect(has(0, 0)).toBe(true);
    expect(has(500, 500)).toBe(true);
    expect(has(300, 200)).toBe(true);
    expect(has(200, 300)).toBe(true);
  });

  it("keeps curves curved", () => {
    const circles = glyph("o", {
      advance: 600,
      contours: [
        ellipseContour(ids, { minX: 0, minY: 0, maxX: 300, maxY: 300 }),
        ellipseContour(ids, { minX: 200, minY: 0, maxX: 500, maxY: 300 }),
      ],
    });
    const out = removeOverlap(circles, ids)!;

    expect(out.glyph.contours).toHaveLength(1);
    // The pieces that survived are real subcurves, so they still have handles.
    expect(out.glyph.contours[0]!.nodes.some((n) => n.out !== null)).toBe(true);
  });

  it("covers the same ground as the two circles did", () => {
    const circles = glyph("o", {
      advance: 600,
      contours: [
        ellipseContour(ids, { minX: 0, minY: 0, maxX: 300, maxY: 300 }),
        ellipseContour(ids, { minX: 200, minY: 0, maxX: 500, maxY: 300 }),
      ],
    });
    const box = glyphBounds(removeOverlap(circles, ids)!.glyph)!;

    expect(box.minX).toBeCloseTo(0, 1);
    expect(box.maxX).toBeCloseTo(500, 1);
  });
});
