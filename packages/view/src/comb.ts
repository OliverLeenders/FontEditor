import { type Rect, type Vec2, curvature, derivative, evaluate } from "@typewright/geometry";
import {
  type Contour,
  contourBounds,
  segmentAt,
  segmentCount,
  segmentCubic,
  unionRect,
} from "@typewright/font-model";

import type { ViewTransform } from "./transform.js";

/**
 * The curvature comb: how tightly the outline turns, drawn as hairs along it.
 *
 * A hair square to the curve at every step, as long as the curvature there, with
 * the tips joined into an envelope. What is read is the envelope rather than the
 * hairs: a step in it at a node is a curvature break — the join is smooth to the
 * eye and not to the light falling on it — a pinch is a flat spot, and where the
 * comb pinches to nothing and grows again is an inflection.
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
  /**
   * Unit normal pointing out of the ink.
   *
   * Out, always — not along the sign of the curvature. A comb that followed the
   * sign stands inside the letter wherever the outline turns the other way,
   * which on an `a` fills the counter with hairs and hides the very join being
   * judged. Away from the ink it is always readable, and an inflection shows as
   * the comb pinching to nothing and growing again rather than as a crossing.
   *
   * This is why the contours have to arrive with their directions corrected:
   * which side the ink is on is a fact about winding, and a contour drawn the
   * wrong way round would grow its comb inwards.
   */
  readonly normal: Vec2;
  /** Signed curvature: the reciprocal of the radius of the circle fitting here. */
  readonly k: number;
  /** How long to draw it, in design units. Scaled and clamped; see {@link combFor}. */
  readonly reach: number;
};

/**
 * One contour's comb, in unbroken runs.
 *
 * Runs, not one list, and this is the whole of why: the envelope is a line
 * through the tips, and a contour's hairs stop wherever the outline goes
 * straight. Joined end to end, the envelope leaps that gap and draws a straight
 * line across it, alongside the straight edge and parallel to it — which reads
 * as a second outline, and was reported as exactly that. A run ends where the
 * hairs do.
 */
export type Comb = {
  readonly contourId: string;
  readonly runs: readonly (readonly CombHair[])[];
};

export type CombOptions = {
  /** How far apart the hairs stand, in screen pixels. */
  readonly spacingPixels?: number;
  /** How long an ordinary hair may grow, in screen pixels. */
  readonly depthPixels?: number;
};

const SPACING = 7;
const DEPTH = 44;

/** How finely each segment is walked while measuring arc length along it. */
const STEPS = 96;

/**
 * Where the scale is taken from, as a fraction of the hairs sorted by length.
 *
 * Not the longest. A letter usually has one corner far tighter than anything
 * else in it — the spur of an `a`, the join of a stem to a shoulder — and
 * dividing by that flattens the whole letter to nothing so the one corner can
 * fit. The hair at nine in ten is drawn at the full depth, and the sharper ones
 * grow past it.
 *
 * Grow by the square root of how much sharper they are, rather than in
 * proportion or not at all. In proportion, one corner ten times the rest sends a
 * spike across the letter; clamped, every hair in the corner comes out the same
 * length and their tips draw a line parallel to the outline — the same artefact
 * as the joined-up envelope, arrived at from the other side. The root keeps the
 * order of things, keeps sharper visibly sharper, and keeps it on the page.
 */
const TYPICAL = 0.9;

/**
 * How straight is straight, as a multiple of the letter's own size.
 *
 * A curve whose radius is ten times the size of the letter is straight as far as
 * that letter is concerned: over the length of a stem it departs from a line by
 * a fraction of a unit. Drawing a hair there puts a line beside the stem
 * parallel to it, which reads as a second outline rather than as a measurement.
 */
const STRAIGHT = 10;

/**
 * The comb for a glyph's contours, at the current zoom.
 *
 * The zoom is not decoration here: the spacing is in pixels, so a letter zoomed
 * in gets more hairs rather than the same hairs further apart, which is what
 * makes the envelope readable at both sizes.
 *
 * The contours must be the *filled* ones — `filledContours` in the model — since
 * the hairs point out of the ink and only the corrected winding says which side
 * that is.
 */
