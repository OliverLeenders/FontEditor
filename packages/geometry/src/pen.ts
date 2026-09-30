import {
  type Cubic,
  arcLength,
  cubic,
  curvature,
  derivative,
  endTangent,
  evaluate,
  tangent,
} from "./cubic.js";
import { fitCubics } from "./fit.js";
import { halfNib, nibStroke, ovalBands, ovalCap, ovalFolds, ovalWedge } from "./nib.js";
import { OFFSET_TOLERANCE, leftNormal } from "./offset.js";
import type { Vec2 } from "./vec2.js";

/**
 * A pen that can change along a stroke.
 *
 * A pen is an oval: `width` long along its `angle`, `thickness` across it. A
 * thickness of nothing is the broad edge, a straight nib; a thickness equal to the
 * width is a round pen. One shape covers all three, which is what lets a stroke go
 * from one to another along its length — a broad edge that fills out as it goes,
 * say — and it is why everything here is said of ovals.
 *
 * The pen is set at the points of the path and changes smoothly from each point's
 * pen to the next along the segment between them: the angle turns, the width and
 * thickness grow or shrink. Where both ends of a segment have the same pen the ink
 * is worked out the way it always was — exactly, for a broad edge. Where they
 * differ, the edge of the ink is a curve nobody placed, and it is sampled and fitted
 * with cubics to within a stated distance.
 */

export type PenShape = {
  readonly angle: number;
  readonly width: number;
  readonly thickness: number;
};

/** Below this thickness a pen is drawn as the broad edge it cannot be told from. */
const BROAD_BELOW = 0.5;

/** Whether a pen is a broad edge, or near enough that its exact answer is the right one. */
export function isBroad(pen: PenShape): boolean {
  return pen.thickness < BROAD_BELOW;
}

export function samePenShape(a: PenShape, b: PenShape): boolean {
  return a.angle === b.angle && a.width === b.width && a.thickness === b.thickness;
}

/**
 * The pen a fraction `t` of the way from one pen to another.
 *
 * The angle goes the short way round, and the short way is judged over half a turn
 * rather than a whole one: a nib held at ten degrees and one at a hundred and
 * ninety are the same nib, so turning from one to the other is no turn at all, and
 * a pen at 170° turning to 10° goes through 180°, twenty degrees, not through 90°.
 */
export function blendPen(a: PenShape, b: PenShape, t: number): PenShape {
  let turn = (b.angle - a.angle) % 180;
  if (turn > 90) turn -= 180;
  if (turn < -90) turn += 180;
  return {
    angle: a.angle + turn * t,
    width: a.width + (b.width - a.width) * t,
    thickness: a.thickness + (b.thickness - a.thickness) * t,
  };
}

/**
 * How a pen changes along one segment, from its first point's pen to its last's.
 *
 * - `linear`: evenly, by distance along the path.
 * - `smooth`: along a curve through the pens at all the points, so the rate of
 *   change carries on through a point instead of turning there — no corner in the
 *   ink's edge where a point is. The curve is the monotone kind (Fritsch and
 *   Carlson's, as PCHIP has it): between two points it never goes past either
 *   pen, so a pen growing from 40 to 80 is never 85 on the way, and one that is
 *   the same at both ends of a segment stays that pen along it.
 * - `ease`: slowly away from the first pen and slowly into the last, the change
 *   happening mostly in the middle.
 * - `step`: the first pen held the whole way, changing at the next point.
 */
export type PenBlend = "linear" | "smooth" | "ease" | "step";

/** How the angle and the shape — width and thickness together — change along a segment. */
export type SegmentBlend = { readonly angle: PenBlend; readonly shape: PenBlend };

const LINEAR: SegmentBlend = { angle: "linear", shape: "linear" };

/**
 * One segment's pen as it goes: `at(t)` is the pen at parameter `t` of the
 * segment's curve, and `constant` is the pen when it does not change along the
 * segment at all — which is when the ink has an exact answer.
 */
export type PenProfile = {
  readonly at: (t: number) => PenShape;
  readonly constant: PenShape | null;
};

/**
 * Every segment's pen along a path, given the pens at its points and how each
 * segment blends between them.
 *
 * `pens` and `curves` are as {@link penPathStroke} has them; `blends[i]` is the
 * blend along curve `i`, linear where it is not given. Distance along the path is
 * what a blend is measured by, not the curve's parameter, so that a pen changing
 * evenly changes evenly however the curve's handles are pulled.
 */
