import {
  type Cubic,
  type Vec2,
  OFFSET_TOLERANCE,
  arcCubics,
  cubic,
  leftNormal,
  offsetCubic,
  tangent,
} from "@typewright/geometry";

import { type Contour, segmentAt, segmentCount, segmentCubic } from "./contour.js";
import { type CurvePiece, contourOfCurves } from "./curves.js";
import { contourWinding } from "./direction.js";
import type { IdFactory } from "./ids.js";

/**
 * Offsetting a contour: the same shape, fatter or thinner.
 *
 * What a designer reaches for it for is weight — a light drawn from a regular, a
 * stem thickened without redrawing it — and what makes it more than a curve
 * operation is the corners. Moving every piece of the outline sideways leaves the
 * pieces no longer touching at the corners they used to meet at, and what goes in
 * the gap is a decision: an arc, a spike, or a flat.
 *
 * The distance is given per axis, and not because anybody wants an oval pen here.
 * A type designer thickening a letter wants more weight on the stems than on the
 * thin parts of the curves, which is a horizontal distance larger than the
 * vertical one — and the sum of a shape and an ellipse is the sum of a squashed
 * shape and a circle, squashed back. One line of arithmetic, and it is the same
 * line the elliptical nib will want.
 */

/** What goes in the gap at a corner where the offset outline has come apart. */
export type OffsetJoin = "round" | "miter" | "bevel";

/**
 * How long a mitre may get before it is given up as a bevel.
 *
 * As a multiple of the offset distance. A mitre on a sharp corner runs away to a
 * spike — the limit is `1/sin(θ/2)`, which is already four at twenty-nine degrees
 * and unbounded as the corner closes — and a spike four times the weight you
 * asked for is not a corner anybody drew. Every stroking library has this number
 * and most of them put it at four.
 */
const MITRE_LIMIT = 4;

/** How far apart two ends must be before the corner between them needs filling. */
const JOINED = 1e-6;

export type OffsetOptions = {
  /** Outwards is positive: a bigger shape, whichever way the contour runs. */
  readonly x: number;
  readonly y: number;
  readonly join?: OffsetJoin;
  readonly tolerance?: number;
};

/**
 * A contour moved outwards by `x` horizontally and `y` vertically.
 *
 * Positive is outwards whichever way the contour was drawn, which is the only
 * behaviour worth having: a designer asking for ten more units does not want to
 * know, or think about, which direction the points happen to run in. Inwards is
 * negative, and a counter — which runs the other way — thins by the same number
 * that thickens the shape around it, because outwards for a hole is inwards on
 * the page.
 *
 * `null` where there is nothing to do or nothing sensible to do: an open contour,
 * a contour with no area, no distance at all, or one distance positive and the
 * other negative, which is not a shape that can be summed with.
 *
 * The result may cross itself — an inward offset of a curve that turns tighter
 * than the distance always does — and it is handed back crossing itself. Removing
 * overlap is a separate operation that already knows how, and doing it here would
 * make one undo step out of two decisions.
 */
export function offsetContour(c: Contour, ids: IdFactory, options: OffsetOptions): Contour | null {
  // A skeleton is a path, not the edge of the ink, and moving it outwards would be
  // moving the line the pen is drawn along. Its weight is the nib's.
  if (!c.closed || c.nodes.length < 2 || c.nib !== undefined) return null;
  if (options.x === 0 && options.y === 0) return null;
  if (options.x * options.y < 0) return null;
  // One axis of nothing is a pen with no width in that direction, which is a
  // different operation — see the roadmap's phase 34 — and not this one.
  if (options.x === 0 || options.y === 0) return null;

  const winding = contourWinding(c);
  if (winding === 0) return null;

  // Positive `distance` moves a curve towards its own left, and the left of a
  // contour drawn anticlockwise is its inside. So outwards is the other way for
  // one and this way for the other, and that is the whole of what the drawing
  // direction has to say here.
  const outward = winding > 0 ? -1 : 1;

  const wide = Math.abs(options.x);
  const tall = Math.abs(options.y);
  const sign = Math.sign(options.x);
  const join = options.join ?? "round";
  const tolerance = options.tolerance ?? OFFSET_TOLERANCE;

  // An ellipse is a squashed circle, so a contour squashed the other way can be
  // offset by a circle and squashed back. Done in one place: the isotropic case
  // is the same arithmetic with both scales at one.
  const squash = { x: 1 / wide, y: 1 / tall };
  const squashed = scaleContour(c, squash);
  const curves = offsetRun(squashed, sign * outward, join, tolerance / Math.max(wide, tall));
  if (curves === null) return null;

  return contourOfCurves(
    curves.map((piece) => ({
      curve: scaleCubic(piece.curve, { x: wide, y: tall }),
      line: piece.line,
    })),
    ids,
  );
}

