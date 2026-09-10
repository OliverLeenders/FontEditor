import {
  type Vec2,
  controlBounds,
  distance,
  distanceToRect,
  distanceToSegment,
  project,
} from "@typewright/geometry";
import {
  type ContourId,
  type Glyph,
  contourById,
  segmentAt,
  segmentCount,
  segmentCubic,
  segmentTunniPoint,
  segmentTunniStatus,
} from "@typewright/font-model";

import { type ViewTransform, screenTolerance } from "./transform.js";

export type SegmentRef = {
  readonly contourId: ContourId;
  readonly segmentIndex: number;
};

export function sameSegment(a: SegmentRef | null, b: SegmentRef | null): boolean {
  if (a === null || b === null) return a === b;
  return a.contourId === b.contourId && a.segmentIndex === b.segmentIndex;
}

/** How near the cursor must come to wake a segment that is currently asleep. */
export const DEFAULT_ENTER_PIXELS = 95;
/** How far it may stray before a segment that is already awake gives up. */
export const DEFAULT_STAY_PIXELS = 155;
/** How much nearer a rival must be to steal an awake segment's place. */
export const DEFAULT_STICKINESS = 1.6;

export type ActivationOptions = {
  readonly enterPixels?: number;
  readonly stayPixels?: number;
  readonly stickiness?: number;
};

/**
 * Distance from `p` to a segment's whole control ensemble — its curve, its real
 * handles, its Tunni line and its Tunni point.
 *
 * Measuring to the curve alone is the obvious implementation and it is wrong.
 * The Tunni point sits well off the curve by construction, so a curve-only
 * measure puts the cursor outside the segment's activation radius at the exact
 * moment it arrives on the control — which hides it, and since only visible
 * controls are hit-testable, stops it being grabbable too.
 *
 * Only handles that genuinely exist are counted. A straight segment's cubic has
 * handles at the thirds, but those are a materialisation for geometric queries,
 * not something the user can reach for.
 */
export function segmentProximity(
  g: Glyph,
  ref: SegmentRef,
  p: Vec2,
  limit = Number.POSITIVE_INFINITY,
): number | null {
  const c = contourById(g, ref.contourId);
  if (c === null) return null;
  const segment = segmentAt(c, ref.segmentIndex);
  if (segment === null) return null;

  // The cheap parts of the ensemble first, so the curve has something to be
  // measured against before it is projected onto.
  let best = Number.POSITIVE_INFINITY;
  if (segment.out !== null) best = Math.min(best, distance(p, segment.out));
  if (segment.in !== null) best = Math.min(best, distance(p, segment.in));

  const status = segmentTunniStatus(c, ref.segmentIndex);
  if (status !== null && status !== "flat" && status !== "degenerate") {
    if (segment.out !== null && segment.in !== null) {
      best = Math.min(best, distanceToSegment(segment.out, segment.in, p));
    }
  }
  if (status === "ok") {
    const tunni = segmentTunniPoint(c, ref.segmentIndex);
    if (tunni !== null) best = Math.min(best, distance(p, tunni));
  }

  // The curve, but only when it could change the answer: its bounding box gives
  // a distance it cannot be nearer than, and if that is already worse than what
  // the handles gave, or further than the caller cares about, the projection is
  // work whose result is thrown away.
  const cubic = segmentCubic(segment);
  const floor = distanceToRect(controlBounds(cubic), p);
  if (floor < best && floor <= limit) best = Math.min(best, project(cubic, p).distance);
  else best = Math.min(best, floor);

  return best;
}

/**
 * Which segment the cursor is closest to, given where it is and which segment it
 * was closest to a moment ago.
 *
 * This is only half of what decides whether Tunni controls are drawn. The other
 * half is *focus* — the segment being worked on — which the tools layer keeps
 * separately. Proximity alone cannot express "the thing I am in the middle of
 * editing", and a segment that loses the cursor race must not have its controls
 * taken away mid-task.
 *
 * Deliberately sticky. An awake segment holds on out to a wider radius than it
 * took to wake it, so controls do not blink off while the cursor is travelling
 * towards them — and a neighbour has to be clearly nearer, not merely nearer, to
 * take its place. Without the hysteresis the controls flicker along the boundary
 * between two segments, which reads as the canvas being broken.
 *
 * Pass `null` for `cursor` when the pointer leaves the canvas.
 */
export function hoveredSegment(
  g: Glyph,
  cursor: Vec2 | null,
  view: ViewTransform,
  current: SegmentRef | null,
  options: ActivationOptions = {},
): SegmentRef | null {
  if (cursor === null) return null;

  const enter = screenTolerance(view, options.enterPixels ?? DEFAULT_ENTER_PIXELS);
  const stay = screenTolerance(view, options.stayPixels ?? DEFAULT_STAY_PIXELS);
  const stickiness = options.stickiness ?? DEFAULT_STICKINESS;

  let best: SegmentRef | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const c of g.contours) {
    for (let i = 0; i < segmentCount(c); i++) {
      const ref: SegmentRef = { contourId: c.id, segmentIndex: i };
      // Nothing beyond the wider radius can win or hold, and nothing further
      // than the nearest segment found so far can win either — so segments out
      // there need only be shown to be far, not measured exactly. The winner is
      // still measured exactly, because a segment is only dismissed when it is
      // provably worse than one that was.
      const d = segmentProximity(g, ref, cursor, Math.min(stay, bestDistance));
      if (d !== null && d < bestDistance) {
        bestDistance = d;
        best = ref;
      }
    }
  }

  if (best === null) return null;

  if (current !== null && !sameSegment(current, best)) {
    const holdDistance = segmentProximity(g, current, cursor, stay);
    if (holdDistance !== null && holdDistance < stay && holdDistance < bestDistance * stickiness) {
      return current;
    }
  }

  const threshold = sameSegment(current, best) ? stay : enter;
  return bestDistance < threshold ? best : null;
}