export function penProfiles(
  curves: readonly Cubic[],
  pens: readonly PenShape[],
  closed: boolean,
  blends?: readonly (SegmentBlend | undefined)[],
): PenProfile[] {
  const count = curves.length;
  if (count === 0 || pens.length < (closed ? count : count + 1)) return [];
  const penAt = (i: number): PenShape => pens[closed ? ((i % count) + count) % count : i]!;
  const lengths = curves.map((c) => arcLength(c));

  // The three channels, each as its value at a point and its change along a
  // segment. The angle's change is the short way round over half a turn, as
  // blendPen has it, so every channel can be treated as a plain number.
  type Channel = (pen: PenShape) => number;
  const angle: Channel = (p) => p.angle;
  const width: Channel = (p) => p.width;
  const thickness: Channel = (p) => p.thickness;
  const change = (channel: Channel, segment: number): number =>
    channel === angle
      ? shortTurn(penAt(segment).angle, penAt(segment + 1).angle)
      : channel(penAt(segment + 1)) - channel(penAt(segment));
  const secant = (channel: Channel, segment: number): number => {
    const length = lengths[segment]!;
    return length > 0 ? change(channel, segment) / length : 0;
  };

  // The rate of change a smooth blend passes through a point with, per unit of
  // length: PCHIP's weighted harmonic mean of the secants either side, nothing
  // where they disagree in sign or either is flat, and the one secant at an open
  // end.
  const slope = (channel: Channel, point: number): number => {
    const arriving = closed ? (point - 1 + count) % count : point >= 1 ? point - 1 : null;
    const leaving = closed ? point % count : point < count ? point : null;
    if (arriving === null) return leaving === null ? 0 : secant(channel, leaving);
    if (leaving === null) return secant(channel, arriving);
    const before = secant(channel, arriving);
    const after = secant(channel, leaving);
    if (!(before * after > 0)) return 0;
    const lb = lengths[arriving]!;
    const la = lengths[leaving]!;
    const w1 = 2 * la + lb;
    const w2 = la + 2 * lb;
    return (w1 + w2) / (w1 / before + w2 / after);
  };

  return curves.map((curve, i) => {
    const blend = blends?.[i] ?? LINEAR;
    const from = penAt(i);
    const length = lengths[i]!;

    const along = (channel: Channel, kind: PenBlend): ((s: number) => number) => {
      const v0 = channel(from);
      const dv = change(channel, i);
      if (dv === 0 || kind === "step") return () => v0;
      if (kind === "linear") return (s) => v0 + dv * s;
      if (kind === "ease") return (s) => v0 + dv * s * s * (3 - 2 * s);
      const m0 = slope(channel, i) * length;
      const m1 = slope(channel, i + 1) * length;
      return (s) => {
        const s2 = s * s;
        const s3 = s2 * s;
        return (
          (2 * s3 - 3 * s2 + 1) * v0 +
          (s3 - 2 * s2 + s) * m0 +
          (-2 * s3 + 3 * s2) * (v0 + dv) +
          (s3 - s2) * m1
        );
      };
    };

    const held = (channel: Channel, kind: PenBlend) => kind === "step" || change(channel, i) === 0;
    const constant =
      held(angle, blend.angle) && held(width, blend.shape) && held(thickness, blend.shape)
        ? from
        : null;
    if (constant !== null) return { at: () => constant, constant };

    const a = along(angle, blend.angle);
    const w = along(width, blend.shape);
    const k = along(thickness, blend.shape);
    const distance = distanceAlong(curve);
    return {
      at: (t) => {
        const s = distance(t);
        return { angle: a(s), width: Math.max(0, w(s)), thickness: Math.max(0, k(s)) };
      },
      constant: null,
    };
  });
}

/** The turn from one nib angle to another, the short way round over half a turn. */
function shortTurn(from: number, to: number): number {
  let turn = (to - from) % 180;
  if (turn > 90) turn -= 180;
  if (turn < -90) turn += 180;
  return turn;
}

/** How many chords a curve is measured by, for distance along it. */
const DISTANCE_STEPS = 48;

/**
 * The fraction of a curve's length reached at parameter `t`, from a table of
 * chords. Close enough for a pen's blend, which nobody measures to the unit, and
 * the same curve always gives the same answer.
 */
function distanceAlong(curve: Cubic): (t: number) => number {
  const table = new Float64Array(DISTANCE_STEPS + 1);
  let last = curve.a;
  for (let k = 1; k <= DISTANCE_STEPS; k++) {
    const p = evaluate(curve, k / DISTANCE_STEPS);
    table[k] = table[k - 1]! + Math.hypot(p.x - last.x, p.y - last.y);
    last = p;
  }
  const total = table[DISTANCE_STEPS]!;
  if (!(total > 0)) return (t) => t;
  return (t) => {
    const x = Math.min(1, Math.max(0, t)) * DISTANCE_STEPS;
    const k = Math.min(DISTANCE_STEPS - 1, Math.floor(x));
    const f = x - k;
    return (table[k]! + (table[k + 1]! - table[k]!) * f) / total;
  };
}

/**
 * The point of the pen, centred on the origin, furthest out in a direction.
 *
 * The edge of the ink on each side of a path is where the pen reaches furthest
 * across the path, so this is the whole of what a side is made of. For an oval with
 * half-axes `a` along its angle and `b` across it, in the pen's own frame the
 * furthest point in direction (dx, dy) is (a²dx, b²dy) divided by √(a²dx² + b²dy²).
 * For a broad edge, `b` is nothing and that is one end of the nib or the other,
 * whichever the direction favours.
 */
