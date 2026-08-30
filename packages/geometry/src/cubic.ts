import { FLATTEN_TOLERANCE } from "./epsilon.js";
import { distanceToLine } from "./line.js";
import {
  type Rect,
  type Vec2,
  add,
  addScaled,
  coincident,
  distanceSq,
  isFinitePoint,
  lerp,
  scale,
  sub,
} from "./vec2.js";

/**
 * A cubic Bézier segment: on-curve `a`, its outgoing handle `c1`, the incoming
 * handle `c2` of the next on-curve point, and that point `b`.
 *
 * Cubics are the editor's internal truth, including for fonts destined for
 * TrueType output. Quadratics are an export-time concern and never enter the
 * document.
 */
export type Cubic = {
  readonly a: Vec2;
  readonly c1: Vec2;
  readonly c2: Vec2;
  readonly b: Vec2;
};

export function cubic(a: Vec2, c1: Vec2, c2: Vec2, b: Vec2): Cubic {
  return { a, c1, c2, b };
}

/** The four control points in order, for the cases where iteration is clearer. */
export function controlPoints(s: Cubic): readonly [Vec2, Vec2, Vec2, Vec2] {
  return [s.a, s.c1, s.c2, s.b];
}

/** Point on the curve at parameter `t`, by the Bernstein form. */
export function evaluate(s: Cubic, t: number): Vec2 {
  const mt = 1 - t;
  const w0 = mt * mt * mt;
  const w1 = 3 * mt * mt * t;
  const w2 = 3 * mt * t * t;
  const w3 = t * t * t;
  return {
    x: s.a.x * w0 + s.c1.x * w1 + s.c2.x * w2 + s.b.x * w3,
    y: s.a.y * w0 + s.c1.y * w1 + s.c2.y * w2 + s.b.y * w3,
  };
}

/** First derivative at `t`. Its direction is the tangent; its length is speed. */
export function derivative(s: Cubic, t: number): Vec2 {
  const mt = 1 - t;
  const w0 = 3 * mt * mt;
  const w1 = 6 * mt * t;
  const w2 = 3 * t * t;
  const d0 = sub(s.c1, s.a);
  const d1 = sub(s.c2, s.c1);
  const d2 = sub(s.b, s.c2);
  return {
    x: d0.x * w0 + d1.x * w1 + d2.x * w2,
    y: d0.y * w0 + d1.y * w1 + d2.y * w2,
  };
}

/**
 * Unit tangent at `t`, or `null` where the curve has a cusp and the derivative
 * vanishes.
 */
export function tangent(s: Cubic, t: number): Vec2 | null {
  const d = derivative(s, t);
  const len = Math.hypot(d.x, d.y);
  if (len === 0 || !Number.isFinite(len)) return null;
  return { x: d.x / len, y: d.y / len };
}