/** A piece of the offset outline, and whether it was drawn as a straight line. */
type Piece = CurvePiece;

/**
 * Every segment of a contour offset, with the corners between them filled in.
 *
 * Walked as a ring: each segment's offset is laid down, and then the corner
 * between it and the next one, so the pieces come out in the order the boundary
 * runs and the last corner closes the loop.
 */
function offsetRun(
  c: Contour,
  distance: number,
  join: OffsetJoin,
  tolerance: number,
): Piece[] | null {
  const count = segmentCount(c);
  if (count === 0) return null;

  const runs: Piece[][] = [];
  for (let i = 0; i < count; i++) {
    const segment = segmentAt(c, i);
    if (segment === null) return null;

    const whole = segmentCubic(segment);
    if (segment.kind === "line") {
      const moved = offsetLine(whole, distance);
      runs.push(moved === null ? [] : [{ curve: moved, line: true }]);
      continue;
    }
    runs.push(offsetCubic(whole, distance, tolerance).map((curve) => ({ curve, line: false })));
  }

  // Laid down in order, each run's corner with the one before it settled as it
  // arrives, and the ring closed by settling the corner between the last and the
  // first. Settling can shorten the pieces either side of it, which is why this
  // builds a list it can reach back into rather than a chain of answers.
  const out: Piece[] = [];
  for (const here of runs) {
    if (here.length === 0) continue;
    if (out.length === 0) {
      out.push(...here);
      continue;
    }
    out.push(...settle(c, out, out.length - 1, here, distance, join));
  }
  if (out.length === 0) return null;

  // The last corner, which is the one that closes the ring: the same operation
  // with the first piece as the piece that follows.
  const closing = settle(c, out, out.length - 1, [out[0]!], distance, join);
  // What comes back ends with the first piece, shortened if the corner trimmed it,
  // so it goes back where it came from; anything in front of it is what the corner
  // put between the two, and that closes the ring.
  out[0] = closing[closing.length - 1]!;
  out.push(...closing.slice(0, closing.length - 1));

  return out;
}

/**
 * Settle the corner between the piece at `at` and the run that follows it.
 *
 * Returns the run, with anything the corner needs in front of it. Both sides may
 * be shortened in place: an offset folded over itself at a corner is two pieces
 * that cross, and where they cross is where the outline turns, so cutting them
 * both back to it is the answer rather than something inserted between them.
 *
 * Only for two straight sides. Two curves crossing meet at a parameter that has
 * to be searched for, and the answer there is to leave the fold as a crossing and
 * let the union take it out — which it does properly, and which costs nothing
 * because a fold that needs trimming has a crossing either way.
 */
function settle(
  c: Contour,
  out: Piece[],
  at: number,
  run: readonly Piece[],
  distance: number,
  join: OffsetJoin,
): Piece[] {
  const previous = out[at]!;
  const head = run[0]!;
  const end = previous.curve.b;
  const start = head.curve.a;
  if (Math.hypot(start.x - end.x, start.y - end.y) < JOINED) return [...run];

  const arriving = tangent(previous.curve, 1);
  const leaving = tangent(head.curve, 0);
  const turn =
    arriving === null || leaving === null ? 0 : arriving.x * leaving.y - arriving.y * leaving.x;

  if (turn * distance > 0 && previous.line && head.line && arriving !== null && leaving !== null) {
    const crossing = mitrePoint(end, arriving, start, leaving);
    if (
      crossing !== null &&
      Math.hypot(crossing.x - end.x, crossing.y - end.y) <= MITRE_LIMIT * Math.abs(distance)
    ) {
      out[at] = { curve: straight(previous.curve.a, crossing), line: true };
      const rest = [...run];
      rest[0] = { curve: straight(crossing, head.curve.b), line: true };
      return rest;
    }
  }

  return [...cornerBetween(c, previous.curve, head.curve, distance, join), ...run];
}

/** A straight segment offset, which is exact: the same line, moved. */
function offsetLine(s: Cubic, distance: number): Cubic | null {
  const normal = leftNormal(s, 0.5);
  if (normal === null) return null;
  const shift = (p: Vec2): Vec2 => ({
    x: p.x + normal.x * distance,
    y: p.y + normal.y * distance,
  });
  return cubic(shift(s.a), shift(s.c1), shift(s.c2), shift(s.b));
}

/**
 * What goes between two offset pieces that no longer meet.
 *
 * Always something. A contour is a ring of nodes with a segment between each
 * pair, so there is no such thing as a gap in one: leaving two ends apart does not
 * draw a gap, it draws the piece before them stretched to reach — which is the
 * offset silently redrawn. A straight line between the two is the least this can
 * answer, and every case below either fills the corner properly or falls back to
 * it.
 *
 * Which side the corner comes apart on follows from the turn. The outside of a
 * left turn is the right-hand side, so the ends part when the offset went the
 * opposite way from the turn and fold over each other when it went the same way.
 *
 * A fold is trimmed where it can be. The two offset pieces cross, and the point
 * they cross at is where the outline should turn — for two straight sides that is
 * exact, and it is what makes an inward offset of a rectangle another rectangle
 * rather than a pinwheel. Where the crossing is too far away to be that corner,
 * the fold is left as a crossing for the union to take out.
 *
 * Nothing at all for a corner that is not one: two pieces that still meet are a
 * smooth join, which is most of them.
 */