export function penSupport(pen: PenShape, direction: Vec2): Vec2 {
  const angle = (pen.angle * Math.PI) / 180;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const a = pen.width / 2;
  const b = pen.thickness / 2;

  const dx = direction.x * ux + direction.y * uy;
  const dy = -direction.x * uy + direction.y * ux;
  const reach = Math.sqrt(a * a * dx * dx + b * b * dy * dy);
  if (reach === 0 || !Number.isFinite(reach)) return { x: 0, y: 0 };

  const x = (a * a * dx) / reach;
  const y = (b * b * dy) / reach;
  return { x: x * ux - y * uy, y: x * uy + y * ux };
}

/**
 * What a pen leaves along a path whose pen is set point by point.
 *
 * `pens` has one pen per point: as many as there are curves for a closed path,
 * one more for an open one. Curve `i` runs from point `i` to the next, and its
 * pen goes from `pens[i]` to the next pen along it.
 *
 * The pieces are the ones the constant pens have always been made of — bands along
 * each curve, a wedge on the outside of a corner, a cap at each open end — and a
 * varying curve adds bands of its own, fitted. At a point the pen is one pen
 * whichever curve is asked, so the pieces meet along the same straight line across
 * the ink, and the union joins them.
 *
 * `blends[i]` is how the pen changes along curve `i`; see {@link PenBlend}.
 */
export function penPathStroke(
  curves: readonly Cubic[],
  pens: readonly PenShape[],
  closed: boolean,
  tolerance: number = OFFSET_TOLERANCE,
  blends?: readonly (SegmentBlend | undefined)[],
): Cubic[][] {
  const parts = penPathStrokeParts(curves, pens, closed, tolerance, blends);
  return [...parts.loops, ...parts.sweeps.flat()];
}

/**
 * What a pen leaves along a path, in its parts: the bands, wedges and caps, and
 * apart from them each fold's chain of swept steps (see {@link sweptSteps}).
 *
 * The chains are handed over apart because they are many small pieces that are
 * one region between them, and whoever keeps the ink — the model, which can join
 * polygons — is better joining each chain into one than filling and measuring a
 * hundred pieces.
 */
export type StrokeParts = {
  readonly loops: Cubic[][];
  readonly sweeps: Cubic[][][];
};

export function penPathStrokeParts(
  curves: readonly Cubic[],
  pens: readonly PenShape[],
  closed: boolean,
  tolerance: number = OFFSET_TOLERANCE,
  blends?: readonly (SegmentBlend | undefined)[],
): StrokeParts {
  const count = curves.length;
  const sweeps: Cubic[][][] = [];
  if (count === 0 || pens.length < (closed ? count : count + 1)) return { loops: [], sweeps };
  const bandsOf = (curve: Cubic, penOn: (t: number) => PenShape): Cubic[][] => {
    const found = varyingBands(curve, penOn, tolerance);
    sweeps.push(...found.sweeps);
    return found.bands;
  };
  const penAt = (i: number): PenShape => pens[closed ? i % count : i]!;
  const profiles = penProfiles(curves, pens, closed, blends);

  const loops: Cubic[][] = [];
  for (let i = 0; i < count; i++) {
    const curve = curves[i]!;
    const profile = profiles[i]!;
    // No pen at either end is no ink, whatever happens between.
    if (!(penAt(i).width > 0) && !(penAt(i + 1).width > 0)) continue;
    const pen = profile.constant;
    if (pen !== null) {
      if (!(pen.width > 0)) continue;
      loops.push(
        ...(isBroad(pen)
          ? nibStroke(curve, halfNib(pen.angle, pen.width))
          : // A bend tighter than the pen folds its inside edge back over itself
            // at every scale, and halving the stretch until it did not fold made
            // hundreds of slivers of a tight curve. Traced instead the way a pen
            // that changes is: the edge sampled, the folded samples left out, and
            // fitted — one band for the curve.
            ovalFolds(curve, pen)
            ? bandsOf(curve, () => pen)
            : ovalBands(curve, pen, tolerance)),
      );
    } else {
      loops.push(...bandsOf(curve, profile.at));
    }
  }

  // The outside of each corner, where the pen at that point is an oval. A broad
  // edge needs nothing: each stretch of it includes the nib standing at its ends,
  // and that covers the corner.
  const joins = closed ? count : count - 1;
  for (let i = 0; i < joins; i++) {
    const pen = penAt(i + 1);
    if (isBroad(pen) || !(pen.width > 0)) continue;
    const wedge = ovalWedge(curves[i]!, curves[(i + 1) % count]!, pen);
    if (wedge !== null) loops.push(wedge);
  }

  if (!closed) {
    // The pen each end of the ink is drawn with, which for a held last segment is
    // the pen it held rather than the one set at the last point.
    const first = profiles[0]!.at(0);
    const last = profiles[count - 1]!.at(1);
    if (!isBroad(last) && last.width > 0) {
      const end = ovalCap(curves[count - 1]!, true, last);
      if (end !== null) loops.push(end);
    }
    if (!isBroad(first) && first.width > 0) {
      const start = ovalCap(curves[0]!, false, first);
      if (start !== null) loops.push(start);
    }
  }

  return { loops, sweeps };
}

