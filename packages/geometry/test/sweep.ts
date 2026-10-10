import { type Cubic, evaluate, flatten } from "../src/cubic.js";
import { type PenShape, type SegmentBlend, penExponent, penProfiles } from "../src/pen.js";
import type { Vec2 } from "../src/vec2.js";

/**
 * The ink a pen leaves along a path, worked out the slow and obvious way, to hold
 * a stroker's answer against.
 *
 * The pen is stood at a few hundred places along each curve and drawn as a
 * polygon there — an oval as a many-sided one, a broad edge as its two ends — and
 * the ink between two places is every quadrilateral one edge of the pen sweeps
 * out getting from one to the next. Nothing clever, which is the point: a stroker
 * is checked against something that cannot share its mistakes.
 *
 * A grid of points is asked, and only the ones plainly inside or plainly outside
 * count — a point is plain when it and the eight points a `margin` around it all
 * agree. The edge itself is the stroker's to place to within its tolerance, and
 * a point on it is no evidence of anything.
 */

/** How many places along each curve the pen is stood at. */
const STANDS = 240;
/** How many sides the polygon an oval pen is drawn as has. */
const SIDES = 32;

/** The pen's outline at a place, as a convex polygon — two points for a broad edge. */
function penPolygon(pen: PenShape, at: Vec2): Vec2[] {
  const a = (pen.angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const along = pen.width / 2;
  const across = pen.thickness / 2;
  if (!(across > 0)) {
    return [
      { x: at.x + cos * along, y: at.y + sin * along },
      { x: at.x - cos * along, y: at.y - sin * along },
    ];
  }
  const out: Vec2[] = [];
  // The outline said outright, by its own equation and no question of reach: a
  // point round the circle with each coordinate raised to two over the exponent.
  const power = 2 / penExponent(pen);
  const raised = (v: number): number => Math.sign(v) * Math.pow(Math.abs(v), power);
  for (let i = 0; i < SIDES; i++) {
    const u = (i / SIDES) * Math.PI * 2;
    const x = raised(Math.cos(u)) * along;
    const y = raised(Math.sin(u)) * across;
    out.push({ x: at.x + cos * x - sin * y, y: at.y + sin * x + cos * y });
  }
  return out;
}

/** Whether `q` is inside a convex polygon, either way round. */
function inConvex(poly: readonly Vec2[], q: Vec2): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const c = (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x);
    if (c === 0) continue;
    const s = Math.sign(c);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

/** Whether `q` is inside a quadrilateral, which may be twisted: as its two triangles. */
function inQuad(a: Vec2, b: Vec2, c: Vec2, d: Vec2, q: Vec2): boolean {
  return (
    inConvex([a, b, c], q) ||
    inConvex([a, c, d], q) ||
    inConvex([a, b, d], q) ||
    inConvex([b, c, d], q)
  );
}

export type Swept = {
  readonly inked: (q: Vec2) => boolean;
  readonly bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

/** The ink along a path, as a membership test and the box it lies in. */
export function sweep(
  curves: readonly Cubic[],
  pens: readonly PenShape[],
  closed: boolean,
  blends?: readonly (SegmentBlend | undefined)[],
): Swept {
  const profiles = penProfiles(curves, pens, closed, blends);
  const stands: { centre: Vec2; reach: number; poly: Vec2[] }[][] = [];
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  curves.forEach((curve, i) => {
    const row: { centre: Vec2; reach: number; poly: Vec2[] }[] = [];
    for (let k = 0; k <= STANDS; k++) {
      const t = k / STANDS;
      const centre = evaluate(curve, t);
      const pen = profiles[i]!.at(t);
      const poly = penPolygon(pen, centre);
      for (const p of poly) {
        box.minX = Math.min(box.minX, p.x);
        box.minY = Math.min(box.minY, p.y);
        box.maxX = Math.max(box.maxX, p.x);
        box.maxY = Math.max(box.maxY, p.y);
      }
      row.push({ centre, reach: Math.max(pen.width, pen.thickness) / 2, poly });
    }
    stands.push(row);
  });

  const inked = (q: Vec2): boolean => {
    for (const row of stands) {
      for (let k = 0; k < row.length; k++) {
        const here = row[k]!;
        const near = Math.hypot(q.x - here.centre.x, q.y - here.centre.y);
        if (near > here.reach * 1.5 + 50) continue;
        if (here.poly.length > 2 && inConvex(here.poly, q)) return true;
        const next = row[k + 1];
        if (next === undefined) continue;
        const n = here.poly.length;
        for (let j = 0; j < n; j++) {
          const j2 = (j + 1) % n;
          if (n === 2 && j === 1) break;
          if (inQuad(here.poly[j]!, here.poly[j2]!, next.poly[j2]!, next.poly[j]!, q)) return true;
        }
      }
    }
    return false;
  };
  return { inked, bounds: box };
}

/** The winding number of a point against loops of cubics, flattened finely. */
export function winding(loops: readonly (readonly Cubic[])[], q: Vec2): number {
  let w = 0;
  for (const loop of loops) {
    const pts: Vec2[] = [];
    for (const s of loop) {
      const flat = flatten(s, 0.01);
      pts.push(...(pts.length === 0 ? flat : flat.slice(1)));
    }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      if (a.y <= q.y) {
        if (b.y > q.y && (b.x - a.x) * (q.y - a.y) - (q.x - a.x) * (b.y - a.y) > 0) w++;
      } else if (b.y <= q.y && (b.x - a.x) * (q.y - a.y) - (q.x - a.x) * (b.y - a.y) < 0) {
        w--;
      }
    }
  }
  return w;
}

export type Disagreement = {
  /** Points plainly inked that the loops leave empty: holes and notches. */
  readonly missing: Vec2[];
  /** Points plainly not inked that the loops fill: ink where no pen went. */
  readonly extra: Vec2[];
  /** How many points were plain enough to count. */
  readonly checked: number;
};

/**
 * Where loops, filled by the non-zero rule, disagree with the swept pen over a grid
 * of `across` points on the longer side of the ink's box — or of `within`, to look
 * closely at one place without paying for the whole stroke at that spacing.
 */
export function disagreement(
  loops: readonly (readonly Cubic[])[],
  swept: Swept,
  across = 70,
  margin = 1.5,
  within?: { minX: number; minY: number; maxX: number; maxY: number },
): Disagreement {
  const { minX, minY, maxX, maxY } = within ?? swept.bounds;
  const step = Math.max(maxX - minX, maxY - minY) / across;
  const missing: Vec2[] = [];
  const extra: Vec2[] = [];
  let checked = 0;
  const ring: Vec2[] = [];
  for (let i = 0; i < 8; i++) {
    const u = (i / 8) * Math.PI * 2;
    ring.push({ x: Math.cos(u) * margin, y: Math.sin(u) * margin });
  }
  for (let y = minY - step; y <= maxY + step; y += step) {
    for (let x = minX - step; x <= maxX + step; x += step) {
      const q = { x, y };
      const here = swept.inked(q);
      if (!ring.every((r) => swept.inked({ x: x + r.x, y: y + r.y }) === here)) continue;
      checked++;
      const filled = winding(loops, q) !== 0;
      if (here && !filled) missing.push(q);
      if (!here && filled) extra.push(q);
    }
  }
  return { missing, extra, checked };
}
