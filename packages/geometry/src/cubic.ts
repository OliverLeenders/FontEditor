import { FLATTEN_TOLERANCE } from "./epsilon.js";
import { distanceToLine, projectOntoLine } from "./line.js";
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

/**
 * Real roots of `c3 t³ + c2 t² + c1 t + c0`, in the closed unit interval.
 *
 * Written out rather than reached for from a library because the degenerate
 * cases are the whole difficulty and they are common here: a cubic segment whose
 * control points happen to be collinear reduces to a quadratic, a straight line
 * reduces to a linear, and both turn up in ordinary outlines. Solving the general
 * case and hoping is how an intersection quietly goes missing.
 *
 * Cardano's method for the genuine cubic, with the trigonometric form for three
 * real roots — the algebraic form needs complex arithmetic to get there, and this
 * avoids it.
 */
export function unitRoots(c3: number, c2: number, c1: number, c0: number): number[] {
  const tiny = 1e-12;

  // Degree reduction, in order. Each is a real case rather than a safety net.
  if (Math.abs(c3) < tiny) {
    if (Math.abs(c2) < tiny) {
      if (Math.abs(c1) < tiny) return [];
      return inUnit([-c0 / c1]);
    }
    const disc = c1 * c1 - 4 * c2 * c0;
    if (disc < 0) return [];
    const root = Math.sqrt(disc);
    return inUnit([(-c1 + root) / (2 * c2), (-c1 - root) / (2 * c2)]);
  }

  // Depressed cubic: t = x - a/3 turns it into x³ + px + q.
  const a = c2 / c3;
  const b = c1 / c3;
  const c = c0 / c3;
  const shift = a / 3;
  const p = b - (a * a) / 3;
  const q = (2 * a * a * a) / 27 - (a * b) / 3 + c;

  const disc = (q * q) / 4 + (p * p * p) / 27;

  if (disc > tiny) {
    // One real root.
    const root = Math.sqrt(disc);
    const u = Math.cbrt(-q / 2 + root);
    const v = Math.cbrt(-q / 2 - root);
    return inUnit([u + v - shift]);
  }

  if (disc > -tiny) {
    // Two distinct roots, one of them doubled — or a triple root when p is zero.
    if (Math.abs(p) < tiny) return inUnit([-shift]);
    const u = Math.cbrt(-q / 2);
    return inUnit([2 * u - shift, -u - shift]);
  }

  // Three real roots, reached through the angle rather than through complex
  // cube roots.
  const r = Math.sqrt(-(p * p * p) / 27);
  const phi = Math.acos(clamp(-q / (2 * r), -1, 1));
  const m = 2 * Math.cbrt(r);
  return inUnit([
    m * Math.cos(phi / 3) - shift,
    m * Math.cos((phi + 2 * Math.PI) / 3) - shift,
    m * Math.cos((phi + 4 * Math.PI) / 3) - shift,
  ]);
}

const clamp = (v: number, low: number, high: number): number => Math.min(high, Math.max(low, v));

/**
 * Keep the roots that lie on the curve, snapping the ones a hair outside.
 *
 * A root at t = -1e-16 is an endpoint that floating point missed, and dropping
 * it loses a real crossing. Sorted, and duplicates removed, so a caller can walk
 * them in order.
 */
function inUnit(roots: readonly number[]): number[] {
  const eps = 1e-9;
  const kept: number[] = [];
  for (const raw of roots) {
    if (!Number.isFinite(raw)) continue;
    const t = raw < 0 && raw > -eps ? 0 : raw > 1 && raw < 1 + eps ? 1 : raw;
    if (t < 0 || t > 1) continue;
    if (!kept.some((seen) => Math.abs(seen - t) < eps)) kept.push(t);
  }
  return kept.sort((l, r) => l - r);
}

/** Where a curve crosses a line, and how far along each the crossing sits. */
export type Crossing = {
  /** Parameter along the curve. */
  readonly t: number;
  /** Parameter along the line segment, 0 at `a` and 1 at `b`. */
  readonly u: number;
  readonly point: Vec2;
};

/**
 * Where a cubic crosses a line *segment*.
 *
 * Done in the line's own frame rather than by intersecting two curves: the
 * signed distance from the line is linear in the point, so substituting the
 * cubic into it gives a cubic in `t` whose roots are exactly the crossings. The
 * Bernstein coefficients of that cubic are just the four control points'
 * distances from the line, which is both cheap and numerically kind.
 *
 * A crossing outside the segment is dropped: a knife is the stroke that was
 * drawn, not the infinite line through it.
 */
export function intersectSegmentCubic(a: Vec2, b: Vec2, s: Cubic): Crossing[] {
  const nx = -(b.y - a.y);
  const ny = b.x - a.x;
  const length = Math.hypot(nx, ny);
  // A knife of no length crosses nothing, and would divide by zero deciding so.
  if (length < 1e-12) return [];

  const at = (p: Vec2): number => (nx * (p.x - a.x) + ny * (p.y - a.y)) / length;
  const d0 = at(s.a);
  const d1 = at(s.c1);
  const d2 = at(s.c2);
  const d3 = at(s.b);

  // Bernstein to power basis.
  const c3 = -d0 + 3 * d1 - 3 * d2 + d3;
  const c2 = 3 * d0 - 6 * d1 + 3 * d2;
  const c1 = -3 * d0 + 3 * d1;
  const c0 = d0;

  const out: Crossing[] = [];
  for (const t of unitRoots(c3, c2, c1, c0)) {
    const point = evaluate(s, t);
    const u = projectOntoLine(a, b, point);
    if (u === null || u < 0 || u > 1) continue;
    out.push({ t, u, point });
  }
  return out;
}
