import { describe, expect, it } from "vitest";

import { contour, reverseContour } from "../src/contour.js";
import { addContour, glyph } from "../src/glyph.js";
import { counterIds } from "../src/ids.js";
import { measureAngle, measureNormal, sectionAcross } from "../src/measure.js";
import { node } from "../src/node.js";
import { ellipseContour, rectContour } from "../src/shapes.js";

const ids = counterIds("m");
const at = (x: number, y: number) => ({ x, y });
const vec = at;

/** An upright stem 80 wide and 700 tall, starting at x = 100. */
const stem = () =>
  glyph("l", {
    advance: 300,
    contours: [rectContour(ids, { minX: 100, minY: 0, maxX: 180, maxY: 700 })],
  });

/** A ring with a wall 100 units thick all the way round. */
const ring = () =>
  glyph("o", {
    advance: 600,
    contours: [
      ellipseContour(ids, { minX: 0, minY: 0, maxX: 600, maxY: 600 }),
      reverseContour(ellipseContour(ids, { minX: 100, minY: 100, maxX: 500, maxY: 500 })),
    ],
  });

describe("measuring a stem", () => {
  it("gives the stem's width from its left wall", () => {
    // The left wall of the rectangle is the segment from (100,700) to (100,0);
    // a cursor inside the stem measures across to the right wall.
    const g = stem();
    const left = g.contours[0]!.nodes.findIndex((n) => n.pt.x === 100 && n.pt.y === 700);
    const m = measureNormal(g, g.contours[0]!.id, left, at(140, 350))!;

    expect(m.distance).toBeCloseTo(80, 6);
    expect(m.from.x).toBeCloseTo(100, 6);
    expect(m.to.x).toBeCloseTo(180, 6);
  });

  it("measures square to the outline, whatever height the cursor is at", () => {
    const g = stem();
    const left = g.contours[0]!.nodes.findIndex((n) => n.pt.x === 100 && n.pt.y === 700);
    const low = measureNormal(g, g.contours[0]!.id, left, at(140, 60))!;
    const high = measureNormal(g, g.contours[0]!.id, left, at(140, 640))!;

    expect(low.distance).toBeCloseTo(80, 6);
    expect(high.distance).toBeCloseTo(80, 6);
    // Level, because the wall is upright.
    expect(low.from.y).toBeCloseTo(low.to.y, 6);
  });

  it("says nothing when the cursor is outside the shape", () => {
    // The normal points away from the ink, so there is nothing between the
    // cursor and the far side. Measurement happens where there is material.
    const g = stem();
    const left = g.contours[0]!.nodes.findIndex((n) => n.pt.x === 100 && n.pt.y === 700);
    expect(measureNormal(g, g.contours[0]!.id, left, at(40, 350))).toBeNull();
  });

  it("says nothing when the cursor sits on the outline", () => {
    // Neither side is the side it is on, and either answer would be arbitrary.
    const g = stem();
    const left = g.contours[0]!.nodes.findIndex((n) => n.pt.x === 100 && n.pt.y === 700);
    expect(measureNormal(g, g.contours[0]!.id, left, at(100, 350))).toBeNull();
  });

  it("reports the direction it measured in", () => {
    const g = stem();
    const left = g.contours[0]!.nodes.findIndex((n) => n.pt.x === 100 && n.pt.y === 700);
    const m = measureNormal(g, g.contours[0]!.id, left, at(140, 350))!;

    expect(m.normal.x).toBeCloseTo(1, 6);
    expect(m.normal.y).toBeCloseTo(0, 6);
    expect(Math.abs(measureAngle(m))).toBeCloseTo(0, 6);
  });
});

describe("measuring a curved wall", () => {
  it("gives the wall thickness, not a chord across the letter", () => {
    // The whole reason for measuring along the normal. A straight line across
    // this ring would report something between 100 and 600 depending on where it
    // was drawn; the wall is 100 thick everywhere.
    const g = ring();
    const outer = g.contours[0]!;
    const m = measureNormal(g, outer.id, 0, at(520, 300))!;
    expect(m.distance).toBeCloseTo(100, 3);
  });

  it("gives the same thickness on the other side of the ring", () => {
    const g = ring();
    const outer = g.contours[0]!;
    // Segment 1 runs over the top; a cursor just inside the top wall.
    const m = measureNormal(g, outer.id, 1, at(300, 520))!;
    expect(m.distance).toBeCloseTo(100, 3);
  });

  it("measures across the counter when asked from the inner wall", () => {
    // From the counter's edge towards its middle: the counter is 400 across.
    const g = ring();
    const inner = g.contours[1]!;
    const m = measureNormal(g, inner.id, 0, at(300, 300))!;
    expect(m.distance).toBeCloseTo(400, 3);
  });

  it("finds the nearest far edge rather than the last one", () => {
    // From the outer wall the ray meets the counter first and the far outer wall
    // after it. The wall is what was asked about.
    const g = ring();
    const m = measureNormal(g, g.contours[0]!.id, 0, at(520, 300))!;
    expect(m.distance).toBeLessThan(200);
  });
});

describe("what a measurement refuses", () => {
  it("says nothing about a segment that is not there", () => {
    expect(measureNormal(stem(), "nope", 0, at(140, 350))).toBeNull();
    expect(measureNormal(stem(), stem().contours[0]!.id, 99, at(140, 350))).toBeNull();
  });

  it("says nothing about an empty glyph", () => {
    const empty = glyph("space", { advance: 250 });
    expect(measureNormal(empty, "x", 0, at(0, 0))).toBeNull();
  });
});

describe("a section across the glyph", () => {
  /** Two upright bars 100 wide, 100 apart: stem, counter, stem. */
  function bars() {
    const ids = counterIds("sec");
    const bar = (left: number) =>
      contour(
        ids.contour(),
        [
          node(ids.node(), vec(left, 0)),
          node(ids.node(), vec(left + 100, 0)),
          node(ids.node(), vec(left + 100, 700)),
          node(ids.node(), vec(left, 700)),
        ],
        true,
      );
    return addContour(addContour(glyph("n", { advance: 400 }), bar(0)), bar(200));
  }

  it("reads the widths in the order the line meets them", () => {
    const out = sectionAcross(bars(), vec(-50, 350), vec(350, 350));

    expect(out.crossings.map((c) => c.x)).toEqual([0, 100, 200, 300]);
    expect(out.spans.map((s) => [s.distance, s.ink])).toEqual([
      [100, true],
      [100, false],
      [100, true],
    ]);
  });

  it("knows ink from counter wherever the line starts", () => {
    // Starting inside the first bar: the parity of the crossings is the other
    // way round, and asking the midpoint rather than counting gets it right.
    const out = sectionAcross(bars(), vec(50, 350), vec(350, 350));
    expect(out.spans.map((s) => [s.distance, s.ink])).toEqual([
      [100, false],
      [100, true],
    ]);
  });

  it("reads a diagonal cut as the distance along it", () => {
    const out = sectionAcross(bars(), vec(-50, 0), vec(350, 400));
    // Every crossing is on the line, and the first span is the diagonal through
    // the first bar rather than its horizontal width.
    expect(out.spans[0]!.distance).toBeCloseTo(Math.hypot(100, 100), 6);
  });

  it("has nothing to say about a line that misses the letter", () => {
    const out = sectionAcross(bars(), vec(-50, 900), vec(350, 900));
    expect(out.crossings).toEqual([]);
    expect(out.spans).toEqual([]);
  });
});
