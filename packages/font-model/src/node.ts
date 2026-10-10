import type { EndSerif } from "./serif.js";
import { type Vec2, add, addScaled, distance, length, sub } from "@typewright/geometry";

import type { SegmentBlend } from "@typewright/geometry";

import type { Nib } from "./contour.js";
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
/**
 * Which of a node's handles are held to the horizontal or vertical.
 *
 * Per handle rather than per node, because the two sides of a node are often
 * doing different jobs: the flat top of an `a` wants its outgoing handle level
 * while the incoming one follows the curve down into the stem, and one flag for
 * both could only say yes to both or no to both.
 *
 * On a *smooth* node the two handles are one straight line, so a lock on either
 * end holds the whole line — see `setHandle` for how that is resolved. The flags
 * still record only what was asked for; the geometry does the rest.
 */
export type HandleLock = {
  readonly in: boolean;
  readonly out: boolean;
};

export const NO_LOCK: HandleLock = { in: false, out: false };
export const BOTH_LOCKED: HandleLock = { in: true, out: true };

/** Whether either handle is held, which is what an interface usually asks. */
export function anyLocked(lock: HandleLock): boolean {
  return lock.in || lock.out;
}

export type Node = {
  readonly id: NodeId;
  readonly pt: Vec2;
  readonly type: NodeType;
  readonly in: Vec2 | null;
  readonly out: Vec2 | null;
  /** Which handles are constrained to the horizontal or vertical axis. */
  readonly hvLock: HandleLock;
  /**
   * Whether this node is kept where the curvature either side of it agrees.
   *
   * Harmonising moves a node to that place. It is a one-shot operation, and the
   * next drag of a handle beside it undoes what it did — which is the wrong shape
   * for what it is used for, because the reason to harmonise a join is that it
   * should *stay* smooth while the curves through it are drawn.
   *
   * A node with this set is solved again after every edit, and the solving needs
   * no iteration: where the node belongs depends on the four handles around it and
   * never on the points, so no node's answer can disturb another's.
   *
   * Beside `type` rather than a fourth kind of node, because it is not a fourth
   * kind: a harmonised node is a smooth node with its position decided for it, and
   * a fourth enum member would have to be handled by every switch that asks
   * whether a node is smooth — and written into a `.glif`, which has no word for
   * it.
   */
  readonly harmonised: boolean;
  /**
   * The pen at this point, for a point of a stroke's skeleton.
   *
   * A stroke's pen is set at its points and changes smoothly along each segment
   * from one point's pen to the next: the angle turns, the width and thickness
   * grow or shrink. Absent, the point has the contour's own pen, which is what
   * every point of a stroke drawn with one pen has. On a point of an outline it
   * means nothing and is never set.
   */
  readonly pen?: Nib;
  /**
   * How the pen changes along the segment that leaves this point, for a point of a
   * stroke: the angle and the shape each linear, smooth, eased or held. Absent,
   * both are linear.
   */
  readonly blend?: SegmentBlend;
  /**
   * A corner the drawn outline rounds with a curvature that ramps up from the
   * sides instead of jumping: the squircle. `size` is how much of each side it
   * spends, `smoothness` from nought — a plain circular round — to one, all ramp.
   * Only on a corner or a tangent node; see `corneredContour`.
   */
  readonly continuous?: ContinuousCorner;
  /**
   * How a stroke ends here, for the first or last point of an open stroke's
   * skeleton: cut off straight instead of left as the pen leaves it. Absent, the
   * end is the pen's own. On any other point it means nothing — and is kept, so
   * that a point which becomes an end again, by the knife, ends as it did.
   */
  readonly end?: StrokeEnd;
};

/**
 * A stroke's end, cut straight.
 *
 * A pen held at an angle leaves the end of a stroke at that angle: the foot of
 * a stem drawn with a pen at thirty degrees slants at thirty degrees. Turning
 * the pen level at the last point makes the foot level and the stem wider, and
 * the width then has to be taken back off, at every weight. A cut leaves the
 * pen alone: the stroke is carried on past its last point as far as the pen
 * reaches, and cut off by a straight line through that point. So the point is
 * where the ink ends, and the stroke is its own weight all the way to it.
 *
 * `cut` is the line: `"square"`, across the path where it ends, or an angle in
 * degrees anticlockwise from level, as a pen's is — nought for a foot standing
 * on the baseline, ninety for the end of a bar.
 *
 * `shape` is what the end is closed with. Absent, the cut itself: a straight
 * edge, and a sharp corner where it meets each side of the stroke. `"nib"`, half
 * the pen's own outline, laid along the cut and made as wide as the stroke is
 * there — the end the pen would leave if it were turned to the cut and were the
 * stroke's width, which is the turning and the taking back of width done for
 * you. A broad edge has no outline but a line, and its end is the same either way.
 *
 * `serif` is a serif standing on the cut, which then closes the end whatever
 * `shape` says: see `serif.ts`.
 */
export type StrokeEnd = {
  readonly cut: "square" | number;
  readonly shape?: "nib";
  readonly serif?: EndSerif;
};

/** How a continuous corner is drawn. */
export type ContinuousCorner = { readonly size: number; readonly smoothness: number };

export type NodeInit = {
  readonly type?: NodeType;
  readonly in?: Vec2 | null;
  readonly out?: Vec2 | null;
  /** `true` locks both handles, which is what the flag used to mean. */
  readonly hvLock?: boolean | Partial<HandleLock>;
  readonly harmonised?: boolean;
  readonly pen?: Nib;
  readonly blend?: SegmentBlend;
  readonly continuous?: ContinuousCorner;
  readonly end?: StrokeEnd;
};

/** Read an init's lock, accepting the boolean the field used to be. */
export function handleLock(init: NodeInit["hvLock"]): HandleLock {
  if (init === undefined) return NO_LOCK;
  if (typeof init === "boolean") return init ? BOTH_LOCKED : NO_LOCK;
  return { in: init.in ?? false, out: init.out ?? false };
}

export function node(id: NodeId, pt: Vec2, init: NodeInit = {}): Node {
  return {
    id,
    pt,
    type: init.type ?? "corner",
    in: init.in ?? null,
    out: init.out ?? null,
    hvLock: handleLock(init.hvLock),
    harmonised: init.harmonised ?? false,
    ...(init.pen === undefined ? {} : { pen: init.pen }),
    ...(init.blend === undefined ? {} : { blend: init.blend }),
    ...(init.continuous === undefined ? {} : { continuous: init.continuous }),
    ...(init.end === undefined ? {} : { end: init.end }),
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

/**
 * Rotate `p` onto the nearer axis through `anchor`, keeping its distance.
 *
 * Distinct from {@link applyHvLock}, and the difference matters. Dragging a
 * locked handle *projects* the cursor onto the axis — the pointer is saying
 * where, and how far along the axis you dragged is the length you asked for.
 * Turning the lock on has no cursor to follow, so the least destructive thing is
 * to correct the direction and leave the length alone, which is what "snap the
 * direction to north, east, south or west" actually asks for.
 */
export function snapToAxis(anchor: Vec2, p: Vec2): Vec2 {
  const dx = p.x - anchor.x;
  const dy = p.y - anchor.y;
  const reach = Math.hypot(dx, dy);
  if (reach === 0) return p;

  return Math.abs(dx) >= Math.abs(dy)
    ? { x: anchor.x + Math.sign(dx) * reach, y: anchor.y }
    : { x: anchor.x, y: anchor.y + Math.sign(dy) * reach };
}
