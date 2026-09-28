import { type Cubic, type Vec2, fitCubics, flatten } from "@typewright/geometry";
import * as clipping from "polygon-clipping";

import { type Contour, segmentAt, segmentCount, segmentCubic } from "./contour.js";
import { type CurvePiece, contourOfCurves } from "./curves.js";
import type { IdFactory } from "./ids.js";

/**
 * The union as polygons, for when the union of curves gives up.
 *
 * The union of curves is exact and keeps every curve a person drew, and it has
 * one weakness: edges that run all but on top of each other for a stretch — the
 * two legs of a pen stroke at a sharp corner sweep the same positions of the pen,
 * and their edges lie a few thousandths of a unit apart — where it cannot tell
 * which stretch is buried, and declines. A polygon union has no such trouble:
 * polygon-clipping (Martinez–Rueda, with exact orientation tests) settles
 * coincident and near-coincident edges as a matter of course. So the contours are
 * flattened finely, joined as polygons, and cubics fitted back through what is
 * left, corners kept as corners.
 *
 * Not exact: every curve comes back refitted, within a few hundredths of a unit.
 * Which is why this is the fallback and not the union.
 *
 * The non-zero rule, as a font fills: contours turning the way an outer contour
 * turns are joined, and those turning the other way — counters — are taken out
 * of the result. `null` where there is nothing left, or nothing could be fitted.
 */

/** How finely curves are flattened, in units. */
const FLATTEN = 0.02;
/** How closely cubics are fitted back through the joined polygons, in units. */
const FIT = 0.05;
/** A turn sharper than this between two flattened edges is a corner, in radians. */
const CORNER = (30 * Math.PI) / 180;

// The package's own types name its functions, and its module build exports them
// on a default object: taken from whichever of the two the bundler hands over.
type Clipping = typeof clipping;
const pc: Clipping = (clipping as unknown as { default?: Clipping }).default ?? clipping;

export function unionByPolygons(contours: readonly Contour[], ids: IdFactory): Contour[] | null {
  const outer: clipping.Polygon[] = [];
  const counters: clipping.Polygon[] = [];
  for (const c of contours) {
    const ring = ringOf(c);
    if (ring.length < 3) continue;
    (area(ring) >= 0 ? outer : counters).push([ring]);
  }
  if (outer.length === 0) return null;

  let joined = pc.union(outer[0]!, ...outer.slice(1));
  if (counters.length > 0) joined = pc.difference(joined, ...counters);

  const out: Contour[] = [];
  for (const polygon of joined) {
    for (const ring of polygon) {
      const fitted = contourOfRing(ring, ids);
      if (fitted !== null) out.push(fitted);
    }
  }
  return out.length === 0 ? null : out;
}

/** A closed contour as one ring of points, its curves flattened. */
function ringOf(c: Contour): clipping.Ring {
  const points: clipping.Ring = [];
  for (let i = 0; i < segmentCount(c); i++) {
    const s = segmentAt(c, i);
    if (s === null) continue;
    const flat = s.kind === "line" ? [s.a, s.b] : flatten(segmentCubic(s), FLATTEN);
    for (const p of flat.slice(0, -1)) {
      const x = snap(p.x);
      const y = snap(p.y);
      const last = points[points.length - 1];
      if (last === undefined || last[0] !== x || last[1] !== y) points.push([x, y]);
    }
  }
  return points;
}

/**
 * A coordinate on a grid of a sixty-five-thousandth of a unit. Two pieces meant to
 * meet along one line — the pieces of a pen stroke, one worked out through the
 * space where the pen is round and one not — agree to a trillionth of a unit, and
 * a polygon union treats edges that far apart as two edges, keeping the pieces
 * apart. On the grid they are one edge.
 */
const snap = (value: number): number => Math.round(value * 65536) / 65536;

/** Twice the signed area of a ring: positive turning anticlockwise, as an outer contour does. */
function area(ring: clipping.Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[(i + 1) % ring.length]!;
    sum += x0 * y1 - x1 * y0;
  }
  return sum;
}

