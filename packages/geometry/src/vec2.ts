import { COINCIDENT_EPS, isNegligible } from "./epsilon.js";

/**
 * A point or vector in design units.
 *
 * Design space is **y-up**, the convention every font format uses: the baseline
 * is y = 0 and ascenders have positive y. Screen space is y-down, and the two
 * are bridged in exactly one place — the view transform in the render package.
 * Nothing in this package knows that pixels exist.
 *
 * Plain readonly data, deliberately: a `Vec2` survives `structuredClone`, JSON
 * round-trips, and Worker message passing unchanged, which is what lets the
 * document be snapshotted and patched without special cases.
 */
export type Vec2 = { readonly x: number; readonly y: number };

/** An axis-aligned rectangle in design units. */
export type Rect = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(p: Vec2, q: Vec2): Vec2 {
  return { x: p.x + q.x, y: p.y + q.y };
}

export function sub(p: Vec2, q: Vec2): Vec2 {
  return { x: p.x - q.x, y: p.y - q.y };
}

export function scale(p: Vec2, k: number): Vec2 {
  return { x: p.x * k, y: p.y * k };
}

/**
 * `p + q * k`, the fused form. Common enough in curve evaluation to be worth
 * naming, and it avoids one intermediate allocation per call.
 */
export function addScaled(p: Vec2, q: Vec2, k: number): Vec2 {
  return { x: p.x + q.x * k, y: p.y + q.y * k };
}

export function dot(p: Vec2, q: Vec2): number {
  return p.x * q.x + p.y * q.y;
}

/**
 * The z-component of the 3D cross product, also called the perp-dot product.
 *
 * Its sign says which way `q` turns relative to `p`: positive when `q` is
 * counter-clockwise from `p`, which in y-up design space reads as "to the left".
 */
export function cross(p: Vec2, q: Vec2): number {
  return p.x * q.y - p.y * q.x;
}

export function length(p: Vec2): number {
  return Math.hypot(p.x, p.y);
}

export function distance(p: Vec2, q: Vec2): number {
  return Math.hypot(q.x - p.x, q.y - p.y);
}

export function distanceSq(p: Vec2, q: Vec2): number {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  return dx * dx + dy * dy;
}

export function lerp(p: Vec2, q: Vec2, t: number): Vec2 {
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
}

export function midpoint(p: Vec2, q: Vec2): Vec2 {
  return { x: (p.x + q.x) * 0.5, y: (p.y + q.y) * 0.5 };
}

/** Rotated a quarter turn counter-clockwise. Useful for offsets and normals. */
export function perpendicular(p: Vec2): Vec2 {
  return { x: -p.y, y: p.x };
}

/** Unit vector in the direction of `p`, or `null` when `p` has no direction. */
export function normalize(p: Vec2): Vec2 | null {
  const len = length(p);
  if (len === 0 || !Number.isFinite(len)) return null;
  return { x: p.x / len, y: p.y / len };
}

/**
 * `p` scaled so that it is `targetLength` away from `origin`, keeping its
 * direction. Returns `null` when `p` and `origin` coincide, because there is no
 * direction to preserve.
 *
 * The prototype's `stretch_to_length` returned the input unchanged in that case,
 * which silently produced a handle of the wrong length.
 */
export function stretchToLength(origin: Vec2, p: Vec2, targetLength: number): Vec2 | null {
  const d = sub(p, origin);
  const len = length(d);
  if (len === 0 || !Number.isFinite(len)) return null;
  return addScaled(origin, d, targetLength / len);
}

/**
 * `p` rotated by `angle` radians (counter-clockwise, y-up) about `center`.
 *
 * The prototype's version dropped the coordinate factors and computed
 * `cos(a) - sin(a)` rather than `x·cos(a) - y·sin(a)`. It was unreachable there;
 * it will not be once components and transforms exist.
 */
export function rotate(p: Vec2, center: Vec2, angle: number): Vec2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

/** Signed angle in radians from `p` to `q`, in (-π, π]. */
export function angleBetween(p: Vec2, q: Vec2): number {
  return Math.atan2(cross(p, q), dot(p, q));
}

/** True when the two points coincide, to within a scale-relative tolerance. */
export function coincident(p: Vec2, q: Vec2, eps = COINCIDENT_EPS): boolean {
  const scaleRef = Math.max(1, length(p), length(q));
  return isNegligible(distance(p, q), scaleRef, eps);
}

/** Exact component equality. For tolerant comparison use {@link coincident}. */
export function equals(p: Vec2, q: Vec2): boolean {
  return p.x === q.x && p.y === q.y;
}

export function isFinitePoint(p: Vec2): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * How far a point lies outside a rectangle, or zero when it is inside.
 *
 * A lower bound on the distance to anything the rectangle contains, which is
 * what makes it worth having: it answers "can this possibly be within reach"
 * with four comparisons, before the expensive exact question is asked.
 */
export function distanceToRect(box: Rect, p: Vec2): number {
  const dx = Math.max(box.minX - p.x, 0, p.x - box.maxX);
  const dy = Math.max(box.minY - p.y, 0, p.y - box.maxY);
  return Math.hypot(dx, dy);
}

/** Bounding rectangle of a non-empty list of points, or `null` when empty. */
export function boundsOf(points: readonly Vec2[]): Rect | null {
  const first = points[0];
  if (first === undefined) return null;
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