/** How many points a varying curve's sides are sampled at, before fitting. */
const SAMPLES = 48;

/**
 * Where along a curve its sides are sampled: evenly, and closer together towards
 * each end.
 *
 * A curve whose handle is pulled onto its end point turns through most of its
 * direction in the last hair of its length — its curvature all but unbounded
 * there — and the edge of the ink swings round the pen in that hair. Samples
 * spaced evenly step over it, and the fold it makes on the inside is then
 * guessed at rather than found.
 */
function sampleParams(): number[] {
  const near = [1e-4, 3e-4, 1e-3, 3e-3, 6e-3, 1e-2, 1.5e-2];
  const ts = new Set<number>();
  for (let k = 0; k <= SAMPLES; k++) ts.add(k / SAMPLES);
  for (const t of near) {
    ts.add(t);
    ts.add(1 - t);
  }
  return [...ts].sort((a, b) => a - b);
}

/**
 * The bands a pen leaves along one curve over which it changes.
 *
 * Each side is sampled — the path's point, plus the furthest the pen at that point
 * reaches across the path on that side — and fitted with cubics. Two things break
 * a side into more than one run.
 *
 * A pen at or near a broad edge, drawn across its own direction, flips: the side
 * the nib's far end was on becomes the side its near end is on. That is the pinch
 * where a broad pen draws nothing, and the side is cut there, each run closed across
 * by the nib itself, as a constant broad edge is.
 *
 * And the inside of a bend tighter than the pen folds back over itself, which is
 * found where the side runs backwards against the path. There the side is not the
 * edge of the ink, and the stretch is swept instead: the pen stood at positions
 * close together, the ink between each two the smallest convex shape round both
 * (see {@link sweptSteps}), handed back apart from the bands as the fold's chain.
 * The samples of a fold used to be left out and the gap crossed straight, and
 * where the side came back past itself — an oval pen leaving a sharp corner, a
 * handle pulled onto its point — that straight line ran through ink and left a
 * notch.
 */
function varyingBands(
  curve: Cubic,
  penOn: (t: number) => PenShape,
  tolerance: number,
): { bands: Cubic[][]; sweeps: Cubic[][][] } {
  type Sample = {
    readonly t: number;
    readonly at: Vec2;
    readonly along: Vec2;
    readonly left: Vec2;
    readonly right: Vec2;
    readonly side: number;
  };

  const samples: Sample[] = [];
  for (const t of sampleParams()) {
    const along =
      t === 0 ? endTangent(curve, 0) : t === 1 ? endTangent(curve, 1) : tangent(curve, t);
    const normal = leftNormal(curve, t);
    if (along === null || normal === null) continue;
    const pen = penOn(t);
    const at = evaluate(curve, t);
    const reach = penSupport(pen, normal);
    const angle = (pen.angle * Math.PI) / 180;
    // Which side of the path the nib's own direction points: the sign that flips at
    // a broad pen's pinch.
    const side = Math.sign(normal.x * Math.cos(angle) + normal.y * Math.sin(angle));
    samples.push({
      t,
      at,
      along,
      left: { x: at.x + reach.x, y: at.y + reach.y },
      right: { x: at.x - reach.x, y: at.y - reach.y },
      side,
    });
  }
  if (samples.length < 2) return { bands: [], sweeps: [] };

  // Runs between pinches. A pen with thickness does not pinch — its sides are
  // continuous however it is turned — so only a pen thin enough to be a broad edge
  // at both samples breaks the run.
  const runs: Sample[][] = [[samples[0]!]];
  for (let k = 1; k < samples.length; k++) {
    const previous = samples[k - 1]!;
    const here = samples[k]!;
    const thin = isBroad(penOn(previous.t)) && isBroad(penOn(here.t));
    if (thin && previous.side !== 0 && here.side !== 0 && previous.side !== here.side) {
      // Both runs end on the pinch itself, found between the two samples: there
      // the nib lies along the path and the ink is the nib's own line, which the
      // run before ends on and the run after starts from. Ending one run at one
      // sample and starting the next at the one after left the stretch between
      // them to neither, and two loose ends the union could not close.
      const pinch = pinchBetween(curve, penOn, previous.t, here.t, previous.side);
      runs[runs.length - 1]!.push(pinchSample(curve, penOn, pinch, previous.side));
      runs.push([pinchSample(curve, penOn, pinch, here.side), here]);
    } else {
      runs[runs.length - 1]!.push(here);
    }
  }

  // Each run cut into stretches: where neither side folds, a band between the two
  // sides, fitted; where one does, the pen swept from one position to the next.
  // A run with no fold anywhere is kept whole, so the runs can still be chained
  // through their pinches into one outline.
  const whole: { left: Cubic[]; right: Cubic[] }[] = [];
  const pieces: Cubic[][] = [];
  const sweeps: Cubic[][][] = [];
  let broken = false;
  for (const run of runs) {
    if (run.length < 2) {
      broken = true;
      continue;
    }
    const folding = foldingSteps(run, curve, penOn);
    if (!folding.some(Boolean)) {
      const fitted = fittedSides(curve, penOn, run, tolerance);
      if (fitted === null) broken = true;
      else whole.push(fitted);
      continue;
    }
    broken = true;
    for (const stretch of stretchesOf(run, folding)) {
      if (stretch.folds) {
        const chain = sweptSteps(
          curve,
          penOn,
          stretch.samples.map((s) => s.t),
        );
        if (chain.length > 0) sweeps.push(chain);
      } else {
        const fitted = fittedSides(curve, penOn, stretch.samples, tolerance);
        if (fitted !== null) pieces.push(band(fitted.left, fitted.right));
      }
    }
  }

  // One loop through the pinches. At a pinch the nib lies along the path and the
  // two sides swap: the side that was on the left arrives at one end of the nib,
  // and it is the right side of the run after that leaves from there. So one
  // edge of the ink is the left of the first run, the right of the second, the
  // left of the third, and the other edge the rest — a single outline with a
  // waist at each pinch, where a loop per run met the next along the nib's own
  // line, a stretch the union has to recognise as buried with a sliver of ink
  // either side of it, and did not always.
  if (!broken && whole.length > 0) {
    const upper = whole.flatMap((s, i) => (i % 2 === 0 ? s.left : s.right));
    const lower = whole.flatMap((s, i) => (i % 2 === 0 ? s.right : s.left));
    return { bands: [band(upper, lower)], sweeps };
  }
  // A run too short to fit, or one with a fold, leaves the chain broken, and each
  // run is loops of its own.
  return { bands: [...whole.map((s) => band(s.left, s.right)), ...pieces], sweeps };
}

