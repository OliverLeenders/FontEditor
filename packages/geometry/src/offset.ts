import {
  type Cubic,
  cubic,
  curvature,
  evaluate,
  inflections,
  project,
  split,
  tangent,
  endTangent,
} from "./cubic.js";
import type { Vec2 } from "./vec2.js";

/**
 * Moving a curve sideways: the one thing in this package that cannot be exact.
 *
 * The offset of a cubic is not a cubic. It is an algebraic curve of degree ten,
 * and no amount of care with the handles will make one Bézier lie on it — so this
 * is the first operation here that answers "close enough, and here is how close".
 *
 * The approach is the standard one and it is standard because the alternatives
 * are worse: approximate a piece, measure how far the approximation strays from
 * the true offset, and cut the piece in half and try again where it strays too
 * far. What makes it cheap is that the first approximation is already good. The
 * offset of a circular arc *is* an arc, so a piece that is nearly an arc is
 * nearly right the moment its handles are scaled by how much the radius changed:
 * a curve of radius `r` offset by `d` has radius `r − d` on the side the centre
 * is on, and `1 − d·κ` is that ratio written with the curvature this package
 * already computes.
 *
 * Which side is which follows the sign convention {@link curvature} already
 * uses: positive `distance` moves the curve towards its own left, and the left
 * normal is the tangent turned a quarter-turn anticlockwise. A caller that means
 * "outwards" has to know which way its contour runs; see the contour-level
 * operation, which does.
 */

/**
 * How far the approximation may stray, in design units.
 *
 * A fiftieth of a unit on a thousand-unit em is a hundred times finer than the
 * grid a font is finally rounded to, so an offset drawn at this tolerance is
 * exact as far as the file is concerned. It is not free — every halving doubles
 * the number of curves — but the counting stays small because the first
 * approximation is good: a quarter-circle needs no subdivision at all.
 */
export const OFFSET_TOLERANCE = 0.02;

/** How many times a piece may be halved before the answer is accepted as it is. */
const MAX_DEPTH = 10;

/** How many points along a piece are asked how far the approximation strays. */
const CHECKS = 12;

/**
 * The left normal at `t`: the tangent turned a quarter-turn anticlockwise.
 *
 * `null` where there is no tangent — a cusp, or a handle pulled onto its own
 * point. There is no side to move towards there.
 */
export function leftNormal(s: Cubic, t: number): Vec2 | null {
  // At an end, the direction the curve leaves or arrives by even where the handle
  // there is retracted: a curve leaving a corner with one handle still has a side.
  const along = t === 0 ? endTangent(s, 0) : t === 1 ? endTangent(s, 1) : tangent(s, t);
  if (along === null) return null;
  const length = Math.hypot(along.x, along.y);
  if (length === 0 || !Number.isFinite(length)) return null;
  return { x: -along.y / length, y: along.x / length };
}

/**
 * A cubic moved `distance` to its left, as however many cubics that takes.
 *
 * Split at its inflections first. An inflection is where the curve stops turning
 * one way and starts turning the other, so the radius that the handle scaling is
 * derived from passes through infinity there — and a piece with one in the middle
 * is a piece where a single scaling is wrong at both ends. They are also where a
 * designer's curve changes character, so cutting there costs nothing anybody will
 * mind.
 *
 * An empty list where the curve has no direction to speak of: a point, or a curve
 * whose handles are retracted onto it. There is nothing to move sideways.
 */
export function offsetCubic(
  s: Cubic,
  distance: number,
  tolerance: number = OFFSET_TOLERANCE,
): Cubic[] {
  if (distance === 0) return [s];

  const stops = [0, ...inflections(s).filter((t) => t > 1e-6 && t < 1 - 1e-6), 1];
  const out: Cubic[] = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const piece = subrange(s, stops[i]!, stops[i + 1]!);
    if (piece === null) continue;
    out.push(...offsetPiece(piece, distance, tolerance, 0));
  }
  return out;
}

/** A sub-range of a curve, or `null` where it is too short to have a direction. */
function subrange(s: Cubic, from: number, to: number): Cubic | null {
  if (!(to > from)) return null;
  const [, rest] = split(s, from);
  const [piece] = split(rest, (to - from) / (1 - from));
  return piece;
}

/**
 * One piece, offset — halved and tried again while the answer strays too far.
 *
 * The recursion ends either because the approximation is good enough or because
 * the piece has been halved ten times, and the second case is not a failure to
 * report: a curve with a cusp in it has no offset anywhere near the cusp, and the
 * honest thing is to draw the rest of it well. What comes out there crosses
 * itself, and removing overlap is what takes that out.
 */
function offsetPiece(s: Cubic, distance: number, tolerance: number, depth: number): Cubic[] {
  const approximation = approximate(s, distance);
  if (
    approximation !== null &&
    (depth >= MAX_DEPTH || strays(s, approximation, distance) <= tolerance)
  ) {
    return [approximation];
  }
  if (depth >= MAX_DEPTH) return approximation === null ? [] : [approximation];

  const [before, after] = split(s, 0.5);
  return [
    ...offsetPiece(before, distance, tolerance, depth + 1),
    ...offsetPiece(after, distance, tolerance, depth + 1),
  ];
}

