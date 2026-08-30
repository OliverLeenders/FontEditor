import { type Vec2, add, addScaled, distance, length, sub } from "@fonteditor/geometry";

import type { NodeId } from "./ids.js";

/**
 * How a node treats its two handles.
 *
 * - `corner`  — the handles are independent. Moving one leaves the other alone.
 * - `smooth`  — the handles stay collinear through the node, each keeping its
 *               own length. This is what makes a curve continue without a kink.
 * - `tangent` — one side is a straight segment; the handle on the curved side
 *               must stay aligned with it. Enforced when the neighbouring
 *               segments are known, which is contour-level knowledge.
 */
export type NodeType = "corner" | "smooth" | "tangent";

/**
 * An on-curve point together with the two handles it owns.
 *
 * This is the change that matters most against the Tunni-Lines prototype, which
 * stored a contour as a list of segments, each holding its own copy of the four
 * points. There, `segments[i].end` and `segments[i+1].start` had to be kept as
 * the same object by convention, and cloning quietly broke that. Here there is
 * one node per on-curve point, so the question cannot arise.
 *
 * `in` is the handle governing the segment arriving at this node; `out` governs
 * the segment leaving it. Both are absolute positions in design units, not
 * offsets — an offset representation reads more nicely but obliges every
 * operation that moves the anchor to remember to carry its handles.
 *
 * `null` means genuinely no handle. A segment whose two facing handles are both
 * null is a straight line, and stays one through a save and load — matching
 * what UFO's glif format and TrueType both record.
 */
export type Node = {
  readonly id: NodeId;
  readonly pt: Vec2;
  readonly type: NodeType;
  readonly in: Vec2 | null;
  readonly out: Vec2 | null;
  /** Constrain this node's handles to the horizontal or vertical axis. */
  readonly hvLock: boolean;
};

export type NodeInit = {
  readonly type?: NodeType;
  readonly in?: Vec2 | null;
  readonly out?: Vec2 | null;
  readonly hvLock?: boolean;
};

export function node(id: NodeId, pt: Vec2, init: NodeInit = {}): Node {
  return {
    id,
    pt,
    type: init.type ?? "corner",
    in: init.in ?? null,
    out: init.out ?? null,
    hvLock: init.hvLock ?? false,
  };
}

export function handleOf(n: Node, which: "in" | "out"): Vec2 | null {
  return which === "in" ? n.in : n.out;
}

export function withHandleRaw(n: Node, which: "in" | "out", pt: Vec2 | null): Node {
  return which === "in" ? { ...n, in: pt } : { ...n, out: pt };
}

/** Move the node and both of its handles by the same offset. */
export function translateNode(n: Node, delta: Vec2): Node {
  return {
    ...n,
    pt: add(n.pt, delta),
    in: n.in === null ? null : add(n.in, delta),
    out: n.out === null ? null : add(n.out, delta),
  };
}

/** Move the node to an absolute position, carrying its handles with it. */
export function moveNodeTo(n: Node, pt: Vec2): Node {
  return translateNode(n, sub(pt, n.pt));
}

/**
 * Restore the smooth constraint after `moved` has been repositioned: swing the
 * opposite handle to point directly away, keeping the length it already had.
 *
 * A no-op for corner nodes, and for any case where there is no direction to work
 * from — a missing handle, or one sitting exactly on its anchor.
 *
 * Length is preserved rather than mirrored because the two sides of a smooth
 * node are routinely asymmetric; mirroring would silently rewrite the curve on
 * the far side every time the near side was touched.
 */
export function enforceSmooth(n: Node, moved: "in" | "out"): Node {
  if (n.type === "corner") return n;

  const movedHandle = handleOf(n, moved);
  const otherSide = moved === "in" ? "out" : "in";
  const otherHandle = handleOf(n, otherSide);
  if (movedHandle === null || otherHandle === null) return n;

  const direction = sub(movedHandle, n.pt);
  const directionLength = length(direction);
  if (directionLength === 0) return n;

  const otherLength = distance(n.pt, otherHandle);
  if (otherLength === 0) return n;

  const opposite = addScaled(n.pt, direction, -otherLength / directionLength);
  return withHandleRaw(n, otherSide, opposite);
}

/**
 * Snap `pt` to the horizontal or vertical axis through `anchor`, whichever it is
 * already closer to.
 *
 * The prototype's HV-lock compared the *previous* offset against the new one to
 * decide which axis to hold, which made the behaviour depend on drag history.
 * Choosing from the current position alone is predictable: the handle sits on
 * whichever axis it is nearer, and crossing the diagonal switches it.
 */
export function applyHvLock(anchor: Vec2, pt: Vec2): Vec2 {
  const dx = Math.abs(pt.x - anchor.x);
  const dy = Math.abs(pt.y - anchor.y);
  return dy <= dx ? { x: pt.x, y: anchor.y } : { x: anchor.x, y: pt.y };
}

export function hasHandles(n: Node): boolean {
  return n.in !== null || n.out !== null;
}
