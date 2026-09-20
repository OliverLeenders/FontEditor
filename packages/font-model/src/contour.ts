import {
  type Cubic,
  type HandleScales,
  type Rect,
  type TunniStatus,
  type Vec2,
  balance,
  addScaled,
  coincident,
  curvature,
  harmonisedJoin,
  bounds,
  distance,
  dot,
  length,
  lerp,
  lineAsCubic,
  moveTunniLine,
  refitJoin,
  setLambdas,
  setTunniPoint,
  split,
  sub,
  tunniLambdas,
  tunniPoint,
  tunniStatus,
} from "@typewright/geometry";

import type { ContourId, IdFactory, NodeId } from "./ids.js";
import {
  type Node,
  applyHvLock,
  enforceSmooth,
  handleOf,
  moveNodeTo,
  node,
  snapToAxis,
  translateNode,
  withHandleRaw,
} from "./node.js";

/**
 * A closed or open path, stored as its on-curve points.
 *
 * Segments are *derived*, never stored — see {@link segments}. That is what
 * makes a shared on-curve point impossible to desync, because there is only ever
 * one of it.
 */
export type Contour = {
  readonly id: ContourId;
  readonly closed: boolean;
  readonly nodes: readonly Node[];
};

export type SegmentKind = "line" | "curve";

/**
 * A derived view of the span between two consecutive nodes.
 *
 * Carries the handles exactly as stored, `null` included, so callers that write
 * files can tell a real line from a curve whose handles happen to sit on the
 * chord. Callers that want geometry should ask for {@link segmentCubic}.
 */
export type Segment = {
  readonly index: number;
  readonly fromId: NodeId;
  readonly toId: NodeId;
  readonly kind: SegmentKind;
  readonly a: Vec2;
  readonly b: Vec2;
  readonly out: Vec2 | null;
  readonly in: Vec2 | null;
};

export function contour(id: ContourId, nodes: readonly Node[], closed = false): Contour {
  return { id, closed, nodes };
}

// ---------------------------------------------------------------------------
// derivation
// ---------------------------------------------------------------------------

/**
 * A closed contour has as many segments as nodes, the last wrapping to the
 * first. An open one has one fewer. Below two nodes there is nothing to span.
 */
export function segmentCount(c: Contour): number {
  const n = c.nodes.length;
  if (n < 2) return 0;
  return c.closed ? n : n - 1;
}

export function segments(c: Contour): Segment[] {
  const count = segmentCount(c);
  const out: Segment[] = [];
  for (let i = 0; i < count; i++) {
    const segment = segmentAt(c, i);
    if (segment !== null) out.push(segment);
  }
  return out;
}

export function segmentAt(c: Contour, index: number): Segment | null {
  if (index < 0 || index >= segmentCount(c)) return null;
  const from = c.nodes[index];
  const to = c.nodes[(index + 1) % c.nodes.length];
  if (from === undefined || to === undefined) return null;
  return {
    index,
    fromId: from.id,
    toId: to.id,
    kind: from.out === null && to.in === null ? "line" : "curve",
    a: from.pt,
    b: to.pt,
    out: from.out,
    in: to.in,
  };
}

/**
 * The segment as a cubic, for geometric queries.
 *
 * A line is materialised with handles at the thirds — the exact parameterisation
 * the prototype used for new segments. This is a *view*, and writing it back
 * unchanged would turn the line into a curve, so treat it as read-only unless
 * you mean to convert.
 */
export function segmentCubic(s: Segment): Cubic {
  if (s.kind === "line") return lineAsCubic(s.a, s.b);
  return { a: s.a, c1: s.out ?? s.a, c2: s.in ?? s.b, b: s.b };
}

export function nodeIndex(c: Contour, id: NodeId): number {
  return c.nodes.findIndex((n) => n.id === id);
}

/**
 * The segment a given handle shapes, or `null` if there is not one.
 *
 * A node's `out` handle governs the segment leaving it and its `in` handle the
 * segment arriving — so unlike the node itself, which sits between two segments
 * and belongs to neither in particular, a handle names exactly one. That is what
 * lets touching a handle say unambiguously which segment is being worked on.
 *
 * Returns `null` at the ends of an open contour, where one side of the end node
 * has no segment to govern.
 */