/** A band closed straight across its two ends. */
function band(upper: readonly Cubic[], lower: readonly Cubic[]): Cubic[] {
  return [
    ...upper,
    line(upper[upper.length - 1]!.b, lower[lower.length - 1]!.b),
    ...[...lower].reverse().map(reversed),
    line(lower[0]!.a, upper[0]!.a),
  ];
}

/** A sample of the pen along a curve: where it is, and how far it reaches either side. */
type SideSample = {
  readonly t: number;
  readonly along: Vec2;
  readonly left: Vec2;
  readonly right: Vec2;
};

/**
 * The two sides of a stretch, fitted — or `null` where one of them will not fit.
 *
 * The directions each side leaves and arrives by are read a hair's breadth along
 * it rather than guessed from the first two samples, which would be the chord
 * between them — a little off the side's own direction, and enough off that the
 * fit splits to make up for it and writes points nobody needs.
 */
function fittedSides(
  curve: Cubic,
  penOn: (t: number) => PenShape,
  samples: readonly SideSample[],
  tolerance: number,
): { left: Cubic[]; right: Cubic[] } | null {
  const first = samples[0]!.t;
  const last = samples[samples.length - 1]!.t;
  const left = fitCubics(
    samples.map((s) => s.left),
    tolerance,
    edgeDirection(curve, penOn, first, 1, 1),
    edgeDirection(curve, penOn, last, 1, -1),
  );
  const right = fitCubics(
    samples.map((s) => s.right),
    tolerance,
    edgeDirection(curve, penOn, first, -1, 1),
    edgeDirection(curve, penOn, last, -1, -1),
  );
  return left.length === 0 || right.length === 0 ? null : { left, right };
}

/**
 * Which steps between samples fold: where either side runs backwards against
 * the path.
 *
 * On the inside of a bend tighter than the pen, the side — the path plus the
 * pen's furthest reach across it — runs on past where the ink ends and back
 * again. For a round pen it crosses itself and leaves a swallowtail; for an oval
 * it need not cross at all, and runs out and back past itself, so there is no
 * crossing to cut the fold at. Either way the side is not the edge of the ink
 * there, and no fitting of it is.
 */
function foldingSteps(
  samples: readonly SideSample[],
  curve: Cubic,
  penOn: (t: number) => PenShape,
): boolean[] {
  const back = (from: Vec2, to: Vec2, along: Vec2): boolean =>
    (to.x - from.x) * along.x + (to.y - from.y) * along.y < 0;
  const pivots = samples.map((s) => pivoting(curve, penOn, s.t));
  const out: boolean[] = [];
  for (let k = 0; k + 1 < samples.length; k++) {
    const here = samples[k]!;
    const next = samples[k + 1]!;
    out.push(
      back(here.left, next.left, next.along) ||
        back(here.right, next.right, next.along) ||
        pivots[k]! ||
        pivots[k + 1]!,
    );
  }
  return out;
}

/**
 * Whether a broad nib that is turning pivots on itself at `t`: some point of it
 * other than its ends moving along the nib rather than across it.
 *
 * A broad nib's ink is bounded by the paths its two ends trace, and the sides of
 * a band are those two paths — which holds while the whole nib moves one way
 * across itself. A nib that only moves swaps its sides where the path runs along
 * it, at its centre. A nib that also turns does not: every point of it moves
 * across the nib at a rate that changes linearly from one end to the other, and
 * where that rate is nothing, somewhere between the ends, the nib pivots — the
 * two ends swing opposite ways, and the ink there is bounded by where the nib
 * pivots, which neither end's path is. That point walks from one end to the other
 * over a stretch of the curve, and the stretch is swept like a fold.
 *
 * The rate across the nib at the point `s` of the way from its centre to an end
 * is the cross product of the path's velocity plus `s` times the half-nib's with
 * the half-nib, so it is nothing at `s* = −(P′ × h) / (h′ × h)`.
 */
