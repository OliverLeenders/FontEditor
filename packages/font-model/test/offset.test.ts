import { describe, expect, it } from "vitest";

import { contourBounds, segmentCount } from "../src/contour.js";
import { contourWinding } from "../src/direction.js";
import { counterIds } from "../src/ids.js";
import { offsetContour } from "../src/offset.js";
import { ellipseContour, rectContour } from "../src/shapes.js";

const ids = counterIds("off");

/**
 * Offsetting a contour.
 *
 * The curve arithmetic is tested in the geometry package against shapes whose
 * offsets are known exactly. What is asked here is the policy: that positive means
 * outwards whichever way the contour runs, that a corner is filled the way it was
 * asked to be, and that the cases with no sensible answer say so instead of
 * guessing.
 */

const square = (size: number) => rectContour(ids, { minX: 0, minY: 0, maxX: size, maxY: size });

/** The same square, drawn the other way round. */
const reversed = (size: number) => {
  const c = square(size);
  return { ...c, nodes: [...c.nodes].reverse() };
};

describe("which way is out", () => {
  it("grows the shape for a positive distance", () => {
    const out = offsetContour(square(100), ids, { x: 10, y: 10 })!;
    expect(contourBounds(out)).toEqual({ minX: -10, minY: -10, maxX: 110, maxY: 110 });
  });

  it("grows it by the same amount whichever way it was drawn", () => {
    // Which direction the points run in is an accident of how they were placed,
    // and a designer asking for ten more units is not thinking about it.
    const one = offsetContour(square(100), ids, { x: 10, y: 10 })!;
    const other = offsetContour(reversed(100), ids, { x: 10, y: 10 })!;
    expect(contourBounds(one)).toEqual(contourBounds(other));
  });

  it("shrinks it for a negative distance", () => {
    const out = offsetContour(square(100), ids, { x: -10, y: -10 })!;
    expect(contourBounds(out)).toEqual({ minX: 10, minY: 10, maxX: 90, maxY: 90 });
  });

  it("keeps the direction the contour was drawn in", () => {
    // The offset of a shape is the same shape, so it fills the same way. A result
    // that came back reversed would turn a letter into a hole.
    const drawn = square(100);
    const out = offsetContour(drawn, ids, { x: 10, y: 10 })!;
    expect(Math.sign(contourWinding(out))).toBe(Math.sign(contourWinding(drawn)));
  });

  it("takes a different distance on each axis", () => {
    // What a type designer actually wants: more weight on the stems than on the
    // thins. An ellipse rather than a circle, which is a squashed circle.
    const out = offsetContour(square(100), ids, { x: 20, y: 5 })!;
    const box = contourBounds(out)!;
    expect(box.minX).toBeCloseTo(-20, 1);
    expect(box.maxX).toBeCloseTo(120, 1);
    expect(box.minY).toBeCloseTo(-5, 1);
    expect(box.maxY).toBeCloseTo(105, 1);
  });
});

describe("the corners", () => {
  it("rounds them by default", () => {
    // A square offset outwards with round joins is a rounded square: every corner
    // becomes a quarter circle, so four corners become four arcs of one curve
    // each, between four straight sides.
    const out = offsetContour(square(100), ids, { x: 10, y: 10 })!;
    expect(segmentCount(out)).toBe(8);
    // The corner of the original is a tenth of the offset away from the outline
    // now, not on it.
    const corners = out.nodes.filter(
      (n) => Math.abs(n.pt.x + 10) < 0.01 && Math.abs(n.pt.y + 10) < 0.01,
    );
    expect(corners).toHaveLength(0);
  });

  it("spikes them when asked for a mitre", () => {
    const out = offsetContour(square(100), ids, { x: 10, y: 10, join: "miter" })!;
    // The mitre of a right angle puts the corner back where a corner belongs.
    const at = out.nodes.some((n) => Math.abs(n.pt.x + 10) < 0.01 && Math.abs(n.pt.y + 10) < 0.01);
    expect(at).toBe(true);
    expect(contourBounds(out)).toEqual({ minX: -10, minY: -10, maxX: 110, maxY: 110 });
  });

  it("cuts them off when asked for a bevel", () => {
    const out = offsetContour(square(100), ids, { x: 10, y: 10, join: "bevel" })!;
    expect(segmentCount(out)).toBe(8);
    // No arc: every piece is a straight line, so nothing has a handle.
    expect(out.nodes.every((n) => n.in === null && n.out === null)).toBe(true);
  });

  it("gives up a mitre that would run away to a spike", () => {
    // A thin wedge: the mitre on its point is many times the offset distance, and
    // a spike four times the weight asked for is not a corner anybody drew.
    const wedge = rectContour(ids, { minX: 0, minY: 0, maxX: 400, maxY: 400 });
    const sharp = {
      ...wedge,
      nodes: [wedge.nodes[0]!, { ...wedge.nodes[1]!, pt: { x: 400, y: 8 } }, wedge.nodes[3]!],
    };
    const out = offsetContour(sharp, ids, { x: 10, y: 10, join: "miter" })!;
    const box = contourBounds(out)!;
    expect(box.maxX).toBeLessThan(400 + 10 * 4);
  });

  it("leaves a smooth join alone", () => {
    // A circle has no corners, so nothing is inserted anywhere: what comes out is
    // the curve pieces and nothing else.
    const out = offsetContour(
      ellipseContour(ids, { minX: 0, minY: 0, maxX: 200, maxY: 200 }),
      ids,
      {
        x: 20,
        y: 20,
      },
    )!;
    expect(out.nodes.every((n) => n.in !== null || n.out !== null)).toBe(true);
  });
});

describe("a curve offset", () => {
  it("keeps a circle a circle, at the new radius", () => {
    const circle = ellipseContour(ids, { minX: 0, minY: 0, maxX: 200, maxY: 200 });
    const out = offsetContour(circle, ids, { x: 20, y: 20 })!;
    const box = contourBounds(out)!;

    expect(box.minX).toBeCloseTo(-20, 0);
    expect(box.maxX).toBeCloseTo(220, 0);
    expect(box.minY).toBeCloseTo(-20, 0);
    expect(box.maxY).toBeCloseTo(220, 0);
  });

  it("keeps its handles, so it is still editable", () => {
    const circle = ellipseContour(ids, { minX: 0, minY: 0, maxX: 200, maxY: 200 });
    const out = offsetContour(circle, ids, { x: 20, y: 20 })!;
    expect(out.nodes.some((n) => n.out !== null)).toBe(true);
  });
});

describe("what it will not do", () => {
  const cases: [string, Parameters<typeof offsetContour>[2]][] = [
    ["no distance at all", { x: 0, y: 0 }],
    ["one axis out and the other in", { x: 10, y: -10 }],
    ["a pen with no width one way", { x: 0, y: 10 }],
  ];

  for (const [what, options] of cases) {
    it(`says nothing for ${what}`, () => {
      expect(offsetContour(square(100), ids, options)).toBeNull();
    });
  }

  it("says nothing for an open contour", () => {
    const open = { ...square(100), closed: false };
    expect(offsetContour(open, ids, { x: 10, y: 10 })).toBeNull();
  });

  it("says nothing for a contour with no area", () => {
    const flat = {
      ...square(100),
      nodes: square(100).nodes.map((n) => ({ ...n, pt: { x: n.pt.x, y: 0 } })),
    };
    expect(offsetContour(flat, ids, { x: 10, y: 10 })).toBeNull();
  });
});
