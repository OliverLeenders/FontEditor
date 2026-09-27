import { type Cubic, cubic, curvature, evaluate, reverse, split, tangent } from "./cubic.js";
import { OFFSET_TOLERANCE, arcCubics, leftNormal, offsetCubic } from "./offset.js";
import type { Vec2 } from "./vec2.js";

/**
 * What a broad-edged pen leaves along a curve: the one stroke operation that is
 * exact.
 *
 * A broad nib is a straight edge held at a fixed angle, and the ink it leaves is
 * every position of that edge as it is drawn along the path. For a round pen the
 * boundary of that is an offset curve, which no Bézier can follow. For a straight
 * nib it is not: along any stretch where the path is not running in the nib's own
 * direction, the ink is bounded by the path moved half the nib one way, the path
 * moved half the nib the other way, and the nib itself at the two ends. A cubic
 * moved is a cubic, so every one of those is exact.
 *
 * The stretches are cut where the path *does* run along the nib. There the pen is
 * being drawn edge-on and leaves no width at all — the stroke pinches to a point —
 * and the two moved copies of the path swap sides. That pinch is not a defect in
 * the arithmetic; it is what a broad pen does, and it is why a letter written
 * with one is thick and thin where it is.
 *
 * What comes out is one closed region per stretch. They overlap — each stretch's
 * region shares the nib at its ends with the next — and joining them is the
 * union's business, which already handles regions that meet along an edge.
 */

/** The nib as a vector from its centre to one end: half its width, at its angle. */
export function halfNib(angleDegrees: number, width: number): Vec2 {
  const a = (angleDegrees * Math.PI) / 180;
  return { x: (exactly(Math.cos(a)) * width) / 2, y: (exactly(Math.sin(a)) * width) / 2 };
}

/**
 * A cosine or sine with the rounding error at the quarter turns taken out.
 *
 * `Math.cos(π/2)` is 6e-17 rather than nothing, so a pen held upright moved every
 * point of its ink a few quadrillionths of a unit sideways — invisible, and written
 * into the outline as `-1.8e-15` all the same. Upright and level are the pen angles
 * people type most, and they should come out exact.
 */
function exactly(v: number): number {
  return Math.abs(v) < 1e-12 ? 0 : v;
}

/**
 * Where a curve runs in the nib's direction: the parameters strictly between its
 * ends at which its tangent is parallel to the nib.
 *
 * The tangent of a cubic is a quadratic in `t`, and the cross product of a
 * quadratic with a fixed vector is a quadratic in `t` too — so this is the roots of
 * one quadratic, and there are at most two. Written out from the control points
 * rather than sampled, because a stroke cut a hair away from its pinch leaves a
 * sliver of ink with no width that the union then has to find and throw away.
 */
export function nibTangencies(s: Cubic, nib: Vec2): number[] {
  const d0 = { x: s.c1.x - s.a.x, y: s.c1.y - s.a.y };
  const d1 = { x: s.c2.x - s.c1.x, y: s.c2.y - s.c1.y };
  const d2 = { x: s.b.x - s.c2.x, y: s.b.y - s.c2.y };
  const cross = (v: Vec2): number => v.x * nib.y - v.y * nib.x;

  // The tangent is proportional to d0 + 2t(d1 − d0) + t²(d0 − 2d1 + d2).
  const a = cross({ x: d0.x - 2 * d1.x + d2.x, y: d0.y - 2 * d1.y + d2.y });
  const b = 2 * cross({ x: d1.x - d0.x, y: d1.y - d0.y });
  const c = cross(d0);

  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  if (scale === 0) return [];
  const tiny = scale * 1e-12;

  const roots: number[] = [];
  if (Math.abs(a) <= tiny) {
    if (Math.abs(b) > tiny) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      // The form that does not subtract two nearly equal numbers, for each root.
      const q = -0.5 * (b + Math.sign(b || 1) * root);
      roots.push(q / a);
      if (q !== 0) roots.push(c / q);
    }
  }

  const inside = roots.filter((t) => t > 1e-9 && t < 1 - 1e-9).sort((l, r) => l - r);
  // Two roots in the same place are one tangency, where the path only touches the
  // nib's direction and turns away again.
  return inside.filter((t, i) => i === 0 || t - inside[i - 1]! > 1e-9);
}

