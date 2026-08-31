import { contour, counterIds, glyph, node } from "@fonteditor/font-model";
import { describe, expect, it } from "vitest";

import { alignmentLines } from "../src/alignment.js";
import type { Selection } from "../src/selection.js";

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

const values = (lines: readonly { at: number }[]): number[] => lines.map((l) => l.at).sort((a, b) => a - b);

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
    expect(alignmentLines(glyph("t", { contours: [twin] }), [], { extremes: true }).xs).toHaveLength(1);
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
