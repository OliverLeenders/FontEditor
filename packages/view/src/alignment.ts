import type { Vec2 } from "@fonteditor/geometry";
import type { Contour, Glyph, Node } from "@fonteditor/font-model";

import type { Selection, SelectionItem } from "./selection.js";
import type { SnapLine } from "./snap.js";

/**
 * Which points in a glyph a drag may align itself with.
 *
 * Not all of them. Every point in a glyph is a couple of hundred coordinates per
 * axis on anything complex, and at that density something is always within reach:
 * the drag turns sticky, catches jitter between rivals, and the pull becomes
 * inexplicable. Tightening the radius does not fix that — it only makes the
 * stickiness harder to trigger deliberately.
 *
 * So the answer is fewer and better candidates rather than a smaller radius, and
 * that is what this module is for.
 */

export type AlignmentOptions = {
  /**
   * The points where the outline turns.
   *
   * Stem edges, overshoot tops, the point across a counter — the structurally
   * meaningful ones, and few: a handful per glyph rather than every node.
   */
  readonly extremes?: boolean;
  /**
   * The nodes either side of what is being dragged, along its own contour.
   *
   * A different intent from an extreme, and worth having separately: aligning a
   * point with its own neighbour is how a segment is made exactly vertical or
   * exactly horizontal, and the neighbour is often nothing like an extreme.
   */
  readonly neighbours?: boolean;
};

export type AlignmentLines = {
  readonly xs: readonly SnapLine[];
  readonly ys: readonly SnapLine[];
};

const NONE: AlignmentLines = { xs: [], ys: [] };

/**
 * Whether a node is where the outline turns back on itself, per axis.
 *
 * A local test on the handles rather than the calculus: the outline reverses at
 * a node exactly when both handles leave it on the same side. A node missing a
 * handle is a corner, and a corner is a landmark on both axes — a polygon has no
 * curve extremes and its corners are the only things worth aligning to.
 */
function extremeAxes(n: Node): { readonly x: boolean; readonly y: boolean } {
  if (n.in === null || n.out === null) return { x: true, y: true };

  const inX = n.in.x - n.pt.x;
  const outX = n.out.x - n.pt.x;
  const inY = n.in.y - n.pt.y;
  const outY = n.out.y - n.pt.y;

  return {
    // Same side, or one of them exactly on the axis. A node whose handles are
    // both flat in x is a horizontal extreme of the outline in y, not x, which
    // the other half of this answers.
    x: inX * outX >= 0,
    y: inY * outY >= 0,
  };
}

/** The nodes before and after one in its contour, respecting whether it closes. */
function neighboursOf(c: Contour, nodeId: string): Node[] {
  const index = c.nodes.findIndex((n) => n.id === nodeId);
  if (index < 0) return [];

  const found: Node[] = [];
  const last = c.nodes.length - 1;

  const previous = index > 0 ? c.nodes[index - 1] : c.closed ? c.nodes[last] : undefined;
  const next = index < last ? c.nodes[index + 1] : c.closed ? c.nodes[0] : undefined;

  // An open contour's ends have one neighbour, and a two-node closed contour
  // has the same node on both sides — worth adding once, not twice.
  if (previous !== undefined) found.push(previous);
  if (next !== undefined && next !== previous) found.push(next);
  return found;
}

/**
 * The lines a drag of `moving` may align itself with, in the glyph as it was
 * when the drag began.
 *
 * Anything that is moving is excluded, along with the handles of any moving
 * node: they travel with it, so aligning to one would be aligning to something
 * that is not staying still. That is also why this asks for the glyph at the
 * start of the gesture — candidates computed from the live glyph would be
 * dragged around by the very drag trying to catch them.
 */
export function alignmentLines(
  g: Glyph,
  moving: Selection,
  options: AlignmentOptions = {},
): AlignmentLines {
  if (options.extremes !== true && options.neighbours !== true) return NONE;

  // Keyed by node rather than by selected part: a node's handles travel with it,
  // so neither the node nor either handle is standing still to be caught.
  const movingNodes = new Set(moving.map((item) => `${item.contourId} ${item.nodeId}`));

  const xs: SnapLine[] = [];
  const ys: SnapLine[] = [];
  const seenX = new Set<number>();
  const seenY = new Set<number>();

  const add = (p: Vec2, source: SnapLine["source"], axes: { x: boolean; y: boolean }): void => {
    if (axes.x && !seenX.has(p.x)) {
      seenX.add(p.x);
      xs.push({ at: p.x, source, from: p });
    }
    if (axes.y && !seenY.has(p.y)) {
      seenY.add(p.y);
      ys.push({ at: p.y, source, from: p });
    }
  };

  // Neighbours first, so a coordinate that is both wins the more specific
  // account of itself: `catchLine` breaks a tie by the order it was given.
  if (options.neighbours === true) {
    for (const item of moving) {
      for (const p of neighbourPoints(g, item, movingNodes)) {
        add(p, "neighbour", BOTH);
      }
    }
  }

  if (options.extremes === true) {
    for (const c of g.contours) {
      for (const n of c.nodes) {
        if (movingNodes.has(`${c.id} ${n.id}`)) continue;
        const axes = extremeAxes(n);
        if (axes.x || axes.y) add(n.pt, "extreme", axes);
      }
    }
  }

  return { xs, ys };
}

const BOTH = { x: true, y: true };

/**
 * What counts as a neighbour of one dragged item.
 *
 * For a node, the nodes either side of it. For a handle, the node it belongs to
 * — which is standing still while the handle moves, and lining the two up is how
 * a handle is made exactly vertical or horizontal.
 */
function neighbourPoints(g: Glyph, item: SelectionItem, movingNodes: Set<string>): Vec2[] {
  const c = g.contours.find((each) => each.id === item.contourId);
  if (c === undefined) return [];

  if (item.part !== "point") {
    const own = c.nodes.find((n) => n.id === item.nodeId);
    return own === undefined ? [] : [own.pt];
  }

  return neighboursOf(c, item.nodeId)
    .filter((n) => !movingNodes.has(`${c.id} ${n.id}`))
    .map((n) => n.pt);
}
