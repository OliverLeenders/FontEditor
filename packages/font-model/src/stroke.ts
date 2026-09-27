import {
  type Cubic,
  halfNib,
  loopArea,
  nibStroke,
  ovalPathStroke,
  reverseLoop,
} from "@typewright/geometry";

import { type Contour, type Nib, segmentAt, segmentCount, segmentCubic } from "./contour.js";
import { type Glyph, glyph } from "./glyph.js";
import type { IdFactory } from "./ids.js";
import { contourOfCurves } from "./curves.js";
import { removeOverlap } from "./overlap.js";

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
  const nib = c.nib;
  if (nib === undefined) return [c];
  if (!(nib.width > 0) || c.nodes.length < 2) return [];

  const curves: Cubic[] = [];
  for (let i = 0; i < segmentCount(c); i++) {
    const segment = segmentAt(c, i);
    if (segment !== null) curves.push(segmentCubic(segment));
  }

  // A broad edge is worked out a curve at a time and needs to know nothing about
  // its neighbours: each stretch includes the nib at its ends, and that covers the
  // corners. An oval needs the path, because its joins are wedges round the
  // corners and its ends are caps only where the path actually ends.
  const half = halfNib(nib.angle, nib.width);
  const pieces = isOval(nib)
    ? ovalPathStroke(curves, c.closed, nib.angle, nib.width, nib.thickness ?? 0)
    : curves.flatMap((curve) => nibStroke(curve, half));

  // Every piece the same way round, or two that overlap with opposite turns cancel
  // where they cross and leave a hole in the stroke.
  const loops = pieces.map((loop) => (loopArea(loop) < 0 ? reverseLoop(loop) : loop));
  if (loops.length === 0) return [];

  const regions = loops.map((loop) =>
    contourOfCurves(
      loop.map((curve) => ({ curve, line: straight(curve) })),
      ids,
    ),
  );

  // One outline out of the regions. The union may decline a boundary it cannot
  // close; the regions are still the right ink by the non-zero rule, only
  // overlapping, so they are drawn as they are rather than not at all.
  const joined = removeOverlap(glyph("", { contours: regions }), ids);
  return joined === null ? regions : joined.glyph.contours;
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
  if (!g.contours.some((c) => c.nib !== undefined)) return g;
  return { ...g, contours: g.contours.flatMap((c) => inkOf(c, ids)) };
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
