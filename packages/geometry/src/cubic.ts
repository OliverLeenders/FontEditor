import { FLATTEN_TOLERANCE } from "./epsilon.js";
import { distanceToLine, projectOntoLine } from "./line.js";
import {
  type Rect,
  type Vec2,
  add,
  addScaled,
  coincident,
  cross,
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

/**
 * The second derivative at `t`, in Bernstein form.
 *
 * Differentiated symbolically rather than by sampling the first derivative
 * twice: a difference quotient on a curve this small is dominated by its own
 * step size, and curvature — which divides by the cube of a length — makes that
 * noise visible immediately.
 */
export function secondDerivative(s: Cubic, t: number): Vec2 {
  const u = 1 - t;
  return {
    x: 6 * (u * (s.c2.x - 2 * s.c1.x + s.a.x) + t * (s.b.x - 2 * s.c2.x + s.c1.x)),
    y: 6 * (u * (s.c2.y - 2 * s.c1.y + s.a.y) + t * (s.b.y - 2 * s.c2.y + s.c1.y)),
  };
}

/**
 * Signed curvature at `t`: how tightly the curve turns, and which way.
 *
 * `(x'y" - y'x") / (x'^2 + y'^2)^{3/2}` — the standard expression for a
 * parametric curve. It is the reciprocal of the radius of the circle that best
 * fits there, so a circle of radius 100 reads 0.01 everywhere and a straight
 * line reads zero.
 *
 * Signed, because the sign is half of what it is for: it says which side of the
 * curve the centre of that circle lies on, so a comb drawn along it flips at an
 * inflection instead of folding over and hiding one.
 *
 * `null` where the derivative vanishes — a cusp, or a handle retracted onto its
 * anchor. Curvature genuinely does not exist there, and a very large number
 * would be a lie of the kind that draws a spike through the letter.
 */
export function curvature(s: Cubic, t: number): number | null {
  const d = derivative(s, t);
  const dd = secondDerivative(s, t);

  const speed = Math.hypot(d.x, d.y);
  if (speed === 0 || !Number.isFinite(speed)) return null;

  const k = (d.x * dd.y - d.y * dd.x) / (speed * speed * speed);
  return Number.isFinite(k) ? k : null;
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
 * Parameters in (0, 1) where the curve changes which way it bends.
 *
 * The cross product of the first and second derivatives, which is where the
 * signed curvature changes sign. It looks like a cubic in `t` and is not: the
 * cubic term cancels, leaving `At² + Bt + C` in the first differences of the
 * control points. A curve with none — which is most of the segments in a
 * letter — gives back nothing rather than a root at an end.
 */
export function inflections(s: Cubic): number[] {
  const u = sub(s.c1, s.a);
  const v = sub(s.c2, s.c1);
  const w = sub(s.b, s.c2);

  const uv = cross(u, v);
  const uw = cross(u, w);
  const vw = cross(v, w);

  return unitRoots(0, uv - uw + vw, uw - 2 * uv, uv)
    .filter((t) => t > 0 && t < 1)
    .sort((l, r) => l - r);
}

/**
 * One cubic through what two of them drew, for a point being taken out.
 *
 * Deleting a node leaves the two segments it joined to be drawn by one, and the
 * neighbours' handles were the right length for half the distance each. Keeping
 * them is what makes a deleted point dent the outline. The directions the curve
 * leaves and arrives by are kept — they are the join with whatever is beyond,
 * and a smooth node either side depends on them — and only the two lengths are
 * fitted, by least squares against points sampled off the pair.
 *
 * Two unknowns, so each fit is a 2×2 solve. It is done a few times over, with
 * every sample asked again between rounds which point of the fitted curve it is
 * nearest: where a sample sits along the pair is not where it sits along the
 * answer, and a fit against the first guess at that is visibly off. Where the
 * solve degenerates — a cusp, a zero-length side, handles the fit would send
 * backwards — each length falls back to a third of the chord, which is the
 * length that draws a circular-ish arc and is what every curve fitter starts
 * from.
 *
 * `null` when there is no direction to leave or arrive by, which is a pair of
 * segments with nothing to fit.
 */
export function refitJoin(before: Cubic, after: Cubic): Cubic | null {
  const from = before.a;
  const to = after.b;

  const leaving = unit(sub(coincident(before.c1, from) ? before.b : before.c1, from));
  const arriving = unit(sub(coincident(after.c2, to) ? after.a : after.c2, to));
  if (leaving === null || arriving === null) return null;

  const chord = Math.hypot(to.x - from.x, to.y - from.y);
  const plain = fallback(from, to, leaving, arriving, chord / 3);

  const points: Vec2[] = [];
  for (let i = 0; i <= SAMPLES; i++) points.push(evaluate(before, i / SAMPLES));
  for (let i = 1; i <= SAMPLES; i++) points.push(evaluate(after, i / SAMPLES));

  // Chord length to start with: the fit is only as good as the correspondence
  // between a sample and the `u` it is called, and uniform `u` across a pair of
  // unequal segments would pull the result towards the shorter one. It is only
  // a start, because distance along the pair is not distance along the answer.
  let params = chordParameters(points);
  if (params === null) return plain;

  let best = plain;
  let bestError = Infinity;
  for (let round = 0; round < ROUNDS; round++) {
    const fitted = handlesFor(points, params, from, to, leaving, arriving, chord);
    if (fitted === null) break;

    // Each sample is re-asked which point of the fitted curve it is nearest,
    // and the next fit is against those answers. Repeating that is what turns a
    // fit that is roughly right into one that puts a curve which *can* be
    // recovered exactly back exactly, and it is also what makes the error worth
    // measuring: the distance to the nearest point of the curve is what a
    // designer sees, and the distance at a guessed parameter is not.
    params = params.map((u, i) => nearer(fitted, points[i]!, u));
    const error = worstDistance(fitted, points, params);
    if (error < bestError) {
      best = fitted;
      bestError = error;
    }
  }
  return best;
}

/** How many points are read off the pair, each side of the join. */
const SAMPLES = 24;

/**
 * How many times to fit and re-parameterise.
 *
 * It converges quickly and then finely: a curve that was one curve before a
 * point was put in the middle of it comes back within a hundredth of a unit by
 * about twenty, and a pair that no single cubic can draw has settled long
 * before. Two dozen rounds of a 2×2 solve over fifty points is nothing beside
 * the redraw that follows.
 */
const ROUNDS = 24;

/**
 * The two handle lengths that put the curve closest to the samples, by the
 * normal equations of Q(u) = a·B0 + (a + αT1)·B1 + (b + βT2)·B2 + b·B3, where α
 * and β are the only unknowns.
 *
 * `null` where the solve degenerates, or where it asks for a handle behind its
 * own anchor — which is not a shorter handle but a loop, a segment crossing
 * itself where the original did not.
 */
function handlesFor(
  points: readonly Vec2[],
  params: readonly number[],
  from: Vec2,
  to: Vec2,
  leaving: Vec2,
  arriving: Vec2,
  chord: number,
): Cubic | null {
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;

  for (let i = 0; i < points.length; i++) {
    const u = params[i]!;
    const p = points[i]!;
    const v = 1 - u;
    const b0 = v * v * v;
    const b1 = 3 * v * v * u;
    const b2 = 3 * v * u * u;
    const b3 = u * u * u;

    const a1 = scale(leaving, b1);
    const a2 = scale(arriving, b2);
    const restX = p.x - (from.x * (b0 + b1) + to.x * (b2 + b3));
    const restY = p.y - (from.y * (b0 + b1) + to.y * (b2 + b3));

    c00 += a1.x * a1.x + a1.y * a1.y;
    c01 += a1.x * a2.x + a1.y * a2.y;
    c11 += a2.x * a2.x + a2.y * a2.y;
    x0 += restX * a1.x + restY * a1.y;
    x1 += restX * a2.x + restY * a2.y;
  }

  const det = c00 * c11 - c01 * c01;
  if (Math.abs(det) < 1e-12) return null;

  const alpha = (x0 * c11 - c01 * x1) / det;
  const beta = (c00 * x1 - x0 * c01) / det;
  const tiny = chord * 1e-6;
  if (!(alpha > tiny) || !(beta > tiny)) return null;

  return {
    a: from,
    c1: addScaled(from, leaving, alpha),
    c2: addScaled(to, arriving, beta),
    b: to,
  };
}

/** The furthest any sample is from where its own parameter puts the curve. */
function worstDistance(s: Cubic, points: readonly Vec2[], params: readonly number[]): number {
  let worst = 0;
  for (let i = 0; i < points.length; i++) {
    const at = evaluate(s, params[i]!);
    worst = Math.max(worst, Math.hypot(at.x - points[i]!.x, at.y - points[i]!.y));
  }
  return worst;
}

/**
 * The parameter of the curve nearest `p`, starting from `u`.
 *
 * Newton on `(Q(u) − p) · Q'(u)`, which is zero exactly where the curve is at
 * its closest. Two steps, which is where a step stops buying anything at this
 * distance from the answer, and the result is held inside the segment: at the
 * ends the derivative of a handle-retracted curve vanishes, and the step is a
 * division by nearly nothing.
 */
function nearer(s: Cubic, p: Vec2, u: number): number {
  let at = u;
  for (let step = 0; step < 2; step++) {
    const q = evaluate(s, at);
    const d1 = derivative(s, at);
    const d2 = secondDerivative(s, at);

    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const numerator = dx * d1.x + dy * d1.y;
    const denominator = d1.x * d1.x + d1.y * d1.y + dx * d2.x + dy * d2.y;
    if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) return at;

    const moved = at - numerator / denominator;
    if (!Number.isFinite(moved)) return at;
    at = Math.min(1, Math.max(0, moved));
  }
  return at;
}

function fallback(from: Vec2, to: Vec2, leaving: Vec2, arriving: Vec2, reach: number): Cubic {
  return {
    a: from,
    c1: addScaled(from, leaving, reach),
    c2: addScaled(to, arriving, reach),
    b: to,
  };
}

function unit(v: Vec2): Vec2 | null {
  const reach = Math.hypot(v.x, v.y);
  if (!(reach > 0) || !Number.isFinite(reach)) return null;
  return { x: v.x / reach, y: v.y / reach };
}

/** Each sample's share of the distance walked to reach it, from 0 to 1. */
function chordParameters(points: readonly Vec2[]): number[] | null {
  const walked: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const step = Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
    walked.push(walked[i - 1]! + step);
  }
  const total = walked[walked.length - 1]!;
  if (!(total > 0)) return null;
  return walked.map((each) => each / total);
}

