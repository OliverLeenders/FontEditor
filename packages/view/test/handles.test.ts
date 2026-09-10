import { contour, counterIds, node } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { ALL_HANDLES, type HandleVisibility, handleIsVisible } from "../src/hit.js";

const ids = counterIds();

/** Three nodes, closed: three segments, the last wrapping from node 2 to node 0. */
const c = contour(
  ids.contour(),
  [
    node("n0", { x: 0, y: 0 }, { in: { x: -20, y: 0 }, out: { x: 20, y: 0 } }),
    node("n1", { x: 100, y: 0 }, { in: { x: 80, y: 0 }, out: { x: 120, y: 0 } }),
    node("n2", { x: 50, y: 90 }, { in: { x: 70, y: 90 }, out: { x: 30, y: 90 } }),
  ],
  true,
);

const awake = (segmentIndex: number): HandleVisibility => ({
  autoHide: true,
  awake: [{ contourId: c.id, segmentIndex }],
  selection: [],
});

describe("handleIsVisible", () => {
  it("shows everything when auto-hide is off", () => {
    for (let i = 0; i < c.nodes.length; i++) {
      expect(handleIsVisible(c, i, "in", ALL_HANDLES)).toBe(true);
      expect(handleIsVisible(c, i, "out", ALL_HANDLES)).toBe(true);
    }
  });

  it("shows the two handles that shape the awake segment, and no others", () => {
    // Segment 0 runs node 0 to node 1, shaped by n0.out and n1.in.
    const v = awake(0);
    expect(handleIsVisible(c, 0, "out", v)).toBe(true);
    expect(handleIsVisible(c, 1, "in", v)).toBe(true);

    expect(handleIsVisible(c, 0, "in", v)).toBe(false);
    expect(handleIsVisible(c, 1, "out", v)).toBe(false);
    expect(handleIsVisible(c, 2, "in", v)).toBe(false);
    expect(handleIsVisible(c, 2, "out", v)).toBe(false);
  });

  it("wraps: the last segment of a closed contour shapes the first node's in", () => {
    const v = awake(2);
    expect(handleIsVisible(c, 2, "out", v)).toBe(true);
    expect(handleIsVisible(c, 0, "in", v)).toBe(true);
    expect(handleIsVisible(c, 0, "out", v)).toBe(false);
  });

  it("shows both handles of a selected point wherever the cursor is", () => {
    const v: HandleVisibility = {
      autoHide: true,
      awake: [],
      selection: [{ contourId: c.id, nodeId: "n2", part: "point" }],
    };
    expect(handleIsVisible(c, 2, "in", v)).toBe(true);
    expect(handleIsVisible(c, 2, "out", v)).toBe(true);
    expect(handleIsVisible(c, 1, "in", v)).toBe(false);
  });

  it("counts a selected handle as selecting its node", () => {
    const v: HandleVisibility = {
      autoHide: true,
      awake: [],
      selection: [{ contourId: c.id, nodeId: "n1", part: "out" }],
    };
    // Grabbing one handle must not hide the other, or a smooth node becomes
    // impossible to reason about mid-edit.
    expect(handleIsVisible(c, 1, "in", v)).toBe(true);
    expect(handleIsVisible(c, 1, "out", v)).toBe(true);
  });

  it("ignores an awake segment belonging to another contour", () => {
    const v: HandleVisibility = {
      autoHide: true,
      awake: [{ contourId: "somewhere-else", segmentIndex: 0 }],
      selection: [],
    };
    expect(handleIsVisible(c, 0, "out", v)).toBe(false);
  });

  it("does not wrap on an open contour", () => {
    const open = contour(ids.contour(), c.nodes, false);
    const v: HandleVisibility = {
      autoHide: true,
      awake: [{ contourId: open.id, segmentIndex: 1 }],
      selection: [],
    };
    // Two segments only; node 0's `in` belongs to no segment at all.
    expect(handleIsVisible(open, 0, "in", v)).toBe(false);
    expect(handleIsVisible(open, 1, "out", v)).toBe(true);
    expect(handleIsVisible(open, 2, "in", v)).toBe(true);
  });
});