/**
 * Whether the whole of a curve runs in the nib's direction, and so leaves no ink.
 *
 * A straight stroke drawn along the nib's own edge: the pen moves edge-on for its
 * whole length and draws a line of no width. There is nothing to fill.
 */
export function runsAlongNib(s: Cubic, nib: Vec2): boolean {
  const length = Math.hypot(nib.x, nib.y);
  if (length === 0) return true;
  const unit = { x: nib.x / length, y: nib.y / length };
  const span = Math.max(
    Math.hypot(s.c1.x - s.a.x, s.c1.y - s.a.y),
    Math.hypot(s.c2.x - s.a.x, s.c2.y - s.a.y),
    Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y),
    1e-12,
  );
  // Every control point on the line through the start in the nib's direction.
  return [s.c1, s.c2, s.b].every(
    (p) => Math.abs((p.x - s.a.x) * unit.y - (p.y - s.a.y) * unit.x) <= span * 1e-9,
  );
}

/**
 * The ink a broad nib leaves along one curve, as closed loops of cubics.
 *
 * One loop per stretch between the places the curve runs along the nib. Each loop
 * goes out along the curve moved by `+nib`, across the nib at the far end, back
 * along the curve moved by `−nib`, and across the nib at the near end — which is
 * the whole boundary of what the pen covers over that stretch. The loops are not
 * oriented consistently; which way each one runs depends on which side of the path
 * `+nib` falls, and a caller that fills them together orients them first.
 *
 * A curve running entirely along the nib leaves nothing, and says so with an empty
 * list rather than a loop of no area.
 */
export function nibStroke(s: Cubic, nib: Vec2): Cubic[][] {
  if (runsAlongNib(s, nib)) return [];

  const stops = [0, ...nibTangencies(s, nib), 1];
  const loops: Cubic[][] = [];
  let rest = s;
  let used = 0;

  for (let i = 1; i < stops.length; i++) {
    const t = stops[i]!;
    let piece: Cubic;
    if (t >= 1) {
      piece = rest;
    } else {
      const [before, after] = split(rest, (t - used) / (1 - used));
      piece = before;
      rest = after;
      used = t;
    }

    const loop = regionOf(piece, nib);
    if (loop !== null) loops.push(loop);
  }

  return loops;
}

/**
 * The boundary of what the nib covers along one stretch that never runs along it.
 *
 * Out on the `+nib` side, across, back on the `−nib` side, and across again. The
 * two crossings are the nib itself at the two ends of the stretch, straight lines,
 * and at a pinch one of them has no length — the two sides meet at a point.
 */
function regionOf(piece: Cubic, nib: Vec2): Cubic[] | null {
  const plus = moved(piece, nib);
  const minus = moved(piece, { x: -nib.x, y: -nib.y });

  const out: Cubic[] = [plus];
  const across = straight(plus.b, minus.b);
  if (across !== null) out.push(across);
  out.push(reverse(minus));
  const back = straight(minus.a, plus.a);
  if (back !== null) out.push(back);

  return out.length >= 3 ? out : null;
}

/** A cubic moved, which is exact: every control point by the same amount. */
function moved(s: Cubic, by: Vec2): Cubic {
  const at = (p: Vec2): Vec2 => ({ x: p.x + by.x, y: p.y + by.y });
  return cubic(at(s.a), at(s.c1), at(s.c2), at(s.b));
}

/** A straight line as a cubic, or `null` for one with no length. */
function straight(a: Vec2, b: Vec2): Cubic | null {
  if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) return null;
  return cubic(
    a,
    { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
    { x: a.x + ((b.x - a.x) * 2) / 3, y: a.y + ((b.y - a.y) * 2) / 3 },
    b,
  );
}

/**
 * Twice the signed area a loop of cubics encloses, positive anticlockwise.
 *
 * Sampled rather than integrated: this is asked only for its sign, to turn the
 * loops of a stroke the same way round before they are filled together, and a
 * dozen points per curve settles a sign with room to spare.
 */
