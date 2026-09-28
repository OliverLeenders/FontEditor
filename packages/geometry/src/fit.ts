import { type Cubic, cubic } from "./cubic.js";
import type { Vec2 } from "./vec2.js";

/**
 * Cubics through a run of points, to within a stated distance.
 *
 * What an outline is made of when it is worked out rather than drawn: a pen whose
 * angle and width change along a stroke leaves an edge that is no curve anybody
 * placed, and the only way to write it into a font is to sample it and fit Béziers
 * through the samples. The method is the one Philip Schneider published in
 * Graphics Gems in 1990, and every curve fitter since is a variation on it: fit one
 * cubic with the end directions fixed and the handle lengths solved by least
 * squares; if it strays too far, try re-parameterising the samples against it a few
 * times; if it still strays, split at the worst point and fit the two halves.
 *
 * The directions at the ends are the caller's to give where it knows them, because
 * a fitted edge meets whatever is either side of it, and a direction guessed from
 * the first two samples would put a kink at every join.
 */

/** How many times the samples are re-asked their parameter before splitting. */
const REPARAMETERISE = 8;

/**
 * Fit cubics through `points` so that none strays more than `tolerance` from them.
 *
 * `start` and `end` are unit directions the fitted curve leaves the first point by
 * and arrives at the last point by; left out, they are read from the neighbouring
 * samples. Fewer than two points fit nothing.
 */
export function fitCubics(
  points: readonly Vec2[],
  tolerance: number,
  start?: Vec2,
  end?: Vec2,
): Cubic[] {
  const pts = dedupe(points);
  if (pts.length < 2) return [];

  const leaving = start ?? unit(sub(pts[1]!, pts[0]!));
  // The direction back from the last point, which is how the fit wants it.
  const arriving =
    end === undefined ? unit(sub(pts[pts.length - 2]!, pts[pts.length - 1]!)) : neg(end);
  if (leaving === null || arriving === null) return [straight(pts[0]!, pts[pts.length - 1]!)];

  const out: Cubic[] = [];
  fitRange(pts, 0, pts.length - 1, leaving, arriving, tolerance * tolerance, out, 0);
  return out;
}

/** The longest a fitted handle may be, in chords. */
const HANDLE_MOST = 3;

/** How deep the splitting may go before a curve is accepted as it is. */
const MAX_DEPTH = 24;

function fitRange(
  pts: readonly Vec2[],
  first: number,
  last: number,
  leaving: Vec2,
  arriving: Vec2,
  squaredTolerance: number,
  out: Cubic[],
  depth: number,
): void {
  const a = pts[first]!;
  const b = pts[last]!;

  // Two points: a curve along the directions given, a third of the way each.
  if (last - first === 1) {
    const d = dist(a, b) / 3;
    out.push(cubic(a, add(a, scale(leaving, d)), add(b, scale(arriving, d)), b));
    return;
  }

  const params = chordParameters(pts, first, last);
  let curve = handlesFor(pts, first, last, params, leaving, arriving);
  let worst = worstPoint(pts, first, last, curve, params);
  if (worst.squared <= squaredTolerance) {
    out.push(curve);
    return;
  }

  // Ask each sample again which point of the curve it is nearest, and fit against
  // that. Chord length is only a first guess at a sample's parameter, and on a run
  // that one cubic *can* draw, a few rounds of this find that cubic where splitting
  // at once would have drawn it in eight. Every split is two more points in an
  // outline somebody will have to live with, so the rounds are always worth trying.
  //
  // Every round, even after one that made the stray worse: Newton's steps wander
  // before they settle, and stopping at the first bad round splits curves that the
  // next round would have found whole.
  for (let round = 0; round < REPARAMETERISE; round++) {
    reparameterise(pts, first, params, curve);
    curve = handlesFor(pts, first, last, params, leaving, arriving);
    worst = worstPoint(pts, first, last, curve, params);
    if (worst.squared <= squaredTolerance) {
      out.push(curve);
      return;
    }
  }

  if (depth >= MAX_DEPTH) {
    out.push(curve);
    return;
  }

  // Split at the worst point, with the direction there read from its neighbours so
  // the two halves meet smoothly.
  const at = Math.min(Math.max(worst.index, first + 1), last - 1);
  const across = unit(sub(pts[at - 1]!, pts[at + 1]!)) ?? leaving;
  fitRange(pts, first, at, leaving, across, squaredTolerance, out, depth + 1);
  fitRange(pts, at, last, neg(across), arriving, squaredTolerance, out, depth + 1);
}