/**
 * The first guess: the ends moved along their normals, the handles scaled by how
 * much the radius changed there.
 *
 * `1 − d·κ` is the ratio between the offset radius and the original, and it is
 * also the ratio the handle wants because the handle length of an arc is
 * proportional to its radius. Where it comes out negative the curve turns tighter
 * than the distance being offset — the offset there is a cusp rather than a curve
 * — and a handle is not run backwards to describe it: it is held at nothing, and
 * the subdivision above finds the error and cuts the piece down until the cusp is
 * in a piece of its own.
 */
function approximate(s: Cubic, distance: number): Cubic | null {
  const startNormal = leftNormal(s, 0);
  const endNormal = leftNormal(s, 1);
  if (startNormal === null || endNormal === null) return null;

  const from = { x: s.a.x + startNormal.x * distance, y: s.a.y + startNormal.y * distance };
  const to = { x: s.b.x + endNormal.x * distance, y: s.b.y + endNormal.y * distance };

  const startScale = Math.max(0, 1 - distance * (curvature(s, 0) ?? 0));
  const endScale = Math.max(0, 1 - distance * (curvature(s, 1) ?? 0));

  const c1 = {
    x: from.x + (s.c1.x - s.a.x) * startScale,
    y: from.y + (s.c1.y - s.a.y) * startScale,
  };
  const c2 = {
    x: to.x + (s.c2.x - s.b.x) * endScale,
    y: to.y + (s.c2.y - s.b.y) * endScale,
  };

  const answer = cubic(from, c1, c2, to);
  return finite(answer) ? answer : null;
}

/**
 * How far the approximation is from the true offset, at its worst.
 *
 * Measured to the nearest point of the approximation rather than to the point at
 * the same parameter. The two curves are not parameterised alike — they cannot be
 * — and the distance at equal parameters would report an error that is mostly
 * disagreement about naming.
 */
function strays(s: Cubic, approximation: Cubic, distance: number): number {
  let worst = 0;
  for (let i = 1; i < CHECKS; i++) {
    const t = i / CHECKS;
    const normal = leftNormal(s, t);
    if (normal === null) return Infinity;

    const at = evaluate(s, t);
    const want = { x: at.x + normal.x * distance, y: at.y + normal.y * distance };
    worst = Math.max(worst, project(approximation, want).distance);
  }
  return worst;
}

/**
 * A circular arc as cubics, from `from` to `to` about `centre`.
 *
 * What a round join is made of. Ninety degrees at a time, because the standard
 * handle length for an arc — `4/3·tan(θ/4)` times the radius — is within a
 * thousandth of the circle at a quarter turn and visibly wide by a half turn.
 *
 * `anticlockwise` picks which way round, since two points on a circle name two
 * arcs and the caller is the one that knows which side the ink is on.
 */
export function arcCubics(centre: Vec2, from: Vec2, to: Vec2, anticlockwise: boolean): Cubic[] {
  const radius = Math.hypot(from.x - centre.x, from.y - centre.y);
  if (radius === 0 || !Number.isFinite(radius)) return [];

  const start = Math.atan2(from.y - centre.y, from.x - centre.x);
  const end = Math.atan2(to.y - centre.y, to.x - centre.x);

  let sweep = end - start;
  const turn = Math.PI * 2;
  if (anticlockwise && sweep < 0) sweep += turn;
  if (!anticlockwise && sweep > 0) sweep -= turn;
  if (Math.abs(sweep) < 1e-9) return [];

  // A hair under, because a quarter turn arrived at through two arctangents is
  // as likely to measure 1.0000000000000002 quarter turns as one, and rounding
  // that up draws a corner in two curves where one is exact.
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const step = sweep / steps;
  const handle = (4 / 3) * Math.tan(step / 4) * radius;

  const out: Cubic[] = [];
  for (let i = 0; i < steps; i++) {
    const a0 = start + step * i;
    const a1 = a0 + step;
    const p0 = { x: centre.x + radius * Math.cos(a0), y: centre.y + radius * Math.sin(a0) };
    const p1 = { x: centre.x + radius * Math.cos(a1), y: centre.y + radius * Math.sin(a1) };
    // The handles run along the tangents, which on a circle are the radii turned
    // a quarter-turn — in the direction of travel at the start, against it at the
    // end.
    out.push(
      cubic(
        p0,
        { x: p0.x - handle * Math.sin(a0), y: p0.y + handle * Math.cos(a0) },
        { x: p1.x + handle * Math.sin(a1), y: p1.y - handle * Math.cos(a1) },
        p1,
      ),
    );
  }
  return out;
}

const finite = (s: Cubic): boolean =>
  [s.a, s.c1, s.c2, s.b].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
