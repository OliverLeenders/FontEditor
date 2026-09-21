import { contour, counterIds, glyph, node } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { alignmentLines } from "../src/alignment.js";
import type { Selection } from "../src/selection.js";
import { snapDelta } from "../src/snap.js";

const ids = counterIds();
const at = (x: number, y: number) => ({ x, y });

/**
 * A ring of four smooth nodes, each a genuine extreme: handles level either
 * side of the top and bottom, upright either side of the left and right.
 */
function ring() {
  return contour(
    ids.contour(),
    [
      node(ids.node(), at(300, 700), { type: "smooth", in: at(180, 700), out: at(420, 700) }),
      node(ids.node(), at(540, 350), { type: "smooth", in: at(540, 490), out: at(540, 210) }),
      node(ids.node(), at(300, 0), { type: "smooth", in: at(420, 0), out: at(180, 0) }),
      node(ids.node(), at(60, 350), { type: "smooth", in: at(60, 210), out: at(60, 490) }),
    ],
    true,
  );
}

/** A node midway along a curve, which passes through rather than turning. */
function throughContour() {
  return contour(
    ids.contour(),
    [
      node(ids.node(), at(0, 0), { type: "corner", out: at(50, 50) }),
      // Handles on opposite sides in both axes: the outline passes through.
      node(ids.node(), at(200, 200), { type: "smooth", in: at(150, 150), out: at(250, 250) }),
      node(ids.node(), at(400, 400), { type: "corner", in: at(350, 350) }),
    ],
    false,
  );
}

const values = (lines: readonly { at: number }[]): number[] =>
  lines.map((l) => l.at).sort((a, b) => a - b);

const sourceAt = (lines: readonly { at: number; source: string }[], value: number) =>
  lines.find((l) => l.at === value)?.source;

/**
 * Every point, on both of its axes.
 *
 * The rule used to be cleverer — the places the outline turns, and the dragged
 * point's own neighbours — and the cleverness could not be seen. Which points
 * would catch was a fact about local curvature, so a stem edge caught and the
 * point beside it did not, for no reason a person could read off the drawing.
 */
describe("what a drag can catch on", () => {
  const c = ring();
  const g = glyph("o", { advance: 600, contours: [c] });

  it("offers every point, on both of its axes", () => {
    const lines = alignmentLines(g, [], { points: true });

    expect(values(lines.xs)).toEqual([60, 300, 540]);
    expect(values(lines.ys)).toEqual([0, 350, 700]);
  });

  it("offers a node the outline runs straight through", () => {
    // It used to be passed over for having no turn in it. A point is a point.
    const through = glyph("s", { contours: [throughContour()] });
    const lines = alignmentLines(through, [], { points: true });

    expect(values(lines.xs)).toEqual([0, 200, 400]);
    expect(values(lines.ys)).toEqual([0, 200, 400]);
  });

  it("offers one line per coordinate, however many points share it", () => {
    const twin = contour(
      ids.contour(),
      [node(ids.node(), at(100, 0)), node(ids.node(), at(100, 500))],
      false,
    );
    expect(alignmentLines(glyph("t", { contours: [twin] }), [], { points: true }).xs).toHaveLength(
      1,
    );
  });

  it("offers every contour's points, the drag's own included", () => {
    const inner = counter();
    const o = glyph("o", { advance: 600, contours: [c, inner] });
    const lines = alignmentLines(o, [], { points: true });

    expect(values(lines.xs)).toEqual([60, 180, 300, 420, 540]);
    expect(values(lines.ys)).toEqual([0, 170, 350, 360, 530, 700]);
  });

  it("leaves out whatever is being dragged", () => {
    const moving: Selection = [{ contourId: c.id, nodeId: c.nodes[1]!.id, part: "point" }];
    expect(values(alignmentLines(g, moving, { points: true }).xs)).toEqual([60, 300]);
  });

  it("keeps the node under a dragged handle, which is what it is aimed at", () => {
    // The handle moves and its node stays, and lining the two up is how a
    // handle is made exactly upright or exactly level — so the node is offered,
    // where a dragged *point* is not.
    const moving: Selection = [{ contourId: c.id, nodeId: c.nodes[1]!.id, part: "out" }];
    expect(values(alignmentLines(g, moving, { points: true }).xs)).toEqual([60, 300, 540]);
  });

  it("says nothing at all unless asked", () => {
    expect(alignmentLines(g, [], {})).toEqual({ xs: [], ys: [] });
  });
});

/**
 * Which point a line says it came from.
 *
 * Two points at one coordinate make one line, and the account it gives of
 * itself is the most particular one available: it decides what a guide says and
 * breaks a tie between equal corrections.
 */