/**
 * The cubic through the first and last points, leaving and arriving along the
 * given directions, with handle lengths solved by least squares.
 *
 * Two unknowns, so a two-by-two system. Where it degenerates — the samples in a
 * line, or the lengths coming out negative or vanishingly small — each length is a
 * third of the chord, the length that draws a nearly circular arc.
 */
function handlesFor(
  pts: readonly Vec2[],
  first: number,
  last: number,
  params: Float64Array,
  leaving: Vec2,
  arriving: Vec2,
): Cubic {
  const a = pts[first]!;
  const b = pts[last]!;

  // Written out in numbers rather than with the small vector helpers, because this
  // runs for every sample of every round of every fit, and a stroke whose pen
  // changes is fitted afresh on every frame of a drag.
  const lx = leaving.x;
  const ly = leaving.y;
  const rx = arriving.x;
  const ry = arriving.y;
  const ll = lx * lx + ly * ly;
  const lr = lx * rx + ly * ry;
  const rr = rx * rx + ry * ry;
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (let i = 0; i < params.length; i++) {
    const u = params[i]!;
    const mu = 1 - u;
    const b0 = mu * mu * mu;
    const b1 = 3 * u * mu * mu;
    const b2 = 3 * u * u * mu;
    const b3 = u * u * u;
    c00 += b1 * b1 * ll;
    c01 += b1 * b2 * lr;
    c11 += b2 * b2 * rr;
    const p = pts[first + i]!;
    const sx = p.x - (a.x * (b0 + b1) + b.x * (b2 + b3));
    const sy = p.y - (a.y * (b0 + b1) + b.y * (b2 + b3));
    x0 += b1 * (lx * sx + ly * sy);
    x1 += b2 * (rx * sx + ry * sy);
  }

  const det = c00 * c11 - c01 * c01;
  const chord = dist(a, b);
  const fallback = chord / 3;
  let alpha1 = fallback;
  let alpha2 = fallback;
  if (Math.abs(det) > 1e-12) {
    const s1 = (x0 * c11 - x1 * c01) / det;
    const s2 = (c00 * x1 - c01 * x0) / det;
    // A length more than a few chords long is a system too near degenerate to
    // trust — samples almost in a line along the given directions — and one taken
    // at its word writes a handle a hundred billion units long. The third of the
    // chord instead, and the fit splits if that does not do.
    const most = chord * HANDLE_MOST;
    if (
      s1 > chord * 1e-6 &&
      s2 > chord * 1e-6 &&
      s1 < most &&
      s2 < most &&
      Number.isFinite(s1) &&
      Number.isFinite(s2)
    ) {
      alpha1 = s1;
      alpha2 = s2;
    }
  }

  return cubic(a, add(a, scale(leaving, alpha1)), add(b, scale(arriving, alpha2)), b);
}

/** Parameters for the samples from their distance along the run, from nought to one. */
function chordParameters(pts: readonly Vec2[], first: number, last: number): Float64Array {
  const out = new Float64Array(last - first + 1);
  for (let i = first + 1; i <= last; i++) {
    out[i - first] = out[i - first - 1]! + dist(pts[i - 1]!, pts[i]!);
  }
  const total = out[out.length - 1]!;
  for (let i = 0; i < out.length; i++) {
    out[i] = total === 0 ? i / (out.length - 1) : out[i]! / total;
  }
  return out;
}

