import { type Cubic, cubic, endTangent, evaluate, tangent } from "./cubic.js";
import { fitCubics } from "./fit.js";
import { halfNib, nibStroke, ovalBands, ovalCap, ovalWedge } from "./nib.js";
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
 */
export function penPathStroke(
  curves: readonly Cubic[],
  pens: readonly PenShape[],
  closed: boolean,
  tolerance: number = OFFSET_TOLERANCE,
): Cubic[][] {
  const count = curves.length;
  if (count === 0 || pens.length < (closed ? count : count + 1)) return [];
  const penAt = (i: number): PenShape => pens[closed ? i % count : i]!;

  const loops: Cubic[][] = [];
  for (let i = 0; i < count; i++) {
    const curve = curves[i]!;
    const from = penAt(i);
    const to = penAt(i + 1);
    if (!(from.width > 0) && !(to.width > 0)) continue;

    if (samePenShape(from, to)) {
      loops.push(
        ...(isBroad(from)
          ? nibStroke(curve, halfNib(from.angle, from.width))
          : ovalBands(curve, from, tolerance)),
      );
    } else {
      loops.push(...varyingBands(curve, from, to, tolerance));
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
    const first = pens[0]!;
    const last = pens[count]!;
    if (!isBroad(last) && last.width > 0) {
      const end = ovalCap(curves[count - 1]!, true, last);
      if (end !== null) loops.push(end);
    }
    if (!isBroad(first) && first.width > 0) {
      const start = ovalCap(curves[0]!, false, first);
      if (start !== null) loops.push(start);
    }
  }

  return loops;
}

/** How many points a varying curve's sides are sampled at, before fitting. */
const SAMPLES = 48;

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
 * found where the side runs backwards against the path. The samples in a fold are
 * left out and the fit crosses the gap straight, for the reason a constant oval's
 * fold is drawn straight across: the pen's ends either side of it overlap the whole
 * of the fold, and a side that looped back would fill with a hole in it.
 */
function varyingBands(curve: Cubic, from: PenShape, to: PenShape, tolerance: number): Cubic[][] {
  type Sample = {
    readonly t: number;
    readonly at: Vec2;
    readonly along: Vec2;
    readonly left: Vec2;
    readonly right: Vec2;
    readonly side: number;
  };

  const samples: Sample[] = [];
  for (let k = 0; k <= SAMPLES; k++) {
    const t = k / SAMPLES;
    const along =
      t === 0 ? endTangent(curve, 0) : t === 1 ? endTangent(curve, 1) : tangent(curve, t);
    const normal = leftNormal(curve, t);
    if (along === null || normal === null) continue;
    const pen = blendPen(from, to, t);
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
  if (samples.length < 2) return [];

  // Runs between pinches. A pen with thickness does not pinch — its sides are
  // continuous however it is turned — so only a pen thin enough to be a broad edge
  // at both samples breaks the run.
  const runs: Sample[][] = [[samples[0]!]];
  for (let k = 1; k < samples.length; k++) {
    const previous = samples[k - 1]!;
    const here = samples[k]!;
    const thin = isBroad(blendPen(from, to, previous.t)) && isBroad(blendPen(from, to, here.t));
    if (thin && previous.side !== 0 && here.side !== 0 && previous.side !== here.side) {
      runs.push([here]);
    } else {
      runs[runs.length - 1]!.push(here);
    }
  }

  const loops: Cubic[][] = [];
  for (const run of runs) {
    if (run.length < 2) continue;
    const left = unfolded(run.map((s) => ({ point: s.left, along: s.along })));
    const right = unfolded(run.map((s) => ({ point: s.right, along: s.along })));
    // The directions each side leaves and arrives by, read a hair's breadth along
    // it rather than guessed from the first two samples, which would be the chord
    // between them — a little off the side's own direction, and enough off that the
    // fit splits to make up for it and writes points nobody needs.
    const first = run[0]!.t;
    const last = run[run.length - 1]!.t;
    const leftCurves = fitCubics(
      left,
      tolerance,
      edgeDirection(curve, from, to, first, 1, 1),
      edgeDirection(curve, from, to, last, 1, -1),
    );
    const rightCurves = fitCubics(
      right,
      tolerance,
      edgeDirection(curve, from, to, first, -1, 1),
      edgeDirection(curve, from, to, last, -1, -1),
    );
    if (leftCurves.length === 0 || rightCurves.length === 0) continue;

    const leftEnd = leftCurves[leftCurves.length - 1]!.b;
    const rightEnd = rightCurves[rightCurves.length - 1]!.b;
    loops.push([
      ...leftCurves,
      line(leftEnd, rightEnd),
      ...[...rightCurves].reverse().map(reversed),
      line(rightCurves[0]!.a, leftCurves[0]!.a),
    ]);
  }
  return loops;
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
  from: PenShape,
  to: PenShape,
  t: number,
  side: 1 | -1,
  inward: 1 | -1,
): Vec2 | undefined {
  const step = 1e-4;
  const near = Math.min(1, Math.max(0, t + step * inward));
  const edgeAt = (u: number): Vec2 | null => {
    const normal = leftNormal(curve, u);
    if (normal === null) return null;
    const reach = penSupport(blendPen(from, to, u), { x: normal.x * side, y: normal.y * side });
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

/**
 * A side's samples with the folds taken out: the ones that run backwards against
 * the path. The first and last are always kept, so the side still meets the lines
 * across the ends of the band.
 */
function unfolded(samples: readonly { readonly point: Vec2; readonly along: Vec2 }[]): Vec2[] {
  const out: Vec2[] = [samples[0]!.point];
  for (let k = 1; k < samples.length - 1; k++) {
    const here = samples[k]!;
    const last = out[out.length - 1]!;
    const step = { x: here.point.x - last.x, y: here.point.y - last.y };
    if (step.x * here.along.x + step.y * here.along.y > 0) out.push(here.point);
  }
  out.push(samples[samples.length - 1]!.point);
  return out;
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
