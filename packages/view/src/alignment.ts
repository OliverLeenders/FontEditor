import type { Vec2 } from "@typewright/geometry";
import type { Contour, Glyph, Node } from "@typewright/font-model";

import type { Selection, SelectionItem } from "./selection.js";
import type { SnapLine } from "./snap.js";

/**
 * Which points in a glyph a drag may align itself with.
 *
 * All of them, on both axes. This module used to offer a curated few — the
 * places the outline turns, and the dragged point's own neighbours — on the
 * argument that a couple of hundred coordinates per axis makes something always
 * within reach and the drag sticky. The stickiness was real; the cure was worse.
 * Which points would catch could not be told by looking, so the pull felt
 * arbitrary: a stem edge caught and the point beside it did not, for a reason
 * about local curvature that nobody can see.
 *
 * "The nearest point on this axis, if it is near enough" is a rule a person can
 * hold in their head and aim with. What keeps it from being sticky is the catch
 * radius — small, and measured in screen pixels, so it is a fixed distance for
 * the eye at every zoom — and the hysteresis in `catchLine`, which holds one
 * line until the drag is clearly done with it rather than flickering between
 * rivals.
 *
 * What the old rules are still good for is *ranking*. Two points at the same
 * coordinate make one line, and which of them it says it came from decides what
 * is drawn and what wins a tie: a neighbour first, then a turn in the outline,
 * then any point at all.
 */

export type AlignmentOptions = {
  /** Offer the glyph's own points, each on both axes. */
  readonly points?: boolean;
};

export type AlignmentLines = {
  readonly xs: readonly SnapLine[];
  readonly ys: readonly SnapLine[];
};

const NONE: AlignmentLines = { xs: [], ys: [] };

/**
 * How far off level a direction may be and still count as level.
 *
 * The sine of about five degrees. Needed because the sign test below is a
 * knife-edge on a smooth node: its two handles are collinear through it, so they
 * land on opposite sides of any axis unless the tangent is *exactly* level, and
 * a drawn outline is never exactly anything. The bottom of a real stem was found
 * one unit and 1.4 degrees off, which was enough to stop it being offered at all
 * while the counter beside it — level to the unit — was offered. Dragging one
 * onto the other worked in one direction and not the other.
 *
 * Five degrees is wide enough for that and far short of anything anyone would
 * call a slope: over a 40-unit handle it is three and a half units.
 */
const LEVEL = 0.09;

/** Whether a direction is close enough to level to be treated as level, per axis. */
function level(d: Vec2, axis: "x" | "y"): boolean {
  const length = Math.hypot(d.x, d.y);
  if (length === 0) return true;
  // A y-extreme wants a near-horizontal tangent, which is a small y component;
  // an x-extreme wants a near-vertical one, which is a small x component.
  return Math.abs(axis === "y" ? d.y : d.x) <= length * LEVEL;
}

/**
 * Whether a node is where the outline turns back on itself, per axis.
 *
 * A local test rather than the calculus: the outline reverses at a node exactly
 * when it leaves on the same side it arrived from. A handle gives that direction
 * where there is one, and where there is not — a straight segment — the on-curve
 * point at the far end of that segment gives it instead.
 *
 * That second half is the difference between this being useful and being noise.
 * Calling every node with a straight side a landmark, which is the obvious
 * reading of "it has no handle to judge by", turned 21 nodes of a real drawn `a`
 * into 14 candidates on one axis — several within a single catch radius of each
 * other, so no drag could aim between them. Judging the straight side by where
 * it goes gives 6.
 *
 * The other half is {@link LEVEL}: a turn that is nearly flat is a turn.
 */
function extremeAxes(
  n: Node,
  previous: Vec2,
  next: Vec2,
): { readonly x: boolean; readonly y: boolean } {
  const from = { x: (n.in ?? previous).x - n.pt.x, y: (n.in ?? previous).y - n.pt.y };
  const to = { x: (n.out ?? next).x - n.pt.x, y: (n.out ?? next).y - n.pt.y };

  return {
    x: from.x * to.x >= 0 || level(from, "x") || level(to, "x"),
    y: from.y * to.y >= 0 || level(from, "y") || level(to, "y"),
  };
}

/** The point one step around a contour, or `null` at the end of an open one. */
function around(c: Contour, index: number, step: -1 | 1): Vec2 | null {
  const next = index + step;
  if (next >= 0 && next < c.nodes.length) return c.nodes[next]!.pt;
  if (!c.closed) return null;
  return c.nodes[step === 1 ? 0 : c.nodes.length - 1]?.pt ?? null;
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
 *
 * An extreme is offered on the axis it turns about, and to a drag in *another*
 * contour on both of its axes. The leftmost point of an `o` is a landmark in x
 * by turning there; its height is a landmark too, but only to the counter, which
 * is drawn deliberately level with it — and without that, dragging the counter's
 * side to the height of the bowl's side catches nothing, because a point that
 * turns in x contributes no horizontal line at all. Within one contour the other
 * coordinate is left out: it means much less there, and offering it everywhere
 * doubles the candidates, which is exactly what this module exists to avoid.
 */
export function alignmentLines(
  g: Glyph,
  moving: Selection,
  options: AlignmentOptions = {},
): AlignmentLines {
  if (options.points !== true) return NONE;

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

  // Three passes, in the order a coordinate would rather be explained. The
  // first line at a coordinate keeps it — see `add` — so a point that is both a
  // neighbour and a turn is offered as the neighbour, and `catchLine` breaks a
  // tie between equal corrections by the order it was given.
  for (const item of moving) {
    for (const p of neighbourPoints(g, item, movingNodes)) add(p, "neighbour", BOTH);
  }

  for (const c of g.contours) {
    for (const [i, n] of c.nodes.entries()) {
      if (movingNodes.has(`${c.id} ${n.id}`)) continue;

      // An open contour's ends have nothing beyond them, and a node with a
      // straight side and no node past it has no direction to be judged by.
      // Treating it as a landmark is the right answer there: it really is where
      // the outline stops.
      const previous = around(c, i, -1) ?? n.pt;
      const next = around(c, i, 1) ?? n.pt;

      const axes = extremeAxes(n, previous, next);
      if (axes.x || axes.y) add(n.pt, "extreme", BOTH);
    }
  }

  for (const c of g.contours) {
    for (const n of c.nodes) {
      if (movingNodes.has(`${c.id} ${n.id}`)) continue;
      add(n.pt, "point", BOTH);
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