/**
 * Each sample's parameter moved towards the point of the curve nearest it, by one
 * step of Newton's method on the squared distance. In place: the parameters are
 * the fit's own, and the old ones are not wanted again.
 */
function reparameterise(
  pts: readonly Vec2[],
  first: number,
  params: Float64Array,
  curve: Cubic,
): void {
  const { a, c1, c2, b } = curve;
  for (let i = 0; i < params.length; i++) {
    const u = params[i]!;
    const p = pts[first + i]!;
    const m = 1 - u;
    // The point, and the first and second derivatives, at u.
    const w0 = m * m * m;
    const w1 = 3 * m * m * u;
    const w2 = 3 * m * u * u;
    const w3 = u * u * u;
    const qx = a.x * w0 + c1.x * w1 + c2.x * w2 + b.x * w3 - p.x;
    const qy = a.y * w0 + c1.y * w1 + c2.y * w2 + b.y * w3 - p.y;
    const d1x = 3 * (m * m * (c1.x - a.x) + 2 * m * u * (c2.x - c1.x) + u * u * (b.x - c2.x));
    const d1y = 3 * (m * m * (c1.y - a.y) + 2 * m * u * (c2.y - c1.y) + u * u * (b.y - c2.y));
    const d2x = 6 * (m * (c2.x - 2 * c1.x + a.x) + u * (b.x - 2 * c2.x + c1.x));
    const d2y = 6 * (m * (c2.y - 2 * c1.y + a.y) + u * (b.y - 2 * c2.y + c1.y));
    const numerator = qx * d1x + qy * d1y;
    const denominator = d1x * d1x + d1y * d1y + qx * d2x + qy * d2y;
    if (Math.abs(denominator) < 1e-12) continue;
    const next = u - numerator / denominator;
    if (Number.isFinite(next)) params[i] = Math.min(1, Math.max(0, next));
  }
}

/** The sample furthest from where the curve puts it, and how far, squared. */
function worstPoint(
  pts: readonly Vec2[],
  first: number,
  last: number,
  curve: Cubic,
  params: Float64Array,
): { readonly index: number; readonly squared: number } {
  const { a, c1, c2, b } = curve;
  let index = Math.floor((first + last) / 2);
  let squared = 0;
  for (let i = 1; i < params.length - 1; i++) {
    const u = params[i]!;
    const m = 1 - u;
    const w0 = m * m * m;
    const w1 = 3 * m * m * u;
    const w2 = 3 * m * u * u;
    const w3 = u * u * u;
    const p = pts[first + i]!;
    const dx = a.x * w0 + c1.x * w1 + c2.x * w2 + b.x * w3 - p.x;
    const dy = a.y * w0 + c1.y * w1 + c2.y * w2 + b.y * w3 - p.y;
    const d = dx * dx + dy * dy;
    if (d > squared) {
      squared = d;
      index = first + i;
    }
  }
  return { index, squared };
}

/** Samples with repeats removed: two samples in one place fit nothing between them. */
function dedupe(points: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last === undefined || dist(last, p) > 1e-9) out.push(p);
  }
  return out;
}

function straight(a: Vec2, b: Vec2): Cubic {
  return cubic(a, add(a, scale(sub(b, a), 1 / 3)), add(a, scale(sub(b, a), 2 / 3)), b);
}

const add = (p: Vec2, q: Vec2): Vec2 => ({ x: p.x + q.x, y: p.y + q.y });
const sub = (p: Vec2, q: Vec2): Vec2 => ({ x: p.x - q.x, y: p.y - q.y });
const scale = (p: Vec2, k: number): Vec2 => ({ x: p.x * k, y: p.y * k });
const neg = (p: Vec2): Vec2 => ({ x: -p.x, y: -p.y });
const dist = (p: Vec2, q: Vec2): number => Math.hypot(p.x - q.x, p.y - q.y);
function unit(v: Vec2): Vec2 | null {
  const len = Math.hypot(v.x, v.y);
  return len === 0 || !Number.isFinite(len) ? null : { x: v.x / len, y: v.y / len };
}