/**
 * The box round the four control points.
 *
 * Looser than {@link bounds} and far cheaper — no root finding, four comparisons
 * a coordinate — and, since a Bézier lies inside the convex hull of its control
 * points, still a box the curve is certainly inside. That is what a rejection
 * test wants: never wrong about "too far away", allowed to be pessimistic.
 */
export function controlBounds(s: Cubic): Rect {
  return {
    minX: Math.min(s.a.x, s.c1.x, s.c2.x, s.b.x),
    minY: Math.min(s.a.y, s.c1.y, s.c2.y, s.b.y),
    maxX: Math.max(s.a.x, s.c1.x, s.c2.x, s.b.x),
    maxY: Math.max(s.a.y, s.c1.y, s.c2.y, s.b.y),
  };
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
    return (
      distanceSq(s.a, s.c1) <= tolerance * tolerance &&
      distanceSq(s.b, s.c2) <= tolerance * tolerance
    );
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

/** Where two curves meet, with the parameter along each. */
export type CurveMeeting = {
  readonly t1: number;
  readonly t2: number;
  readonly point: Vec2;
};

/**
 * How close two boxes must get before their curves are called met, how deep the
 * search may go, and how much work it may do in total.
 *
 * A design unit is the scale everything here works in, so a five-hundredth of
 * one is already far below anything a font can express — and the precision
 * matters beyond looks, because a caller splits both curves here and two split
 * points that do not quite coincide leave a hairline gap in the result. The depth allows for the fact
 * that only one curve is split at a time, so each gets about half of it — enough
 * to take either from a thousand units down to the tolerance twice over. The
 * budget is what stops the pathological case: two curves lying along each other
 * prune nothing, so every branch survives and the search would not end.
 */
const MEET_TOLERANCE = 0.002;
const MEET_DEPTH = 44;
const MEET_BUDGET = 50_000;

/**
 * Where two cubics cross.
 *
 * By subdivision rather than by algebra. Two cubics meet where a ninth-degree
 * polynomial vanishes, and the numerical trouble in finding those roots is worse
 * than the trouble in bisecting: a Bézier lies inside the hull of its control
 * points, so two curves whose boxes miss cannot meet, and that one fact drives
 * the whole search.
 *
 * Only the larger of the two is split at each step. Splitting both makes four
 * branches where two will do, and four to the twenty-fourth is not a search.
 *
 * `null` when the two overlap along a stretch rather than crossing at points.
 * That case has no finite answer — every point of the shared stretch is an
 * intersection — and a caller that treated the flood of near-identical hits as
 * crossings would tear the outline apart. Saying so is the only honest reply.
 */
export function intersectCubics(a: Cubic, b: Cubic): CurveMeeting[] | null {
  const found: CurveMeeting[] = [];
  let steps = 0;
  // On an object rather than in a plain `let` so that reading it after the
  // search is not treated as reading a variable that was never reassigned:
  // narrowing does not follow an assignment made inside a closure.
  const ran = { out: false };

  const search = (a0: number, a1: number, b0: number, b1: number, depth: number): void => {
    if (ran.out) return;
    if (++steps > MEET_BUDGET) {
      ran.out = true;
      return;
    }

    const ba = bounds(subcurve(a, a0, a1));
    const bb = bounds(subcurve(b, b0, b1));

    if (
      ba.maxX < bb.minX - MEET_TOLERANCE ||
      bb.maxX < ba.minX - MEET_TOLERANCE ||
      ba.maxY < bb.minY - MEET_TOLERANCE ||
      bb.maxY < ba.minY - MEET_TOLERANCE
    ) {
      return;
    }

    const spanA = Math.max(ba.maxX - ba.minX, ba.maxY - ba.minY);
    const spanB = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);

    if (spanA <= MEET_TOLERANCE && spanB <= MEET_TOLERANCE) {
      const t1 = (a0 + a1) / 2;
      const point = evaluate(a, t1);
      // Two boxes that both shrank to nothing around the same place are one
      // crossing found twice, not two crossings.
      if (found.some((seen) => Math.hypot(seen.point.x - point.x, seen.point.y - point.y) < 0.05)) {
        return;
      }
      found.push({ t1, t2: (b0 + b1) / 2, point });
      return;
    }

    if (depth >= MEET_DEPTH) {
      // Neither box shrank away and the search ran out of room, which is what
      // curves lying along each other look like from in here.
      ran.out = true;
      return;
    }

    if (spanA >= spanB) {
      const m = (a0 + a1) / 2;
      search(a0, m, b0, b1, depth + 1);
      search(m, a1, b0, b1, depth + 1);
    } else {
      const m = (b0 + b1) / 2;
      search(a0, a1, b0, m, depth + 1);
      search(a0, a1, m, b1, depth + 1);
    }
  };

  search(0, 1, 0, 1, 0);
  if (ran.out) return null;

  return found.sort((l, r) => l.t1 - r.t1);
}

