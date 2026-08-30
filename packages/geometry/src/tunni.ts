/**
 * The Tunni-line kernel.
 *
 * Tunni lines were devised by Eduardo Tunni and FontLab Ltd. The maths here
 * follows the derivation in the Tunni-Lines repository, with three deliberate
 * departures, each marked at the function that makes it:
 *
 *   1. Every operation returns `null` on degenerate input rather than a
 *      plausible-looking point that is not the answer.
 *   2. Handle scales are signed projections rather than unsigned length ratios,
 *      so a handle pointing away from the intersection is distinguishable from
 *      one pointing towards it.
 *   3. `setTunniPoint` solves both handles from the *original* geometry, so the
 *      result does not depend on which handle is solved first.
 */

import { type Cubic } from "./cubic.js";
import { intersectLines, projectOntoLine, sideOf } from "./line.js";
import {
  type Vec2,
  add,
  addScaled,
  coincident,
  dot,
  isFinitePoint,
  midpoint,
  sub,
} from "./vec2.js";

/**
 * Whether a segment's Tunni controls are meaningful, and if not, why not.
 *
 * - `ok`         — both handles strictly on the same side of the chord, and
 *                  pointing towards each other. The Tunni point is well defined.
 * - `flat`       — both handles lie on the chord. The curve is a straight line;
 *                  there is no Tunni line to drag, because the handles have no
 *                  direction to be rescaled along.
 * - `crossed`    — the handles are not strictly on the same side of the chord.
 *                  Includes the boundary case of exactly one handle on it.
 * - `divergent`  — same side, but the handles point away from each other, so
 *                  their intersection is on the far side of the chord. The
 *                  Tunni point exists numerically and behaves unintuitively.
 * - `degenerate` — coincident anchors, a zero-length handle, or parallel handle
 *                  lines. Nothing is defined.
 */
export type TunniStatus = "ok" | "flat" | "crossed" | "divergent" | "degenerate";

/**
 * The signed scales of the two handles along their own directions, where `1`
 * places a handle exactly at the handle intersection.
 *
 * This is the natural coordinate system for Tunni manipulation. Since the whole
 * premise is that handle *directions* are fixed, a segment with known anchors
 * and known intersection is fully described by these two numbers — which turns
 * the operations from geometry into arithmetic, and turns the "a handle must not
 * pass through its anchor" rule into the single condition `lambda > 0`.
 */
export type HandleScales = {
  readonly lambda1: number;
  readonly lambda2: number;
};

/** The Tunni line: the segment joining the two off-curve control points. */
export type TunniLine = {
  readonly from: Vec2;
  readonly to: Vec2;
};

/**
 * Intersection of the two handle lines, `a → c1` and `b → c2`.
 *
 * Returns `null` when either handle has zero length or the two lines are
 * parallel. This is the point the README calls `s`, and everything else is
 * built on it.
 */
export function handleIntersection(s: Cubic): Vec2 | null {
  if (coincident(s.a, s.c1) || coincident(s.b, s.c2)) return null;
  return intersectLines(s.a, s.c1, s.b, s.c2);
}

/**
 * The Tunni point: `2·c1 − a + 2·c2 − b − s`.
 *
 * Returns `null` only when the handle intersection does not exist. It is
 * computed for `crossed` and `divergent` segments too — the value is real, it is
 * just not useful to drag. Deciding whether to *show* it is
 * {@link tunniStatus}'s job, and keeping those two questions apart is what stops
 * the control from flickering out of existence mid-gesture.
 */
export function tunniPoint(s: Cubic): Vec2 | null {
  const is = handleIntersection(s);
  if (is === null) return null;
  const t = {
    x: 2 * s.c1.x - s.a.x + 2 * s.c2.x - s.b.x - is.x,
    y: 2 * s.c1.y - s.a.y + 2 * s.c2.y - s.b.y - is.y,
  };
  return isFinitePoint(t) ? t : null;
}

/**
 * The Tunni line, or `null` when the segment is flat or degenerate — the cases
 * where dragging it has no defined effect, because the handles would have to
 * change direction for the line to move.
 */
export function tunniLine(s: Cubic): TunniLine | null {
  const status = tunniStatus(s);
  if (status === "flat" || status === "degenerate") return null;
  return { from: s.c1, to: s.c2 };
}

/**
 * Classify the segment. See {@link TunniStatus} for what each value means.
 */
export function tunniStatus(s: Cubic): TunniStatus {
  if (!isFinitePoint(s.a) || !isFinitePoint(s.c1) || !isFinitePoint(s.c2) || !isFinitePoint(s.b)) {
    return "degenerate";
  }
  if (coincident(s.a, s.b)) return "degenerate";
  if (coincident(s.a, s.c1) || coincident(s.b, s.c2)) return "degenerate";

  const side1 = sideOf(s.a, s.b, s.c1);
  const side2 = sideOf(s.a, s.b, s.c2);

  if (side1 === 0 && side2 === 0) return "flat";
  if (side1 !== side2) return "crossed";

  const is = handleIntersection(s);
  if (is === null) return "degenerate";

  return sideOf(s.a, s.b, is) === side1 ? "ok" : "divergent";
}

