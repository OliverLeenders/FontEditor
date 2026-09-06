import {
  type Cubic,
  type CurveMeeting,
  type Vec2,
  evaluate,
  flatten,
  intersectCubics,
  project,
  reverse,
  selfIntersection,
  subcurve,
  tangent,
} from "@fonteditor/geometry";

import { type Contour, contour, segmentAt, segmentCount, segmentCubic } from "./contour.js";
import type { Glyph } from "./glyph.js";
import type { IdFactory } from "./ids.js";
import { type Node, node } from "./node.js";

/**
 * Removing overlap: the outline of what a glyph's contours cover together.
 *
 * The tools that make the problem are the ones that were added to solve others —
 * a rectangle laid across a stem, an ellipse cut by a knife — and the format
 * makes it again: CFF does not allow overlapping contours, so the exporter takes
 * this union on the way into a font whether or not anyone asked for it.
 *
 * The approach is to be exact where it shows and approximate where it does not.
 * Curves are split at their true crossings and every piece that survives is a
 * genuine subcurve, so the handles a designer placed come back untouched. The
 * only thing flattening is used for is deciding whether a point is inside the
 * shape, which wants robustness far more than it wants precision.
 *
 * Three things make real drawings hard, and each has its answer here:
 *
 *  - **Shapes that share an edge** rather than crossing it — a bowl flush
 *    against a stem. There is no crossing point to split at, so the ends of the
 *    shared stretch are used instead: where one piece's end lands on the other.
 *  - **Shapes that touch tangentially** — an arch leaving a stem along its edge.
 *    That produces a knot of near-identical crossings, so points that land
 *    within a whisker of each other are treated as one place.
 *  - **More than two edges meeting at a point**, which both of the above
 *    produce. Chaining by "which piece starts nearest" cannot answer that; the
 *    walk below picks by *angle*, which is what tracing a boundary means.
 */

export type OverlapResult = {
  readonly glyph: Glyph;
  /** How many crossings between contours were resolved. Zero means none were. */
  readonly crossings: number;
};

/**
 * How far to either side of a piece the fill is sampled, against the tolerance.
 *
 * Not a fixed distance. Where two shapes touch, their boundaries run within the
 * tolerance of each other for a stretch, and a probe shorter than that lands in
 * the fuzz between them and answers about the wrong region — which leaves an
 * edge with ink on both sides looking like a boundary, and cuts the union into
 * pieces that meet along it. Half the tolerance is clear of the fuzz and still a
 * fraction of anything anyone draws.
 */
const PROBE = 0.5;

/** The floor under "the same place", for a glyph too small to have an opinion. */
const JOIN = 0.05;

/**
 * How near two points must be to count as the same place, as a fraction of the
 * glyph.
 *
 * Relative because the answer is about drawing, not about arithmetic: two points
 * a five-hundredth of an em apart are the same point to anyone looking, and a
 * tangency reports its contact spread over exactly that sort of distance. An
 * absolute tolerance either drowns in the spread on a thousand-unit em or
 * swallows real detail on a small one.
 */
const SAME_PLACE = 0.002;

/**
 * Remove overlap from a glyph.
 *
 * A glyph with nothing overlapping comes back unchanged, with a count of zero:
 * the same object, so a caller can tell "cleaned" from "already clean" by
 * identity as well as by the number.
 *
 * `null` means the outlines could not be resolved. It is the answer of last
 * resort — a boundary that will not close means the crossings were not found
 * cleanly, and handing back an outline with a gap in it would be worse than
 * handing back nothing.
 */
