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

describe("extremes", () => {
  const c = ring();
  const g = glyph("o", { advance: 600, contours: [c] });

  it("offers each turning point on the axis it turns about", () => {
    const lines = alignmentLines(g, [], { extremes: true });
    // Top and bottom turn in y; left and right turn in x.
    expect(values(lines.ys)).toEqual([0, 700]);
    expect(values(lines.xs)).toEqual([60, 540]);
  });

  it("passes over a node the outline runs straight through", () => {
    const through = glyph("s", { contours: [throughContour()] });
    const lines = alignmentLines(through, [], { extremes: true });
    // The two ends are corners and count; the middle node does not.
    expect(values(lines.xs)).toEqual([0, 400]);
    expect(values(lines.ys)).toEqual([0, 400]);
  });

  it("counts a corner as a landmark on both axes", () => {
    const square = contour(
      ids.contour(),
      [node(ids.node(), at(10, 20)), node(ids.node(), at(90, 20)), node(ids.node(), at(90, 80))],
      true,
    );
    const lines = alignmentLines(glyph("box", { contours: [square] }), [], { extremes: true });
    // A polygon has no curve extremes, and its corners are all there is to
    // align to — offering nothing would make the option useless on one.
    expect(values(lines.xs)).toEqual([10, 90]);
    expect(values(lines.ys)).toEqual([20, 80]);
  });

  it("passes over a node partway along a straight run", () => {
    // The rule that matters most in practice. A real drawn letter is mostly
    // straight segments, and calling every node on one a landmark buries the
    // few that are in a crowd no drag can aim between.
    const run = contour(
      ids.contour(),
      [
        node(ids.node(), at(0, 0)),
        node(ids.node(), at(50, 100)),
        node(ids.node(), at(100, 200)),
        node(ids.node(), at(0, 200)),
      ],
      true,
    );
    const lines = alignmentLines(glyph("z", { contours: [run] }), [], { extremes: true });
    // The middle of the diagonal is not offered on either axis; the corners are.
    expect(values(lines.xs)).toEqual([0, 100]);
    expect(values(lines.ys)).toEqual([0, 200]);
  });

  it("keeps a node level with its neighbour as a landmark on that axis", () => {
    const flat = contour(
      ids.contour(),
      [node(ids.node(), at(0, 0)), node(ids.node(), at(50, 0)), node(ids.node(), at(100, 90))],
      false,
    );
    const lines = alignmentLines(glyph("f", { contours: [flat] }), [], { extremes: true });
    // The middle node runs straight through in x and is not offered there, but
    // it sits on a level run and its y is worth aligning to.
    expect(values(lines.xs)).toEqual([0, 100]);
    expect(values(lines.ys)).toContain(0);
  });

  it("treats the end of an open contour as a landmark", () => {
    // Nothing lies beyond it, so there is no direction to judge it by — and it
    // really is where the outline stops.
    const open = contour(
      ids.contour(),
      [node(ids.node(), at(10, 10)), node(ids.node(), at(60, 60)), node(ids.node(), at(110, 110))],
      false,
    );
    const lines = alignmentLines(glyph("j", { contours: [open] }), [], { extremes: true });
    expect(values(lines.xs)).toEqual([10, 110]);
  });

  it("offers a turn that is very nearly, but not exactly, level", () => {
    // Taken from a real drawn `a`. Its counter's lowest node had handles exactly
    // level and was offered; the stem's lowest node, one unit and 1.4 degrees
    // off, was not — so a drag snapped the stem onto the counter but never the
    // counter onto the stem. On a smooth node the sign test alone is a
    // knife-edge: the two handles are collinear through it, so they straddle the
    // axis unless the tangent is exactly level, and a drawn outline never is.
    const bottoms = contour(
      ids.contour(),
      [
        node(ids.node(), at(175, -13), { type: "smooth", in: at(241, -13), out: at(86, -13) }),
        node(ids.node(), at(390, -12), { type: "smooth", in: at(430, -13), out: at(349, -11) }),
        node(ids.node(), at(300, 500), { type: "smooth", in: at(240, 500), out: at(360, 500) }),
      ],
      true,
    );
    const lines = alignmentLines(glyph("a", { contours: [bottoms] }), [], { extremes: true });
    expect(values(lines.ys)).toContain(-13);
    expect(values(lines.ys)).toContain(-12);
  });

  it("still refuses a turn that is genuinely a slope", () => {
    // The tolerance is five degrees, not a licence for anything vaguely flat.
    const sloped = contour(
      ids.contour(),
      [
        node(ids.node(), at(0, 0), { type: "smooth", in: at(-50, -30), out: at(50, 30) }),
        node(ids.node(), at(200, 400)),
      ],
      true,
    );
    const lines = alignmentLines(glyph("k", { contours: [sloped] }), [], { extremes: true });
    // Thirty degrees off level, so the first node is no landmark in y.
    expect(values(lines.ys)).not.toContain(0);
  });

  it("leaves out whatever is being dragged", () => {
    const moving: Selection = [{ contourId: c.id, nodeId: c.nodes[1]!.id, part: "point" }];
    expect(values(alignmentLines(g, moving, { extremes: true }).xs)).toEqual([60]);
  });

  it("leaves out a node whose handle is being dragged", () => {
    // The handle moves and the node stays, but the node is what the handle is
    // measured from, so catching on it would be catching on the drag itself.
    const moving: Selection = [{ contourId: c.id, nodeId: c.nodes[1]!.id, part: "out" }];
    expect(values(alignmentLines(g, moving, { extremes: true }).xs)).toEqual([60]);
  });

  it("says nothing at all unless asked", () => {
    expect(alignmentLines(g, [], {})).toEqual({ xs: [], ys: [] });
  });

  it("offers one line per coordinate, however many points share it", () => {
    const twin = contour(
      ids.contour(),
      [node(ids.node(), at(100, 0)), node(ids.node(), at(100, 500))],
      false,
    );
    expect(
      alignmentLines(glyph("t", { contours: [twin] }), [], { extremes: true }).xs,
    ).toHaveLength(1);
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

describe("extremes across contours", () => {
  const outer = ring();
  const inner = counter();
  const o = glyph("o", { advance: 600, contours: [outer, inner] });

  const dragging = (c: { id: string; nodes: readonly { id: string }[] }, i: number): Selection => [
    { contourId: c.id, nodeId: c.nodes[i]!.id, part: "point" },
  ];

  it("offers another contour's turns on both of their axes", () => {
    // Dragging the counter's top. The bowl's sides turn in x, and their height
    // is what the counter's sides are drawn level with — so it has to be
    // offered, or a counter can never be aligned to the shape holding it.
    const lines = alignmentLines(o, dragging(inner, 0), { extremes: true });
    expect(values(lines.ys)).toContain(350);
    expect(values(lines.xs)).toContain(300);
  });

  it("keeps a contour's own turns to the axis they turn about", () => {
    // The counter's own sides are in the drag's contour, so their height stays
    // out: within one shape the other coordinate means much less, and offering
    // it everywhere doubles the candidates.
    const lines = alignmentLines(o, dragging(inner, 0), { extremes: true });
    expect(values(lines.ys)).not.toContain(360);

    // And the other way round, which is the same rule seen from the bowl.
    const other = alignmentLines(o, dragging(outer, 0), { extremes: true });
    expect(values(other.ys)).toContain(360);
    expect(values(other.ys)).not.toContain(350);
  });

  it("offers nothing across contours when nothing is being dragged", () => {
    // No drag, so there is nobody for the other coordinate to be a landmark to.
    const lines = alignmentLines(o, [], { extremes: true });
    expect(values(lines.ys)).toEqual([0, 170, 530, 700]);
    expect(values(lines.xs)).toEqual([60, 180, 420, 540]);
  });
});

describe("neighbours", () => {
  const c = ring();
  const g = glyph("o", { advance: 600, contours: [c] });

  it("offers the nodes either side along the contour", () => {
    const moving: Selection = [{ contourId: c.id, nodeId: c.nodes[0]!.id, part: "point" }];
    const lines = alignmentLines(g, moving, { neighbours: true });

    // Either side of the top node: the right node and the left one.
    expect(values(lines.xs)).toEqual([60, 540]);
    expect(values(lines.ys)).toEqual([350]);
  });

  it("wraps around a closed contour", () => {
    // The first node's previous neighbour is the last, which only a closed
    // contour has.
    const moving: Selection = [{ contourId: c.id, nodeId: c.nodes[0]!.id, part: "point" }];
    const lines = alignmentLines(g, moving, { neighbours: true });
    expect(values(lines.xs)).toContain(60);
  });

  it("gives an open contour's end only the neighbour it has", () => {
    const open = throughContour();
    const moving: Selection = [{ contourId: open.id, nodeId: open.nodes[0]!.id, part: "point" }];
    const lines = alignmentLines(glyph("s", { contours: [open] }), moving, { neighbours: true });
    expect(values(lines.xs)).toEqual([200]);
  });

  it("offers a dragged handle the node it belongs to", () => {
    // Lining the two up is how a handle is made exactly upright or exactly level.
    const moving: Selection = [{ contourId: c.id, nodeId: c.nodes[0]!.id, part: "out" }];
    const lines = alignmentLines(g, moving, { neighbours: true });
    expect(values(lines.xs)).toEqual([300]);
    expect(values(lines.ys)).toEqual([700]);
  });

  it("skips a neighbour that is moving too", () => {
    const moving: Selection = [
      { contourId: c.id, nodeId: c.nodes[0]!.id, part: "point" },
      { contourId: c.id, nodeId: c.nodes[1]!.id, part: "point" },
    ];
    const lines = alignmentLines(g, moving, { neighbours: true });
    // Each moving node contributes the neighbours it has that are standing
    // still, and neither contributes the other: the left node beside the top
    // one, and the bottom node beside the right one.
    expect(values(lines.xs)).toEqual([60, 300]);
  });

  it("says nothing at all unless asked", () => {
    const moving: Selection = [{ contourId: c.id, nodeId: c.nodes[0]!.id, part: "point" }];
    expect(alignmentLines(g, moving, {})).toEqual({ xs: [], ys: [] });
  });
});

describe("both together", () => {
  const c = ring();
  const g = glyph("o", { advance: 600, contours: [c] });
  const moving: Selection = [{ contourId: c.id, nodeId: c.nodes[0]!.id, part: "point" }];

  it("names a shared coordinate as the neighbour, not the extreme", () => {
    // The right node is both, and "neighbour" is the more specific account of
    // why it is being offered — which is what a guide would say.
    const lines = alignmentLines(g, moving, { extremes: true, neighbours: true });
    expect(lines.xs.find((l) => l.at === 540)?.source).toBe("neighbour");
  });

  it("keeps an extreme that is nobody's neighbour", () => {
    const lines = alignmentLines(g, moving, { extremes: true, neighbours: true });
    // The bottom node is not adjacent to the top one, and is still an extreme.
    expect(values(lines.ys)).toEqual([0, 350]);
  });
});

/**
 * The `o` this rule was written for, coordinates and all, from a real drawing.
 *
 * Kept as it was reported: the counter's left node one unit above the bowl's,
 * with no horizontal line to catch on because the bowl's side turns in x.
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
    const counter = reportedCounter();
    const o = glyph("o", { advance: 500, contours: [bowl, counter] });

    const moving: Selection = [
      { contourId: counter.id, nodeId: counter.nodes[2]!.id, part: "point" },
    ];
    const lines = alignmentLines(o, moving, { extremes: true, neighbours: true });
    // Before the cross-axis rule these were [-12, 67, 421, 511]: the two sides
    // of the bowl turn in x, so the height they share was offered by nothing.
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