function cornerBetween(
  c: Contour,
  from: Cubic,
  to: Cubic,
  distance: number,
  join: OffsetJoin,
): Piece[] {
  const end = from.b;
  const start = to.a;
  if (Math.hypot(start.x - end.x, start.y - end.y) < JOINED) return [];

  const flat = [{ curve: straight(end, start), line: true }];

  const arriving = tangent(from, 1);
  const leaving = tangent(to, 0);
  if (arriving === null || leaving === null) return flat;

  const spike = mitrePoint(end, arriving, start, leaving);
  const turn = arriving.x * leaving.y - arriving.y * leaving.x;
  const reach = Math.abs(distance);

  // Folded over rather than opened out. The crossing is the corner, and cutting
  // both pieces back to it is what an inward offset of a corner means.
  if (turn * distance > 0) {
    if (spike === null) return flat;
    if (Math.hypot(spike.x - end.x, spike.y - end.y) > MITRE_LIMIT * reach) return flat;
    return [
      { curve: straight(end, spike), line: true },
      { curve: straight(spike, start), line: true },
    ];
  }

  if (join === "bevel") return flat;

  // The corner of the original, which is where both offset ends stand at the
  // distance from — so it is the centre of the arc that joins them.
  const centre = cornerPoint(c, end, start, distance);
  if (join === "round") {
    if (centre === null) return flat;
    const arc = arcCubics(centre, end, start, turn > 0);
    return arc.length === 0 ? flat : arc.map((curve) => ({ curve, line: false }));
  }

  if (spike === null) return flat;
  const from0 = centre ?? end;
  if (Math.hypot(spike.x - from0.x, spike.y - from0.y) > MITRE_LIMIT * reach) return flat;
  return [
    { curve: straight(end, spike), line: true },
    { curve: straight(spike, start), line: true },
  ];
}

/**
 * The point both offset ends were moved away from.
 *
 * The node they were cut at, found by which of the contour's own points is the
 * right distance from both. Read from the contour rather than worked out from the
 * two ends, because two points and a radius name two centres and only one of them
 * is the corner that was there.
 */
function cornerPoint(c: Contour, end: Vec2, start: Vec2, distance: number): Vec2 | null {
  const reach = Math.abs(distance);
  let best: Vec2 | null = null;
  let bestError = Infinity;
  for (const n of c.nodes) {
    const one = Math.abs(Math.hypot(end.x - n.pt.x, end.y - n.pt.y) - reach);
    const two = Math.abs(Math.hypot(start.x - n.pt.x, start.y - n.pt.y) - reach);
    const error = one + two;
    if (error < bestError) {
      bestError = error;
      best = n.pt;
    }
  }
  return bestError <= reach * 0.05 + 1e-6 ? best : null;
}

/** Where the two tangent lines meet, which is the tip of a mitre. */
function mitrePoint(end: Vec2, arriving: Vec2, start: Vec2, leaving: Vec2): Vec2 | null {
  const denominator = arriving.x * leaving.y - arriving.y * leaving.x;
  if (Math.abs(denominator) < 1e-12) return null;

  const dx = start.x - end.x;
  const dy = start.y - end.y;
  const along = (dx * leaving.y - dy * leaving.x) / denominator;
  const point = { x: end.x + arriving.x * along, y: end.y + arriving.y * along };
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}

const straight = (a: Vec2, b: Vec2): Cubic =>
  cubic(
    a,
    { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
    { x: a.x + ((b.x - a.x) * 2) / 3, y: a.y + ((b.y - a.y) * 2) / 3 },
    b,
  );

function scaleContour(c: Contour, by: Vec2): Contour {
  const scale = (p: Vec2): Vec2 => ({ x: p.x * by.x, y: p.y * by.y });
  return {
    ...c,
    nodes: c.nodes.map((n) => ({
      ...n,
      pt: scale(n.pt),
      in: n.in === null ? null : scale(n.in),
      out: n.out === null ? null : scale(n.out),
    })),
  };
}

const scaleCubic = (s: Cubic, by: Vec2): Cubic =>
  cubic(
    { x: s.a.x * by.x, y: s.a.y * by.y },
    { x: s.c1.x * by.x, y: s.c1.y * by.y },
    { x: s.c2.x * by.x, y: s.c2.y * by.y },
    { x: s.b.x * by.x, y: s.b.y * by.y },
  );
