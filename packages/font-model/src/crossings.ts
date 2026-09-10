import { type Vec2, intersectSegmentCubic } from "@fonteditor/geometry";

import { segmentAt, segmentCount, segmentCubic } from "./contour.js";
import type { Glyph } from "./glyph.js";

/**
 * Where a straight stroke meets a glyph's outline.
 *
 * Shared by the knife and the measure, which want the same thing and learned the
 * same lesson: a crossing that lands on a node is found twice, once from the
 * segment arriving and once from the one leaving. Counting it twice makes an odd
 * number of crossings look even, which for the knife is the difference between
 * cutting a shape and mangling it, and for the measure is a stem width of zero.
 */

export type StrokeCrossing = {
  readonly contourIndex: number;
  readonly segmentIndex: number;
  /** Parameter along the segment. */
  readonly t: number;
  /** Parameter along the stroke, 0 at `a` and 1 at `b`. */
  readonly u: number;
  readonly point: Vec2;
};

/** Whether two points are the same point, allowing for arithmetic. */
export function samePoint(p: Vec2, q: Vec2): boolean {
  return Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
}

/**
 * Every crossing of the stroke with the glyph, in the order the stroke meets
 * them.
 *
 * Deduped within each contour, not across them: two contours genuinely touching
 * at a point is a degenerate outline rather than a repeat, and silently dropping
 * one of them would hide it.
 *
 * Closed contours by default. An open one has no inside, so the measure and the
 * fill have nothing to say about crossing it — but the knife does: a stroke
 * across an open path divides it, and that question is asked by passing
 * `open`.
 */
export function strokeCrossings(
  g: Glyph,
  a: Vec2,
  b: Vec2,
  options: { readonly open?: boolean } = {},
): StrokeCrossing[] {
  const perContour = new Map<number, StrokeCrossing[]>();

  for (const [contourIndex, c] of g.contours.entries()) {
    if (c.nodes.length < 2) continue;
    if (!c.closed && options.open !== true) continue;

    const kept: StrokeCrossing[] = [];
    for (let segmentIndex = 0; segmentIndex < segmentCount(c); segmentIndex++) {
      const segment = segmentAt(c, segmentIndex);
      if (segment === null) continue;

      for (const crossing of intersectSegmentCubic(a, b, segmentCubic(segment))) {
        if (kept.some((seen) => samePoint(seen.point, crossing.point))) continue;
        kept.push({
          contourIndex,
          segmentIndex,
          t: crossing.t,
          u: crossing.u,
          point: crossing.point,
        });
      }
    }
    if (kept.length > 0) perContour.set(contourIndex, kept);
  }

  const all = [...perContour.values()].flat();
  return all.sort((l, r) => l.u - r.u);
}

/** The crossings grouped by the contour they belong to. */
export function byContour(crossings: readonly StrokeCrossing[]): Map<number, StrokeCrossing[]> {
  const out = new Map<number, StrokeCrossing[]>();
  for (const crossing of crossings) {
    const list = out.get(crossing.contourIndex) ?? [];
    list.push(crossing);
    out.set(crossing.contourIndex, list);
  }
  return out;
}