export function loopArea(loop: readonly Cubic[]): number {
  const points: Vec2[] = [];
  for (const s of loop) for (let i = 0; i < 12; i++) points.push(evaluate(s, i / 12));
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/** The same loop run the other way round. */
export function reverseLoop(loop: readonly Cubic[]): Cubic[] {
  return [...loop].reverse().map(reverse);
}

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
  const along = width / 2;
  const across = thickness / 2;
  if (!(along > 0) || !(across > 0) || segments.length === 0) return [];

  const a = (angleDegrees * Math.PI) / 180;
  const cos = exactly(Math.cos(a));
  const sin = exactly(Math.sin(a));

  // Into the space where the pen is a unit circle: turned back by its angle, then
  // each axis divided by the pen's half-size along it. And out again.
  const inward = (p: Vec2): Vec2 => ({
    x: (cos * p.x + sin * p.y) / along,
    y: (-sin * p.x + cos * p.y) / across,
  });
  const outward = (p: Vec2): Vec2 => {
    const x = p.x * along;
    const y = p.y * across;
    return { x: cos * x - sin * y, y: sin * x + cos * y };
  };

  // Segments with no direction — a point, a handle-less curve of no length — have
  // no sides to offset and are passed over; they would only put a zero-length
  // band in the way of the joins either side of them.
  const squashed = segments
    .map((s) => mapCubic(s, inward))
    .filter((s) => leftNormal(s, 0) !== null && leftNormal(s, 1) !== null);
  if (squashed.length === 0) return [];

  // The tolerance is in design units, and a unit in the squashed space is as long
  // as the pen's longer half.
  const fine = tolerance / Math.max(along, across);

  const loops: Cubic[][] = [];
  for (const s of squashed) loops.push(...bands(s, fine, 0));

  const joins = closed ? squashed.length : squashed.length - 1;
  for (let i = 0; i < joins; i++) {
    const wedge = cornerWedge(squashed[i]!, squashed[(i + 1) % squashed.length]!);
    if (wedge !== null) loops.push(wedge);
  }

  if (!closed) {
    const first = squashed[0]!;
    const last = squashed[squashed.length - 1]!;
    loops.push(cap(last.b, leftNormal(last, 1)!, true));
    loops.push(cap(first.a, leftNormal(first, 0)!, false));
  }

  return loops.map((loop) => loop.map((c) => mapCubic(c, outward)));
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

/** How many times a stretch is halved looking for one that does not fold. */
const FOLD_DEPTH = 8;

/**
 * How far two directions may differ at a join before it is a corner, in radians.
 *
 * A tenth of a degree. Below it the gap a corner opens is thinner than anything
 * the font keeps, and a wedge that thin is a sliver the union would have to find
 * and throw away.
 */
const CORNER = (0.1 * Math.PI) / 180;

/**
 * The ink a unit circle leaves along one stretch, as bands that do not cross
 * themselves, each closed straight across at both ends.
 *
 * Where the path bends more tightly than the pen is wide, the offset on the inside
 * of the bend runs backwards over itself: a curve of radius a half moved inwards
 * by one comes out on the far side of its own centre. A band made with that side
 * crosses itself, and one that crosses itself fills by the non-zero rule with a
 * hole in it — a notch on the inside of every tight turn. So a stretch that folds
 * is halved until its halves do not, and one still folding when it is too short to
 * matter has its folded side drawn straight across: over a stretch that short the
 * pen's circles at its two ends overlap all of it, and the straight line runs
 * through ink either way. The halves meet along a straight line across, which is
 * flush and joins cleanly.
 */
function bands(c: Cubic, tolerance: number, depth: number): Cubic[][] {
  const startNormal = leftNormal(c, 0);
  const endNormal = leftNormal(c, 1);
  if (startNormal === null || endNormal === null) return [];

  const leftFolds = folds(c, 1);
  const rightFolds = folds(c, -1);
  if ((leftFolds || rightFolds) && depth < FOLD_DEPTH) {
    const [first, second] = split(c, 0.5);
    return [...bands(first, tolerance, depth + 1), ...bands(second, tolerance, depth + 1)];
  }

  const side = (distance: number, folded: boolean): Cubic[] =>
    folded
      ? [straightAcross(c, distance, startNormal, endNormal)]
      : offsetCubic(c, distance, tolerance);

  const left = side(1, leftFolds);
  const right = side(-1, rightFolds);
  if (left.length === 0 || right.length === 0) return [];

  const leftEnd = left[left.length - 1]!.b;
  const rightEnd = right[right.length - 1]!.b;
  const rightStart = right[0]!.a;
  const leftStart = left[0]!.a;

  return [
    [
      ...left,
      line(leftEnd, rightEnd),
      ...[...right].reverse().map(reverse),
      line(rightStart, leftStart),
    ],
  ];
}

/**
 * What fills the outside of a corner, or `null` for a join that is not one.
 *
 * The pen standing at the corner covers a whole circle, and the two bands either
 * side cover all of it but a wedge on the outside of the turn: between the straight
 * line across the end of one band and the straight line across the start of the
 * next. The wedge is two radii and the arc between them, going the short way
 * round, and it meets each band along the radius they share.
 *
 * On the inside of the turn the bands overlap instead, crossing each other, and
 * crossings are what the union is best at.
 */
function cornerWedge(before: Cubic, after: Cubic): Cubic[] | null {
  const arriving = tangent(before, 1);
  const leaving = tangent(after, 0);
  if (arriving === null || leaving === null) return null;

  const turn = arriving.x * leaving.y - arriving.y * leaving.x;
  const dot = arriving.x * leaving.x + arriving.y * leaving.y;
  if (Math.abs(Math.atan2(turn, dot)) < CORNER) return null;

  // The outside of a left turn is the right-hand side.
  const outside = turn > 0 ? -1 : 1;
  const inNormal = leftNormal(before, 1)!;
  const outNormal = leftNormal(after, 0)!;
  const p = before.b;
  const from = { x: p.x + inNormal.x * outside, y: p.y + inNormal.y * outside };
  const to = { x: p.x + outNormal.x * outside, y: p.y + outNormal.y * outside };

  // The short way round, which is the way the turn went on the outside.
  const anticlockwise = (from.x - p.x) * (to.y - p.y) - (from.y - p.y) * (to.x - p.x) > 0;
  const arc = arcCubics(p, from, to, anticlockwise);
  if (arc.length === 0) return null;

  return [line(p, from), ...arc, line(to, p)];
}

/**
 * The round end of an open path: half the pen's circle, closed by its diameter.
 *
 * At the far end the arc runs from the left side round in front of the path to the
 * right; at the near end, from the right round behind it to the left. The diameter
 * is the straight line across the end of the band beside it, so the two meet flush.
 */
function cap(p: Vec2, normal: Vec2, atEnd: boolean): Cubic[] {
  const left = { x: p.x + normal.x, y: p.y + normal.y };
  const right = { x: p.x - normal.x, y: p.y - normal.y };
  const [from, to] = atEnd ? [left, right] : [right, left];
  return [...arcCubics(p, from, to, false), line(to, from)];
}

/**
 * Whether the path bends more tightly than the pen on the given side somewhere.
 *
 * The offset at distance `d` along the left normal turns back on itself where
 * `1 − d·κ` goes negative: the radius on that side is smaller than the distance.
 * Read at a spread of points rather than solved, because the question is only
 * whether to halve the stretch and look again.
 */
function folds(c: Cubic, distance: number): boolean {
  for (let i = 0; i <= 16; i++) {
    const k = curvature(c, i / 16);
    if (k !== null && 1 - distance * k < 0) return true;
  }
  return false;
}

/** A side drawn straight, from where the pen's edge starts to where it ends. */
function straightAcross(c: Cubic, distance: number, startNormal: Vec2, endNormal: Vec2): Cubic {
  const from = { x: c.a.x + startNormal.x * distance, y: c.a.y + startNormal.y * distance };
  const to = { x: c.b.x + endNormal.x * distance, y: c.b.y + endNormal.y * distance };
  return line(from, to);
}

/** A straight line as a cubic, its handles a third of the way along. */
function line(from: Vec2, to: Vec2): Cubic {
  return cubic(
    from,
    { x: from.x + (to.x - from.x) / 3, y: from.y + (to.y - from.y) / 3 },
    { x: from.x + ((to.x - from.x) * 2) / 3, y: from.y + ((to.y - from.y) * 2) / 3 },
    to,
  );
}

/** A cubic with every control point mapped, which is exact for a linear map. */
function mapCubic(s: Cubic, f: (p: Vec2) => Vec2): Cubic {
  return cubic(f(s.a), f(s.c1), f(s.c2), f(s.b));
}
