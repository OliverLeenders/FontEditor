import { type Vec2, flatten } from "@typewright/geometry";

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

/** How many bands a contour's outline is filed into, to compare two of them. */
const BANDS = 64;

/**
 * A flattened outline with its segments filed by height.
 *
 * Asking whether two outlines cross means asking it of every pair of their
 * segments, and an `o` flattened finely enough to measure is several hundred of
 * them — a few hundred thousand pairs for one question asked while a grid of
 * glyphs is being drawn. Filing the segments by which horizontal band they
 * occupy means each segment of one outline is only compared with the handful of
 * the other's that could possibly reach it.
 */
type Boundary = {
  readonly points: readonly Vec2[];
  readonly bands: readonly (readonly number[])[];
  readonly minY: number;
  readonly bandHeight: number;
};

function boundaryOf(points: readonly Vec2[]): Boundary {
  const bands: number[][] = Array.from({ length: BANDS }, () => []);
  if (points.length < 2) return { points, bands, minY: 0, bandHeight: 0 };

  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const bandHeight = (maxY - minY) / BANDS;

  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const [first, last] = bandsFor(Math.min(a.y, b.y), Math.max(a.y, b.y), minY, bandHeight);
    for (let band = first; band <= last; band++) bands[band]!.push(i);
  }

  return { points, bands, minY, bandHeight };
}

/** The bands a height range falls in, clamped to the ones that exist. */
function bandsFor(low: number, high: number, minY: number, bandHeight: number): [number, number] {
  if (!(bandHeight > 0)) return [0, BANDS - 1];
  const first = Math.floor((low - minY) / bandHeight);
  const last = Math.floor((high - minY) / bandHeight);
  return [Math.min(Math.max(first, 0), BANDS - 1), Math.min(Math.max(last, 0), BANDS - 1)];
}

