import { type Vec2, flatten } from "@fonteditor/geometry";

import { type Contour, reverseContour, segmentAt, segmentCount, segmentCubic } from "./contour.js";
import type { Glyph } from "./glyph.js";

/**
 * Which way round a contour runs, and putting a set of them right.
 *
 * A filled outline is not a set of shapes laid over one another; it is one path,
 * and a rasteriser decides what is ink by the non-zero winding rule: a point is
 * inside when the contours around it do not cancel out. So two contours that
 * overlap must run the *same* way round or the overlap is subtracted, and a
 * counter must run the *opposite* way to the contour holding it or it is not a
 * hole at all.
 *
 * Nothing in a drawing program makes that happen by itself — which way a contour
 * runs is an accident of the order the points were placed. Every font tool
 * therefore has a "correct path direction" pass, and this is ours. It is applied
 * where the font is compiled, so what is drawn stays exactly as it was drawn.
 *
 * The convention is PostScript's, which is what a CFF outline wants: an outer
 * contour anticlockwise, a hole clockwise. In design space y grows upward, so
 * anticlockwise is a positive signed area.
 */

/** A contour as a closed polygon, fine enough for area and containment. */
function polygon(c: Contour): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i < segmentCount(c); i++) {
    const segment = segmentAt(c, i);
    if (segment === null) continue;
    // Each piece ends where the next begins, so the shared point is dropped.
    points.push(...flatten(segmentCubic(segment), 0.05).slice(0, -1));
  }
  return points;
}

/**
 * Twice the signed area of a contour: positive anticlockwise, negative
 * clockwise, zero for a contour with no area to speak of.
 *
 * The shoelace sum over the flattened outline. Doubling is left in because
 * nothing here divides by anything and the sign is the whole point.
 */
export function contourWinding(c: Contour): number {
  const points = polygon(c);
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/** Whether a point is inside a polygon, by the non-zero rule. */
function inside(p: Vec2, poly: readonly Vec2[]): boolean {
  let winding = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const side = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
    if (a.y <= p.y) {
      if (b.y > p.y && side > 0) winding += 1;
    } else if (b.y <= p.y && side < 0) {
      winding -= 1;
    }
  }
  return winding !== 0;
}

/** How many sample points to take along a contour when asking what holds it. */
const SAMPLES = 16;

/** Points spread along a contour, for asking whether it lies within another. */
function samples(poly: readonly Vec2[]): Vec2[] {
  if (poly.length <= SAMPLES) return [...poly];
  const step = poly.length / SAMPLES;
  const out: Vec2[] = [];
  for (let i = 0; i < SAMPLES; i++) out.push(poly[Math.floor(i * step)]!);
  return out;
}

/**
 * Whether `poly` lies within `holder`.
 *
 * Every sample must be inside, not merely one. A contour that *overlaps*
 * another has points on both sides of it, and calling that containment is
 * exactly the mistake that would turn a stem crossing a shoulder into a hole —
 * which is the bug this whole pass exists to prevent rather than cause.
 */
function within(poly: readonly Vec2[], holder: readonly Vec2[]): boolean {
  return samples(poly).every((p) => inside(p, holder));
}

/**
 * The same contours, each running the way its nesting says it should.
 *
 * A contour inside an even number of others is an outer one and runs
 * anticlockwise; inside an odd number, it is a hole and runs the other way. A
 * contour that merely overlaps another is inside nothing, so overlapping shapes
 * come out running the same way and their union is what gets filled.
 *
 * Open contours and contours with no area are left exactly as they are: neither
 * has a direction worth the name, and a font closes an open one itself.
 *
 * Returns the very same array when nothing needed turning, so a caller can tell
 * whether it changed anything by comparing references.
 */
export function correctDirections(contours: readonly Contour[]): readonly Contour[] {
  if (contours.length === 0) return contours;

  const polygons = contours.map((c) => (c.closed ? polygon(c) : []));
  const windings = contours.map((c) => (c.closed ? contourWinding(c) : 0));

  const out = contours.map((c, i) => {
    if (!c.closed || windings[i] === 0) return c;

    let depth = 0;
    for (let j = 0; j < contours.length; j++) {
      if (j === i || windings[j] === 0) continue;
      // Only a larger contour can hold a smaller one, which also settles the
      // case of two identical contours drawn on top of each other.
      if (Math.abs(windings[j]!) < Math.abs(windings[i]!)) continue;
      if (within(polygons[i]!, polygons[j]!)) depth += 1;
    }

    const wanted = depth % 2 === 0 ? 1 : -1;
    return Math.sign(windings[i]!) === wanted ? c : reverseContour(c);
  });

  return out.every((c, i) => c === contours[i]) ? contours : out;
}

/**
 * A glyph's contours as anything filling them should see them, worked out once.
 *
 * Correcting directions costs a containment test between every pair of contours,
 * which is not work for a frame — and need not be. The model is persistent, so a
 * glyph that has changed is a different object and a glyph that has not keeps
 * its answer; there is no invalidation to get wrong.
 */
const filled = new WeakMap<Glyph, readonly Contour[]>();

export function filledContours(g: Glyph): readonly Contour[] {
  const known = filled.get(g);
  if (known !== undefined) return known;
  const corrected = correctDirections(g.contours);
  filled.set(g, corrected);
  return corrected;
}