/**
 * Read the handle scales of a segment.
 *
 * Each λ is the signed projection of the handle onto the vector from its anchor
 * to the handle intersection. Because the handle lies on that line by
 * construction, the projection equals the length ratio the README uses — but it
 * carries a sign, so a handle pointing away from the intersection reads as
 * negative rather than as an indistinguishable positive.
 */
export function tunniLambdas(s: Cubic): HandleScales | null {
  const is = handleIntersection(s);
  if (is === null) return null;
  const lambda1 = projectOntoLine(s.a, is, s.c1);
  const lambda2 = projectOntoLine(s.b, is, s.c2);
  if (lambda1 === null || lambda2 === null) return null;
  if (!Number.isFinite(lambda1) || !Number.isFinite(lambda2)) return null;
  return { lambda1, lambda2 };
}

/**
 * Rebuild a segment from its anchors, its handle intersection, and a pair of
 * handle scales. The inverse of {@link tunniLambdas}.
 */
export function cubicFromLambdas(
  a: Vec2,
  b: Vec2,
  intersection: Vec2,
  scales: HandleScales,
): Cubic | null {
  const c1 = addScaled(a, sub(intersection, a), scales.lambda1);
  const c2 = addScaled(b, sub(intersection, b), scales.lambda2);
  if (!isFinitePoint(c1) || !isFinitePoint(c2)) return null;
  return { a, c1, c2, b };
}

/**
 * Balance the segment: set both handle scales to their mean, which leaves the
 * Tunni line parallel to the chord.
 *
 * Note that this does not guarantee curvature continuity with neighbouring
 * segments — it is a statement about this segment's proportions alone, which is
 * what makes it a distinct operation from the various "harmonise" commands
 * elsewhere in type design.
 *
 * In λ-space the whole operation is one average. The prototype computed it from
 * two square roots and a pair of length ratios, and guarded the result with
 * `avg !== avg && avg !== Infinity`, which catches NaN by accident and never
 * catches an infinity.
 */
export function balance(s: Cubic): Cubic | null {
  const is = handleIntersection(s);
  if (is === null) return null;
  const scales = tunniLambdas(s);
  if (scales === null) return null;

  const mean = (scales.lambda1 + scales.lambda2) / 2;
  if (!Number.isFinite(mean)) return null;

  const next = cubicFromLambdas(s.a, s.b, is, { lambda1: mean, lambda2: mean });
  return next === null ? null : preserveHandles(s, next);
}

/**
 * Move the Tunni point to `target`, rescaling both handles along their existing
 * directions.
 *
 * The construction is the README's: reflect the target about each anchor's
 * midpoint, offset by the opposite handle, and intersect with the handle's own
 * line.
 *
 * Both handles are solved from the *original* `c1` and `c2`. The prototype
 * assigned the new `c1` before computing `c2`, so `c2` was derived from a handle
 * that had already moved and the result depended on solve order.
 */
export function setTunniPoint(s: Cubic, target: Vec2): Cubic | null {
  if (!isFinitePoint(target)) return null;
  if (coincident(s.a, s.c1) || coincident(s.b, s.c2)) return null;

  const halfA = midpoint(s.a, target);
  const alongA = add(halfA, sub(s.c2, s.b));
  const c1 = intersectLines(halfA, alongA, s.a, s.c1);
  if (c1 === null) return null;

  const halfB = midpoint(s.b, target);
  const alongB = add(halfB, sub(s.c1, s.a));
  const c2 = intersectLines(halfB, alongB, s.b, s.c2);
  if (c2 === null) return null;

  return preserveHandles(s, { a: s.a, c1, c2, b: s.b });
}

/**
 * Drag the Tunni line so that it passes through `through`, keeping its
 * direction and both handle directions fixed.
 *
 * Both handles are rescaled by the same construction: intersect the line through
 * `through` parallel to the current Tunni line against each handle's own line.
 */
export function moveTunniLine(s: Cubic, through: Vec2): Cubic | null {
  if (!isFinitePoint(through)) return null;
  if (coincident(s.a, s.c1) || coincident(s.b, s.c2)) return null;
  if (coincident(s.c1, s.c2)) return null;

  const direction = add(through, sub(s.c1, s.c2));
  const c1 = intersectLines(through, direction, s.a, s.c1);
  if (c1 === null) return null;
  const c2 = intersectLines(through, direction, s.b, s.c2);
  if (c2 === null) return null;

  return preserveHandles(s, { a: s.a, c1, c2, b: s.b });
}

/**
 * Reject a result in which a handle has collapsed onto its anchor or flipped
 * through it.
 *
 * This is the clamp the Tunni-Lines README asks for — "additional checks are
 * required when moving the Tunni line such that no control point passes through
 * its corresponding anchor" — enforced before the caller ever sees the geometry,
 * rather than detected afterwards by aborting the drag. Comparing the direction
 * of each new handle against the old one is enough, and needs no intersection.
 */
function preserveHandles(before: Cubic, after: Cubic): Cubic | null {
  if (!isFinitePoint(after.c1) || !isFinitePoint(after.c2)) return null;
  if (!sameDirection(before.a, before.c1, after.c1)) return null;
  if (!sameDirection(before.b, before.c2, after.c2)) return null;
  return after;
}

function sameDirection(anchor: Vec2, before: Vec2, after: Vec2): boolean {
  const d0 = sub(before, anchor);
  const d1 = sub(after, anchor);
  return dot(d0, d1) > 0;
}