export function removeOverlap(g: Glyph, ids: IdFactory): OverlapResult | null {
  const closed = g.contours.filter((c) => c.closed && c.nodes.length >= 2);
  if (closed.length === 0) return { glyph: g, crossings: 0 };

  const eps = tolerance(closed);

  // Where every contour meets every other, and where each meets itself. The two
  // are the same problem: a stroke laid back across its own path leaves exactly
  // the seam that two overlapping shapes do, and the rule for which pieces
  // survive cannot tell them apart either.
  const cuts = new Map<string, number[]>();
  let crossings = 0;

  for (const [index, c] of closed.entries()) {
    crossings += selfMeetings(c, index, cuts, eps);
  }

  for (let i = 0; i < closed.length; i++) {
    for (let j = i + 1; j < closed.length; j++) {
      crossings += meetings(closed[i]!, closed[j]!, i, j, cuts, eps);
    }
  }

  if (crossings === 0) return { glyph: g, crossings: 0 };

  const pieces: Piece[] = [];
  for (const [index, c] of closed.entries()) pieces.push(...split(c, index, cuts, eps));

  // Flattened once, and used only to answer whether a point is covered.
  const outlines = closed.map(polygon);
  const kept = onBoundary(pieces, outlines, eps);
  if (kept.length === 0) return null;

  const loops = walk(kept, ids, eps);
  if (loops === null) return null;

  const others = g.contours.filter((c) => !closed.includes(c));
  return { glyph: { ...g, contours: [...others, ...loops] }, crossings };
}

/**
 * A stretch of outline between two crossings.
 *
 * Just the curve and whether it was drawn as a line. Everything else about the
 * node it starts at — its type, the handle arriving at it — is worked out again
 * when the pieces are chained, because a piece may be walked in either
 * direction and the node it starts at then is not the node it started at when
 * it was cut.
 */
type Piece = {
  readonly curve: Cubic;
  readonly line: boolean;
};

// ---------------------------------------------------------------------------
// finding the crossings
// ---------------------------------------------------------------------------

/** Record where two contours cross, keyed by contour and segment. */
function meetings(
  a: Contour,
  b: Contour,
  ai: number,
  bi: number,
  cuts: Map<string, number[]>,
  eps: number,
): number {
  let count = 0;

  for (let s = 0; s < segmentCount(a); s++) {
    const sa = segmentAt(a, s);
    if (sa === null) continue;

    for (let t = 0; t < segmentCount(b); t++) {
      const sb = segmentAt(b, t);
      if (sb === null) continue;

      const ca = segmentCubic(sa);
      const cb = segmentCubic(sb);
      count += record(
        ca,
        cb,
        `${String(ai)}:${String(s)}`,
        `${String(bi)}:${String(t)}`,
        cuts,
        eps,
      );
    }
  }
  return count;
}

/**
 * Record where a contour crosses itself.
 *
 * Two ways to do it, and both happen. A segment can loop on its own, which is
 * algebra rather than search — a curve cannot be subdivided against itself,
 * since every box overlaps its own. Two different segments of the same contour
 * cross the same way two contours do.
 *
 * Neighbours are compared like any other pair. They meet at the node they
 * share, and a meeting at the very end of a segment records no cut and counts
 * as nothing, which is what keeps every contour in the glyph from reporting a
 * crossing at each of its own corners.
 */
function selfMeetings(c: Contour, index: number, cuts: Map<string, number[]>, eps: number): number {
  let count = 0;

  for (let s = 0; s < segmentCount(c); s++) {
    const sa = segmentAt(c, s);
    if (sa === null) continue;

    const ca = segmentCubic(sa);

    const loop = selfIntersection(ca);
    if (loop !== null) {
      const one = add(cuts, `${String(index)}:${String(s)}`, loop.t1, ca, eps);
      const two = add(cuts, `${String(index)}:${String(s)}`, loop.t2, ca, eps);
      if (one || two) count += 1;
    }

    for (let t = s + 1; t < segmentCount(c); t++) {
      const sb = segmentAt(c, t);
      if (sb === null) continue;
      count += record(
        ca,
        segmentCubic(sb),
        `${String(index)}:${String(s)}`,
        `${String(index)}:${String(t)}`,
        cuts,
        eps,
      );
    }
  }
  return count;
}

/**
 * Note every place two curves meet, however they meet.
 *
 * Crossings come from the intersector. When it says the two lie along each other
 * instead — a bowl drawn flush against a stem, which has no finite set of
 * crossings — the ends of the shared stretch are used: each curve's ends
 * projected onto the other. Those are the only points where the shared stretch
 * begins and ends, and they are exactly what the boundary walk needs.
 */