function pivoting(curve: Cubic, penOn: (t: number) => PenShape, t: number): boolean {
  const pen = penOn(t);
  if (!isBroad(pen)) return false;
  const half = (u: number): Vec2 => {
    const p = penOn(u);
    const a = (p.angle * Math.PI) / 180;
    return { x: (Math.cos(a) * p.width) / 2, y: (Math.sin(a) * p.width) / 2 };
  };
  const step = 1e-4;
  const before = half(Math.max(0, t - step));
  const after = half(Math.min(1, t + step));
  const span = Math.min(1, t + step) - Math.max(0, t - step);
  const h = half(t);
  const turning = { x: (after.x - before.x) / span, y: (after.y - before.y) / span };
  const velocity = derivative(curve, t);
  const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
  const d = cross(turning, h);
  const size = Math.hypot(h.x, h.y) * Math.hypot(velocity.x, velocity.y);
  if (size === 0 || Math.abs(d) <= size * 1e-9) return false;
  const s = -cross(velocity, h) / d;
  return Math.abs(s) <= 1 + PIVOT_MARGIN;
}

/** How far beyond its ends a nib's pivot still counts, as a share of half the nib. */
const PIVOT_MARGIN = 0.05;

/** How many samples either side of a fold are taken into it, so it is swept whole. */
const FOLD_MARGIN = 1;

/**
 * A run cut at its folds into stretches that fold and stretches that do not, each
 * sharing its end sample with the next, so the pieces meet.
 */
function stretchesOf(
  samples: readonly SideSample[],
  folding: readonly boolean[],
): { folds: boolean; samples: SideSample[] }[] {
  const n = samples.length;
  const inFold: boolean[] = Array.from({ length: n }, () => false);
  folding.forEach((folds, k) => {
    if (!folds) return;
    for (let j = Math.max(0, k - FOLD_MARGIN); j <= Math.min(n - 1, k + 1 + FOLD_MARGIN); j++) {
      inFold[j] = true;
    }
  });
  const out: { folds: boolean; samples: SideSample[] }[] = [];
  let k = 0;
  while (k < n) {
    const folds = inFold[k]!;
    const from = Math.max(0, k - 1);
    let to = k;
    while (to + 1 < n && inFold[to + 1] === folds) to++;
    // Each stretch starts on the last sample of the one before, so they meet.
    const stretch = samples.slice(out.length === 0 ? k : from, to + 1);
    if (stretch.length >= 2) out.push({ folds, samples: stretch });
    k = to + 1;
  }
  return out;
}

/**
 * How far along the path the pen may move between two of its positions in a fold:
 * at most as far as keeps the straight step within `SWEEP_SAG` of the curve, and
 * never less than `SWEEP_STEP` nor more than `SWEEP_MOST`.
 */
const SWEEP_STEP = 3;
const SWEEP_MOST = 20;
const SWEEP_SAG = 0.25;
/** How far the pen may turn between two positions in a fold, in degrees. */
const SWEEP_TURN = 3;
/** How finely a fold is walked, looking for where to stand the pen, per whole curve. */
const FOLD_GRID = 400;
/** How many sides the pen's outline is drawn with in a fold. */
const OUTLINE_SIDES = 32;

/**
 * The ink of a fold: the pen stood at positions close together along it, and the
 * ink between two neighbouring positions taken as the smallest convex shape round
 * the pen at both.
 *
 * The pen is convex, and between two positions a step apart it moves all but in a
 * straight line and turns all but not at all, so what it covers is all but that
 * shape. It is the slow, sure way the stroke is checked against in the tests, and
 * it is used only where the fast way — two sides and a band between them — has no
 * sides to give. The pieces overlap their neighbours and are all turned the same
 * way, so the non-zero rule fills them as their union.
 */