/** Which side of the line through `a` and `b` the point `c` falls. */
function side(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * Whether two segments properly cross: each has an end on either side of the
 * other.
 *
 * Touching — an end exactly on the other segment, or the two lying along each
 * other — is deliberately not crossing. Contours that meet without passing
 * through one another are how a counter is drawn against the stroke holding it,
 * and reading that as a crossing would undo the containment it is meant to
 * establish.
 */
function segmentsCross(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const d1 = side(b1, b2, a1);
  const d2 = side(b1, b2, a2);
  if (d1 === 0 || d2 === 0 || d1 > 0 === d2 > 0) return false;

  const d3 = side(a1, a2, b1);
  const d4 = side(a1, a2, b2);
  return d3 !== 0 && d4 !== 0 && d3 > 0 !== d4 > 0;
}

/** Whether the two outlines pass through one another anywhere. */
function boundariesCross(poly: readonly Vec2[], holder: Boundary): boolean {
  if (poly.length < 2 || holder.points.length < 2) return false;

  for (let i = 0; i < poly.length; i++) {
    const a1 = poly[i]!;
    const a2 = poly[(i + 1) % poly.length]!;
    const [first, last] = bandsFor(
      Math.min(a1.y, a2.y),
      Math.max(a1.y, a2.y),
      holder.minY,
      holder.bandHeight,
    );
    for (let band = first; band <= last; band++) {
      for (const j of holder.bands[band]!) {
        const b1 = holder.points[j]!;
        const b2 = holder.points[(j + 1) % holder.points.length]!;
        if (segmentsCross(a1, a2, b1, b2)) return true;
      }
    }
  }
  return false;
}

/**
 * Whether `poly` lies within `holder`.
 *
 * Two questions, because either alone is answered wrongly by a shape that is
 * partly inside. Every sample point must be inside — a contour that plainly
 * overlaps another has points on both sides of it — and the two outlines must
 * not cross anywhere, which is what settles the case the samples get wrong.
 *
 * The case they get wrong is a real drawing: the stem of a dollar sign crossing
 * an `S`, or any bar laid across two strokes with a gap between them. Its
 * corners all land in ink, so every sample says "inside", while the middle of
 * it passes through the gap and out of the letter entirely. Turning it into a
 * hole punches a notch out of the letter exactly where the two should have
 * joined — which is the bug this whole pass exists to prevent rather than
 * cause.
 */
function within(poly: readonly Vec2[], holder: Boundary): boolean {
  if (!samples(poly).every((p) => inside(p, holder.points))) return false;
  return !boundariesCross(poly, holder);
}

/**
 * Which contours hold which.
 *
 * `depth` is how many others each one is inside, which says whether it is ink
 * or a hole; `parent` is the innermost of them, which says *whose* hole it is.
 * Both fall out of the same containment test, and that test is the expensive
 * part — every contour against every other — so the two callers that want it
 * ask for it once here rather than each running their own pass.
 */
type Nesting = {
  readonly depth: readonly number[];
  readonly parent: readonly (number | null)[];
};

function nestingOf(contours: readonly Contour[]): Nesting {
  const polygons = contours.map((c) => (c.closed ? polygon(c) : []));
  const windings = contours.map((c) => (c.closed ? contourWinding(c) : 0));
  // Filed by height once each, because every contour is asked about every other.
  const boundaries = polygons.map(boundaryOf);

  const depth: number[] = [];
  const parent: (number | null)[] = [];

  for (let i = 0; i < contours.length; i++) {
    if (!contours[i]!.closed || windings[i] === 0) {
      depth.push(0);
      parent.push(null);
      continue;
    }

    let held = 0;
    let innermost: number | null = null;
    let smallest = Infinity;

    for (let j = 0; j < contours.length; j++) {
      if (j === i || windings[j] === 0) continue;
      // Only a larger contour can hold a smaller one, which also settles the
      // case of two identical contours drawn on top of each other.
      const area = Math.abs(windings[j]!);
      if (area < Math.abs(windings[i]!)) continue;
      if (!within(polygons[i]!, boundaries[j]!)) continue;

      held += 1;
      // The smallest thing holding it is the one it is a hole *of*: a counter
      // inside a bowl inside nothing belongs to the bowl.
      if (area < smallest) {
        smallest = area;
        innermost = j;
      }
    }

    depth.push(held);
    parent.push(innermost);
  }

  return { depth, parent };
}

/** One filled shape: the contour bounding it, and the holes punched in it. */
export type ContourShape = {
  readonly outer: number;
  readonly holes: readonly number[];
};

/**
 * The contours grouped into the shapes they draw.
 *
 * A contour inside an even number of others bounds ink and begins a shape;
 * inside an odd number it is a hole, and belongs to the shape of the contour
 * immediately around it. An island drawn inside a counter is two deep and so
 * begins a shape of its own, which is what it looks like.
 *
 * This is the difference between a hole and a neighbour, and the knife needs it:
 * a cut across an `o` has to close from the outer contour to the counter,
 * because they bound one piece of ink, while a cut across two overlapping
 * shapes has to cut each of them and leave them two.
 *
 * Open contours draw no ink and are in no shape.
 */
export function shapesOf(contours: readonly Contour[]): ContourShape[] {
  const { depth, parent } = nestingOf(contours);

  const holes = new Map<number, number[]>();
  const outers: number[] = [];

  for (let i = 0; i < contours.length; i++) {
    if (!contours[i]!.closed) continue;
    if (depth[i]! % 2 === 0) {
      outers.push(i);
      continue;
    }
    const owner = parent[i];
    if (owner === null || owner === undefined) continue;
    const list = holes.get(owner);
    if (list === undefined) holes.set(owner, [i]);
    else list.push(i);
  }

  return outers.map((outer) => ({ outer, holes: holes.get(outer) ?? [] }));
}

/** A closed contour as a flat polygon, for asking what is inside it. */
export function contourPolygon(c: Contour): Vec2[] {
  return polygon(c);
}

/** Whether a point is inside these polygons, by the non-zero winding rule. */
export function insidePolygons(polygons: readonly (readonly Vec2[])[], p: Vec2): boolean {
  let winding = 0;
  for (const poly of polygons) winding += windingAt(poly, p);
  return winding !== 0;
}

/** How many times a polygon winds about a point, with its sign. */
function windingAt(poly: readonly Vec2[], p: Vec2): number {
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
  return winding;
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

  const windings = contours.map((c) => (c.closed ? contourWinding(c) : 0));
  const { depth } = nestingOf(contours);

  const out = contours.map((c, i) => {
    if (!c.closed || windings[i] === 0) return c;
    const wanted = depth[i]! % 2 === 0 ? 1 : -1;
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

/**
 * A glyph's filled outlines as flat polygons, worked out once.
 *
 * For asking whether a point is inside the letter, which is a question the
 * measuring tools ask on every pointer move. Memoised on the glyph for the same
 * reason {@link filledContours} is: the model is persistent, so an unchanged
 * glyph is the same object and there is no invalidation to get wrong.
 */
const polygons = new WeakMap<Glyph, Vec2[][]>();

export function glyphPolygons(g: Glyph): readonly (readonly Vec2[])[] {
  const known = polygons.get(g);
  if (known !== undefined) return known;

  const built = filledContours(g)
    .filter((c) => c.closed)
    .map(polygon);
  polygons.set(g, built);
  return built;
}

/**
 * Whether a point is inside the ink, by the non-zero winding rule.
 *
 * The directions are corrected first — through {@link filledContours} — so a
 * counter drawn the same way round as the shape holding it still reads as a
 * hole, which is what the compiled font will draw.
 */
export function insideGlyph(g: Glyph, p: Vec2): boolean {
  return insidePolygons(glyphPolygons(g), p);
}