function record(
  ca: Cubic,
  cb: Cubic,
  keyA: string,
  keyB: string,
  cuts: Map<string, number[]>,
  eps: number,
): number {
  const met = intersectCubics(ca, cb);
  if (met !== null) {
    let count = 0;
    for (const m of gathered(met, eps)) {
      const one = add(cuts, keyA, m.t1, ca, eps);
      const two = add(cuts, keyB, m.t2, cb, eps);
      if (one || two) count += 1;
    }
    return count;
  }

  let count = 0;
  for (const [from, onto, key] of [
    [ca, cb, keyB],
    [cb, ca, keyA],
  ] as const) {
    for (const end of [from.a, from.b]) {
      const landed = project(onto, end);
      if (landed.distance > eps) continue;
      if (add(cuts, key, landed.t, onto, eps)) count += 1;
    }
  }
  return count;
}

/**
 * A run of hits along one stretch of contact, reduced to what it means.
 *
 * Two curves that touch tangentially — an arch springing from a stem along its
 * edge — are not reported as one crossing. The search narrows on the contact
 * from both ends and comes back with a smear of hits down its length, every one
 * of them true and none of them the point anybody means. Splitting at all of
 * them leaves a dust of pieces shorter than the tolerance the rest of this works
 * to, and a boundary made of dust does not close.
 *
 * So hits that lie within a whisker of each other along the curve are gathered:
 * a smear no longer than the tolerance becomes the point in the middle of it,
 * and a longer one becomes its two ends, which is where the curves actually meet
 * and part.
 */
function gathered(met: readonly CurveMeeting[], eps: number): CurveMeeting[] {
  if (met.length < 2) return [...met];

  const sorted = [...met].sort((l, r) => l.t1 - r.t1);
  const out: CurveMeeting[] = [];
  let run: CurveMeeting[] = [sorted[0]!];

  const close = () => {
    const first = run[0]!;
    const last = run[run.length - 1]!;
    const apart = Math.hypot(last.point.x - first.point.x, last.point.y - first.point.y);
    if (apart <= eps) out.push(run[Math.floor(run.length / 2)]!);
    else out.push(first, last);
  };

  for (const hit of sorted.slice(1)) {
    const previous = run[run.length - 1]!;
    const gap = Math.hypot(hit.point.x - previous.point.x, hit.point.y - previous.point.y);
    if (gap <= eps) {
      run.push(hit);
      continue;
    }
    close();
    run = [hit];
  }
  close();

  return out;
}

/**
 * Note a place to split, and say whether it was one that had not been seen.
 *
 * An end of the segment is not a place to split: there is a node there already,
 * and the piece it would cut off has no length. Judged by where the point lands
 * rather than by how near the parameter is to nought or one, because the search
 * that found it works to a distance and the parameter it reports is only as
 * precise as the segment is long — every corner of a square would otherwise
 * record a crossing with the edge beside it.
 *
 * Two cuts at the same parameter are one cut. Two at the same *place* are not:
 * a curve that loops crosses itself at one point that it passes through twice,
 * and cutting only once there leaves the loop attached to the rest. The dust a
 * tangency leaves — a curve springing away along a straight edge, found again
 * and again as the search narrows — is dealt with where the pieces are made,
 * since a piece whose ends are the same place has nothing to contribute.
 */
function add(
  cuts: Map<string, number[]>,
  key: string,
  t: number,
  curve: Cubic,
  eps: number,
): boolean {
  if (!(t > 0 && t < 1)) return false;

  const p = evaluate(curve, t);
  if (Math.hypot(p.x - curve.a.x, p.y - curve.a.y) < eps) return false;
  if (Math.hypot(p.x - curve.b.x, p.y - curve.b.y) < eps) return false;

  const list = cuts.get(key) ?? [];
  if (list.some((seen) => sameVisit(curve, seen, t, p, eps))) return false;
  list.push(t);
  cuts.set(key, list);
  return true;
}

/**
 * Whether a cut has already been made at this place, on this pass of the curve.
 *
 * The same place is not always the same cut. A curve that loops crosses itself
 * at one point it passes through twice, and cutting there once would leave the
 * loop attached. What tells the two apart is what the curve does in between: on
 * one visit it stays put, and between two visits it goes somewhere else.
 */
