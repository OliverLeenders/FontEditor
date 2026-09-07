import { type Vec2, curvature, derivative, evaluate } from "@fonteditor/geometry";
import { type Contour, segmentAt, segmentCount, segmentCubic } from "@fonteditor/font-model";

import type { ViewTransform } from "./transform.js";

/**
 * The curvature comb: how tightly the outline turns, drawn as hairs along it.
 *
 * A hair square to the curve at every step, as long as the curvature there, with
 * the tips joined into an envelope. What is read is the envelope rather than the
 * hairs: a step in it at a node is a curvature break — the join is smooth to the
 * eye and not to the light falling on it — a pinch is a flat spot, and where the
 * comb crosses to the other side is an inflection.
 *
 * This is the one instrument that says whether two segments *agree*. The Tunni
 * line describes one segment; it has nothing to say about the join.
 *
 * Sampled along the outline at a fixed spacing in screen pixels rather than in
 * `t`, which is not the same thing at all: a cubic travels slowly where its
 * handles are short, so stepping in `t` crowds hairs exactly where the curve is
 * flat and thins them where it turns hardest — backwards, and worst where the
 * comb is most worth reading.
 */

export type CombHair = {
  /** Where on the outline it stands, in design units. */
  readonly at: Vec2;
  /** Unit normal, to the left of the direction of travel. */
  readonly normal: Vec2;
  /** Signed curvature: the reciprocal of the radius of the circle fitting here. */
  readonly k: number;
};

/** One contour's worth of hairs, kept apart so the envelope is not joined across a gap. */
export type Comb = {
  readonly contourId: string;
  readonly hairs: readonly CombHair[];
};

export type CombOptions = {
  /** How far apart the hairs stand, in screen pixels. */
  readonly spacingPixels?: number;
  /** How long the longest hair in the glyph is drawn, in screen pixels. */
  readonly depthPixels?: number;
};

const SPACING = 7;
const DEPTH = 44;

/** How finely each segment is walked while measuring arc length along it. */
const STEPS = 96;

/**
 * The comb for a glyph's contours, at the current zoom.
 *
 * The zoom is not decoration here: the spacing is in pixels, so a letter zoomed
 * in gets more hairs rather than the same hairs further apart, which is what
 * makes the envelope readable at both sizes.
 */
export function combFor(
  contours: readonly Contour[],
  view: ViewTransform,
  options: CombOptions = {},
): Comb[] {
  const spacing = (options.spacingPixels ?? SPACING) / Math.max(view.scale, 1e-6);

  const combs: Comb[] = [];
  for (const c of contours) {
    const hairs = hairsOf(c, spacing);
    if (hairs.length > 0) combs.push({ contourId: c.id, hairs });
  }
  return combs;
}

/**
 * How many design units of hair one unit of curvature is worth.
 *
 * Normalised across the whole glyph rather than per segment or by a fixed gain:
 * curvature spans orders of magnitude between a bowl and a tight corner, so a
 * fixed scale either flattens the letter or sends the corner off the canvas —
 * and normalising per segment would make each segment look the same, which is
 * precisely the comparison the comb exists to allow.
 *
 * Zero when nothing curves, which is a glyph of straight lines and no comb.
 */
export function combScale(
  combs: readonly Comb[],
  view: ViewTransform,
  options: CombOptions = {},
): number {
  let sharpest = 0;
  for (const comb of combs) {
    for (const hair of comb.hairs) sharpest = Math.max(sharpest, Math.abs(hair.k));
  }
  if (sharpest === 0) return 0;

  const depth = (options.depthPixels ?? DEPTH) / Math.max(view.scale, 1e-6);
  return depth / sharpest;
}

function hairsOf(c: Contour, spacing: number): CombHair[] {
  const hairs: CombHair[] = [];
  // Carried across segments so the hairs do not restart at every node: a comb
  // that began again at each join would show a gap there whatever the curve did.
  let since = spacing;

  for (let i = 0; i < segmentCount(c); i++) {
    const segment = segmentAt(c, i);
    if (segment === null || segment.kind === "line") {
      // A straight segment has no curvature to draw, but it still has length,
      // and swallowing it would shift every hair after it.
      if (segment !== null) since += chord(segment.a, segment.b);
      continue;
    }

    const cubic = segmentCubic(segment);
    let previous = evaluate(cubic, 0);

    for (let step = 1; step <= STEPS; step++) {
      const t = step / STEPS;
      const point = evaluate(cubic, t);
      since += chord(previous, point);
      previous = point;

      if (since < spacing) continue;
      since = 0;

      const hair = hairAt(cubic, t);
      if (hair !== null) hairs.push(hair);
    }
  }

  return hairs;
}

function hairAt(cubic: Parameters<typeof curvature>[0], t: number): CombHair | null {
  const k = curvature(cubic, t);
  if (k === null) return null;

  const d = derivative(cubic, t);
  const speed = Math.hypot(d.x, d.y);
  if (speed === 0) return null;

  return {
    at: evaluate(cubic, t),
    normal: { x: -d.y / speed, y: d.x / speed },
    k,
  };
}

const chord = (p: Vec2, q: Vec2): number => Math.hypot(q.x - p.x, q.y - p.y);
