import {
  type Cubic,
  type Vec2,
  evaluate,
  flatten,
  intersectCubics,
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
 * a rectangle laid across a stem, an ellipse cut by a knife. Two shapes that
 * overlap fill correctly on screen under the non-zero rule and are still wrong
 * in a font: the overlap is a seam that shows in a rasteriser at small sizes,
 * and it is the first thing any production check complains about.
 *
 * The approach is to be exact where it shows and approximate where it does not.
 * Curves are split at their true crossings and every piece that survives is a
 * genuine subcurve, so the handles a designer placed come back untouched. The
 * only thing flattening is used for is deciding whether a point is inside the
 * shape, which wants robustness far more than it wants precision.
 *
 * The rule for keeping a piece is the whole of the algorithm: a piece is on the
 * boundary of the union exactly when the shape is filled on one side of it and
 * empty on the other. That is true of an outer edge and of the edge of a
 * counter alike, which is why nothing here needs to know what a counter is —
 * and of a contour laid across itself, which is why one contour needs no
 * separate treatment from two.
 */

export type OverlapResult = {
  readonly glyph: Glyph;
  /** How many crossings between contours were resolved. Zero means none were. */
  readonly crossings: number;
};

/** How far to either side of a piece the fill is sampled, in design units. */
const PROBE = 0.05;

/** How near two points must be to count as the same place when joining pieces. */
const JOIN = 0.05;

/**
 * Remove overlap from a glyph.
 *
 * A glyph with nothing overlapping comes back unchanged, with a count of zero:
 * the same object, so a caller can tell "cleaned" from "already clean" by
 * identity as well as by the number.
 *
 * `null` means the outlines could not be resolved — two edges lying along each
 * other have no crossing points to split at, and a guess there would silently
 * reshape the letter. Refusing and doing nothing are different answers, and a
 * caller that showed the same message for both would be lying about one.
 */
export function removeOverlap(g: Glyph, ids: IdFactory): OverlapResult | null {
  const closed = g.contours.filter((c) => c.closed && c.nodes.length >= 2);
  if (closed.length === 0) return { glyph: g, crossings: 0 };

  // Where every contour meets every other, and where each meets itself. The two
  // are the same problem: a stroke laid back across its own path leaves exactly
  // the seam that two overlapping shapes do, and the rule for which pieces
  // survive cannot tell them apart either.
  const cuts = new Map<string, number[]>();
  let crossings = 0;

  for (const [index, c] of closed.entries()) {
    const found = selfMeetings(c, index, cuts);
    if (found === null) return null;
    crossings += found;
  }

  for (let i = 0; i < closed.length; i++) {
    for (let j = i + 1; j < closed.length; j++) {
      const found = meetings(closed[i]!, closed[j]!, i, j, cuts);
      if (found === null) return null;
      crossings += found;
    }
  }

  if (crossings === 0) return { glyph: g, crossings: 0 };

  const pieces: Piece[] = [];
  for (const [index, c] of closed.entries()) {
    pieces.push(...split(c, index, cuts, ids));
  }

  // Flattened once, and used only to answer whether a point is covered.
  const outlines = closed.map(polygon);
  const kept = pieces.filter((piece) => onBoundary(piece, outlines));
  if (kept.length === 0) return null;

  const loops = join(kept, ids);
  if (loops === null) return null;

  const others = g.contours.filter((c) => !closed.includes(c));
  return { glyph: { ...g, contours: [...others, ...loops] }, crossings };
}

/** A stretch of one contour between two crossings, with the curve it follows. */
type Piece = {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly node: Node;
  /** The handle arriving at `to`, which belongs to whatever node comes next. */
  readonly incoming: Vec2 | null;
  /** A point on the piece, away from its ends, for asking which side is filled. */
  readonly middle: Vec2;
  readonly normal: Vec2;
};

/** Record where two contours cross, keyed by contour and segment. */
function meetings(
  a: Contour,
  b: Contour,
  ai: number,
  bi: number,
  cuts: Map<string, number[]>,
): number | null {
  let count = 0;

  for (let s = 0; s < segmentCount(a); s++) {
    const sa = segmentAt(a, s);
    if (sa === null) continue;

    for (let t = 0; t < segmentCount(b); t++) {
      const sb = segmentAt(b, t);
      if (sb === null) continue;

      const ca = segmentCubic(sa);
      const cb = segmentCubic(sb);
      const met = intersectCubics(ca, cb);
      // Two edges lying along each other rather than crossing. There is no set
      // of points to split at, so there is no honest answer to give.
      if (met === null) return null;

      for (const m of met) {
        const one = add(cuts, `${String(ai)}:${String(s)}`, m.t1, ca);
        const two = add(cuts, `${String(bi)}:${String(t)}`, m.t2, cb);
        if (one || two) count += 1;
      }
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
function selfMeetings(c: Contour, index: number, cuts: Map<string, number[]>): number | null {
  let count = 0;

  for (let s = 0; s < segmentCount(c); s++) {
    const sa = segmentAt(c, s);
    if (sa === null) continue;

    const ca = segmentCubic(sa);

    const loop = selfIntersection(ca);
    if (loop !== null) {
      const one = add(cuts, `${String(index)}:${String(s)}`, loop.t1, ca);
      const two = add(cuts, `${String(index)}:${String(s)}`, loop.t2, ca);
      if (one || two) count += 1;
    }

    for (let t = s + 1; t < segmentCount(c); t++) {
      const sb = segmentAt(c, t);
      if (sb === null) continue;

      const cb = segmentCubic(sb);
      const met = intersectCubics(ca, cb);
      if (met === null) return null;

      for (const m of met) {
        const one = add(cuts, `${String(index)}:${String(s)}`, m.t1, ca);
        const two = add(cuts, `${String(index)}:${String(t)}`, m.t2, cb);
        if (one || two) count += 1;
      }
    }
  }
  return count;
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
 */
function add(cuts: Map<string, number[]>, key: string, t: number, curve: Cubic): boolean {
  if (!(t > 0 && t < 1)) return false;

  const p = evaluate(curve, t);
  if (Math.hypot(p.x - curve.a.x, p.y - curve.a.y) < JOIN) return false;
  if (Math.hypot(p.x - curve.b.x, p.y - curve.b.y) < JOIN) return false;

  const list = cuts.get(key) ?? [];
  if (list.some((seen) => Math.abs(seen - t) < 1e-5)) return false;
  list.push(t);
  cuts.set(key, list);
  return true;
}

/** Break a contour into the pieces between its crossings. */
function split(c: Contour, index: number, cuts: Map<string, number[]>, ids: IdFactory): Piece[] {
  const out: Piece[] = [];

  for (let i = 0; i < segmentCount(c); i++) {
    const segment = segmentAt(c, i);
    if (segment === null) continue;

    const whole = segmentCubic(segment);
    const line = segment.kind === "line";
    const start = c.nodes[i]!;
    const ts = (cuts.get(`${String(index)}:${String(i)}`) ?? []).slice().sort((l, r) => l - r);
    const stops = [0, ...ts, 1];

    for (let k = 0; k + 1 < stops.length; k++) {
      const part = subcurve(whole, stops[k]!, stops[k + 1]!);
      const mid = midpointOf(part);

      out.push({
        from: part.a,
        to: part.b,
        // The first piece keeps the node's own type and incoming handle; a piece
        // that begins at a crossing begins at a corner, because the outline on
        // the far side of it belonged to a different contour.
        node: node(ids.node(), part.a, {
          type: k === 0 ? start.type : "corner",
          in: k === 0 ? start.in : line ? null : null,
          out: line ? null : part.c1,
        }),
        incoming: line ? null : part.c2,
        middle: mid.point,
        normal: mid.normal,
      });
    }
  }

  return out;
}

/**
 * The middle of a piece and the direction square to it, for probing either side.
 *
 * Taken at the curve's own halfway point rather than from a flattened copy. A
 * straight piece flattens to its two ends, and the "middle" of two points is one
 * of the ends — which is a crossing, the one place where which side is filled
 * has no answer.
 */
function midpointOf(part: Cubic): { point: Vec2; normal: Vec2 } {
  const point = evaluate(part, 0.5);
  const along = tangent(part, 0.5) ?? {
    x: part.b.x - part.a.x,
    y: part.b.y - part.a.y,
  };
  const reach = Math.hypot(along.x, along.y) || 1;
  return { point, normal: { x: -along.y / reach, y: along.x / reach } };
}

/**
 * Whether a piece lies on the boundary of the union.
 *
 * Filled on one side and empty on the other. A piece with fill on both sides is
 * buried inside the shape, and one with fill on neither is a stray.
 */
function onBoundary(piece: Piece, outlines: readonly Vec2[][]): boolean {
  const left = {
    x: piece.middle.x + piece.normal.x * PROBE,
    y: piece.middle.y + piece.normal.y * PROBE,
  };
  const right = {
    x: piece.middle.x - piece.normal.x * PROBE,
    y: piece.middle.y - piece.normal.y * PROBE,
  };
  return filled(left, outlines) !== filled(right, outlines);
}

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

/**
 * Chain the surviving pieces back into closed contours.
 *
 * Joined by where they end rather than by what they belonged to: at a crossing
 * the outline leaves one contour and continues along another, and which one is
 * exactly what the piece that starts there answers.
 */
function join(pieces: readonly Piece[], ids: IdFactory): Contour[] | null {
  const unused = new Set(pieces.keys());
  const loops: Contour[] = [];

  const nearest = (p: Vec2, from: Set<number>): number | null => {
    let best: number | null = null;
    let bestGap = JOIN;
    for (const index of from) {
      const gap = Math.hypot(pieces[index]!.from.x - p.x, pieces[index]!.from.y - p.y);
      if (gap < bestGap) {
        bestGap = gap;
        best = index;
      }
    }
    return best;
  };

  while (unused.size > 0) {
    const first = unused.values().next().value as number;
    unused.delete(first);

    const chain: Piece[] = [pieces[first]!];
    let at = pieces[first]!;

    for (;;) {
      // Back where it started: the loop is closed.
      if (Math.hypot(at.to.x - pieces[first]!.from.x, at.to.y - pieces[first]!.from.y) < JOIN)
        break;

      const next = nearest(at.to, unused);
      // A piece whose end meets nothing means the boundary does not close, which
      // happens when the crossings were not found cleanly. Better to leave the
      // glyph alone than to hand back an outline with a gap in it.
      if (next === null) return null;

      unused.delete(next);
      chain.push(pieces[next]!);
      at = pieces[next]!;
    }

    if (chain.length < 2) continue;

    const nodes = chain.map((piece, i) => {
      const before = chain[(i - 1 + chain.length) % chain.length]!;
      return { ...piece.node, in: before.incoming };
    });
    loops.push(contour(ids.contour(), nodes, true));
  }

  return loops.length === 0 ? null : loops;
}