export function segmentIndexForHandle(c: Contour, id: NodeId, which: "in" | "out"): number | null {
  const i = nodeIndex(c, id);
  if (i < 0) return null;

  const count = segmentCount(c);
  if (count === 0) return null;

  if (which === "out") return i < count ? i : null;

  const arriving = i === 0 ? (c.closed ? count - 1 : -1) : i - 1;
  return arriving >= 0 && arriving < count ? arriving : null;
}

export function nodeById(c: Contour, id: NodeId): Node | null {
  return c.nodes.find((n) => n.id === id) ?? null;
}

/** Bounding box of every segment, or `null` for a contour with no segments. */
export function contourBounds(c: Contour): Rect | null {
  let box: Rect | null = null;
  for (const segment of segments(c)) {
    box = unionRect(box, bounds(segmentCubic(segment)));
  }
  if (box === null && c.nodes.length === 1) {
    const only = c.nodes[0]!;
    return { minX: only.pt.x, minY: only.pt.y, maxX: only.pt.x, maxY: only.pt.y };
  }
  return box;
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (a === null) return b;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

// ---------------------------------------------------------------------------
// editing — every function is pure and returns a new contour, or null when the
// request does not identify anything. Transactions and history live in
// edit-core; nothing here knows about undo.
// ---------------------------------------------------------------------------

function replaceNode(c: Contour, index: number, next: Node): Contour {
  const nodes = c.nodes.slice();
  nodes[index] = next;
  return { ...c, nodes };
}

// ---------------------------------------------------------------------------
// tangent nodes
//
// A tangent node has a straight segment on one side and a curve on the other,
// and the curve leaves along the line rather than at an angle to it. It is what
// the top of an "n" is: a stem going straight up, and the shoulder starting off
// vertically before it turns.
//
// Which handle is constrained cannot be read off the node — a node knows its
// two handles and nothing about its neighbours, and whether a side is straight
// is a fact about the segment. So this lives here, where the neighbours are.
// ---------------------------------------------------------------------------

/** The segment arriving at a node, wrapping round a closed contour. */
function arrivingAt(c: Contour, index: number): Segment | null {
  if (index !== 0) return segmentAt(c, index - 1);
  return c.closed ? segmentAt(c, segmentCount(c) - 1) : null;
}

/**
 * The far end of the straight side, and which handle has to face away from it.
 *
 * `null` when the node is not in a position to be tangent: an end of an open
 * contour has only one side, and a node with two straight sides or two curved
 * ones has no line for a curve to continue.
 */
function tangentSides(c: Contour, index: number): { away: Vec2; curved: "in" | "out" } | null {
  const arriving = arrivingAt(c, index);
  const leaving = segmentAt(c, index);
  if (arriving === null || leaving === null) return null;
  if (arriving.kind === leaving.kind) return null;

  // The handle continues the line's own direction, so it points away from the
  // straight segment's other end — which is the same rule read from either side.
  return arriving.kind === "line"
    ? { away: arriving.a, curved: "out" }
    : { away: leaving.b, curved: "in" };
}

/** Whether `tangent` is a type this node could truthfully have. */
export function canBeTangent(c: Contour, index: number): boolean {
  return tangentSides(c, index) !== null;
}

/**
 * The one node, with its curved handle swung onto the line.
 *
 * The handle keeps the length it had and only its direction is corrected, for
 * the reason `enforceSmooth` keeps lengths: the two sides of a node are
 * routinely asymmetric, and rewriting a length nobody asked to change would
 * reshape the curve every time the straight side was touched.
 */
function tangentNode(c: Contour, index: number): Node | null {
  const n = c.nodes[index];
  if (n === undefined || n.type !== "tangent") return null;

  const sides = tangentSides(c, index);
  if (sides === null) return null;

  const handle = handleOf(n, sides.curved);
  if (handle === null) return null;

  const along = sub(n.pt, sides.away);
  const reach = length(along);
  const held = distance(n.pt, handle);
  if (reach === 0 || held === 0) return null;

  const placed = addScaled(n.pt, along, held / reach);
  if (placed.x === handle.x && placed.y === handle.y) return null;
  return withHandleRaw(n, sides.curved, placed);
}

/**
 * Make every tangent node in the contour true again.
 *
 * Every edit ends here rather than each one remembering which nodes it might
 * have disturbed: moving a node swings the tangents on both sides of it,
 * turning a segment into a line makes a node tangent that could not have been,
 * and a rule applied in one place is a rule that cannot be forgotten in
 * another. A contour is a handful of nodes, so the pass is free.
 *
 * Returns the same contour when nothing moved, which is what the rest of the
 * model relies on to tell an edit from a no-op.
 */
export function enforceTangents(c: Contour): Contour {
  let nodes: Node[] | null = null;
  for (let i = 0; i < c.nodes.length; i++) {
    const fixed = tangentNode(c, i);
    if (fixed === null) continue;
    nodes ??= c.nodes.slice();
    nodes[i] = fixed;
  }
  return nodes === null ? c : { ...c, nodes };
}

/** What every edit hands back: the contour with its tangent nodes settled. */
const settled = (c: Contour | null): Contour | null => (c === null ? null : enforceTangents(c));

export function translateNodeBy(c: Contour, id: NodeId, delta: Vec2): Contour | null {
  const i = nodeIndex(c, id);
  if (i < 0) return null;
  return settled(replaceNode(c, i, translateNode(c.nodes[i]!, delta)));
}

/**
 * Move many nodes of one contour at once.
 *
 * One pass over the nodes and one settling of the tangents, where calling
 * {@link translateNodeBy} in a loop is a search, a copy of the whole node list
 * and a full tangent sweep *per node* — quadratic in the size of the selection,
 * which stopped being a theoretical worry when selecting a whole contour became
 * one gesture. Ids that name nothing here are ignored, the way a selection is
 * allowed to outlive what it named.
 *
 * Settling once at the end is also the more correct answer: a tangent node reads
 * its neighbours, and the neighbours have all moved by the time it is asked.
 */
export function translateNodes(c: Contour, ids: ReadonlySet<NodeId>, delta: Vec2): Contour | null {
  if (ids.size === 0) return null;
  if (!c.nodes.some((n) => ids.has(n.id))) return null;

  const nodes = c.nodes.map((n) => (ids.has(n.id) ? translateNode(n, delta) : n));
  return enforceTangents({ ...c, nodes });
}

export function setNodePoint(c: Contour, id: NodeId, pt: Vec2): Contour | null {
  const i = nodeIndex(c, id);
  if (i < 0) return null;
  return settled(replaceNode(c, i, moveNodeTo(c.nodes[i]!, pt)));
}

/**
 * Reposition one handle, honouring the node's own constraints: HV-lock first,
 * then the smooth constraint on the opposite handle.
 *
 * Passing `null` retracts the handle. Retracting does not disturb the opposite
 * side — there is no direction left to derive one from.
 *
 * `breakSmooth` suppresses the smooth constraint for this one move, which is
 * what holding Alt does while dragging a handle. HV-lock still applies: the two
 * constraints are independent, and Alt conventionally means "unlink the
 * handles", not "ignore everything". Note that a node left with non-collinear
 * handles is no longer smooth in fact, so the caller should also set its type to
 * `corner` once the gesture ends — otherwise the model records something the
 * geometry contradicts.
 */
export function setHandle(
  c: Contour,
  id: NodeId,
  which: "in" | "out",
  pt: Vec2 | null,
  breakSmooth = false,
): Contour | null {
  const i = nodeIndex(c, id);
  if (i < 0) return null;
  const base = c.nodes[i]!;

  if (pt === null) return settled(replaceNode(c, i, withHandleRaw(base, which, null)));

  // A tangent node's curved handle runs along the straight side, so the cursor
  // says how far and not which way: it is projected onto the line rather than
  // followed. Alt gives up the constraint, and gives up the type with it — a
  // node called tangent whose handle has just been swung off the line would be
  // recording something the geometry contradicts.
  const tangent = base.type === "tangent" ? tangentSides(c, i) : null;
  if (tangent !== null && tangent.curved === which) {
    if (breakSmooth) return settled(replaceNode(c, i, { ...base, type: "corner", [which]: pt }));

    const along = sub(base.pt, tangent.away);
    const reach = length(along);
    if (reach > 0) {
      // Never behind the node: a negative reach would put the handle on the
      // wrong side of the line and turn the join into a cusp.
      const far = Math.max(0, dot(sub(pt, base.pt), along) / (reach * reach));
      return settled(replaceNode(c, i, withHandleRaw(base, which, addScaled(base.pt, along, far))));
    }
  }

  // A smooth node's two handles are one straight line, so a lock on the far side
  // holds this side too: swinging this handle off the axis would drag the locked
  // one off with it, and the lock would be a lock that does not hold. Alt breaks
  // the link for this one move, and with it that obligation.
  const other = which === "in" ? "out" : "in";
  const held = base.hvLock[which] || (!breakSmooth && base.type === "smooth" && base.hvLock[other]);

  const constrained = held ? applyHvLock(base.pt, pt) : pt;
  const moved = withHandleRaw(base, which, constrained);
  return settled(replaceNode(c, i, breakSmooth ? moved : enforceSmooth(moved, which)));
}

/**
 * Give a node a type.
 *
 * `tangent` is refused where it would not be true: it says the curve on one
 * side leaves along the straight segment on the other, and a node with two
 * curves, two lines, or only one side has no such arrangement to describe. The
 * other two types make sense anywhere, and are enforced where they can be —
 * `smooth` on a node with one handle does nothing, and says nothing false.
 */
export function setNodeType(c: Contour, id: NodeId, type: Node["type"]): Contour | null {
  const i = nodeIndex(c, id);
  if (i < 0) return null;
  if (type === "tangent" && !canBeTangent(c, i)) return null;

  const next: Node = { ...c.nodes[i]!, type };
  // Adopting a type should take effect immediately rather than on the next
  // handle drag: `smooth` here, and `tangent` in the pass every edit ends with.
  return settled(replaceNode(c, i, type === "smooth" ? enforceSmooth(next, "out") : next));
}

/**
 * Turn the axis constraint on or off, for one handle or for both.
 *
 * Switching it on snaps the handle onto an axis immediately rather than waiting
 * for the next drag: a lock that visibly changed nothing would read as broken.
 * The snap rotates rather than projects, so a handle keeps its length and only
 * its direction is corrected — see `snapToAxis` for why those differ.
 *
 * A smooth node needs more care than snapping each handle to its own nearer
 * axis, which would leave one pointing north and the other east and quietly make
 * "smooth" a lie. Its handles are one line, so one of them picks the axis and
 * the other is swung to face it. Which one leads is the one being locked; when
 * both are, the longer handle leads, since it carries more of the curve's shape
 * and is the less destructive to keep. A corner node has no such obligation, so
 * each handle snaps on its own.
 *
 * Switching one side of a smooth node off while the other stays locked makes it
 * a corner. The two handles are one line, so the far side's lock goes on holding
 * this one — see `setHandle` — and the switch would be a switch that changes
 * nothing. Freeing the handle is what unlocking it means, and a node whose
 * handles are free to point in different directions is a corner.
 *
 * A tangent node's curved handle runs along the straight side, which is a
 * direction the node does not get to choose — so locking that handle to an axis
 * makes the node a corner, the way unlocking one side of a smooth node does.
 * Otherwise the handle would be snapped and then swung straight back by the
 * tangent pass every edit ends with, and the lock would read as broken. Where
 * the straight side already lies on an axis there is nothing to give up: the
 * handle is on the axis, and the node stays tangent.
 */
export function setHvLock(
  c: Contour,
  id: NodeId,
  which: "in" | "out" | "both",
  locked: boolean,
): Contour | null {
  const i = nodeIndex(c, id);
  if (i < 0) return null;

  const base = c.nodes[i]!;
  const hvLock =
    which === "both" ? { in: locked, out: locked } : { ...base.hvLock, [which]: locked };

  let next: Node = { ...base, hvLock };
  if (!locked) {
    const other = which === "in" ? "out" : "in";
    const stillHeld = which !== "both" && base.type === "smooth" && hvLock[other];
    return settled(replaceNode(c, i, stillHeld ? { ...next, type: "corner" } : next));
  }

  // The tangent line is what the curved handle would have to leave to reach an
  // axis. Asked to leave it, the node stops being a tangent node.
  if (base.type === "tangent") {
    const sides = tangentSides(c, i);
    const handle = sides === null ? null : handleOf(base, sides.curved);
    if (sides !== null && handle !== null && hvLock[sides.curved]) {
      const snapped = snapToAxis(base.pt, handle);
      if (!coincident(snapped, handle)) next = { ...next, type: "corner" };
    }
  }

  const smooth = base.type === "smooth" && base.in !== null && base.out !== null;
  if (smooth) {
    const leading =
      which === "both"
        ? distance(base.pt, base.out) >= distance(base.pt, base.in)
          ? "out"
          : "in"
        : which;
    const handle = leading === "out" ? base.out : base.in;
    const swung = withHandleRaw(next, leading, snapToAxis(base.pt, handle));
    return settled(replaceNode(c, i, enforceSmooth(swung, leading)));
  }

  let snapped: Node = next;
  for (const side of ["in", "out"] as const) {
    if (!hvLock[side]) continue;
    const handle = side === "in" ? snapped.in : snapped.out;
    if (handle !== null) snapped = withHandleRaw(snapped, side, snapToAxis(base.pt, handle));
  }
  return settled(replaceNode(c, i, snapped));
}

/**
 * Write a cubic back onto the two nodes that own it.
 *
 * The single place where segment geometry re-enters the model, and the reason
 * the two halves of a shared on-curve point cannot disagree: `c1` lands on one
 * node's `out`, `c2` on the next node's `in`, and each anchor is written exactly
 * once.
 *
 * Note this always produces a curve. Converting a line into one is a real edit,
 * so make it deliberately.
 */
export function setSegmentCubic(c: Contour, index: number, geometry: Cubic): Contour | null {
  if (index < 0 || index >= segmentCount(c)) return null;
  const j = (index + 1) % c.nodes.length;
  const from = c.nodes[index];
  const to = c.nodes[j];
  if (from === undefined || to === undefined) return null;

  const nodes = c.nodes.slice();
  nodes[index] = { ...from, pt: geometry.a, out: geometry.c1 };
  nodes[j] = { ...to, pt: geometry.b, in: geometry.c2 };
  return settled({ ...c, nodes });
}

/**
 * Give a straight segment handles at the thirds, turning it into a curve.
 *
 * The inverse of {@link makeSegmentLine}, and the same parameterisation the pen
 * uses for a new segment — so converting a line and then converting it back
 * leaves the shape exactly where it started.
 */
export function makeSegmentCurve(c: Contour, index: number): Contour | null {
  const segment = segmentAt(c, index);
  if (segment === null) return null;
  // A curve missing one of its handles is completed rather than left alone.
  // Returning it untouched was what made a retracted handle unrecoverable.
  if (segment.kind === "curve") return extendSegmentHandles(c, index);
  return setSegmentCubic(c, index, lineAsCubic(segment.a, segment.b));
}

/**
 * Give a handle to a node that has not got one.
 *
 * The inverse of retracting, and the way out of a state that was otherwise a
 * trap: a segment counts as a curve when *either* of its handles is set, with
 * the missing control point sitting invisibly on its anchor — where nothing can
 * be clicked, and where "make curve" sees a curve already and declines.
 *
 * The new handle lands a third of the way along the chord, which is where
 * `lineAsCubic` puts one and therefore what a handle pulled from a straight
 * segment already looks like. That does change the shape: a control point at the
 * anchor and one a third along describe different curves, and there is no
 * placement that would leave the outline untouched. Extracting is asked for
 * precisely when the current shape is not the one wanted.
 */
export function extendHandle(c: Contour, id: NodeId, which: "in" | "out"): Contour | null {
  const i = nodeIndex(c, id);
  if (i < 0) return null;

  const n = c.nodes[i]!;
  if (handleOf(n, which) !== null) return c;

  // `out` shapes the segment leaving this node, `in` the one arriving; an open
  // contour's ends have no segment on the far side and so nothing to extend.
  const facing = which === "out" ? i + 1 : i - 1;
  const wrapped = (facing + c.nodes.length) % c.nodes.length;
  if (!c.closed && (facing < 0 || facing >= c.nodes.length)) return null;

  const other = c.nodes[wrapped];
  if (other === undefined) return null;

  const at = lerp(n.pt, other.pt, 1 / 3);
  const placed = n.hvLock[which] ? applyHvLock(n.pt, at) : at;
  return settled(replaceNode(c, i, enforceSmooth(withHandleRaw(n, which, placed), which)));
}

/**
 * Give both of a segment's handles to it, whichever are missing.
 *
 * What the interface offers as "extract handles": a half-handled curve has one
 * control point you can reach and one you cannot, and asking for them one at a
 * time would mean knowing which end is the awkward one.
 */
export function extendSegmentHandles(c: Contour, index: number): Contour | null {
  const segment = segmentAt(c, index);
  if (segment === null) return null;
  if (segment.out !== null && segment.in !== null) return c;

  const withOut = extendHandle(c, segment.fromId, "out") ?? c;
  return extendHandle(withOut, segment.toId, "in") ?? withOut;
}

/** Whether a segment is drawn as a curve but has a control point out of reach. */
export function isHalfHandled(c: Contour, index: number): boolean {
  const segment = segmentAt(c, index);
  if (segment === null || segment.kind === "line") return false;
  return segment.out === null || segment.in === null;
}

/** Retract both of a segment's handles, turning it into a straight line. */
export function makeSegmentLine(c: Contour, index: number): Contour | null {
  if (index < 0 || index >= segmentCount(c)) return null;
  const j = (index + 1) % c.nodes.length;
  const from = c.nodes[index];
  const to = c.nodes[j];
  if (from === undefined || to === undefined) return null;

  const nodes = c.nodes.slice();
  nodes[index] = { ...from, out: null };
  nodes[j] = { ...to, in: null };
  return settled({ ...c, nodes });
}

/**
 * Insert a node partway along a segment, leaving the curve's shape unchanged.
 *
 * For a curve this is de Casteljau: the split hands back the handles that make
 * the two halves trace exactly what the whole did. For a line it is a plain
 * interpolation, and the new node stays a corner with no handles, so the line
 * stays a line.
 */
export function insertNodeOnSegment(
  c: Contour,
  index: number,
  t: number,
  ids: IdFactory,
): Contour | null {
  const segment = segmentAt(c, index);
  if (segment === null) return null;
  if (!(t > 0 && t < 1)) return null;

  const j = (index + 1) % c.nodes.length;
  const from = c.nodes[index];
  const to = c.nodes[j];
  if (from === undefined || to === undefined) return null;

  const nodes = c.nodes.slice();
  let inserted: Node;

  if (segment.kind === "line") {
    inserted = node(ids.node(), lerp(segment.a, segment.b, t));
  } else {
    const [left, right] = split(segmentCubic(segment), t);
    nodes[index] = { ...from, out: left.c1 };
    nodes[j] = { ...to, in: right.c2 };
    inserted = node(ids.node(), left.b, { type: "smooth", in: left.c2, out: right.c1 });
  }

  nodes.splice(index + 1, 0, inserted);
  return settled({ ...c, nodes });
}

/** How near an end, or another new node, an inserted parameter may not be. */
const T_EDGE = 1e-4;

/**
 * Insert several nodes along one segment, at the parameters of the segment as
 * it is now.
 *
 * Splitting changes the parameterisation of what is left, so the parameters are
 * taken from the back: everything before a split keeps its share of the segment
 * still at `index`, scaled by where the split was. Doing it the other way round
 * means every later parameter meaning something else by the time it is used,
 * which is how points end up somewhere nobody asked for.
 *
 * Parameters at the ends, or so close to each other that the nodes would land on
 * top of one another, are dropped rather than refused: this is fed by root
 * finding, where a curve that turns exactly at its own end point is ordinary.
 */
export function insertNodesOnSegment(
  c: Contour,
  index: number,
  ts: readonly number[],
  ids: IdFactory,
): Contour | null {
  const wanted = [...ts].filter((t) => t > T_EDGE && t < 1 - T_EDGE).sort((l, r) => r - l);

  let next = c;
  let above = 1;
  let inserted = 0;
  for (const t of wanted) {
    if (above - t < T_EDGE) continue;
    const split = insertNodeOnSegment(next, index, t / above, ids);
    if (split === null) continue;
    next = split;
    above = t;
    inserted++;
  }
  return inserted === 0 ? null : next;
}

/**
 * Remove a node and fit what is left to the shape it had.
 *
 * The two segments the node joined become one, and the neighbours' handles were
 * the length they were because each drew half the distance — keeping them is
 * what makes a deleted point dent the outline. The directions are kept, since
 * they are the join with whatever lies beyond and a smooth node either side
 * rests on them, and only the two lengths are fitted, against the pair of curves
 * that were there. Two straight segments stay straight.
 *
 * Falls back to {@link removeNode} wherever there is nothing to fit: an end of
 * an open contour, a contour down to its last nodes, a pair of lines.
 */
export function removeNodeFitted(c: Contour, id: NodeId): Contour | null {
  const i = nodeIndex(c, id);
  if (i < 0) return null;
  const count = c.nodes.length;
  if (count < 3) return removeNode(c, id);

  const previous = (i - 1 + count) % count;
  const following = (i + 1) % count;
  const before = c.closed || i > 0 ? segmentAt(c, previous) : null;
  const after = c.closed || i < count - 1 ? segmentAt(c, i) : null;
  if (before === null || after === null) return removeNode(c, id);
  if (before.kind === "line" && after.kind === "line") return removeNode(c, id);

  const fitted = refitJoin(segmentCubic(before), segmentCubic(after));
  const from = c.nodes[previous];
  const to = c.nodes[following];
  if (fitted === null || from === undefined || to === undefined) return removeNode(c, id);

  const nodes = c.nodes.slice();
  nodes[previous] = withHandleRaw(from, "out", fitted.c1);
  nodes[following] = withHandleRaw(to, "in", fitted.c2);
  nodes.splice(i, 1);
  return settled({ ...c, nodes });
}

/**
 * Remove a node. The neighbours keep the handles they already had, so the curve
 * changes shape — see {@link removeNodeFitted} for the deletion that fits it
 * back.
 */
export function removeNode(c: Contour, id: NodeId): Contour | null {
  const i = nodeIndex(c, id);
  if (i < 0) return null;
  const nodes = c.nodes.slice();
  nodes.splice(i, 1);
  return settled({ ...c, nodes });
}

export function appendNode(c: Contour, n: Node): Contour {
  return { ...c, nodes: [...c.nodes, n] };
}

export function setClosed(c: Contour, closed: boolean): Contour {
  return { ...c, closed };
}

/**
 * Reverse the direction of travel.
 *
 * Every node swaps `in` and `out`, since the segment that used to arrive now
 * leaves. A closed contour keeps its start point where it was and reverses the
 * rest, which is what preserves the meaning of "first node" across the
 * operation; an open one reverses outright, because its endpoints trade places.
 */
export function reverseContour(c: Contour): Contour {
  const swapped = c.nodes.map((n) => ({ ...n, in: n.out, out: n.in }));
  if (!c.closed) return { ...c, nodes: swapped.reverse() };
  const [first, ...rest] = swapped;
  if (first === undefined) return c;
  return { ...c, nodes: [first, ...rest.reverse()] };
}

// ---------------------------------------------------------------------------
// Tunni bridge
//
// Each of these reads a segment, hands the cubic to the kernel, and writes the
// result back through setSegmentCubic. The kernel stays ignorant of the model,
// the model stays ignorant of the maths, and the null from a degenerate segment
// propagates out untouched.
//
// Tunni operations preserve handle *directions* by construction, so a smooth
// node stays smooth without any constraint being re-applied here.
// ---------------------------------------------------------------------------

export function segmentTunniStatus(c: Contour, index: number): TunniStatus | null {
  const segment = segmentAt(c, index);
  if (segment === null) return null;
  if (segment.kind === "line") return "flat";
  return tunniStatus(segmentCubic(segment));
}

export function segmentTunniPoint(c: Contour, index: number): Vec2 | null {
  const segment = segmentAt(c, index);
  if (segment === null || segment.kind === "line") return null;
  return tunniPoint(segmentCubic(segment));
}

/**
 * The two handle scales of a segment: how far along its own handle line each
 * control point sits, where `1` is the point the two lines cross at.
 *
 * `null` for a straight segment as well as a degenerate one — a line has no
 * handles to scale, which is the same answer as "there is nothing to read here".
 */
export function segmentLambdas(c: Contour, index: number): HandleScales | null {
  const segment = segmentAt(c, index);
  if (segment === null || segment.kind === "line") return null;
  return tunniLambdas(segmentCubic(segment));
}

/** Place both handles at the given scales. The write to {@link segmentLambdas}. */
export function setSegmentLambdas(c: Contour, index: number, scales: HandleScales): Contour | null {
  return applyToSegment(c, index, (geometry) => setLambdas(geometry, scales));
}

/**
 * The two segments meeting at a node, as cubics, or `null` where they are not
 * two curves.
 *
 * The pair everything about a join is asked of: the curvature either side of it,
 * and whether it can be harmonised.
 */
export function segmentsAround(
  c: Contour,
  id: NodeId,
): { readonly before: Cubic; readonly after: Cubic } | null {
  const i = nodeIndex(c, id);
  if (i < 0) return null;

  const count = segmentCount(c);
  if (count === 0) return null;

  // The segment arriving is the one before this node, which wraps on a closed
  // contour and does not exist at the start of an open one.
  const arriving = i === 0 ? (c.closed ? count - 1 : -1) : i - 1;
  const leaving = i < count ? i : -1;
  if (arriving < 0 || leaving < 0) return null;

  const before = segmentAt(c, arriving);
  const after = segmentAt(c, leaving);
  if (before === null || after === null) return null;
  if (before.kind === "line" || after.kind === "line") return null;

  return { before: segmentCubic(before), after: segmentCubic(after) };
}

/**
 * The curvature either side of a node: how tightly the outline turns as it
 * arrives, and as it leaves.
 *
 * Two numbers rather than one, because the whole question at a join is whether
 * they are the same. `null` where the node is not between two curves, or where
 * a curve has no curvature there to speak of — a cusp, a retracted handle.
 */
export function curvatureAround(
  c: Contour,
  id: NodeId,
): { readonly before: number; readonly after: number } | null {
  const pair = segmentsAround(c, id);
  if (pair === null) return null;

  const before = curvature(pair.before, 1);
  const after = curvature(pair.after, 0);
  return before === null || after === null ? null : { before, after };
}

/**
 * Move a node to where the curvature either side of it agrees.
 *
 * Harmonising: the node slides along the line between its own two handles,
 * which leaves both segments the directions they were drawn with and lands the
 * node exactly smooth as well as curvature-continuous. See `harmonisedJoin` for
 * why that line is the one place it can go.
 *
 * The node becomes smooth, because after the move it is: its handles are
 * collinear through it by construction, and saying so keeps the next drag from
 * quietly breaking what was just fixed.
 *
 * `null` where there is nothing to do — a node between anything but two curves,
 * a straight side, or a node already where it belongs.
 */
export function harmoniseNode(c: Contour, id: NodeId): Contour | null {
  const pair = segmentsAround(c, id);
  if (pair === null) return null;

  const point = harmonisedJoin(pair.before, pair.after);
  if (point === null) return null;

  const i = nodeIndex(c, id);
  const existing = c.nodes[i];
  if (existing === undefined) return null;
  if (existing.pt.x === point.x && existing.pt.y === point.y) return null;

  // The point alone. `setNodePoint` takes the handles along with it, which is
  // what dragging a node means and the opposite of what this means: the handles
  // are the two curves' own, they stay, and the point slides between them.
  return settled(replaceNode(c, i, { ...existing, pt: point, type: "smooth" }));
}

export function balanceSegment(c: Contour, index: number): Contour | null {
  return applyToSegment(c, index, balance);
}

export function setSegmentTunniPoint(c: Contour, index: number, target: Vec2): Contour | null {
  return applyToSegment(c, index, (geometry) => setTunniPoint(geometry, target));
}

export function moveSegmentTunniLine(c: Contour, index: number, through: Vec2): Contour | null {
  return applyToSegment(c, index, (geometry) => moveTunniLine(geometry, through));
}

function applyToSegment(
  c: Contour,
  index: number,
  operation: (geometry: Cubic) => Cubic | null,
): Contour | null {
  const segment = segmentAt(c, index);
  if (segment === null || segment.kind === "line") return null;
  const next = operation(segmentCubic(segment));
  if (next === null) return null;
  return setSegmentCubic(c, index, next);
}
