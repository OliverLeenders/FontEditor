import { describe, expect, it } from "vitest";

import { reverseContour, segmentCount } from "../src/contour.js";
import { glyph, glyphBounds } from "../src/glyph.js";
import { counterIds } from "../src/ids.js";
import { cutGlyph } from "../src/knife.js";
import { rectContour, ellipseContour } from "../src/shapes.js";

const ids = counterIds("k");
const at = (x: number, y: number) => ({ x, y });

/** A 400 x 400 square from (0,0) to (400,400). */
const square = () =>
  glyph("a", {
    advance: 500,
    contours: [rectContour(ids, { minX: 0, minY: 0, maxX: 400, maxY: 400 })],
  });

/** A ring: a big circle with a smaller one inside it, as an `o` is. */
const ring = () =>
  glyph("o", {
    advance: 600,
    contours: [
      ellipseContour(ids, { minX: 0, minY: 0, maxX: 600, maxY: 600 }),
      // Reversed, because a counter is a hole: an inner contour running the same
      // way as the outer one is a second filled disc, not a counter.
      reverseContour(ellipseContour(ids, { minX: 150, minY: 150, maxX: 450, maxY: 450 })),
    ],
  });

describe("cutting a single shape", () => {
  it("says nothing happened when the stroke misses", () => {
    expect(cutGlyph(square(), at(-100, 800), at(500, 800), ids)).toBeNull();
  });

  it("makes two closed contours from one", () => {
    const cut = cutGlyph(square(), at(-50, 200), at(450, 200), ids)!;

    expect(cut.crossings).toBe(2);
    expect(cut.glyph.contours).toHaveLength(2);
    expect(cut.glyph.contours.every((c) => c.closed)).toBe(true);
  });

  it("leaves the two halves covering exactly what the whole covered", () => {
    // A cut moves nothing. The pair of halves has to occupy the same box the
    // square did, or the knife has quietly reshaped the glyph.
    const cut = cutGlyph(square(), at(-50, 200), at(450, 200), ids)!;
    expect(glyphBounds(cut.glyph)).toEqual({ minX: 0, minY: 0, maxX: 400, maxY: 400 });
  });

  it("puts the cut where the stroke ran", () => {
    const cut = cutGlyph(square(), at(-50, 200), at(450, 200), ids)!;
    const top = cut.glyph.contours.find((c) => c.nodes.some((n) => n.pt.y === 400))!;
    const bottom = cut.glyph.contours.find((c) => c.nodes.some((n) => n.pt.y === 0))!;
    // Compared with a tolerance rather than exactly: a crossing is the root of a
    // cubic, so it lands on 200 to within arithmetic rather than on the nose.
    const eps = 1e-9;

    // One half sits above the line and one below, and both have a node on it.
    expect(top.nodes.every((n) => n.pt.y >= 200 - eps)).toBe(true);
    expect(bottom.nodes.every((n) => n.pt.y <= 200 + eps)).toBe(true);
    expect(top.nodes.filter((n) => Math.abs(n.pt.y - 200) < eps)).toHaveLength(2);
  });

  it("gives each half four corners for a straight cut across a square", () => {
    const cut = cutGlyph(square(), at(-50, 200), at(450, 200), ids)!;
    for (const c of cut.glyph.contours) expect(c.nodes).toHaveLength(4);
  });

  it("cuts on a diagonal too", () => {
    const cut = cutGlyph(square(), at(-50, -50), at(450, 450), ids)!;
    expect(cut.crossings).toBe(2);
    expect(cut.glyph.contours).toHaveLength(2);
  });

  it("marks the outline when the stroke stops inside it", () => {
    // In and not out. There is no pair of shapes to make from that, but there
    // is a place worth naming: the knife was used to put a point somewhere.
    const cut = cutGlyph(square(), at(-50, 200), at(200, 200), ids)!;

    expect(cut.crossings).toBe(1);
    expect(cut.marked).toBe(1);
    expect(cut.opened).toBe(0);
    expect(cut.glyph.contours).toHaveLength(1);
    expect(cut.glyph.contours[0]?.closed).toBe(true);
  });

  it("puts the point exactly where the stroke met the outline", () => {
    const cut = cutGlyph(square(), at(-50, 200), at(200, 200), ids)!;
    const on = cut.glyph.contours[0]!.nodes.filter(
      (n) => Math.abs(n.pt.x) < 1e-6 && Math.abs(n.pt.y - 200) < 1e-6,
    );
    expect(on).toHaveLength(1);
  });

  it("keeps the shape when it only marks it", () => {
    const before = glyphBounds(square())!;
    const after = glyphBounds(cutGlyph(square(), at(-50, 200), at(200, 200), ids)!.glyph)!;
    expect(after).toEqual(before);
  });
});

