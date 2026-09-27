import { curvature } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import {
  type Contour,
  contour,
  curvatureAround,
  enforceHarmony,
  harmoniseNode,
  holdCurvature,
  segmentAt,
  segmentCubic,
  setHandle,
  translateNodeBy,
} from "../src/contour.js";
import { counterIds } from "../src/ids.js";
import { node } from "../src/node.js";

const ids = counterIds("harm");

/**
 * A node that holds its own curvature.
 *
 * Harmonising has been here since phase 16 and it is a one-shot: it moves the node
 * to where the curvature either side agrees, and the next drag of a handle beside
 * it undoes what it did. What is asked here is that a node told to hold it holds it
 * — through a handle drag, through a neighbour moving, through anything that ends
 * in the pass every edit ends with — and that a node which cannot hold anything
 * says so instead of pretending.
 *
 * Every test builds its own contour and asks it about its own nodes. The ids are
 * counted, so two contours built the same way are two different sets of ids.
 */

/**
 * Two curves meeting at a node that is nowhere near harmonised.
 *
 * The node sits halfway between its handles, and the outer handles stand off that
 * line by forty units on one side and a hundred on the other — so the place the
 * curvatures agree is well to the left of where the node is. Both outer handles
 * have to stand off the line: one lying on it makes that curve straight at the
 * join, and there is then nothing to agree with.
 */
const join = (): Contour =>
  contour(
    ids.contour(),
    [
      node(ids.node(), { x: 0, y: 0 }, { out: { x: 40, y: 80 } }),
      node(ids.node(), { x: 150, y: 120 }, { in: { x: 100, y: 120 }, out: { x: 200, y: 120 } }),
      node(ids.node(), { x: 300, y: 0 }, { in: { x: 260, y: 20 } }),
    ],
    true,
  );

/** The same, with its middle node holding its curvature. */
const held = (): Contour => {
  const c = join();
  const out = holdCurvature(c, c.nodes[1]!.id, true);
  if (out === null) throw new Error("nothing held");
  return out;
};

/** How far apart the curvature is either side of the middle node. */
function disagreement(c: Contour): number {
  const around = curvatureAround(c, c.nodes[1]!.id);
  if (around === null) throw new Error("not between two curves");
  return Math.abs(around.before - around.after);
}

describe("asking a node to hold its curvature", () => {
  it("harmonises it the moment it is asked", () => {
    const before = join();
    expect(disagreement(before)).toBeGreaterThan(1e-6);

    const after = held();
    expect(after.nodes[1]!.harmonised).toBe(true);
    expect(disagreement(after)).toBeLessThan(1e-9);
  });

  it("makes the node smooth, because after the move it is", () => {
    expect(held().nodes[1]!.type).toBe("smooth");
  });

  it("keeps the handles the designer placed", () => {
    // Harmonising moves the point along the line between its own two handles, so
    // both curves keep the directions they were drawn with.
    const c = join();
    const after = holdCurvature(c, c.nodes[1]!.id, true)!;
    expect(after.nodes[1]!.in).toEqual(c.nodes[1]!.in);
    expect(after.nodes[1]!.out).toEqual(c.nodes[1]!.out);
  });

  it("leaves a real curvature either side, not a cusp", () => {
    const after = held();
    expect(curvature(segmentCubic(segmentAt(after, 0)!), 1)).not.toBeNull();
    expect(curvature(segmentCubic(segmentAt(after, 1)!), 0)).not.toBeNull();
  });
});

describe("holding it through an edit", () => {
  it("stays harmonised when a handle beside it moves", () => {
    const c = held();
    const dragged = setHandle(c, c.nodes[0]!.id, "out", { x: 20, y: 40 })!;
    expect(disagreement(dragged)).toBeLessThan(1e-9);
  });

  it("stays harmonised when a neighbour moves", () => {
    const c = held();
    const moved = translateNodeBy(c, c.nodes[2]!.id, { x: 40, y: -30 })!;
    expect(disagreement(moved)).toBeLessThan(1e-9);
  });

  it("does what a one-shot harmonise does not", () => {
    // The contrast this exists for, stated as a test: the same drag on a node that
    // was harmonised once leaves the join crooked again.
    const c = join();
    const once = harmoniseNode(c, c.nodes[1]!.id)!;
    expect(disagreement(once)).toBeLessThan(1e-9);

    const dragged = setHandle(once, once.nodes[0]!.id, "out", { x: 20, y: 40 })!;
    expect(disagreement(dragged)).toBeGreaterThan(1e-9);
  });

  it("needs only one pass, whatever order the nodes are in", () => {
    // Two held nodes side by side. Each one's answer depends on the handles around
    // it and not on where the other landed, so solving twice changes nothing.
    const c = join();
    const both = {
      ...c,
      nodes: c.nodes.map((n, i) => (i === 1 || i === 2 ? { ...n, harmonised: true } : n)),
    };
    const once = enforceHarmony(both);
    const twice = enforceHarmony(once);
    expect(twice.nodes.map((n) => n.pt)).toEqual(once.nodes.map((n) => n.pt));
  });

  it("leaves a node that is not held where it is put", () => {
    const c = join();
    const dragged = setHandle(c, c.nodes[0]!.id, "out", { x: 20, y: 40 })!;
    expect(dragged.nodes[1]!.pt).toEqual(c.nodes[1]!.pt);
  });
});

describe("what cannot hold anything, and what is already holding", () => {
  it("refuses a node with a straight side", () => {
    // Between a line and a curve: a line has no curvature to agree with, and moving
    // the point to pretend otherwise would bend it.
    const withLine = contour(
      ids.contour(),
      [
        node(ids.node(), { x: 0, y: 0 }),
        node(ids.node(), { x: 100, y: 0 }, { out: { x: 160, y: 0 } }),
        node(ids.node(), { x: 200, y: 100 }, { in: { x: 200, y: 40 } }),
      ],
      true,
    );
    expect(holdCurvature(withLine, withLine.nodes[1]!.id, true)).toBeNull();
  });

  it("says there is nothing to do for a node already holding it", () => {
    const c = held();
    expect(holdCurvature(c, c.nodes[1]!.id, true)).toBeNull();
  });

  it("stops holding without moving the node back", () => {
    const c = held();
    const where = c.nodes[1]!.pt;

    const loose = holdCurvature(c, c.nodes[1]!.id, false)!;
    expect(loose.nodes[1]!.harmonised).toBe(false);
    expect(loose.nodes[1]!.pt).toEqual(where);
  });

  it("lets go when it is let go, and a later drag leaves it where it is", () => {
    const c = held();
    const loose = holdCurvature(c, c.nodes[1]!.id, false)!;
    const dragged = setHandle(loose, loose.nodes[0]!.id, "out", { x: 20, y: 40 })!;
    expect(dragged.nodes[1]!.pt).toEqual(loose.nodes[1]!.pt);
  });
});