function sweptSteps(
  curve: Cubic,
  penOn: (t: number) => PenShape,
  ts: readonly number[],
): Cubic[][] {
  // Placed by how far the pen has gone and turned since the last position, walked
  // along a fine grid of the curve, rather than one or more per sample: the samples
  // crowd towards the curve's ends, and a step per sample drew a fold in dozens of
  // pieces where a handful covers it as well.
  const from = ts[0]!;
  const to = ts[ts.length - 1]!;
  const fine = Math.max(2, Math.ceil((to - from) * FOLD_GRID));
  const poses: number[] = [from];
  let lastAngle = penOn(from).angle;
  let gone = 0;
  let previous = evaluate(curve, from);
  for (let i = 1; i <= fine; i++) {
    const t = from + ((to - from) * i) / fine;
    const here = evaluate(curve, t);
    gone += Math.hypot(here.x - previous.x, here.y - previous.y);
    previous = here;
    if (i === fine) break;
    // A chord of length L across a bend of radius R strays L²/8R from it.
    const k = Math.abs(curvature(curve, t) ?? 0);
    const allowed =
      k === 0
        ? SWEEP_MOST
        : Math.min(SWEEP_MOST, Math.max(SWEEP_STEP, Math.sqrt((8 * SWEEP_SAG) / k)));
    if (gone >= allowed || Math.abs(penOn(t).angle - lastAngle) >= SWEEP_TURN) {
      poses.push(t);
      lastAngle = penOn(t).angle;
      gone = 0;
    }
  }
  poses.push(to);

  const outlines = poses.map((t) => penOutline(penOn(t), evaluate(curve, t)));
  const out: Cubic[][] = [];
  for (let i = 0; i + 1 < outlines.length; i++) {
    const a = outlines[i]!;
    const b = outlines[i + 1]!;
    const shapes = a.length === 2 && b.length === 2 ? nibBetween(a, b) : [convexHull([...a, ...b])];
    for (const shape of shapes) {
      if (shape.length < 3) continue;
      out.push(shape.map((p, j) => line(p, shape[(j + 1) % shape.length]!)));
    }
  }
  return out;
}

/**
 * What a broad nib covers going from one position to the next, near enough.
 *
 * Where the two positions cross, the nib turned about the crossing and covered
 * the two triangles either side of it — not the four-sided shape round both
 * positions, which would add two thin wedges of ink it never laid. Where they do
 * not cross, it is that four-sided shape.
 */
function nibBetween(first: readonly Vec2[], second: readonly Vec2[]): Vec2[][] {
  const [a1, b1] = first as [Vec2, Vec2];
  const [a2, b2] = second as [Vec2, Vec2];
  const rx = b1.x - a1.x;
  const ry = b1.y - a1.y;
  const sx = b2.x - a2.x;
  const sy = b2.y - a2.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) > 1e-12) {
    const qx = a2.x - a1.x;
    const qy = a2.y - a1.y;
    const t = (qx * sy - qy * sx) / denom;
    const u = (qx * ry - qy * rx) / denom;
    if (t > 0 && t < 1 && u > 0 && u < 1) {
      const pivot = { x: a1.x + rx * t, y: a1.y + ry * t };
      return [convexHull([a1, a2, pivot]), convexHull([b1, b2, pivot])];
    }
  }
  return [convexHull([a1, b1, a2, b2])];
}

/**
 * The pen's outline at a place, as a polygon drawn round it rather than inside it,
 * so the polygon never leaves out a sliver of what the pen covers. A broad edge is
 * its two ends.
 */
function penOutline(pen: PenShape, at: Vec2): Vec2[] {
  if (isBroad(pen)) {
    const a = (pen.angle * Math.PI) / 180;
    const half = { x: (Math.cos(a) * pen.width) / 2, y: (Math.sin(a) * pen.width) / 2 };
    return [
      { x: at.x + half.x, y: at.y + half.y },
      { x: at.x - half.x, y: at.y - half.y },
    ];
  }
  const out: Vec2[] = [];
  const grow = 1 / Math.cos(Math.PI / OUTLINE_SIDES);
  for (let k = 0; k < OUTLINE_SIDES; k++) {
    const u = (k / OUTLINE_SIDES) * Math.PI * 2;
    const reach = penSupport(pen, { x: Math.cos(u), y: Math.sin(u) });
    out.push({ x: at.x + reach.x * grow, y: at.y + reach.y * grow });
  }
  return out;
}

/** The convex hull of some points, anticlockwise, by Andrew's monotone chain. */
function convexHull(points: readonly Vec2[]): Vec2[] {
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  if (pts.length < 3) return pts;
  const cross = (o: Vec2, p: Vec2, q: Vec2): number =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return hull.filter((p, i) => {
    const q = hull[(i + 1) % hull.length]!;
    return Math.hypot(q.x - p.x, q.y - p.y) > 1e-6;
  });
}

/** Which side of the path a pen's own direction points at `t`: the sign that flips at a pinch. */
function sideAt(curve: Cubic, penOn: (t: number) => PenShape, t: number): number {
  const normal = leftNormal(curve, t);
  if (normal === null) return 0;
  const angle = (penOn(t).angle * Math.PI) / 180;
  return Math.sign(normal.x * Math.cos(angle) + normal.y * Math.sin(angle));
}

