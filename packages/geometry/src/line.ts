import { COLLINEAR_EPS, PARALLEL_EPS, isNegligible } from "./epsilon.js";
import { type Vec2, addScaled, cross, length, sub } from "./vec2.js";

/** Which side of a directed line a point falls on. */
export type Side = -1 | 0 | 1;

/**
 * Which side of the directed line `a → b` the point `p` lies on.
 *
 * In y-up design space `1` means left of the direction of travel, `-1` means
 * right, and `0` means on the line to within a scale-relative tolerance. `0` is
 * also returned when `a` and `b` coincide, since then there is no line.
 */
export function sideOf(a: Vec2, b: Vec2, p: Vec2, eps = COLLINEAR_EPS): Side {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const c = cross(ab, ap);
  const scaleRef = length(ab) * length(ap);
  if (scaleRef === 0) return 0;
  if (isNegligible(c, scaleRef, eps)) return 0;
  return c > 0 ? 1 : -1;
}

/**
 * True when `p` and `q` lie strictly on the same side of the line `a → b`.
 *
 * "Strictly" is the point: a point *on* the line is not on the same side as
 * anything, so this returns `false` if either point is collinear. That boundary
 * case is real — it is a curve whose handle sits exactly on its chord — and the
 * caller should name it rather than have it silently absorbed.
 *
 * The prototype compared the two side values directly, which reported two
 * collinear points as being on the same side as each other.
 */
export function sameSide(a: Vec2, b: Vec2, p: Vec2, q: Vec2, eps = COLLINEAR_EPS): boolean {
  const sp = sideOf(a, b, p, eps);
  if (sp === 0) return false;
  return sp === sideOf(a, b, q, eps);
}

/**
 * Intersection of the infinite line through `a1, a2` with the infinite line
 * through `b1, b2`.
 *
 * Returns `null` when the lines are parallel, coincident, or when either pair of
 * points is too close together to define a direction. Parallelism is judged by
 * the sine of the angle between the directions, so the test holds at any scale.
 *
 * The prototype returned `b2` on a zero determinant — a plausible-looking point
 * that is not the answer, which then propagated into handle positions.
 */
export function intersectLines(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null {
  const u = sub(a2, a1);
  const v = sub(b2, b1);
  const lu = length(u);
  const lv = length(v);
  if (lu === 0 || lv === 0) return null;

  const denom = cross(u, v);
  if (isNegligible(denom, lu * lv, PARALLEL_EPS)) return null;

  const s = cross(sub(b1, a1), v) / denom;
  if (!Number.isFinite(s)) return null;

  const result = addScaled(a1, u, s);
  return Number.isFinite(result.x) && Number.isFinite(result.y) ? result : null;
}

/**
 * Perpendicular distance from `p` to the infinite line through `a` and `b`.
 * Returns `null` when `a` and `b` coincide.
 */
export function distanceToLine(a: Vec2, b: Vec2, p: Vec2): number | null {
  const ab = sub(b, a);
  const len = length(ab);
  if (len === 0) return null;
  return Math.abs(cross(ab, sub(p, a))) / len;
}

/**
 * Distance from `p` to the *finite* segment between `a` and `b`, measured to
 * the nearest endpoint when `p` falls beyond either end.
 *
 * Distinct from {@link distanceToLine}, which extends the line infinitely. Hit
 * testing wants this one: a point far off the end of a Tunni line is not near
 * the Tunni line, however close it sits to its extension.
 */
export function distanceToSegment(a: Vec2, b: Vec2, p: Vec2): number {
  const ab = sub(b, a);
  const lenSq = ab.x * ab.x + ab.y * ab.y;
  if (lenSq === 0) return length(sub(p, a));
  const ap = sub(p, a);
  const t = Math.min(1, Math.max(0, (ab.x * ap.x + ab.y * ap.y) / lenSq));
  return length(sub(p, addScaled(a, ab, t)));
}

/**
 * Scalar projection of `p` onto the line `a → b`, expressed as a fraction of
 * that segment: `0` at `a`, `1` at `b`. Returns `null` when `a` and `b`
 * coincide.
 *
 * Values outside [0, 1] mean `p` projects beyond the segment, and the sign is
 * meaningful — this is what lets a handle scale be read as a signed λ rather
 * than an unsigned length ratio.
 */
export function projectOntoLine(a: Vec2, b: Vec2, p: Vec2): number | null {
  const ab = sub(b, a);
  const lenSq = ab.x * ab.x + ab.y * ab.y;
  if (lenSq === 0) return null;
  const ap = sub(p, a);
  return (ab.x * ap.x + ab.y * ap.y) / lenSq;
}
