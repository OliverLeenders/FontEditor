import {
  type Cubic,
  type PenShape,
  blendPen,
  loopArea,
  penPathStroke,
  reverseLoop,
} from "@typewright/geometry";

import { type Contour, type Nib, segmentAt, segmentCount, segmentCubic } from "./contour.js";
import { type Glyph, glyph } from "./glyph.js";
import { type IdFactory, counterIds } from "./ids.js";
import { corneredContour, hasContinuousCorners } from "./corner.js";
import { contourOfCurves } from "./curves.js";
import { removeOverlap } from "./overlap.js";
import { joinsFurther, unionByPolygons } from "./polygon-union.js";

/**
 * Drawing with a pen: a contour that is a skeleton, and the ink it leaves.
 *
 * A contour with a nib on it is the path a broad-edged pen is drawn along, and its
 * points are edited like any other contour's. What it *draws* is worked out from
 * it, here, and nowhere else: the view asks for the ink to fill, the exporter asks
 * for it to write, and the ruler asks for it to measure.
 *
 * The ink of the whole path is the ink of each segment put together — the pen's
 * sweep along a path is the sweep along its pieces — so each segment is stroked on
 * its own, every region is turned the same way round, and the union joins them.
 * Where two segments meet, both regions include the nib at the point they share,
 * so a corner is covered without any join being worked out: it is what the pen
 * covers standing at the corner.
 */

/** A pen to start from: a foundational hand's angle, a stem's worth of width. */
export const DEFAULT_NIB: Nib = { angle: 30, width: 80 };

/**
 * What a contour draws, as outlines.
 *
 * An outline draws itself, and comes back as the one contour it is. A skeleton
 * draws the ink its nib leaves along it, as however many closed contours that
 * takes — one for a simple stroke, more where the stroke crosses itself or the
 * pen pinches it to nothing and it comes apart. A skeleton that leaves no ink at
 * all, drawn entirely along the nib's own edge, draws nothing.
 */
export function inkOf(c: Contour, ids: IdFactory): readonly Contour[] {
  if (c.nib === undefined) return [corneredContour(c)];
  const known = joinedInk.get(c);
  if (known !== undefined) return known;

  // Slivers left out: where the path runs along the nib's own edge a stretch of
  // ink can be a hair thin, less ink than anything shows, and its two long sides
  // lying all but on each other are more than the union can tell apart.
  const regions = inkRegions(c).filter((r) => thickness(r) >= SLIVER);
  // One outline out of the regions. The union may decline a boundary it cannot
  // close; the regions are still the right ink by the non-zero rule, only
  // overlapping, so they are drawn as they are rather than not at all.
  const joined =
    regions.length < 2 ? null : removeOverlap(glyph("", { contours: [...regions] }), ids);
  let answer: readonly Contour[] =
    joined === null ? regions : joined.glyph.contours.filter((r) => thickness(r) >= SLIVER);
  // The union of curves can be fooled by edges lying all but on top of each other
  // — the legs of a stroke at a sharp corner — into handing back loops that still
  // overlap, or meet along an edge. Checked, and joined as polygons where they do.
  if (joined !== null && answer.length > 1 && joinsFurther(answer)) {
    answer = unionByPolygons(regions, ids) ?? answer;
  }
  joinedInk.set(c, answer);
  return answer;
}

/** Below this average thickness, in units, a region of ink is a sliver. */
const SLIVER = 0.25;

/**
 * How thick a region is on average: its area over half its perimeter, from its
 * points — rough, and only ever asked whether it is next to nothing.
 */
function thickness(c: Contour): number {
  const pts = c.nodes.map((n) => n.pt);
  let area = 0;
  let perimeter = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    area += a.x * b.y - b.x * a.y;
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return perimeter === 0 ? 0 : Math.abs(area) / perimeter;
}

/**
 * Answers remembered per contour, which is what makes a stroke cheap to draw.
 *
 * The model is persistent: a contour that has not changed is the same object, so
 * dragging one point of one stroke leaves every other stroke's contour — and its
 * answer here — exactly where it was, and only the stroke being dragged is worked
 * out again. Nothing needs invalidating by hand, because a changed contour is a
 * different key.
 */
const joinedInk = new WeakMap<Contour, readonly Contour[]>();
const regionsOf = new WeakMap<Contour, readonly Contour[]>();

/** Ids for the regions of a stroke's ink: nothing selects them, they are drawn. */
const regionIds = counterIds("ink-");

/**
 * The ink a stroke leaves, as the regions it is made of, not joined.
 *
 * What the canvas fills, and why it fills this rather than the joined outline:
 * every region is turned the same way round, the way outlines are, so the non-zero
 * rule fills overlapping regions exactly as it would fill their union — and the
 * union is by far the dearest part of a stroke, dear enough that drawing one while
 * its points were dragged ran at a few frames a second. The joined outline is for
 * where one outline is what is asked for: the font, the `.ufo`, the ruler.
 */
