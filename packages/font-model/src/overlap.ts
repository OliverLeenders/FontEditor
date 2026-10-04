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
} from "@typewright/geometry";

import {
  type Contour,
  contour,
  reverseContour,
  segmentAt,
  segmentCount,
  segmentCubic,
} from "./contour.js";
import { corneredContour, hasContinuousCorners } from "./corner.js";
import { contourWinding, correctDirections } from "./direction.js";
import type { Glyph } from "./glyph.js";
import type { ContourId, IdFactory } from "./ids.js";
import { type Node, node } from "./node.js";
import { unionByPolygons } from "./polygon-union.js";
import { isEmptyContour } from "./simplify.js";

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
 *    Where those ends are nodes of both contours — two squares set side by side,
 *    sharing a whole edge — there is nothing to cut either, and what says the
 *    drawing is not already its own union is that the shared stretch has ink on
 *    both sides of it. See {@link Flush}.
 *  - **Shapes that touch tangentially** — an arch leaving a stem along its edge.
 *    That produces a knot of near-identical crossings, so points that land
 *    within a whisker of each other are treated as one place.
 *  - **More than two edges meeting at a point**, which both of the above
 *    produce. Chaining by "which piece starts nearest" cannot answer that; the
 *    walk below picks by *angle*, which is what tracing a boundary means.
 */

