import { describe, expect, it } from "vitest";

import { contour, segmentCount } from "../src/contour.js";
import { glyph, glyphBounds } from "../src/glyph.js";
import { counterIds } from "../src/ids.js";
import { node } from "../src/node.js";
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

/**
 * A contour that crosses itself: the two diagonals of a square, walked in the
 * order that makes a bowtie. Two triangles joined at a point, drawn as one loop.
 */
const bowtie = () =>
  glyph("a", {
    advance: 600,
    contours: [
      contour(
        ids.contour(),
        [
          node(ids.node(), { x: 0, y: 0 }),
          node(ids.node(), { x: 100, y: 100 }),
          node(ids.node(), { x: 100, y: 0 }),
          node(ids.node(), { x: 0, y: 100 }),
        ],
        true,
      ),
    ],
  });

/** One curve with a loop in it, closed by a line back to where it started. */
const knot = () =>
  glyph("a", {
    advance: 600,
    contours: [
      contour(
        ids.contour(),
        [
          node(ids.node(), { x: 0, y: 0 }, { out: { x: 150, y: 100 } }),
          node(ids.node(), { x: 100, y: 0 }, { in: { x: -50, y: 100 } }),
        ],
        true,
      ),
    ],
  });

describe("a contour that crosses itself", () => {
  it("finds the crossing", () => {
    // The same seam two overlapping shapes leave, made by one stroke laid back
    // across its own path.
    expect(removeOverlap(bowtie(), ids)?.crossings).toBe(1);
  });

  it("leaves an outline that no longer crosses itself", () => {
    // The test that matters: run it again and there is nothing left to find.
    const out = removeOverlap(bowtie(), ids)!;
    expect(removeOverlap(out.glyph, ids)?.crossings).toBe(0);
    expect(out.glyph.contours.every((c) => c.closed)).toBe(true);
  });

  it("covers the same ground it did before", () => {
    const out = removeOverlap(bowtie(), ids)!;
    expect(glyphBounds(out.glyph)).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
  });

  it("puts a node where the crossing was", () => {
    const out = removeOverlap(bowtie(), ids)!;
    const at = out.glyph.contours.flatMap((c) => c.nodes);
    expect(at.some((n) => Math.abs(n.pt.x - 50) < 0.1 && Math.abs(n.pt.y - 50) < 0.1)).toBe(true);
  });

  it("finds a loop inside a single curve, which no search for two curves can", () => {
    // A curve cannot be subdivided against itself — every box overlaps its own —
    // so this one crossing is found by algebra rather than by looking.
    const out = removeOverlap(knot(), ids)!;
    expect(out.crossings).toBeGreaterThan(0);
    expect(removeOverlap(out.glyph, ids)?.crossings).toBe(0);
  });

  it("keeps the curve curved through the loop", () => {
    const out = removeOverlap(knot(), ids)!;
    expect(out.glyph.contours.flatMap((c) => c.nodes).some((n) => n.out !== null)).toBe(true);
  });

  it("says there is nothing to do for a contour that behaves", () => {
    // Every corner of a shape meets the edge beside it, and a curve that turns
    // sharply looks like a loop to arithmetic that is not careful. Neither is a
    // crossing, and reporting either would rebuild a glyph that was already
    // right.
    const round = glyph("o", {
      contours: [ellipseContour(ids, { minX: 0, minY: 0, maxX: 300, maxY: 200 })],
    });
    expect(removeOverlap(round, ids)?.glyph).toBe(round);

    const box = glyph("a", {
      contours: [rectContour(ids, { minX: 0, minY: 0, maxX: 100, maxY: 100 })],
    });
    expect(removeOverlap(box, ids)?.glyph).toBe(box);
  });
});