export function inkRegions(c: Contour): readonly Contour[] {
  const nib = c.nib;
  if (nib === undefined) return [corneredContour(c)];
  const known = regionsOf.get(c);
  if (known !== undefined) return known;
  if (!(nib.width > 0) || c.nodes.length < 2) {
    regionsOf.set(c, []);
    return [];
  }

  const curves: Cubic[] = [];
  for (let i = 0; i < segmentCount(c); i++) {
    const segment = segmentAt(c, i);
    if (segment !== null) curves.push(segmentCubic(segment));
  }

  // The pen at every point, which is the point's own where it has one and the
  // contour's where it does not; along each segment it blends from one to the
  // next. Where a segment's two pens are the same, its ink is worked out as it
  // always was — exactly, for a broad edge.
  const pieces = penPathStroke(
    curves,
    pensOf(c),
    c.closed,
    undefined,
    c.nodes.map((n) => n.blend),
  );

  // Every piece the same way round — anticlockwise, which is how an outline's
  // outer contour is turned for the fill — or two that overlap with opposite
  // turns cancel where they cross and leave a hole in the stroke.
  const loops = pieces.map((loop) => (loopArea(loop) < 0 ? reverseLoop(loop) : loop));
  const regions = loops.map((loop) =>
    contourOfCurves(
      loop.map((curve) => ({ curve, line: straight(curve) })),
      regionIds,
    ),
  );
  regionsOf.set(c, regions);
  return regions;
}

/**
 * How thick a pen has to be to be drawn as an oval rather than a broad edge.
 *
 * Half a unit. Below it the difference is invisible, and the broad edge is the
 * exact answer where the oval is an approximation: a pen typed as a tenth of a unit
 * thick should get the exact stroke it is indistinguishable from.
 */
const OVAL_FROM = 0.5;

/** Whether a pen is drawn as an oval, or as the broad edge it is too thin to differ from. */
export function isOval(nib: Nib): boolean {
  return (nib.thickness ?? 0) >= OVAL_FROM;
}

/** The pen at a point of a stroke: the point's own, or the contour's. */
export function penAt(c: Contour, i: number): Nib | null {
  const own = c.nodes[i]?.pen;
  return own ?? c.nib ?? null;
}

/** The pen at every point of a stroke, as the geometry wants it. */
function pensOf(c: Contour): PenShape[] {
  return c.nodes.map((_, i) => {
    const pen = penAt(c, i) ?? { angle: 0, width: 0 };
    return { angle: pen.angle, width: pen.width, thickness: pen.thickness ?? 0 };
  });
}

/**
 * The pen a fraction of the way from one pen to another, as a stroke's pen.
 *
 * What a point put into a stroke is given: the pen the stroke already had at that
 * place, so putting a point in changes nothing about the ink until the point's pen
 * is changed. The angle turns the short way round, over half a turn.
 */
export function blendNib(a: Nib, b: Nib, t: number): Nib {
  const pen = blendPen(
    { angle: a.angle, width: a.width, thickness: a.thickness ?? 0 },
    { angle: b.angle, width: b.width, thickness: b.thickness ?? 0 },
    t,
  );
  return pen.thickness > 0
    ? { angle: pen.angle, width: pen.width, thickness: pen.thickness }
    : { angle: pen.angle, width: pen.width };
}

/**
 * A glyph with every skeleton turned into the ink it draws.
 *
 * Outlines keep their places and their ids; a skeleton's ink takes its place in the
 * order. For everything that needs to know what a glyph draws — the view's fill,
 * the exporter, a glyph placed in another as a component — and not for anything
 * that edits it, since a skeleton's points are the ones a designer drags.
 *
 * The same glyph back when it has no skeletons, which is nearly every glyph, so a
 * caller that remembers answers by glyph keeps remembering them.
 */
export function withInk(g: Glyph, ids: IdFactory): Glyph {
  if (!g.contours.some(isDerived)) return g;
  return { ...g, contours: g.contours.flatMap((c) => inkOf(c, ids)) };
}

/**
 * Whether what a contour draws is worked out from it rather than being it: a
 * stroke, whose ink comes from its pen, or an outline with continuous corners,
 * whose drawing rounds them.
 */
export function isDerived(c: Contour): boolean {
  return c.nib !== undefined || hasContinuousCorners(c);
}

/**
 * Give a contour a pen, or take it away.
 *
 * Taking it away leaves the skeleton as it is, as an ordinary contour: it was a
 * path the whole time, and what changes is whether it is the edge of the ink or
 * the line a pen is drawn along.
 */
export function withNib(c: Contour, nib: Nib | null): Contour {
  if (nib === null) {
    if (c.nib === undefined) return c;
    // Rebuilt without the field rather than with it set to nothing, so a contour
    // that had a pen and lost it is written exactly as one that never had one.
    return { id: c.id, closed: c.closed, nodes: c.nodes };
  }
  if (c.nib !== undefined && samePen(c.nib, nib)) return c;
  return { ...c, nib };
}

/** Whether two pens are the same pen: angle, width, and thickness, absent being none. */
export function samePen(a: Nib, b: Nib): boolean {
  return a.angle === b.angle && a.width === b.width && (a.thickness ?? 0) === (b.thickness ?? 0);
}

/** Whether a curve is a straight line, which is how a line is kept a line. */
function straight(s: Cubic): boolean {
  const span = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
  if (span === 0) return false;
  const off = (p: { x: number; y: number }) =>
    Math.abs((s.b.x - s.a.x) * (p.y - s.a.y) - (p.x - s.a.x) * (s.b.y - s.a.y)) / span;
  return off(s.c1) < 1e-9 && off(s.c2) < 1e-9;
}