function sameVisit(curve: Cubic, seen: number, t: number, p: Vec2, eps: number): boolean {
  if (Math.abs(seen - t) < 1e-5) return true;

  const before = evaluate(curve, seen);
  if (Math.hypot(before.x - p.x, before.y - p.y) > eps) return false;

  const between = evaluate(curve, (seen + t) / 2);
  return Math.hypot(between.x - p.x, between.y - p.y) <= eps;
}

/** Break a contour into the pieces between its crossings. */
function split(c: Contour, index: number, cuts: Map<string, number[]>, eps: number): Piece[] {
  const out: Piece[] = [];

  for (let i = 0; i < segmentCount(c); i++) {
    const segment = segmentAt(c, i);
    if (segment === null) continue;

    const whole = segmentCubic(segment);
    const line = segment.kind === "line";
    const ts = (cuts.get(`${String(index)}:${String(i)}`) ?? []).slice().sort((l, r) => l - r);
    const stops = [0, ...ts, 1];

    for (let k = 0; k + 1 < stops.length; k++) {
      const curve = subcurve(whole, stops[k]!, stops[k + 1]!);
      // A piece whose ends are the same place is a speck left by a tangency. It
      // has no side to be filled on and no direction to be walked in.
      if (near(curve.a, curve.b, eps)) continue;
      out.push({ curve, line });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// which pieces are on the boundary, and which way round they go
// ---------------------------------------------------------------------------

/**
 * The pieces that lie on the boundary of the union, each pointing so that the
 * ink is on its left.
 *
 * Filled on one side and empty on the other is what makes a piece boundary. A
 * piece with fill on both sides is buried inside the shape — which is what
 * becomes of the stretch two shapes share when they are drawn flush — and one
 * with fill on neither is a stray.
 *
 * Turning each survivor so the ink is on its left is what makes the walk
 * possible: every piece then agrees about which side it is guarding, whatever
 * direction the contour it came from happened to run, and the loops that come
 * out are oriented correctly without anybody having to decide afterwards.
 *
 * A piece that lies exactly along another — the two sides of a shared edge —
 * appears twice and is kept once.
 */
function onBoundary(pieces: readonly Piece[], outlines: readonly Vec2[][], eps: number): Piece[] {
  const kept: Piece[] = [];

  for (const piece of pieces) {
    const at = evaluate(piece.curve, 0.5);
    const along = tangent(piece.curve, 0.5) ?? {
      x: piece.curve.b.x - piece.curve.a.x,
      y: piece.curve.b.y - piece.curve.a.y,
    };
    const length = Math.hypot(along.x, along.y) || 1;
    const normal = { x: -along.y / length, y: along.x / length };

    const reach = PROBE * eps;
    const left = filled({ x: at.x + normal.x * reach, y: at.y + normal.y * reach }, outlines);
    const right = filled({ x: at.x - normal.x * reach, y: at.y - normal.y * reach }, outlines);
    if (left === right) continue;

    const facing = left ? piece : { curve: reverse(piece.curve), line: piece.line };
    if (kept.some((seen) => sameWay(seen, facing, eps))) continue;
    kept.push(facing);
  }

  return kept;
}

/** Whether two pieces run between the same places, through the same middle. */
function sameWay(a: Piece, b: Piece, eps: number): boolean {
  return (
    near(a.curve.a, b.curve.a, eps) &&
    near(a.curve.b, b.curve.b, eps) &&
    near(evaluate(a.curve, 0.5), evaluate(b.curve, 0.5), eps)
  );
}

const near = (p: Vec2, q: Vec2, eps: number): boolean => Math.hypot(p.x - q.x, p.y - q.y) < eps;

/**
 * How near counts as the same place, for this glyph.
 *
 * A fraction of the size of what is being drawn, with a floor for the very
 * small: see {@link SAME_PLACE}.
 */
function tolerance(contours: readonly Contour[]): number {
  let span = 0;
  for (const c of contours) {
    for (const n of c.nodes) span = Math.max(span, Math.abs(n.pt.x), Math.abs(n.pt.y));
  }
  return Math.max(JOIN, span * SAME_PLACE);
}

// ---------------------------------------------------------------------------
// walking the boundary
// ---------------------------------------------------------------------------

/**
 * Chain the surviving pieces into closed contours by following the boundary.
 *
 * Every piece has the ink on its left, so at each meeting point the piece to
 * take next is the one that keeps it there: of the pieces leaving that point,
 * the first one met when sweeping clockwise from the way we came in. That is
 * what tracing the edge of a shape means, and it is the part "whichever piece
 * starts nearest" cannot do — where four pieces meet at a tangency, three of
 * them start at the same place and nearness cannot choose between them.
 *
 * Points within a whisker of each other are one meeting point, so a crossing
 * found twice from two directions does not become two places that never quite
 * join up.
 */
function walk(pieces: readonly Piece[], ids: IdFactory, eps: number): Contour[] | null {
  const places: Vec2[] = [];
  const placeOf = (p: Vec2): number => {
    const found = places.findIndex((seen) => near(seen, p, eps));
    if (found >= 0) return found;
    places.push(p);
    return places.length - 1;
  };

  const starts = pieces.map((piece) => placeOf(piece.curve.a));
  const ends = pieces.map((piece) => placeOf(piece.curve.b));

  const leaving = new Map<number, number[]>();
  pieces.forEach((_, index) => {
    const list = leaving.get(starts[index]!) ?? [];
    list.push(index);
    leaving.set(starts[index]!, list);
  });

  const unused = new Set(pieces.keys());
  const loops: Contour[] = [];

  while (unused.size > 0) {
    const first = unused.values().next().value as number;
    unused.delete(first);

    const chain: number[] = [first];
    let at = first;

    for (;;) {
      if (ends[at] === starts[first]) break;

      const next = turn(pieces, leaving.get(ends[at]!) ?? [], at, unused);
      // A boundary that does not close means the crossings were not found
      // cleanly. Better to leave the glyph alone than to hand back a gap.
      if (next === null) return null;

      unused.delete(next);
      chain.push(next);
      at = next;
    }

    if (chain.length < 2) continue;
    loops.push(
      contourOf(
        chain.map((index) => pieces[index]!),
        ids,
        eps,
      ),
    );
  }

  return loops.length === 0 ? null : loops;
}

/**
 * The piece to follow, of those leaving the place this one arrives at.
 *
 * Swept clockwise from the direction we came in, so the ink stays on the left:
 * of everything leaving that point, take the one that turns furthest towards the
 * ink before any other. With two pieces meeting it is the only one there is;
 * with four, it is the whole of the answer.
 */
function turn(
  pieces: readonly Piece[],
  candidates: readonly number[],
  from: number,
  unused: ReadonlySet<number>,
): number | null {
  const arriving = direction(pieces[from]!.curve, "end");
  const back = Math.atan2(-arriving.y, -arriving.x);

  let best: number | null = null;
  let bestTurn = Infinity;

  for (const index of candidates) {
    if (!unused.has(index)) continue;
    const going = direction(pieces[index]!.curve, "start");
    // Clockwise from the way back, so a piece doubling straight back on itself
    // is the last resort rather than the first choice.
    let swept = back - Math.atan2(going.y, going.x);
    while (swept <= 1e-9) swept += Math.PI * 2;
    while (swept > Math.PI * 2) swept -= Math.PI * 2;

    if (swept < bestTurn) {
      bestTurn = swept;
      best = index;
    }
  }

  return best;
}

/** Which way a piece sets off, or arrives, allowing for a handle on the point. */
function direction(curve: Cubic, at: "start" | "end"): Vec2 {
  const t = at === "start" ? 0 : 1;
  const found = tangent(curve, t);
  if (found !== null && Math.hypot(found.x, found.y) > 1e-9) {
    return at === "start" ? found : found;
  }
  const away =
    at === "start"
      ? { x: curve.b.x - curve.a.x, y: curve.b.y - curve.a.y }
      : { x: curve.b.x - curve.a.x, y: curve.b.y - curve.a.y };
  return away;
}

/**
 * One closed contour out of a chain of pieces.
 *
 * The node types are read back from the geometry rather than carried through the
 * cutting: a piece can be walked either way round, so the node a piece starts at
 * is not always the node it was cut from. Handles that leave a node in one
 * straight line make it smooth, which is what it was before it was cut, and what
 * makes the result editable afterwards.
 */
function contourOf(chain: readonly Piece[], ids: IdFactory, eps: number): Contour {
  const nodes = chain.map((piece, i) => {
    const before = chain[(i - 1 + chain.length) % chain.length]!;
    const incoming = before.line ? null : before.curve.c2;
    const outgoing = piece.line ? null : piece.curve.c1;
    return node(ids.node(), piece.curve.a, {
      type: smooth(piece.curve.a, incoming, outgoing) ? "smooth" : "corner",
      in: incoming,
      out: outgoing,
    });
  });

  return contour(ids.contour(), tidy(nodes, eps), true);
}

/**
 * Drop nodes that sit in the middle of a straight run.
 *
 * Cutting at the ends of a shared stretch leaves a node where two edges lying
 * along each other stopped doing so, and that point is often in the middle of
 * what is now one straight edge — the union of two rectangles sharing a corner
 * comes out an L with eight corners rather than six. The shape is the same
 * either way; the extra points are litter, and litter is what a designer has to
 * clean up by hand afterwards.
 *
 * Only where nothing is lost: both sides straight, no handles, and the point on
 * the line between its neighbours.
 */
function tidy(nodes: readonly Node[], eps: number): Node[] {
  const kept = [...nodes];

  for (let i = kept.length - 1; i >= 0 && kept.length > 3; i--) {
    const here = kept[i]!;
    const before = kept[(i - 1 + kept.length) % kept.length]!;
    const after = kept[(i + 1) % kept.length]!;
    if (here.in !== null || here.out !== null) continue;
    if (before.out !== null || after.in !== null) continue;
    if (!onLine(before.pt, after.pt, here.pt, eps)) continue;
    kept.splice(i, 1);
  }

  return kept;
}

/** Whether `p` lies on the line from `a` to `b`, to within the join tolerance. */
function onLine(a: Vec2, b: Vec2, p: Vec2, eps: number): boolean {
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  if (span === 0) return false;
  const off = Math.abs((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)) / span;
  if (off > eps) return false;
  const along = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (span * span);
  return along > 0 && along < 1;
}

/** Whether two handles leave a point in one straight line, and opposite ways. */
function smooth(pt: Vec2, incoming: Vec2 | null, outgoing: Vec2 | null): boolean {
  if (incoming === null || outgoing === null) return false;

  const before = { x: pt.x - incoming.x, y: pt.y - incoming.y };
  const after = { x: outgoing.x - pt.x, y: outgoing.y - pt.y };
  const lb = Math.hypot(before.x, before.y);
  const la = Math.hypot(after.x, after.y);
  if (lb === 0 || la === 0) return false;

  const cross = (before.x * after.y - before.y * after.x) / (lb * la);
  const dot = (before.x * after.x + before.y * after.y) / (lb * la);
  return dot > 0 && Math.abs(cross) < 0.01;
}

// ---------------------------------------------------------------------------
// what is inside
// ---------------------------------------------------------------------------

/** Whether a point is inside the shape, by the non-zero rule. */
function filled(p: Vec2, outlines: readonly Vec2[][]): boolean {
  let winding = 0;
  for (const poly of outlines) winding += windingOf(p, poly);
  return winding !== 0;
}

/**
 * The winding number of a closed polygon about a point.
 *
 * Counting signed crossings of a ray rather than summing angles: the angle sum
 * is the definition and the crossing count is what survives arithmetic.
 */
function windingOf(p: Vec2, poly: readonly Vec2[]): number {
  let winding = 0;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;

    if (a.y <= p.y) {
      if (b.y > p.y && cross(a, b, p) > 0) winding += 1;
    } else if (b.y <= p.y && cross(a, b, p) < 0) {
      winding -= 1;
    }
  }
  return winding;
}

const cross = (a: Vec2, b: Vec2, p: Vec2): number =>
  (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);

/** A contour as a closed polygon, fine enough that the fill test is not fooled. */
function polygon(c: Contour): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i < segmentCount(c); i++) {
    const segment = segmentAt(c, i);
    if (segment === null) continue;
    const flat = flatten(segmentCubic(segment), 0.05);
    // Each piece ends where the next begins, so the shared point is dropped.
    points.push(...flat.slice(0, -1));
  }
  return points;
}