/** Where between `from` and `to` a broad pen's side flips, by halving. */
function pinchBetween(
  curve: Cubic,
  penOn: (t: number) => PenShape,
  from: number,
  to: number,
  sideFrom: number,
): number {
  let lo = from;
  let hi = to;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (sideAt(curve, penOn, mid) === sideFrom) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The pen at a pinch, as the run on `side` of it has it: its two ends either side
 * of the path's point, the one `side` favours on the left. Both runs meeting there
 * have the same two points, each the other way round.
 */
function pinchSample(
  curve: Cubic,
  penOn: (t: number) => PenShape,
  t: number,
  side: number,
): {
  readonly t: number;
  readonly at: Vec2;
  readonly along: Vec2;
  readonly left: Vec2;
  readonly right: Vec2;
  readonly side: number;
} {
  const pen = penOn(t);
  const at = evaluate(curve, t);
  const angle = (pen.angle * Math.PI) / 180;
  const half = {
    x: (Math.cos(angle) * pen.width * side) / 2,
    y: (Math.sin(angle) * pen.width * side) / 2,
  };
  const along = tangent(curve, t) ?? endTangent(curve, t < 0.5 ? 0 : 1) ?? { x: 1, y: 0 };
  return {
    t,
    at,
    along,
    left: { x: at.x + half.x, y: at.y + half.y },
    right: { x: at.x - half.x, y: at.y - half.y },
    side,
  };
}

/**
 * The direction one side of the ink runs in at `t`, going forwards along the path.
 *
 * By a step so short the side is straight over it: the side is the path plus the
 * pen's furthest reach across it, and its derivative has the pen's own turning in
 * it, which is not worth writing out for a direction that is only ever used to
 * start a fit. `inward` says which way the step is taken — forwards from the
 * start of a run, backwards into it from the end — so it never reads past the run.
 */
function edgeDirection(
  curve: Cubic,
  penOn: (t: number) => PenShape,
  t: number,
  side: 1 | -1,
  inward: 1 | -1,
): Vec2 | undefined {
  const step = 1e-4;
  const near = Math.min(1, Math.max(0, t + step * inward));
  const edgeAt = (u: number): Vec2 | null => {
    const normal = leftNormal(curve, u);
    if (normal === null) return null;
    const reach = penSupport(penOn(u), { x: normal.x * side, y: normal.y * side });
    const at = evaluate(curve, u);
    return { x: at.x + reach.x, y: at.y + reach.y };
  };
  const a = edgeAt(Math.min(t, near));
  const b = edgeAt(Math.max(t, near));
  if (a === null || b === null) return undefined;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return len === 0 || !Number.isFinite(len) ? undefined : { x: dx / len, y: dy / len };
}

function line(from: Vec2, to: Vec2): Cubic {
  return cubic(
    from,
    { x: from.x + (to.x - from.x) / 3, y: from.y + (to.y - from.y) / 3 },
    { x: from.x + ((to.x - from.x) * 2) / 3, y: from.y + ((to.y - from.y) * 2) / 3 },
    to,
  );
}

const reversed = (s: Cubic): Cubic => cubic(s.b, s.c2, s.c1, s.a);

/**
 * What an oval pen leaves along a path, as closed loops of cubics.
 *
 * An oval is a circle squashed along one axis and turned, so the ink an oval pen
 * leaves is the ink a round pen leaves along the path squashed the other way,
 * squashed back. The round pen is the easier problem — its ink is everything
 * within a fixed distance of the path — and it is traced here in the squashed
 * space, where the pen is a circle of radius one, and then stretched back out.
 *
 * The oval is `width` long along its angle and `thickness` across it. A thickness
 * of nothing is the broad edge, which has an exact answer of its own; see
 * {@link nibStroke}. A thickness equal to the width is a round pen.
 *
 * Not exact, unlike the broad edge: the sides are offset curves, which no Bézier
 * follows, and they are approximated to within `tolerance` design units the way
 * offsetting an outline is.
 *
 * Three kinds of piece, and none of them shares a curve with another, which is
 * what lets the union join them. Each segment is a *band* — out along one side,
 * straight across, back along the other, straight across — so two segments that
 * meet smoothly share the straight line across their join, which is the flush edge
 * the union already joins. A corner opens a gap on its outside, and a *wedge* fills
 * it: two radii and the arc between them, meeting the bands along those same
 * straight lines. And an open path's two ends each get a *cap*, half the pen's
 * circle closed by its diameter. The first version of this gave every segment
 * round ends of its own, and two round ends at one point are one arc drawn twice —
 * which the union cannot split, since there is no crossing on it to split at.
 */
export function ovalPathStroke(
  segments: readonly Cubic[],
  closed: boolean,
  angleDegrees: number,
  width: number,
  thickness: number,
  tolerance: number = OFFSET_TOLERANCE,
): Cubic[][] {
  if (!(width > 0) || !(thickness > 0) || segments.length === 0) return [];
  const pen: PenShape = { angle: angleDegrees, width, thickness };
  const pens = Array.from({ length: closed ? segments.length : segments.length + 1 }, () => pen);
  return penPathStroke(segments, pens, closed, tolerance);
}

/**
 * What an oval pen leaves along a single curve, drawn as an open path of its own.
 *
 * For a caller with one curve and no path around it. A contour's stroke is worked
 * out with {@link ovalPathStroke}, which knows where the curves meet.
 */
export function ovalStroke(
  s: Cubic,
  angleDegrees: number,
  width: number,
  thickness: number,
  tolerance: number = OFFSET_TOLERANCE,
): Cubic[][] {
  return ovalPathStroke([s], false, angleDegrees, width, thickness, tolerance);
}