describe("cutting a shape with a counter", () => {
  it("meets the outline four times", () => {
    const cut = cutGlyph(ring(), at(-50, 300), at(650, 300), ids)!;
    expect(cut.crossings).toBe(4);
  });

  it("still makes exactly two shapes", () => {
    // The pairing along the stroke is what does this: outer-to-counter and
    // counter-to-outer, so each half gets an outer arc, a counter arc and two
    // chords. Nothing in the cut knows what a counter is.
    const cut = cutGlyph(ring(), at(-50, 300), at(650, 300), ids)!;
    expect(cut.glyph.contours).toHaveLength(2);
    expect(cut.glyph.contours.every((c) => c.closed)).toBe(true);
  });

  it("gives each half a piece of both contours", () => {
    const cut = cutGlyph(ring(), at(-50, 300), at(650, 300), ids)!;
    for (const c of cut.glyph.contours) {
      // Two chords and two arcs: more nodes than either original arc alone.
      expect(c.nodes.length).toBeGreaterThanOrEqual(4);
      const xs = c.nodes.map((n) => n.pt.x);
      // Reaches the outer circle and comes back in to the counter.
      expect(Math.min(...xs)).toBeLessThan(150);
    }
  });

  it("covers the same ground the ring did", () => {
    const cut = cutGlyph(ring(), at(-50, 300), at(650, 300), ids)!;
    const box = glyphBounds(cut.glyph)!;
    expect(box.minX).toBeCloseTo(0, 6);
    expect(box.maxX).toBeCloseTo(600, 6);
  });

  it("keeps the curves curved where it did not cut", () => {
    // A cut adds places to take the outline apart; it must not straighten what
    // it passed by.
    const cut = cutGlyph(ring(), at(-50, 300), at(650, 300), ids)!;
    const curved = cut.glyph.contours.flatMap((c) =>
      Array.from({ length: segmentCount(c) }, (_, i) => i).filter((i) => {
        const n = c.nodes[i]!;
        return n.out !== null;
      }),
    );
    expect(curved.length).toBeGreaterThan(0);
  });
});

describe("what a cut refuses", () => {
  it("divides an open contour rather than closing anything across it", () => {
    // A path has no inside, so there is no parity to satisfy and no chord to
    // draw: a path that is cut is simply shorter paths.
    const open = glyph("v", {
      advance: 400,
      contours: [
        { ...rectContour(ids, { minX: 0, minY: 0, maxX: 200, maxY: 200 }), closed: false },
      ],
    });

    const cut = cutGlyph(open, at(-50, 100), at(250, 100), ids)!;

    expect(cut.divided).toBe(1);
    expect(cut.glyph.contours).toHaveLength(2);
    for (const c of cut.glyph.contours) expect(c.closed).toBe(false);
  });

  it("ignores a stroke of no length", () => {
    expect(cutGlyph(square(), at(100, 100), at(100, 100), ids)).toBeNull();
  });

  it("leaves an empty glyph alone", () => {
    expect(cutGlyph(glyph("space", { advance: 250 }), at(0, 0), at(100, 100), ids)).toBeNull();
  });
});

/**
 * A stroke that goes through rather than stopping.
 *
 * The other half of the odd crossing. The outline has been broken, so the loop
 * is opened at the crossing and becomes a path that begins and ends there — the
 * drawing is unchanged, and what has gone is the join.
 */
describe("opening a loop", () => {
  it("opens the contour where the stroke went through", () => {
    // From outside the square, through it, and out the other side is two
    // crossings and an ordinary cut. From outside to a point beyond it on the
    // same side is one crossing, and the stroke ended in open air.
    const cut = cutGlyph(square(), at(100, -50), at(100, 500), ids)!;
    expect(cut.crossings).toBe(2);

    // Straight through: an ordinary cut, two shapes, both closed.
    expect(cut.opened).toBe(0);
    expect(cut.glyph.contours).toHaveLength(2);
  });

  it("opens both the outer contour and the counter of a ring", () => {
    // Into an `o` from outside to the middle: the outer contour once, the
    // counter once, and the stroke stops in the hole — which is not ink.
    const cut = cutGlyph(ring(), at(-50, 300), at(300, 300), ids)!;

    expect(cut.opened).toBe(2);
    expect(cut.marked).toBe(0);
    expect(cut.glyph.contours).toHaveLength(2);
    for (const c of cut.glyph.contours) expect(c.closed).toBe(false);
  });

  it("leaves the drawing where it was when it opens a loop", () => {
    const before = glyphBounds(ring())!;
    const after = glyphBounds(cutGlyph(ring(), at(-50, 300), at(300, 300), ids)!.glyph)!;

    expect(after.minX).toBeCloseTo(before.minX, 6);
    expect(after.maxX).toBeCloseTo(before.maxX, 6);
    expect(after.minY).toBeCloseTo(before.minY, 6);
    expect(after.maxY).toBeCloseTo(before.maxY, 6);
  });

  it("begins and ends the opened path at the same place", () => {
    const cut = cutGlyph(ring(), at(-50, 300), at(300, 300), ids)!;

    for (const c of cut.glyph.contours) {
      const first = c.nodes[0]!;
      const last = c.nodes[c.nodes.length - 1]!;
      expect(first.pt.x).toBeCloseTo(last.pt.x, 6);
      expect(first.pt.y).toBeCloseTo(last.pt.y, 6);
    }
  });

  it("has nothing before its first point or after its last", () => {
    // An open path starts where it starts: a handle arriving at the first node
    // would be describing a segment that is not there.
    const cut = cutGlyph(ring(), at(-50, 300), at(300, 300), ids)!;

    for (const c of cut.glyph.contours) {
      expect(c.nodes[0]?.in).toBeNull();
      expect(c.nodes[c.nodes.length - 1]?.out).toBeNull();
    }
  });
});
