import { type Cubic, type PenShape, type Vec2, penOutlineAt, project } from "@typewright/geometry";

import { type Contour, segmentAt, segmentCount, segmentCubic } from "./contour.js";
import { insideGlyph } from "./direction.js";
import { glyph } from "./glyph.js";
import { inkRegions, penAlong } from "./stroke.js";

/**
 * The pen a stroke is drawn with where the pointer is over it: its outline,
 * standing at the place on the path nearest the pointer.
 *
 * What a person moving over a stroke wants to see is the pen that made the ink
 * under the pointer — how wide and how turned it is there, between the points
 * where it was set. Over a stroke is over its ink, or within `near` of its
 * path, for a stroke whose ink is too thin to be over. Of strokes overlapping
 * there, the one whose path is nearest.
 */
export type PenUnder = {
  readonly contourId: Contour["id"];
  readonly at: Vec2;
  readonly pen: PenShape;
  readonly outline: readonly Cubic[];
};

export function penUnder(
  contours: readonly Contour[],
  pointer: Vec2,
  near: number,
): PenUnder | null {
  let best: { c: Contour; segment: number; t: number; at: Vec2; distance: number } | null = null;
  for (const c of contours) {
    if (c.nib === undefined) continue;
    let nearest: { segment: number; t: number; at: Vec2; distance: number } | null = null;
    for (let i = 0; i < segmentCount(c); i++) {
      const segment = segmentAt(c, i);
      if (segment === null) continue;
      const found = project(segmentCubic(segment), pointer);
      if (nearest === null || found.distance < nearest.distance) {
        nearest = { segment: i, t: found.t, at: found.point, distance: found.distance };
      }
    }
    if (nearest === null) continue;
    if (best !== null && nearest.distance >= best.distance) continue;
    const over =
      nearest.distance <= near || insideGlyph(glyph("", { contours: [...inkRegions(c)] }), pointer);
    if (over) best = { c, ...nearest };
  }
  if (best === null) return null;
  const pen = penAlong(best.c, best.segment, best.t);
  if (pen === null) return null;
  const outline = penOutlineAt(pen, best.at);
  if (outline === null) return null;
  return { contourId: best.c.id, at: best.at, pen, outline };
}