/**
 * Where a cubic crosses itself, or `null` when it does not.
 *
 * One segment can make a loop on its own — handles long enough and crossed over
 * take the curve out, round and back through its own path — and a designer
 * dragging a handle produces it without meaning to. It is the same problem as
 * two curves crossing and none of the same arithmetic, since a curve cannot be
 * subdivided against itself: every box overlaps its own.
 *
 * By algebra instead, which for this one question is short. Writing the curve
 * as `a t³ + b t² + c t + d`, the difference between two points on it factors:
 *
 *     B(u) − B(v) = (u − v) · [ a(u² + uv + v²) + b(u + v) + c ]
 *
 * so two distinct parameters land on the same point exactly when the bracket
 * vanishes. In terms of their sum `S` and product `P` that bracket is
 * `a(S² − P) + bS + c`, which — taking `U = S² − P` — is *linear* in `U` and `S`
 * in each of x and y. Two equations, two unknowns, one determinant. `u` and `v`
 * are then the roots of `z² − Sz + P`.
 */
export function selfIntersection(s: Cubic): CurveMeeting | null {
  const ax = -s.a.x + 3 * s.c1.x - 3 * s.c2.x + s.b.x;
  const ay = -s.a.y + 3 * s.c1.y - 3 * s.c2.y + s.b.y;
  const bx = 3 * (s.a.x - 2 * s.c1.x + s.c2.x);
  const by = 3 * (s.a.y - 2 * s.c1.y + s.c2.y);
  const cx = 3 * (s.c1.x - s.a.x);
  const cy = 3 * (s.c1.y - s.a.y);

  // No cubic term in one direction, or the two terms parallel: the curve is a
  // quadratic or a line in disguise, and neither can cross itself.
  const det = ax * by - ay * bx;
  const scale = Math.max(Math.abs(ax), Math.abs(ay), Math.abs(bx), Math.abs(by));
  if (scale === 0 || Math.abs(det) <= 1e-9 * scale * scale) return null;

  const u = (bx * cy - by * cx) / det;
  const sum = (ay * cx - ax * cy) / det;

  // z² − Sz + P with P = S² − U, so the discriminant is 4U − 3S². Not positive
  // means the two parameters coincide or are imaginary: the curve turns sharply
  // but never actually meets itself.
  const disc = 4 * u - 3 * sum * sum;
  if (!(disc > 0)) return null;

  const root = Math.sqrt(disc);
  const t1 = (sum - root) / 2;
  const t2 = (sum + root) / 2;
  // A loop lies within the segment. A pair of parameters outside it belongs to
  // the infinite curve this segment is a piece of, which is not on the outline.
  if (!(t1 > 0 && t2 < 1)) return null;

  const point = evaluate(s, t1);
  const other = evaluate(s, t2);
  // The algebra is exact and the arithmetic is not. A pair that does not land
  // on the same place is a near-degenerate curve reporting a loop it has not
  // got, and saying nothing is better than splitting at a point that is not on
  // the curve twice.
  const size = Math.max(Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), scale, 1);
  if (Math.hypot(other.x - point.x, other.y - point.y) > 1e-6 * size) return null;

  return { t1, t2, point };
}