describe("what a line says it is", () => {
  const c = ring();
  const g = glyph("o", { advance: 600, contours: [c] });
  const moving: Selection = [{ contourId: c.id, nodeId: c.nodes[0]!.id, part: "point" }];

  it("names a dragged point's own neighbour as one", () => {
    const lines = alignmentLines(g, moving, { points: true });
    expect(sourceAt(lines.xs, 540)).toBe("neighbour");
    expect(sourceAt(lines.xs, 60)).toBe("neighbour");
  });

  it("names a turn in the outline an extreme", () => {
    const lines = alignmentLines(g, moving, { points: true });
    // The bottom node is nobody's neighbour here, and it is where the outline
    // turns in y.
    expect(sourceAt(lines.ys, 0)).toBe("extreme");
  });

  it("names anything else a point", () => {
    const flat = contour(
      ids.contour(),
      [node(ids.node(), at(0, 0)), node(ids.node(), at(50, 100)), node(ids.node(), at(100, 200))],
      false,
    );
    const lines = alignmentLines(glyph("z", { contours: [flat] }), [], { points: true });
    // Midway along a straight run: no turn, and nobody is dragging.
    expect(sourceAt(lines.xs, 50)).toBe("point");
  });

  it("gives a handle's drag the node it belongs to as a neighbour", () => {
    // Lining the two up is how a handle is made exactly upright or exactly level.
    const held: Selection = [{ contourId: c.id, nodeId: c.nodes[0]!.id, part: "out" }];
    const lines = alignmentLines(g, held, { points: true });

    expect(sourceAt(lines.xs, 300)).toBe("neighbour");
    expect(sourceAt(lines.ys, 700)).toBe("neighbour");
  });

  it("skips a neighbour that is moving too", () => {
    const pair: Selection = [
      { contourId: c.id, nodeId: c.nodes[0]!.id, part: "point" },
      { contourId: c.id, nodeId: c.nodes[1]!.id, part: "point" },
    ];
    const lines = alignmentLines(g, pair, { points: true });

    // Neither of the two moving nodes is offered at all, as a neighbour or
    // otherwise; what is left is the two standing still.
    expect(values(lines.xs)).toEqual([60, 300]);
    expect(sourceAt(lines.xs, 60)).toBe("neighbour");
  });
});

/**
 * A counter for the ring above: level top and bottom, upright sides — and its
 * sides ten units above the ring's, so a line from one is never a line from the
 * other by accident.
 */
function counter() {
  return contour(
    ids.contour(),
    [
      node(ids.node(), at(300, 530), { type: "smooth", in: at(240, 530), out: at(360, 530) }),
      node(ids.node(), at(420, 360), { type: "smooth", in: at(420, 430), out: at(420, 290) }),
      node(ids.node(), at(300, 170), { type: "smooth", in: at(360, 170), out: at(240, 170) }),
      node(ids.node(), at(180, 360), { type: "smooth", in: at(180, 290), out: at(180, 430) }),
    ],
    true,
  );
}

/**
 * The `o` this was reported on, coordinates and all, from a real drawing.
 *
 * The counter's left node sits one unit above the bowl's, and under the old
 * rule there was no horizontal line to catch on: the bowl's sides turn in x, so
 * the height they shared was offered by nothing.
 */
function reportedBowl() {
  return contour(
    ids.contour(),
    [
      node(ids.node(), at(472, 249), { type: "smooth", in: at(472, 89), out: at(472, 406) }),
      node(ids.node(), at(252, 511), { type: "smooth", in: at(388, 511), out: at(119, 511) }),
      node(ids.node(), at(31, 249), { type: "smooth", in: at(31, 402), out: at(31, 92) }),
      node(ids.node(), at(252, -12), { type: "smooth", in: at(114, -12), out: at(384, -12) }),
    ],
    true,
  );
}

function reportedCounter() {
  return contour(
    ids.contour(),
    [
      node(ids.node(), at(391, 248), { type: "smooth", in: at(391, 349), out: at(391, 147) }),
      node(ids.node(), at(254, 67), { type: "smooth", in: at(335, 67), out: at(174, 67) }),
      node(ids.node(), at(116, 250), { type: "smooth", in: at(116, 149), out: at(116, 351) }),
      node(ids.node(), at(252, 421), { type: "smooth", in: at(172, 421), out: at(333, 421) }),
    ],
    true,
  );
}

describe("a drag across a real counter", () => {
  it("lands the counter's side on the height of the bowl's", () => {
    const bowl = reportedBowl();
    const inner = reportedCounter();
    const o = glyph("o", { advance: 500, contours: [bowl, inner] });

    const moving: Selection = [{ contourId: inner.id, nodeId: inner.nodes[2]!.id, part: "point" }];
    const lines = alignmentLines(o, moving, { points: true });
    expect(values(lines.ys)).toContain(249);

    const landed = snapDelta([at(116, 250)], at(0, -0.6), {
      xs: lines.xs,
      ys: lines.ys,
      enter: 9,
      stay: 15,
      stickiness: 1.6,
      grid: 1,
    });
    expect(250 + landed.delta.y).toBe(249);
  });
});
