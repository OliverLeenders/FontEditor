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
 * A stroke that goes in and stops between two contours.
 *
 * The pairing is along the stroke rather than within a contour, so a pair whose
 * two ends are on *different* contours joins them: into an `o` from outside,
 * stopping in the counter, and what comes back is one closed contour — round
 * the outside, along the stroke inwards, round the counter, back along the
 * stroke. A ring with a slit in it, simply connected the way a `c` is.
 */
describe("cutting a ring open", () => {
  const intoTheCounter = () => cutGlyph(ring(), at(-50, 300), at(300, 300), ids)!;

  it("meets the outer contour once and the counter once", () => {
    expect(intoTheCounter().crossings).toBe(2);
  });

  it("leaves one closed contour where there were two", () => {
    const cut = intoTheCounter();

    expect(cut.glyph.contours).toHaveLength(1);
    expect(cut.glyph.contours[0]?.closed).toBe(true);
    expect(cut.marked).toBe(0);
  });

  it("keeps the drawing exactly where it was", () => {
    // The slit has no width yet, so the ring still looks like a ring. Pulling
    // it open is drawing rather than cutting.
    const before = glyphBounds(ring())!;
    const after = glyphBounds(intoTheCounter().glyph)!;

    expect(after.minX).toBeCloseTo(before.minX, 6);
    expect(after.maxX).toBeCloseTo(before.maxX, 6);
    expect(after.minY).toBeCloseTo(before.minY, 6);
    expect(after.maxY).toBeCloseTo(before.maxY, 6);
  });

  it("walks the whole of both rings, not a corner of either", () => {
    // The arc from a crossing back to itself is the whole contour. Getting that
    // wrong gives a contour of four nodes that looks nothing like an `o`.
    const cut = intoTheCounter();
    const before = ring().contours.reduce((n, c) => n + c.nodes.length, 0);

    expect(cut.glyph.contours[0]!.nodes.length).toBeGreaterThanOrEqual(before);
  });

  it("has two points at each end of the slit", () => {
    // Two edges run along the stroke — in and out — so each crossing appears
    // twice, once for each side of the slit.
    const nodes = intoTheCounter().glyph.contours[0]!.nodes;

    // The outer ellipse is crossed at x = 0, the counter at x = 150.
    for (const x of [0, 150]) {
      const here = nodes.filter(
        (n) => Math.abs(n.pt.x - x) < 1e-6 && Math.abs(n.pt.y - 300) < 1e-6,
      );
      expect(here.length).toBe(2);
    }
  });

  it("cuts the ring in two when the stroke goes all the way through", () => {
    // Four crossings pair as outer-to-counter and counter-to-outer, which is
    // the ordinary cut and is unchanged.
    const cut = cutGlyph(ring(), at(-50, 300), at(650, 300), ids)!;

    expect(cut.crossings).toBe(4);
    expect(cut.glyph.contours).toHaveLength(2);
  });
});