export type OverlapResult = {
  readonly glyph: Glyph;
  /**
   * How many places the contours met and had to be resolved. Zero means none
   * were, and the glyph comes back as it went in.
   *
   * Usually crossings. A stretch two contours share, with ink on both sides of
   * it, is one place too: it crosses nothing and still has to go, because it is
   * inside the shape the two of them cover.
   */
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

/** How many times a piece with no ink either side is asked again, an eighth as far each time. */
const THIN_TRIES = 4;

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
 * Remove overlap from a glyph, or from named contours of it.
 *
 * A glyph with nothing overlapping comes back unchanged, with a count of zero:
 * the same object, so a caller can tell "cleaned" from "already clean" by
 * identity as well as by the number.
 *
 * `only` narrows the working set. Everything outside it is left exactly as it
 * was drawn and exactly where it was — which is the whole point of asking for a
 * few contours rather than the glyph: a stem drawn as two strokes is merged
 * while the counter beside it stays a separate shape, and a bowl being fitted
 * to a stem is not swallowed by it a moment too early. The union of a subset is
 * the same operation over a shorter list, so nothing below knows the difference.
 *
 * `null` means the outlines could not be resolved. It is the answer of last
 * resort — a boundary that will not close means the crossings were not found
 * cleanly, and handing back an outline with a gap in it would be worse than
 * handing back nothing.
 */
export function removeOverlap(
  g: Glyph,
  ids: IdFactory,
  only: ReadonlySet<ContourId> | null = null,
): OverlapResult | null {
  // An open contour has no inside, and a contour of one node has no outline, so
  // neither can take part; both are carried through untouched, the same as a
  // contour the caller did not name.
  // A skeleton is not ink — it is the path a pen is drawn along — so joining it to
  // the outlines around it would be joining a line to a shape. Its ink is worked
  // out elsewhere, and unioned there.
  const taken = (c: Contour): boolean =>
    c.closed && c.nodes.length >= 2 && c.nib === undefined && (only === null || only.has(c.id));

  // Continuous corners are joined as they are drawn, rounded. Where nothing
  // crosses, the glyph comes back as it was, corners and all: there was nothing to
  // join, and rounding them into points would be an edit nobody asked for.
  const drawn = withCornersDrawn(g, taken);
  if (drawn !== g) {
    const joined = removeOverlap(drawn, ids, only);
    return joined === null || joined.crossings > 0 ? joined : { glyph: g, crossings: 0 };
  }

  const closed = g.contours.filter(taken);
  if (closed.length === 0) return { glyph: g, crossings: 0 };

  const eps = tolerance(closed);

  // Where every contour meets every other, and where each meets itself. The two
  // are the same problem: a stroke laid back across its own path leaves exactly
  // the seam that two overlapping shapes do, and the rule for which pieces
  // survive cannot tell them apart either.
  const cuts = new Map<string, number[]>();
  const flush: Flush[] = [];
  let crossings = 0;

  for (const [index, c] of closed.entries()) {
    crossings += selfMeetings(c, index, cuts, flush, eps);
  }

  for (let i = 0; i < closed.length; i++) {
    for (let j = i + 1; j < closed.length; j++) {
      crossings += meetings(closed[i]!, closed[j]!, i, j, cuts, flush, eps);
    }
  }

  // Flattened at most once, and used only to answer whether a point is covered.
  // Behind a function because a glyph with nothing overlapping is the common
  // case — the exporter takes this union over every glyph on the way out — and
  // that case should not pay for flattening it.
  let flattened: Vec2[][] | null = null;
  const outlines = (): Vec2[][] => (flattened ??= closed.map(polygon));

  if (crossings === 0) {
    // Nothing to split, which is not the same as nothing to do: contours set
    // flush against each other share a stretch that ends on their own nodes. It
    // has to go if it is buried, and has to stay if it is not — the inside edge
    // of a counter drawn flush against the outside of the letter is a shared
    // stretch that is genuinely part of the outline.
    const buried = flush.filter((f) => insideOnBothSides(f, outlines(), eps)).length;
    if (buried === 0) return { glyph: g, crossings: 0 };
    crossings = buried;
  }

  const pieces: Piece[] = [];
  for (const [index, c] of closed.entries()) pieces.push(...split(c, index, cuts, eps));

  const kept = onBoundary(pieces, outlines(), eps);
  // Where the union of curves cannot close the boundary — edges lying all but on
  // top of each other, which it cannot sort into buried and not — the polygon
  // union settles it, refitted; see unionByPolygons.
  const loops = (kept.length === 0 ? null : walk(kept, ids, eps)) ?? unionByPolygons(closed, ids);
  if (loops === null) return null;

  // The union lands where the working set began, and everything else keeps the
  // order it was drawn in. Order is not geometry — the fill does not depend on
  // it — but it is written into a `.glif` and read back, so a save should not
  // shuffle the contours a person did not ask about.
  const at = g.contours.findIndex(taken);
  const after = g.contours.slice(at + 1).filter((c) => !taken(c));
  const contours = [...g.contours.slice(0, at), ...loops, ...after];

  return { glyph: { ...g, contours }, crossings };
}

/**
 * Whether two contours meet: cross, or run along each other for a stretch.
 *
 * The question a caller asks before deciding what to hand the union. A component
 * cannot be joined to a contour while it is still a reference, so something has
 * to become outlines first — and that is worth doing only for the components that
 * take part. Everything else stays a reference, which is what a composite is for.
 *
 * The same search the union does, stopped as soon as it finds anything. Whether
 * the meeting is one the union would *change* is a further question, about ink,
 * and it is answered where the union answers it: a contour that merely sits flush
 * against another without being buried is still a contour that meets it.
 */
export function contoursMeet(a: Contour, b: Contour): boolean {
  const eps = tolerance([a, b]);
  const cuts = new Map<string, number[]>();
  const flush: Flush[] = [];
  const crossings = meetings(a, b, 0, 1, cuts, flush, eps);
  return crossings > 0 || flush.length > 0;
}

/**
 * What to do with two sets of contours, beyond joining them.
 *
 * Named for what is kept rather than for how it is done: `subtract` leaves what
 * the target covers and the tool does not, `intersect` leaves what both cover,
 * and `exclude` leaves what exactly one of them covers.
 */
export type SetOperation = "subtract" | "intersect" | "exclude";

/**
 * How an operation ended.
 *
 * Four endings rather than a glyph or `null`, because the three that are not a
 * result are all worth saying out loud and none of them is a failure of the
 * arithmetic. Shapes that do not overlap have nothing to subtract from each
 * other; an operation that would leave nothing is almost always a mistake about
 * which shape was the tool, and handing back an empty glyph would be a poor way
 * to find out. `refused` is the union's own last resort: a boundary that will
 * not close.
 */
export type CombineOutcome =
  | { readonly kind: "done"; readonly glyph: Glyph; readonly places: number }
  | { readonly kind: "apart" }
  | { readonly kind: "empty" }
  | { readonly kind: "refused" };

/**
 * Subtract, intersect or exclude one set of contours against the rest.
 *
 * `tool` names the contours being applied; every other closed contour is what
 * they are applied to. Both sides take part in the cutting, so a tool that
 * crosses itself or a target drawn as two overlapping strokes is resolved on the
 * way past — which is what makes these operations usable on real drawings rather
 * than on pairs of tidy shapes.
 *
 * The machinery is the union's, and the only thing that differs is which region
 * is being traced. Every piece of every contour is cut at the crossings, and a
 * piece is kept when the region is on one side of it and not the other:
 *
 *  - **union** — covered by either
 *  - **subtract** — covered by the target and not by the tool
 *  - **intersect** — covered by both
 *  - **exclude** — covered by exactly one
 *
 * The pieces are then pointed so the region is on their left and chained, so the
 * result comes out oriented: the boundary of a hole a subtraction cut runs the
 * opposite way from the outline around it without anybody having to reverse it.
 *
 * The target keeps its counters, because both sides are asked by the non-zero
 * rule rather than contour by contour: a bowl and its counter are covered and
 * not covered exactly as they were, and a tool laid across the counter cuts
 * nothing there because there was nothing there.
 */
export function combineContours(
  g: Glyph,
  ids: IdFactory,
  op: SetOperation,
  tool: ReadonlySet<ContourId>,
): CombineOutcome {
  const taken = (c: Contour): boolean => c.closed && c.nodes.length >= 2 && c.nib === undefined;
  // As drawn, continuous corners rounded; see removeOverlap.
  const drawn = withCornersDrawn(g, taken);
  if (drawn !== g) return combineContours(drawn, ids, op, tool);
  const closed = g.contours.filter(taken);

  const tools = closed.filter((c) => tool.has(c.id));
  const targets = closed.filter((c) => !tool.has(c.id));
  // One side or the other empty: there is no pair to operate on, and an
  // operation between a shape and nothing is not a thing anybody meant.
  if (tools.length === 0 || targets.length === 0) return { kind: "apart" };

  const eps = tolerance(closed);
  const cuts = new Map<string, number[]>();
  const flush: Flush[] = [];
  let places = 0;

  for (const [index, c] of closed.entries()) places += selfMeetings(c, index, cuts, flush, eps);
  for (let i = 0; i < closed.length; i++) {
    for (let j = i + 1; j < closed.length; j++) {
      places += meetings(closed[i]!, closed[j]!, i, j, cuts, flush, eps);
    }
  }

  const toolOutlines = tools.map(polygon);
  const targetOutlines = targets.map(polygon);
  const inTool = (p: Vec2): boolean => filled(p, toolOutlines);
  const inTarget = (p: Vec2): boolean => filled(p, targetOutlines);

  // Shapes that only sit near each other have nothing to do here, and saying so
  // is better than the alternatives: a subtraction would quietly delete the
  // tool, and an intersection would quietly delete everything.
  if (!interact(tools, targets, toolOutlines, targetOutlines, eps)) return { kind: "apart" };

  const inResult = (p: Vec2): boolean => {
    const target = inTarget(p);
    const cutter = inTool(p);
    if (op === "subtract") return target && !cutter;
    if (op === "intersect") return target && cutter;
    return target !== cutter;
  };

  const pieces: Piece[] = [];
  for (const [index, c] of closed.entries()) pieces.push(...split(c, index, cuts, eps));

  const kept = onBoundaryOf(pieces, inResult, eps);
  if (kept.length === 0) return { kind: "empty" };

  const loops = walk(kept, ids, eps);
  if (loops === null) return { kind: "refused" };

  // Where the first of the contours that took part was, so the glyph's order is
  // disturbed as little as it can be — open contours keep their places around it.
  const at = g.contours.findIndex(taken);
  const after = g.contours.slice(at + 1).filter((c) => !taken(c));
  const contours = [...g.contours.slice(0, at), ...loops, ...after];

  return { kind: "done", glyph: { ...g, contours }, places };
}

/**
 * Whether two sets of contours overlap in area, rather than merely lie about in
 * the same glyph.
 *
 * Three ways they can. Their boundaries cross, which the search has already
 * found; the tool is swallowed by the target, which is how a hole is cut and has
 * no crossings at all; or the target is swallowed by the tool. The last two are
 * asked with a point known to be inside one, tested against the other.
 */
function interact(
  tools: readonly Contour[],
  targets: readonly Contour[],
  toolOutlines: readonly Vec2[][],
  targetOutlines: readonly Vec2[][],
  eps: number,
): boolean {
  // Crossings between the two sides, and only between them: a tool that crosses
  // itself says nothing about whether it reaches the target. Asked on a map of
  // its own, because this is a question rather than a decision to cut anything.
  for (const one of tools) {
    for (const other of targets) {
      if (meetings(one, other, 0, 1, new Map(), [], eps) > 0) return true;
    }
  }

  for (const poly of toolOutlines) {
    const p = somewhereInside(poly);
    if (p !== null && filled(p, targetOutlines)) return true;
  }
  for (const poly of targetOutlines) {
    const p = somewhereInside(poly);
    if (p !== null && filled(p, toolOutlines)) return true;
  }

  // What is left is shapes whose boundaries touch without crossing — flush
  // against each other, or meeting at a point. They share no area, so there is
  // nothing for one to take out of the other.
  return false;
}

/**
 * A point strictly inside a polygon, or `null` for one with no inside.
 *
 * The middle of the first stretch a horizontal line through the polygon spends
 * inside it. A centroid is not good enough — the centroid of a `C` is in the gap
 * — and the answer has to be inside or the containment test above is worse than
 * no test.
 */
function somewhereInside(poly: readonly Vec2[]): Vec2 | null {
  if (poly.length < 3) return null;

  let low = Infinity;
  let high = -Infinity;
  for (const p of poly) {
    low = Math.min(low, p.y);
    high = Math.max(high, p.y);
  }
  if (!(high > low)) return null;

  const y = (low + high) / 2;
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    if (a.y === b.y) continue;
    const lower = Math.min(a.y, b.y);
    const upper = Math.max(a.y, b.y);
    if (y < lower || y >= upper) continue;
    xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  if (xs.length < 2) return null;

  xs.sort((l, r) => l - r);
  const from = xs[0]!;
  const to = xs[1]!;
  return to > from ? { x: (from + to) / 2, y } : null;
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

/**
 * A stretch of boundary two curves share, rather than cross.
 *
 * A point along the middle of it and the direction it runs, which is all that is
 * needed to ask the question that matters: is there ink on both sides? If there
 * is, the stretch is inside what the contours cover together and the drawing is
 * not its own union, however few crossings it has.
 *
 * The middle rather than an end. An end of a shared stretch is a place where
 * several edges meet, and a probe there answers about whichever of them it
 * happens to land nearest.
 */
type Flush = {
  readonly at: Vec2;
  readonly along: Vec2;
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
  flush: Flush[],
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
        flush,
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
function selfMeetings(
  c: Contour,
  index: number,
  cuts: Map<string, number[]>,
  flush: Flush[],
  eps: number,
): number {
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
        flush,
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
 *
 * Those ends are not always somewhere to cut. Two squares set side by side share
 * a whole edge, and the ends of it are corners both of them already have, so
 * every projection lands on a node and nothing is split. The stretch is noted in
 * `flush` regardless, because whether it should be there at all is a question
 * about ink rather than about cuts, and it is asked once the outlines are to
 * hand.
 */
function record(
  ca: Cubic,
  cb: Cubic,
  keyA: string,
  keyB: string,
  cuts: Map<string, number[]>,
  flush: Flush[],
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
  const landed = new Map<Cubic, number[]>();
  for (const [from, onto, key] of [
    [ca, cb, keyB],
    [cb, ca, keyA],
  ] as const) {
    for (const end of [from.a, from.b]) {
      const found = project(onto, end);
      if (found.distance > eps) continue;
      landed.set(onto, [...(landed.get(onto) ?? []), found.t]);
      if (add(cuts, key, found.t, onto, eps)) count += 1;
    }
  }

  // One record for the stretch, from whichever curve has both of its ends: the
  // two curves describe the same piece of boundary, and probing it twice would
  // count one shared edge as two.
  for (const [onto, ts] of landed) {
    const stretch = shared(onto, ts, eps);
    if (stretch === null) continue;
    flush.push(stretch);
    break;
  }

  return count;
}

/**
 * The middle of the stretch two curves share, from where one of them was landed
 * on, or `null` where there is no stretch.
 *
 * Two landings a whisker apart are one place rather than a stretch — which is
 * what a pair of curves that merely kiss reports, and what the intersector also
 * gives up on when it cannot separate them. A stretch has to be long enough to
 * have a middle and two sides.
 */
function shared(onto: Cubic, ts: readonly number[], eps: number): Flush | null {
  if (ts.length < 2) return null;

  const low = Math.min(...ts);
  const high = Math.max(...ts);
  const from = evaluate(onto, low);
  const to = evaluate(onto, high);
  if (near(from, to, eps)) return null;

  const middle = (low + high) / 2;
  return {
    at: evaluate(onto, middle),
    along: tangent(onto, middle) ?? { x: to.x - from.x, y: to.y - from.y },
  };
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
  return onBoundaryOf(pieces, (p) => filled(p, outlines), eps);
}

/**
 * The same, for a region described by something other than "covered by any of
 * these contours".
 *
 * Which region is being traced is the whole of the difference between the four
 * operations. A piece is on the boundary of a region when the region is on one
 * side of it and not the other, and it is pointed so the region is on its left —
 * neither of those facts knows or cares whether the region is a union, what is
 * left after a subtraction, or what two shapes have in common.
 */
function onBoundaryOf(
  pieces: readonly Piece[],
  inside: (p: Vec2) => boolean,
  eps: number,
): Piece[] {
  const kept: Piece[] = [];

  for (const piece of pieces) {
    const at = evaluate(piece.curve, 0.5);
    const along = tangent(piece.curve, 0.5) ?? {
      x: piece.curve.b.x - piece.curve.a.x,
      y: piece.curve.b.y - piece.curve.a.y,
    };
    const length = Math.hypot(along.x, along.y) || 1;
    const normal = { x: -along.y / length, y: along.x / length };

    // Outside on both sides means the region is thinner there than the probe
    // reaches — a stroke near where its pen pinches it to nothing — since a piece
    // of a region's edge always has the region on one side. Asked again closer in,
    // until one side finds it. Inside on both sides is a buried piece, and is not
    // asked again: closer in is where coincident edges' fuzz is.
    let reach = PROBE * eps;
    let left = inside({ x: at.x + normal.x * reach, y: at.y + normal.y * reach });
    let right = inside({ x: at.x - normal.x * reach, y: at.y - normal.y * reach });
    // A stretch drawn out and straight back along itself has nothing either side
    // at any distance that is not arithmetic, and is no edge at all: it is not
    // asked again.
    const spike =
      !left && !right && pieces.some((other) => other !== piece && reversedTwin(other, piece, eps));
    for (let i = 0; i < THIN_TRIES && !left && !right && !spike; i++) {
      reach /= 8;
      left = inside({ x: at.x + normal.x * reach, y: at.y + normal.y * reach });
      right = inside({ x: at.x - normal.x * reach, y: at.y - normal.y * reach });
    }
    if (left === right) continue;

    const facing = left ? piece : { curve: reverse(piece.curve), line: piece.line };
    if (kept.some((seen) => sameWay(seen, facing, eps))) continue;
    kept.push(facing);
  }

  return kept;
}

/** Whether one piece is another drawn the other way: the same ends swapped, and the same middle. */
function reversedTwin(a: Piece, b: Piece, eps: number): boolean {
  return (
    near(a.curve.a, b.curve.b, eps) &&
    near(a.curve.b, b.curve.a, eps) &&
    near(evaluate(a.curve, 0.5), evaluate(b.curve, 0.5), eps)
  );
}

/**
 * Whether a shared stretch has ink on both sides of it.
 *
 * The same probe {@link onBoundary} uses to decide whether a piece is boundary
 * at all, asked of a stretch no crossing was found on. Ink on both sides means
 * the stretch is inside what the contours cover together, so it is a seam and
 * the drawing is not its own union; ink on one side means it is part of the
 * outline and there is nothing to resolve.
 */
function insideOnBothSides(stretch: Flush, outlines: readonly Vec2[][], eps: number): boolean {
  const length = Math.hypot(stretch.along.x, stretch.along.y) || 1;
  const normal = { x: -stretch.along.y / length, y: stretch.along.x / length };
  const reach = PROBE * eps;

  const left = filled(
    { x: stretch.at.x + normal.x * reach, y: stretch.at.y + normal.y * reach },
    outlines,
  );
  const right = filled(
    { x: stretch.at.x - normal.x * reach, y: stretch.at.y - normal.y * reach },
    outlines,
  );
  return left && right;
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

/**
 * A glyph drawn for the non-zero rule, as outlines this editor fills the same.
 *
 * A font file's outlines are filled by which way they wind: two contours that
 * run the same way are ink where they overlap, and one inside another the same
 * way round is ink too. This editor fills by nesting — a contour inside another
 * is a counter, whichever way it was drawn — so a glyph built of overlapping
 * pieces, read in as it is, is shown and exported with holes it never had.
 *
 * Where the two rules agree, which is nearly every glyph, the glyph comes back
 * as it went in: the same object. Where they do not, its overlaps are joined
 * as the file's own rule fills them and whatever is buried in ink is taken out,
 * which leaves outlines that nest the way they wind. The contours that draw
 * nothing go too, there being no telling what they were once it is redrawn.
 *
 * `null` where that could not be done — the union could not be made, or what
 * it made is not the ink the file has — and the glyph is best left as it is.
 */
export function nestedAsWound(g: Glyph, ids: IdFactory): Glyph | null {
  const outline = (c: Contour): boolean =>
    c.closed && c.nodes.length >= 2 && c.nib === undefined && !isEmptyContour(c);
  const drawn = g.contours.filter(outline);
  if (plainlyWindsAsItNests(drawn) || windsAsItNests(drawn)) return g;

  const others = g.contours.filter((c) => !c.closed || c.nib !== undefined);
  const good = (redrawn: readonly Contour[]): boolean =>
    sameInk(drawn, redrawn, HAIRLINES) && windsAsItNests(redrawn);

  // By the union of curves, which keeps every point it does not have to cut.
  const joined = removeOverlap({ ...g, contours: drawn }, ids);
  if (joined !== null) {
    // What is left that is not the edge of anything: a shape wholly inside
    // another that winds the same way crosses nothing, so the union had
    // nothing to do with it, and it is ink on both sides.
    const outlines = joined.glyph.contours.map(polygon);
    const eps = tolerance(joined.glyph.contours);
    const edges = joined.glyph.contours.filter((c) => isEdge(c, outlines, eps));
    if (good(edges)) return { ...g, contours: [...edges, ...others] };
  }

  // And where that came back wrong, by the union of polygons, which is not
  // exact — every curve is fitted again — and does not lose its way. It joins
  // what turns the way an outer contour turns here, so a file drawn the other
  // way round is turned first.
  let turning = 0;
  for (const c of drawn) turning += contourWinding(c);
  const facing = turning < 0 ? drawn.map(reverseContour) : drawn;
  const fitted = unionByPolygons(facing, ids);
  if (fitted !== null && good(fitted)) return { ...g, contours: [...fitted, ...others] };

  return null;
}

/**
 * How many places in a hundred a union may differ from what it was made of and
 * still be that ink: the hairlines between shapes set flush, which it closes.
 */
export const HAIRLINES = 2;

/**
 * The same question, answered from the points alone, for the font that is as
 * fonts are made: no contour across another, and each wound so that the two
 * rules fill it alike.
 *
 * By the polygon through each contour's points, with no curve flattened. That
 * is not the contour — a curve bulges past its chord — but it winds the way the
 * contour does and holds what the contour holds, near enough to ask of it what
 * is asked of the contours: whether there is ink to each side of every one
 * under the one rule as under the other. Asked first because the exact
 * answer flattens every curve of every glyph, which for a font of four thousand
 * is seconds on the way in to learn that nothing was wrong.
 *
 * Only of contours that keep clear of each other: each wholly inside another
 * or wholly outside it. Where two cross, the rules differ in the part they
 * share, which is beside no contour's first side, and that is the exact
 * answer's to find.
 *
 * `false` is not "they differ" but "ask properly".
 */
function plainlyWindsAsItNests(contours: readonly Contour[]): boolean {
  const polys = contours.map((c) => c.nodes.map((n) => n.pt));
  // Each one's box, handles and all: what the contour cannot be outside of.
  const boxes = contours.map((c) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of c.nodes) {
      for (const p of [n.pt, n.in, n.out]) {
        if (p === null) continue;
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    return { minX, minY, maxX, maxY };
  });

  // Each one's way round, how many of the others it is inside, and the two
  // places a hair to either side of the middle of its first side.
  const turns: number[] = [];
  const sides: (readonly [Vec2, Vec2])[] = [];
  const depths: number[] = [];
  for (const [i, poly] of polys.entries()) {
    let area = 0;
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k]!;
      const q = poly[(k + 1) % poly.length]!;
      area += p.x * q.y - q.x * p.y;
    }
    const a = poly[0]!;
    const b = poly[1]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (area === 0 || length === 0) return false;

    let depth = 0;
    for (const [j, other] of polys.entries()) {
      if (j === i) continue;
      // All of its points inside the other, or none of them: one or two is a
      // contour across another.
      let inside = 0;
      for (const p of poly) if (windingOf(p, other) !== 0) inside += 1;
      if (inside !== 0 && inside !== poly.length) return false;
      if (inside !== 0) depth += 1;
      else {
        // None of its points inside the other, and none of the other's inside
        // it: clear of each other if their boxes are, and not known to be if
        // they are not. Two shapes can cross with every corner of each outside
        // the other, and one can sit in the bay of another, where what counts
        // as inside is the fill's to say and not this guess's.
        let holds = 0;
        for (const p of other) if (windingOf(p, poly) !== 0) holds += 1;
        const mine = boxes[i]!;
        const theirs = boxes[j]!;
        const apart =
          mine.maxX < theirs.minX ||
          theirs.maxX < mine.minX ||
          mine.maxY < theirs.minY ||
          theirs.maxY < mine.minY;
        if (holds === 0 && !apart) return false;
      }
    }

    const at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const nx = (-(b.y - a.y) / length) * HAIR;
    const ny = ((b.x - a.x) / length) * HAIR;
    sides.push([
      { x: at.x + nx, y: at.y + ny },
      { x: at.x - nx, y: at.y - ny },
    ]);
    depths.push(depth);
    turns.push(area > 0 ? 1 : -1);
  }

  // Turned by nesting, a contour runs one way at an even depth and the other at
  // an odd: whether each already does, and so whether it would be turned.
  const kept = turns.map((turn, i) => (turn === (depths[i]! % 2 === 0 ? 1 : -1) ? 1 : -1));

  for (const pair of sides) {
    for (const p of pair) {
      let asWound = 0;
      let asNested = 0;
      for (const [j, poly] of polys.entries()) {
        const w = windingOf(p, poly);
        asWound += w;
        asNested += kept[j]! * w;
      }
      if ((asWound !== 0) !== (asNested !== 0)) return false;
    }
  }
  return true;
}

/** How far to either side of a contour the cheap answer looks, in units. */
const HAIR = 0.01;

/**
 * Whether filling these by nesting is filling them as they wind: whether,
 * turned by their nesting, they are the ink they were.
 */
function windsAsItNests(contours: readonly Contour[]): boolean {
  const turned = correctDirections(contours);
  if (turned === contours) return true;

  // The same contours, some of them turned: so each is flattened once, and how
  // it winds round a place is asked once and counted both ways. Flattened more
  // coarsely than they were to be turned: there are fewer sides to ask, and
  // asking is most of this.
  const reach = PROBE * tolerance(contours);
  const outlines = contours.map((c, i) => ({ ...boxed(c, reach / 2), turned: turned[i] !== c }));
  const same = (p: Vec2): boolean => {
    let asWound = 0;
    let asNested = 0;
    for (const o of outlines) {
      if (p.x < o.minX || p.x > o.maxX || p.y < o.minY || p.y > o.maxY) continue;
      const w = windingOf(p, o.points);
      asWound += w;
      asNested += o.turned ? -w : w;
    }
    return (asWound !== 0) === (asNested !== 0);
  };
  for (const c of contours) {
    for (const p of besides(c, reach)) if (!same(p)) return false;
  }
  return true;
}

/** A contour flattened to within a tolerance, with the box it lies in. */
function boxed(
  c: Contour,
  within: number,
): { points: Vec2[]; minX: number; minY: number; maxX: number; maxY: number } {
  const points: Vec2[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < segmentCount(c); i++) {
    const segment = segmentAt(c, i);
    if (segment === null) continue;
    const flat = flatten(segmentCubic(segment), within);
    // Each piece ends where the next begins, so the shared point is dropped.
    for (let k = 0; k < flat.length - 1; k++) {
      const p = flat[k]!;
      points.push(p);
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { points, minX, minY, maxX, maxY };
}

/** The places a little to each side of a contour, at three along each of its segments. */
function besides(c: Contour, reach: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < segmentCount(c); i++) {
    const segment = segmentAt(c, i);
    if (segment === null) continue;
    const cubic = segmentCubic(segment);
    for (const t of [0.25, 0.5, 0.75]) {
      const before = evaluate(cubic, t - 0.05);
      const after = evaluate(cubic, t + 0.05);
      const length = Math.hypot(after.x - before.x, after.y - before.y);
      // A segment of no length has no side to be on.
      if (length === 0) continue;
      const at = evaluate(cubic, t);
      const nx = (-(after.y - before.y) / length) * reach;
      const ny = ((after.x - before.x) / length) * reach;
      out.push({ x: at.x + nx, y: at.y + ny }, { x: at.x - nx, y: at.y - ny });
    }
  }
  return out;
}

/**
 * Whether two sets of outlines are the same ink, by the non-zero rule.
 *
 * Asked of the ink rather than of the outlines, which may be cut quite
 * differently and fill the same. Every region of either has some contour of
 * one of them for an edge, so each side of every contour of both is asked, at
 * three places along each segment, and the two have to agree at all of them.
 *
 * It is what says a union did what a union does. That is worth asking: the
 * search for where curves cross can come back with a glyph in pieces, and
 * neither a font read in nor a font written out should take its word.
 *
 * `allowed` is how many places in a hundred may differ and the ink still be
 * called the same: none, for a question about the drawing as it stands; a few,
 * of a union, which closes the hairline between two shapes set flush.
 */
export function sameInk(a: readonly Contour[], b: readonly Contour[], allowed = 0): boolean {
  const closed = (c: Contour): boolean => c.closed && c.nodes.length >= 2;
  const one = a.filter(closed);
  const other = b.filter(closed);
  const reach = PROBE * tolerance([...one, ...other]);

  // Flattened more coarsely than a union wants, and each with its box: a place
  // outside a contour's box is not wound round by it.
  const first = one.map((c) => boxed(c, reach / 2));
  const second = other.map((c) => boxed(c, reach / 2));
  const inked = (p: Vec2, outlines: typeof first): boolean => {
    let winding = 0;
    for (const o of outlines) {
      if (p.x < o.minX || p.x > o.maxX || p.y < o.minY || p.y > o.maxY) continue;
      winding += windingOf(p, o.points);
    }
    return winding !== 0;
  };

  let asked = 0;
  let differ = 0;
  for (const c of [...one, ...other]) {
    for (const p of besides(c, reach)) {
      asked += 1;
      if (inked(p, first) !== inked(p, second)) {
        differ += 1;
        if (allowed === 0) return false;
      }
    }
  }
  return differ * 100 <= asked * allowed;
}

/** Whether a contour has ink on one side of it and none on the other. */
function isEdge(c: Contour, outlines: readonly Vec2[][], eps: number): boolean {
  const reach = PROBE * eps;
  for (let i = 0; i < segmentCount(c); i++) {
    const segment = segmentAt(c, i);
    if (segment === null) continue;
    const cubic = segmentCubic(segment);
    const before = evaluate(cubic, 0.45);
    const after = evaluate(cubic, 0.55);
    const length = Math.hypot(after.x - before.x, after.y - before.y);
    // A segment of no length has no side to be on; the next one has.
    if (length === 0) continue;
    const at = evaluate(cubic, 0.5);
    const nx = (-(after.y - before.y) / length) * reach;
    const ny = ((after.x - before.x) / length) * reach;
    return (
      filled({ x: at.x + nx, y: at.y + ny }, outlines) !==
      filled({ x: at.x - nx, y: at.y - ny }, outlines)
    );
  }
  return false;
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
 * The glyph with the continuous corners of the contours an operation takes drawn
 * in, as ordinary points; the same glyph where there are none.
 */
function withCornersDrawn(g: Glyph, taken: (c: Contour) => boolean): Glyph {
  if (!g.contours.some((c) => taken(c) && hasContinuousCorners(c))) return g;
  return {
    ...g,
    contours: g.contours.map((c) => (taken(c) && hasContinuousCorners(c) ? corneredContour(c) : c)),
  };
}