export function combFor(
  contours: readonly Contour[],
  view: ViewTransform,
  options: CombOptions = {},
): Comb[] {
  const spacing = (options.spacingPixels ?? SPACING) / Math.max(view.scale, 1e-6);
  const depth = (options.depthPixels ?? DEPTH) / Math.max(view.scale, 1e-6);

  const flat = 1 / (STRAIGHT * sizeOf(contours));

  const raw: { id: string; runs: Omit<CombHair, "reach">[][] }[] = [];
  for (const c of contours) {
    const runs = runsOf(c, spacing, flat);
    if (runs.length > 0) raw.push({ id: c.id, runs });
  }
  if (raw.length === 0) return [];

  const typical = typicalOf(raw.flatMap((c) => c.runs.flat().map((h) => Math.abs(h.k))));
  if (typical === 0) return [];

  return raw.map(({ id, runs }) => ({
    contourId: id,
    runs: runs.map((run) =>
      run.map((hair) => ({ ...hair, reach: depth * Math.sqrt(Math.abs(hair.k) / typical) })),
    ),
  }));
}

/** How big the letter is, for deciding what counts as straight within it. */
function sizeOf(contours: readonly Contour[]): number {
  let box: Rect | null = null;
  for (const c of contours) {
    const own = contourBounds(c);
    if (own !== null) box = unionRect(box, own);
  }
  if (box === null) return 1;

  const size = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
  return size > 0 ? size : 1;
}

/** The curvature the depth is measured against: sharper than nine hairs in ten. */
function typicalOf(curvatures: readonly number[]): number {
  if (curvatures.length === 0) return 0;

  const sorted = [...curvatures].sort((l, r) => l - r);
  const at = Math.min(sorted.length - 1, Math.floor(sorted.length * TYPICAL));
  return sorted[at]!;
}

/**
 * One contour's hairs, in runs that break wherever there are none.
 *
 * A run carries on across a node — a comb that began again at every join would
 * show a gap there whatever the curve did, which is the opposite of what the
 * instrument is for — and ends where the outline stops curving: a straight
 * segment, a stretch too gentle to count as one, or a place with no curvature at
 * all.
 */
function runsOf(c: Contour, spacing: number, flat: number): Omit<CombHair, "reach">[][] {
  const runs: Omit<CombHair, "reach">[][] = [];
  let run: Omit<CombHair, "reach">[] = [];
  // Carried across segments so the hairs do not restart at every node.
  let since = spacing;

  const end = (): void => {
    if (run.length > 0) runs.push(run);
    run = [];
  };

  for (let i = 0; i < segmentCount(c); i++) {
    const segment = segmentAt(c, i);
    if (segment === null || segment.kind === "line") {
      // A straight segment has no curvature to draw, but it still has length,
      // and swallowing it would shift every hair after it.
      if (segment !== null) since += chord(segment.a, segment.b);
      end();
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
      if (hair === null || Math.abs(hair.k) <= flat) end();
      else run.push(hair);
    }
  }

  end();

  // A closed contour's comb starts and ends at the same place, so a run that
  // began at the top of the loop belongs to the one that ended at the bottom.
  if (c.closed && runs.length > 1 && wraps(c)) {
    const first = runs.shift()!;
    runs[runs.length - 1] = [...runs[runs.length - 1]!, ...first];
  }
  return runs;
}

/**
 * Whether the comb ran past the point the walk began at without a break.
 *
 * A closed contour is a loop, and the walk has to start somewhere. If the
 * outline curves through that place, the run that began there and the run that
 * ended there are one run, and the envelope belongs joined.
 */
function wraps(c: Contour): boolean {
  const first = segmentAt(c, 0);
  const last = segmentAt(c, segmentCount(c) - 1);
  return first !== null && last !== null && first.kind !== "line" && last.kind !== "line";
}

function hairAt(cubic: Parameters<typeof curvature>[0], t: number): Omit<CombHair, "reach"> | null {
  const k = curvature(cubic, t);
  if (k === null) return null;

  const d = derivative(cubic, t);
  const speed = Math.hypot(d.x, d.y);
  if (speed === 0) return null;

  // The right-hand normal. With the directions corrected, the ink is to the
  // left of travel on an outer contour and to the left again on a hole — a hole
  // runs the other way, so its enclosed side is the counter — which makes the
  // right-hand normal the way out of the ink in both cases.
  return {
    at: evaluate(cubic, t),
    normal: { x: d.y / speed, y: -d.x / speed },
    k,
  };
}

const chord = (p: Vec2, q: Vec2): number => Math.hypot(q.x - p.x, q.y - p.y);