/** Split at `t` into the two sub-curves, by de Casteljau. */
export function split(s: Cubic, t: number): readonly [Cubic, Cubic] {
  const p01 = lerp(s.a, s.c1, t);
  const p12 = lerp(s.c1, s.c2, t);
  const p23 = lerp(s.c2, s.b, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const mid = lerp(p012, p123, t);
  return [
    { a: s.a, c1: p01, c2: p012, b: mid },
    { a: mid, c1: p123, c2: p23, b: s.b },
  ];
}

/** The sub-curve between parameters `t0` and `t1`. */
export function subcurve(s: Cubic, t0: number, t1: number): Cubic {
  if (t0 > t1) return subcurve(s, t1, t0);
  const right = split(s, t0)[1];
  if (t0 >= 1) return right;
  return split(right, (t1 - t0) / (1 - t0))[0];
}

/** Reversed direction of travel; the same curve, drawn the other way. */
export function reverse(s: Cubic): Cubic {
  return { a: s.b, c1: s.c2, c2: s.c1, b: s.a };
}

/**
 * Parameters in (0, 1) where the derivative of one coordinate vanishes — the
 * curve's extrema, and with the endpoints, everything the exact bounding box
 * needs.
 */
export function extrema(s: Cubic): number[] {
  const roots: number[] = [];
  collectAxisRoots(s.a.x, s.c1.x, s.c2.x, s.b.x, roots);
  collectAxisRoots(s.a.y, s.c1.y, s.c2.y, s.b.y, roots);
  return roots.sort((l, r) => l - r);
}

/**
 * Exact bounding box: the hull of the endpoints and the extrema.
 *
 * The control-point hull would be cheaper and is a valid *outer* bound, but it
 * overstates the box badly on curves with long handles — which is most of them
 * in type design.
 */
export function bounds(s: Cubic): Rect {
  let minX = Math.min(s.a.x, s.b.x);
  let minY = Math.min(s.a.y, s.b.y);
  let maxX = Math.max(s.a.x, s.b.x);
  let maxY = Math.max(s.a.y, s.b.y);
  for (const t of extrema(s)) {
    const p = evaluate(s, t);
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * True when the curve deviates from its chord by less than `tolerance`, judged
 * by the control points — the standard conservative flatness test.
 */
export function isFlat(s: Cubic, tolerance = FLATTEN_TOLERANCE): boolean {
  if (coincident(s.a, s.b)) {
    return distanceSq(s.a, s.c1) <= tolerance * tolerance
      && distanceSq(s.b, s.c2) <= tolerance * tolerance;
  }
  const d1 = distanceToLine(s.a, s.b, s.c1);
  const d2 = distanceToLine(s.a, s.b, s.c2);
  if (d1 === null || d2 === null) return true;
  return Math.max(d1, d2) <= tolerance;
}

/**
 * Polyline approximation, by adaptive subdivision. Includes both endpoints.
 *
 * `maxDepth` bounds the work on pathological input; it is a safety valve, not a
 * quality knob — reach for `tolerance` for that.
 */
export function flatten(s: Cubic, tolerance = FLATTEN_TOLERANCE, maxDepth = 16): Vec2[] {
  const out: Vec2[] = [s.a];
  subdivide(s, tolerance, maxDepth, out);
  out.push(s.b);
  return out;
}

function subdivide(s: Cubic, tolerance: number, depth: number, out: Vec2[]): void {
  if (depth <= 0 || isFlat(s, tolerance)) return;
  const [left, right] = split(s, 0.5);
  subdivide(left, tolerance, depth - 1, out);
  out.push(left.b);
  subdivide(right, tolerance, depth - 1, out);
}

/** Approximate arc length, via a flattened polyline at the given tolerance. */
export function arcLength(s: Cubic, tolerance = FLATTEN_TOLERANCE): number {
  const pts = flatten(s, tolerance);
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  }
  return total;
}

/** Result of projecting a point onto a curve. */
export type Projection = {
  /** Parameter of the closest point found, in [0, 1]. */
  readonly t: number;
  /** The closest point itself. */
  readonly point: Vec2;
  /** Distance from the query point to `point`. */
  readonly distance: number;
};

/**
 * Closest point on the curve to `p`.
 *
 * Coarse sampling followed by a bounded ternary refinement on the best bracket.
 * Squared distance to a cubic is not unimodal in general, so the coarse pass has
 * to be fine enough to isolate the right basin — `samples` controls that. At the
 * default it is comfortably accurate for hit-testing, which is what it is for.
 * A curve-curve nearest-point solver, if one is ever needed, wants a different
 * algorithm.
 */
export function project(s: Cubic, p: Vec2, samples = 64, refinements = 32): Projection {
  let bestT = 0;
  let bestD = distanceSq(p, s.a);

  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const d = distanceSq(p, evaluate(s, t));
    if (d < bestD) {
      bestD = d;
      bestT = t;
    }
  }

  const step = 1 / samples;
  let lo = Math.max(0, bestT - step);
  let hi = Math.min(1, bestT + step);

  for (let i = 0; i < refinements; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (distanceSq(p, evaluate(s, m1)) < distanceSq(p, evaluate(s, m2))) {
      hi = m2;
    } else {
      lo = m1;
    }
  }

  let t = (lo + hi) / 2;
  let point = evaluate(s, t);
  let best = distanceSq(p, point);

  // The refinement narrows towards an endpoint without ever arriving, so a query
  // sitting exactly on an anchor comes back a whisker off. The endpoints are
  // exactly known, so check them directly rather than approach them — hit
  // testing lands on anchors constantly, and `t` should be a clean 0 or 1 there.
  const atStart = distanceSq(p, s.a);
  if (atStart < best) {
    best = atStart;
    t = 0;
    point = s.a;
  }
  const atEnd = distanceSq(p, s.b);
  if (atEnd < best) {
    best = atEnd;
    t = 1;
    point = s.b;
  }

  return { t, point, distance: Math.sqrt(best) };
}

/** True when all four control points are finite. */
export function isFiniteCubic(s: Cubic): boolean {
  return isFinitePoint(s.a) && isFinitePoint(s.c1) && isFinitePoint(s.c2) && isFinitePoint(s.b);
}

/**
 * The straight segment `a → b`, expressed as a cubic with its handles at the
 * one-third points. This is the shape the editor inserts for a new segment, and
 * it matches what the prototype's `add_point` built.
 */
export function lineAsCubic(a: Vec2, b: Vec2): Cubic {
  const d = sub(b, a);
  return {
    a,
    c1: add(a, scale(d, 1 / 3)),
    c2: add(a, scale(d, 2 / 3)),
    b,
  };
}

/**
 * A quadratic Bézier segment: two anchors and a single control point.
 *
 * Quadratics exist in this codebase only at the TrueType import boundary. The
 * editor's document model holds cubics exclusively — a quadratic has one control
 * point and therefore no Tunni line, so a quadratic segment would be inert under
 * the editor's central feature.
 */
export type Quadratic = {
  readonly a: Vec2;
  readonly q: Vec2;
  readonly b: Vec2;
};

/** Point on a quadratic at parameter `t`. */
export function evaluateQuadratic(s: Quadratic, t: number): Vec2 {
  const mt = 1 - t;
  return {
    x: s.a.x * mt * mt + s.q.x * 2 * mt * t + s.b.x * t * t,
    y: s.a.y * mt * mt + s.q.y * 2 * mt * t + s.b.y * t * t,
  };
}

/**
 * The cubic that traces exactly the same curve as a given quadratic.
 *
 * This is an equality, not an approximation: raising a degree-2 Bézier to
 * degree 3 is exact, with the handles two-thirds of the way from each anchor to
 * the quadratic's control point. Importing a TrueType outline therefore loses no
 * shape whatsoever — what it does change is node *structure*, since TrueType's
 * implied on-curve points between consecutive off-curve points have to be made
 * explicit. Going back out through cu2qu at export is the lossy direction, and
 * only to within a stated tolerance.
 */
export function quadraticToCubic(s: Quadratic): Cubic {
  return {
    a: s.a,
    c1: addScaled(s.a, sub(s.q, s.a), 2 / 3),
    c2: addScaled(s.b, sub(s.q, s.b), 2 / 3),
    b: s.b,
  };
}

/**
 * Roots in (0, 1) of the derivative of one coordinate, appended to `out`.
 *
 * With control values p0..p3 the derivative is, up to a factor of three,
 * `qa·t² + qb·t + qc` for the coefficients below.
 */
function collectAxisRoots(p0: number, p1: number, p2: number, p3: number, out: number[]): void {
  const qa = -p0 + 3 * p1 - 3 * p2 + p3;
  const qb = 2 * (p0 - 2 * p1 + p2);
  const qc = p1 - p0;

  if (qa === 0) {
    if (qb === 0) return;
    pushIfInside(-qc / qb, out);
    return;
  }

  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return;
  const sqrtDisc = Math.sqrt(disc);
  pushIfInside((-qb + sqrtDisc) / (2 * qa), out);
  pushIfInside((-qb - sqrtDisc) / (2 * qa), out);
}

function pushIfInside(t: number, out: number[]): void {
  if (Number.isFinite(t) && t > 0 && t < 1) out.push(t);
}