/**
 * A ring of points back into a contour of cubics: split at its corners, each run
 * between two corners fitted, a run that is straight kept a line.
 */
function contourOfRing(ring: clipping.Ring, ids: IdFactory): Contour | null {
  // The ring comes back closed, its first point repeated at the end.
  const pts: Vec2[] = ring.map(([x, y]) => ({ x, y }));
  if (pts.length > 1 && same(pts[0]!, pts[pts.length - 1]!)) pts.pop();
  const n = pts.length;
  if (n < 3) return null;

  const corners: number[] = [];
  for (let i = 0; i < n; i++) {
    const before = pts[(i - 1 + n) % n]!;
    const here = pts[i]!;
    const after = pts[(i + 1) % n]!;
    if (turn(before, here, after) > CORNER) corners.push(i);
  }

  const chain: CurvePiece[] = [];
  const run = (from: number, to: number): void => {
    // The points from one corner to the next, round the ring.
    const points: Vec2[] = [];
    for (let k = from; ; k = (k + 1) % n) {
      points.push(pts[k]!);
      if (k === to) break;
    }
    if (points.length === 2 || straight(points)) {
      chain.push({ curve: line(points[0]!, points[points.length - 1]!), line: true });
      return;
    }
    for (const curve of fitCubics(points, FIT)) chain.push({ curve, line: false });
  };

  if (corners.length === 0) {
    // A ring with no corner, a round: fitted from its first point round to itself,
    // leaving and arriving along the direction through that point, so it closes
    // smoothly.
    const direction = unit({ x: pts[1]!.x - pts[n - 1]!.x, y: pts[1]!.y - pts[n - 1]!.y });
    const closed = [...pts, pts[0]!];
    for (const curve of fitCubics(closed, FIT, direction ?? undefined, direction ?? undefined)) {
      chain.push({ curve, line: false });
    }
  } else {
    for (let i = 0; i < corners.length; i++) {
      run(corners[i]!, corners[(i + 1) % corners.length]!);
    }
  }
  return chain.length < 2 ? null : contourOfCurves(chain, ids);
}

/** How far the path turns at `here`, in radians. */
function turn(before: Vec2, here: Vec2, after: Vec2): number {
  const a = { x: here.x - before.x, y: here.y - before.y };
  const b = { x: after.x - here.x, y: after.y - here.y };
  return Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y));
}

/** Whether every point of a run lies within the fitting tolerance of its chord. */
function straight(points: readonly Vec2[]): boolean {
  const a = points[0]!;
  const b = points[points.length - 1]!;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length === 0) return true;
  return points.every(
    (p) => Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / length <= FIT,
  );
}

function line(a: Vec2, b: Vec2): Cubic {
  return {
    a,
    c1: { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
    c2: { x: a.x + ((b.x - a.x) * 2) / 3, y: a.y + ((b.y - a.y) * 2) / 3 },
    b,
  };
}

const same = (p: Vec2, q: Vec2): boolean => p.x === q.x && p.y === q.y;

function unit(v: Vec2): Vec2 | null {
  const length = Math.hypot(v.x, v.y);
  return length === 0 ? null : { x: v.x / length, y: v.y / length };
}

/**
 * Whether a union's answer is not finished: outlines that, joined again as
 * polygons, come to fewer — two that overlap, or that meet along a stretch of edge
 * and so are one shape. The union of curves can hand that back where edges lying
 * all but on top of each other fooled it into keeping loops it should have joined.
 */
export function joinsFurther(contours: readonly Contour[]): boolean {
  const rings = contours.map((c) => ringOf(c)).filter((ring) => ring.length >= 3);
  const outer = rings.filter((ring) => area(ring) >= 0).map((ring) => [ring]);
  const counters = rings.filter((ring) => area(ring) < 0).map((ring) => [ring]);
  if (outer.length < 2) return false;
  let joined = pc.union(outer[0]!, ...outer.slice(1));
  if (counters.length > 0) joined = pc.difference(joined, ...counters);
  return joined.reduce((sum, polygon) => sum + polygon.length, 0) < rings.length;
}