/**
 * Where the point joining two curves has to sit for their curvatures to agree.
 *
 * Harmonisation. Two segments meeting smoothly are tangent-continuous — the
 * light travelling along one arrives at the same angle it leaves at — but the
 * *rate* of turn can jump, and that jump is what the curvature comb shows as a
 * step at the node. The eye finds it too: it is the faint crease that makes a
 * bowl look assembled rather than drawn.
 *
 * What can be moved to fix it is the shared point, along the line between its
 * two handles. The handles stay where they are, so both segments keep the
 * directions they were given, and the point lands where it makes the node
 * exactly smooth as well as curvature-continuous.
 *
 * The arithmetic is short because curvature at the end of a cubic depends on
 * only two things: how far the last handle is from the point, and how far the
 * handle before it stands off the line they lie on. Sliding the point along that
 * line leaves both stand-off distances untouched — they are measured to a line
 * whose direction is fixed — so the two curvatures become `h₁/d₁²` and `h₂/d₂²`
 * with `d₁ + d₂` the whole distance between the handles. Setting them equal
 * gives `d₁/d₂ = √h₁/√h₂`, and the point that divides the line in that ratio is
 * the answer.
 *
 * `null` where there is nothing to solve: a handle sitting on the point it
 * belongs to, both handles in the same place, or a side that is already straight
 * — a straight side has no curvature to match, and moving the point to pretend
 * otherwise would bend it.
 */
export function harmonisedJoin(before: Cubic, after: Cubic): Vec2 | null {
  const from = before.c2;
  const to = after.c1;

  const span = { x: to.x - from.x, y: to.y - from.y };
  const length = Math.hypot(span.x, span.y);
  if (length === 0 || !Number.isFinite(length)) return null;

  const unit = { x: span.x / length, y: span.y / length };
  // How far each outer handle stands off the line the inner two lie on. That is
  // the whole of what its curvature depends on, once the point is on the line.
  const offOne = Math.abs(cross({ x: before.c1.x - from.x, y: before.c1.y - from.y }, unit));
  const offTwo = Math.abs(cross({ x: after.c2.x - to.x, y: after.c2.y - to.y }, unit));

  // A side standing on the line is straight at the join: it has no curvature to
  // agree with, and solving anyway would put the point on top of a handle and
  // flatten the curve rather than harmonise it.
  const flat = length * 1e-9;
  if (offOne <= flat || offTwo <= flat) return null;

  const one = Math.sqrt(offOne);
  const two = Math.sqrt(offTwo);

  const at = one / (one + two);
  const point = { x: from.x + span.x * at, y: from.y + span.y * at };
  return isFinitePoint(point) ? point : null;
}
