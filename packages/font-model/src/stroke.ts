import {
  type Cubic,
  type PenShape,
  type SegmentBlend,
  type Vec2,
  blendPen,
  clipLoop,
  endTangent,
  evaluate,
  lineAsCubic,
  loopArea,
  penPathStrokeParts,
  plannedStrokes,
  reverseLoop,
} from "@typewright/geometry";

import { type Contour, type Nib, segmentAt, segmentCount, segmentCubic } from "./contour.js";
import type { StrokeEnd } from "./node.js";
import { type Glyph, glyph } from "./glyph.js";
import { type IdFactory, counterIds } from "./ids.js";
import { corneredContour, hasContinuousCorners } from "./corner.js";
import { contourOfCurves } from "./curves.js";
import { removeOverlap } from "./overlap.js";
import { joinsFurther, unionByPolygons } from "./polygon-union.js";

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
  if (c.nib === undefined) return [corneredContour(c)];
  const known = joinedInk.get(c);
  if (known !== undefined) return known;

  // Slivers left out: where the path runs along the nib's own edge a stretch of
  // ink can be a hair thin, less ink than anything shows, and its two long sides
  // lying all but on each other are more than the union can tell apart.
  const regions = joinedParts(c, ids).filter((r) => thickness(r) >= SLIVER);
  // One outline out of the regions. The union may decline a boundary it cannot
  // close; the regions are still the right ink by the non-zero rule, only
  // overlapping, so they are drawn as they are rather than not at all.
  const joined =
    regions.length < 2 ? null : removeOverlap(glyph("", { contours: [...regions] }), ids);
  let answer: readonly Contour[] =
    joined === null ? regions : joined.glyph.contours.filter((r) => thickness(r) >= SLIVER);
  // The union of curves can be fooled by edges lying all but on top of each other
  // — the legs of a stroke at a sharp corner — into handing back loops that still
  // overlap, or meet along an edge, or into refusing altogether. Joined as polygons
  // where it refused, and where what it gave back still joins further. Refusing
  // used to hand back the pieces as they were, which is a stroke that converted
  // into a pile of outlines to be joined by hand.
  if (regions.length > 1 && (joined === null || (answer.length > 1 && joinsFurther(answer)))) {
    // Sliver-thin rings left out of this answer as of the union's: a hole a unit
    // long and a fraction wide, where two parts all but met, is a pinhole in the
    // letter, not a counter.
    answer = (unionByPolygons(regions, ids) ?? answer).filter((r) => thickness(r) >= SLIVER);
  }
  markInk(answer);
  joinedInk.set(c, answer);
  return answer;
}

/**
 * One stroke's ink in each of several masters, drawn to the same points in all
 * of them — or `null` where it cannot be.
 *
 * `strokes` is the same stroke as each master has it. What comes back is, for
 * each, the ink as a line round it that crosses itself where the ink folds or
 * turns a corner, and fills as the ink does by the non-zero rule: not an
 * outline to edit or to put in a font that wants its overlaps gone, but one
 * that has the same points in every master, which the joined outline of
 * {@link inkOf} has not. See `plannedStrokes` for how, and for when not.
 */
export function plannedInk(strokes: readonly Contour[], ids: IdFactory): Contour[][] | null {
  if (strokes.some((c) => c.nib === undefined || c.nodes.length < 2)) return null;
  // An end cut straight is the ink cut by a line, which is a different number
  // of points wherever the line falls: not yet a thing every master shares.
  if (strokes.some((c) => strokeCut(c, "start") !== null || strokeCut(c, "end") !== null)) {
    return null;
  }
  const planned = plannedStrokes(
    strokes.map((c) => {
      const curves: Cubic[] = [];
      for (let i = 0; i < segmentCount(c); i++) {
        const segment = segmentAt(c, i);
        if (segment !== null) curves.push(segmentCubic(segment));
      }
      return { curves, pens: pensOf(c), closed: c.closed, blends: c.nodes.map((n) => n.blend) };
    }),
  );
  if (planned === null) return null;
  return planned.map((loops) => markInk(loops.map((loop) => contourOfCurves(loop, ids))));
}

/** Below this average thickness, in units, a region of ink is a sliver. */
const SLIVER = 0.25;

/**
 * How thick a region is on average: its area over half its perimeter — rough, and
 * only ever asked whether it is next to nothing.
 *
 * Measured along its curves, a few points each, not between its nodes alone: a
 * round counter drawn with two curves has two nodes, which enclose nothing, and
 * was thrown away as a sliver.
 */
function thickness(c: Contour): number {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < segmentCount(c); i++) {
    const s = segmentAt(c, i);
    if (s === null) continue;
    const curve = segmentCubic(s);
    for (let k = 0; k < 8; k++) pts.push(evaluate(curve, k / 8));
  }
  let area = 0;
  let perimeter = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    area += a.x * b.y - b.x * a.y;
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return perimeter === 0 ? 0 : Math.abs(area) / perimeter;
}

/**
 * Answers remembered per contour, which is what makes a stroke cheap to draw.
 *
 * The model is persistent: a contour that has not changed is the same object, so
 * dragging one point of one stroke leaves every other stroke's contour — and its
 * answer here — exactly where it was, and only the stroke being dragged is worked
 * out again. Nothing needs invalidating by hand, because a changed contour is a
 * different key.
 */
const joinedInk = new WeakMap<Contour, readonly Contour[]>();
const regionsOf = new WeakMap<Contour, readonly Contour[]>();
const partsOf = new WeakMap<
  Contour,
  { readonly pieces: readonly Contour[]; readonly folds: readonly (readonly Contour[])[] }
>();

/**
 * The contours that are a stroke's ink rather than something drawn.
 *
 * A drawn outline runs whichever way its points were placed, so whatever fills
 * a glyph first turns each contour by its nesting: one inside another is a
 * counter. Ink is already turned the way ink is, and must not be judged like
 * that — the ink of one stroke often lies inside another's, a round end resting
 * on the stroke it meets, a door inside a house, and taken for a counter it is
 * cut out of what it crosses. A stroke says so by its pen, but its ink is
 * handed on without one — into a glyph prepared for drawing, through a
 * component — so the ink is marked here, where it is made, and the mark is
 * what {@link isInk} reads.
 *
 * By identity, since the model is persistent: a contour is ink or it is not
 * for as long as it exists. A copy made by moving it through a component is a
 * new contour, and whoever makes one says so with {@link markInk}.
 */
const inkMarks = new WeakSet<Contour>();

/** Say these contours are a stroke's ink. Returns them, for use in a chain. */
export function markInk<T extends readonly Contour[]>(contours: T): T {
  for (const c of contours) inkMarks.add(c);
  return contours;
}

/** Whether a contour is a stroke's ink: already turned as ink is, and to be filled as it is. */
export function isInk(c: Contour): boolean {
  return inkMarks.has(c);
}

/** Ids for the regions of a stroke's ink: nothing selects them, they are drawn. */
const regionIds = counterIds("ink-");

/**
 * The ink a stroke leaves, as the regions it is made of, not joined.
 *
 * What the canvas fills, and why it fills this rather than the joined outline:
 * every region is turned the same way round, the way outlines are, so the non-zero
 * rule fills overlapping regions exactly as it would fill their union — and the
 * union is by far the dearest part of a stroke, dear enough that drawing one while
 * its points were dragged ran at a few frames a second. The joined outline is for
 * where one outline is what is asked for: the font, the `.ufo`, the ruler.
 */
export function inkRegions(c: Contour): readonly Contour[] {
  if (c.nib === undefined) return [corneredContour(c)];
  const known = regionsOf.get(c);
  if (known !== undefined) return known;
  const parts = strokeParts(c);
  const regions = [...parts.pieces, ...parts.folds.flat()];
  markInk(regions);
  regionsOf.set(c, regions);
  return regions;
}

/**
 * A stroke's ink in its two kinds of part: the bands, wedges and caps, and each
 * fold's chain of steps — the pen swept from one position to the next where the
 * sides fold back and are not the edge of the ink.
 *
 * Apart because they are wanted differently. The canvas fills them all as they
 * are: turned the same way round, the non-zero rule fills them as their union, and
 * the steps are straight-edged, so the curvature comb has nothing to say about
 * their edges. The outline — for the font, the `.ufo`, a conversion — joins each
 * chain into the one region it is first, so the union meets a shape where it would
 * have met a hundred; that join is too dear to make on every move of a drag.
 */
function strokeParts(c: Contour): {
  readonly pieces: readonly Contour[];
  readonly folds: readonly (readonly Contour[])[];
} {
  const known = partsOf.get(c);
  if (known !== undefined) return known;

  const pieces: Contour[] = [];
  const folds: Contour[][] = [];
  for (const stretch of stretchesOf(c)) {
    const parts = stretchParts(stretch);
    // Nearly every stroke is one stretch with nothing cut, and is drawn again
    // at every move of a drag: its parts go straight through.
    if (stretch.cuts.length === 0) {
      for (const loop of parts.loops) pieces.push(regionOf(loop));
      for (const chain of parts.sweeps) folds.push(chain.map(regionOf));
      continue;
    }
    for (const loop of parts.loops) {
      const kept = cutBy(loop, stretch.cuts);
      if (kept.length > 0) pieces.push(regionOf(kept));
    }
    for (const chain of parts.sweeps) {
      const steps = chain
        .map((step) => cutBy(step, stretch.cuts))
        .filter((kept) => kept.length > 0);
      if (steps.length > 0) folds.push(steps.map(regionOf));
    }
  }
  const found = { pieces, folds };
  partsOf.set(c, found);
  return found;
}

/**
 * A loop as a region of ink, turned the way ink is.
 *
 * Every piece the same way round — anticlockwise, which is how an outline's
 * outer contour is turned for the fill — or two that overlap with opposite
 * turns cancel where they cross and leave a hole in the stroke.
 */
function regionOf(loop: readonly Cubic[]): Contour {
  return asContour(loopArea(loop) < 0 ? reverseLoop(loop) : loop);
}

/** A loop as a contour, turned as it is. */
function asContour(loop: readonly Cubic[]): Contour {
  return contourOfCurves(
    loop.map((curve) => ({ curve, line: straight(curve) })),
    regionIds,
  );
}

/** A contour's curves, in order. */
function curvesOf(c: Contour): Cubic[] {
  const curves: Cubic[] = [];
  for (let i = 0; i < segmentCount(c); i++) {
    const segment = segmentAt(c, i);
    if (segment !== null) curves.push(segmentCubic(segment));
  }
  return curves;
}

/** A loop with everything past each of some cuts taken off. */
function cutBy(loop: readonly Cubic[], cuts: readonly StrokeCut[]): readonly Cubic[] {
  let kept = loop;
  for (const cut of cuts) {
    if (kept.length === 0) break;
    kept = clipLoop(kept, cut.through, cut.normal);
  }
  return kept;
}

/**
 * A straight line a stroke's end is cut off by: the point it goes through, the
 * way it faces — away from the ink that is kept — and the way the path was
 * going when it got there.
 */
export type StrokeCut = {
  readonly through: Vec2;
  readonly normal: Vec2;
  readonly onward: Vec2;
};

/**
 * How nearly along the path a cut may lie: the sine of fifteen degrees.
 *
 * A stroke is carried on until the whole pen is past the cut, and a cut that
 * runs nearly the way the path does is never got past. Flatter than this the
 * end is left as the pen leaves it.
 */
const SHALLOWEST_CUT = Math.sin((15 * Math.PI) / 180);

/**
 * The cut at one end of a stroke, or `null` where that end is left as the pen
 * leaves it: no cut set there, a closed path, which has no ends, or a cut too
 * nearly along the path to make.
 */
export function strokeCut(c: Contour, which: "start" | "end"): StrokeCut | null {
  if (c.nib === undefined || c.closed || c.nodes.length < 2) return null;
  const node = which === "start" ? c.nodes[0]! : c.nodes[c.nodes.length - 1]!;
  if (node.end === undefined) return null;
  const segment = segmentAt(c, which === "start" ? 0 : segmentCount(c) - 1);
  if (segment === null) return null;
  const along = endTangent(segmentCubic(segment), which === "start" ? 0 : 1);
  if (along === null) return null;
  // The way the stroke would go on: forwards past its last point, backwards
  // past its first.
  const onward = which === "start" ? { x: -along.x, y: -along.y } : along;

  let normal = onward;
  if (node.end.cut !== "square") {
    const angle = (node.end.cut * Math.PI) / 180;
    const across = { x: -Math.sin(angle), y: Math.cos(angle) };
    const facing = across.x * onward.x + across.y * onward.y;
    normal = facing < 0 ? { x: -across.x, y: -across.y } : across;
  }
  if (normal.x * onward.x + normal.y * onward.y < SHALLOWEST_CUT) return null;
  return { through: node.pt, normal, onward };
}

/**
 * The line an end of a stroke is cut along, as something to show and to take
 * hold of: through the end, a little longer than the pen is wide, with a knob at
 * one end of it that turns it.
 *
 * Wherever a cut is set — also one too nearly along the path to be made, which
 * is exactly the one somebody wants to take hold of and turn back. `null` where
 * the end is left as the pen leaves it.
 */
export type StrokeCutHandle = {
  readonly through: Vec2;
  readonly from: Vec2;
  readonly to: Vec2;
  /** Where the line is taken hold of: its far end. */
  readonly knob: Vec2;
};

/** How far past the pen's reach the line of a cut is drawn, in units. */
const CUT_HANDLE_PAST = 24;

export function strokeCutHandle(c: Contour, which: "start" | "end"): StrokeCutHandle | null {
  if (c.nib === undefined || c.closed || c.nodes.length < 2) return null;
  const index = which === "start" ? 0 : c.nodes.length - 1;
  const node = c.nodes[index]!;
  if (node.end === undefined) return null;

  let along: Vec2;
  if (node.end.cut === "square") {
    const segment = segmentAt(c, which === "start" ? 0 : segmentCount(c) - 1);
    const going =
      segment === null ? null : endTangent(segmentCubic(segment), which === "start" ? 0 : 1);
    if (going === null) return null;
    along = { x: -going.y, y: going.x };
  } else {
    const angle = (node.end.cut * Math.PI) / 180;
    along = { x: Math.cos(angle), y: Math.sin(angle) };
  }
  const pen = penAt(c, index) ?? c.nib;
  const half = Math.max(pen.width, pen.thickness ?? 0) / 2 + CUT_HANDLE_PAST;
  const at = (by: number): Vec2 => ({ x: node.pt.x + along.x * by, y: node.pt.y + along.y * by });
  return { through: node.pt, from: at(-half), to: at(half), knob: at(half) };
}

/** How near a round angle a cut being turned is drawn to it, in degrees. */
const CUT_SNAP = 4;

/**
 * The cut an end takes when its line is turned to point at `towards`.
 *
 * In whole degrees, anticlockwise from level, as it is typed. Near level,
 * upright or square to the path it is that exactly: those are what a cut is
 * nearly always wanted at, and a degree off one of them is a mistake nobody
 * can see until the font is set.
 */
export function strokeCutTowards(
  c: Contour,
  which: "start" | "end",
  towards: Vec2,
): StrokeEnd | null {
  if (c.nib === undefined || c.closed || c.nodes.length < 2) return null;
  const node = which === "start" ? c.nodes[0]! : c.nodes[c.nodes.length - 1]!;
  const dx = towards.x - node.pt.x;
  const dy = towards.y - node.pt.y;
  if (Math.hypot(dx, dy) < 1e-6) return null;
  const turned = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;

  // How far two lines are apart, which is never more than a quarter turn.
  const apart = (a: number, b: number): number => {
    const d = Math.abs(a - b) % 180;
    return Math.min(d, 180 - d);
  };
  const segment = segmentAt(c, which === "start" ? 0 : segmentCount(c) - 1);
  const going =
    segment === null ? null : endTangent(segmentCubic(segment), which === "start" ? 0 : 1);
  if (going !== null) {
    const square = ((Math.atan2(going.x, -going.y) * 180) / Math.PI + 360) % 360;
    // Level and upright first: a stem's foot is both level and square, and
    // level is what it is called.
    if (
      apart(turned, 0) > CUT_SNAP &&
      apart(turned, 90) > CUT_SNAP &&
      apart(turned, square) <= CUT_SNAP
    ) {
      return { cut: "square" };
    }
  }
  for (const round of [0, 90, 180, 270]) {
    const d = Math.abs(turned - round);
    if (Math.min(d, 360 - d) <= CUT_SNAP) return { cut: round };
  }
  return { cut: Math.round(turned) % 360 };
}

/**
 * A stretch of a stroke worked out on its own: its path, the pen at each of its
 * points, and the cuts its ink is cut by.
 */
type Stretch = {
  readonly curves: readonly Cubic[];
  readonly pens: readonly PenShape[];
  readonly blends: readonly (SegmentBlend | undefined)[];
  readonly closed: boolean;
  readonly cuts: readonly StrokeCut[];
};

/**
 * A stroke as the stretches its ink is worked out in: one, the whole of it,
 * unless an end is cut.
 *
 * A cut end is the stroke carried on straight past its last point, with the pen
 * it had there, far enough for the whole pen to be past the cut — and then cut.
 * The cut is a line across the whole page, and a stroke comes back across lines:
 * the bowl of a u hangs below the feet of its stems. So only the last segment is
 * carried on and cut, as a stretch of its own, and the rest of the stroke is
 * left whole. Each stretch has the pen standing at both its ends, so they
 * overlap where they meet, as the segments of a stroke always have.
 */
function stretchesOf(c: Contour): Stretch[] {
  const nib = c.nib;
  if (nib === undefined || !(nib.width > 0) || c.nodes.length < 2) return [];
  const curves = curvesOf(c);
  const count = curves.length;
  if (count === 0) return [];
  const pens = pensOf(c);
  const blends = c.nodes.map((n) => n.blend);

  const start = strokeCut(c, "start");
  const end = strokeCut(c, "end");
  if (start === null && end === null) return [{ curves, pens, blends, closed: c.closed, cuts: [] }];

  // How far on the stroke is carried: until the pen's furthest reach is past the cut.
  const carried = (cut: StrokeCut, pen: PenShape): Vec2 => {
    const reach = Math.max(pen.width, pen.thickness) / 2 + 2;
    const by = reach / (cut.normal.x * cut.onward.x + cut.normal.y * cut.onward.y);
    return { x: cut.through.x + cut.onward.x * by, y: cut.through.y + cut.onward.y * by };
  };
  const before = start === null ? null : lineAsCubic(carried(start, pens[0]!), start.through);
  const after = end === null ? null : lineAsCubic(end.through, carried(end, pens[count]!));

  if (count === 1) {
    return [
      {
        curves: [
          ...(before === null ? [] : [before]),
          curves[0]!,
          ...(after === null ? [] : [after]),
        ],
        pens: [
          ...(before === null ? [] : [pens[0]!]),
          pens[0]!,
          pens[1]!,
          ...(after === null ? [] : [pens[1]!]),
        ],
        blends: [
          ...(before === null ? [] : [undefined]),
          blends[0],
          ...(after === null ? [] : [undefined]),
        ],
        closed: false,
        cuts: [...(start === null ? [] : [start]), ...(end === null ? [] : [end])],
      },
    ];
  }

  const out: Stretch[] = [];
  if (start !== null && before !== null) {
    out.push({
      curves: [before, curves[0]!],
      pens: [pens[0]!, pens[0]!, pens[1]!],
      blends: [undefined, blends[0]],
      closed: false,
      cuts: [start],
    });
  }
  const from = start === null ? 0 : 1;
  const to = end === null ? count : count - 1;
  if (to > from) {
    out.push({
      curves: curves.slice(from, to),
      pens: pens.slice(from, to + 1),
      blends: blends.slice(from, to),
      closed: false,
      cuts: [],
    });
  }
  if (end !== null && after !== null) {
    out.push({
      curves: [curves[count - 1]!, after],
      pens: [pens[count - 1]!, pens[count]!, pens[count]!],
      blends: [blends[count - 1], undefined],
      closed: false,
      cuts: [end],
    });
  }
  return out;
}

/**
 * The ink of one stretch in its parts, as the geometry gives them.
 *
 * The pen at every point, which is the point's own where it has one and the
 * contour's where it does not; along each segment it blends from one to the
 * next. Where a segment's two pens are the same, its ink is worked out as it
 * always was — exactly, for a broad edge.
 */
function stretchParts(stretch: Stretch): { loops: Cubic[][]; sweeps: Cubic[][][] } {
  return penPathStrokeParts([...stretch.curves], [...stretch.pens], stretch.closed, undefined, [
    ...stretch.blends,
  ]);
}

/** Each part of a stroke's ink, with every fold's chain of steps joined into one region. */
function joinedParts(c: Contour, ids: IdFactory): readonly Contour[] {
  const stretches = stretchesOf(c);
  if (stretches.every((s) => s.cuts.length === 0)) {
    const parts = strokeParts(c);
    // Where the join fails the steps are kept as they are: they fill the same.
    return [
      ...parts.pieces,
      ...parts.folds.flatMap((steps) => unionByPolygons(steps, ids, false) ?? steps),
    ];
  }

  // A stretch that is cut is joined into one outline first and cut after. Cut
  // first, every part of it would have an edge along the same line, lying on
  // its neighbours' — and edges lying along each other are what the union is
  // worst at.
  return stretches.flatMap((stretch) => {
    const parts = stretchParts(stretch);
    const regions = [
      ...parts.loops.map(regionOf),
      ...parts.sweeps.flatMap((chain) => {
        const steps = chain.map(regionOf);
        return unionByPolygons(steps, ids, false) ?? steps;
      }),
    ];
    if (stretch.cuts.length === 0) return regions;
    const whole =
      regions.length < 2
        ? regions
        : (removeOverlap(glyph("", { contours: regions }), ids)?.glyph.contours ??
          unionByPolygons(regions, ids) ??
          regions);
    // Turned as the union left them: a hole in it stays a hole.
    return whole.flatMap((region) => {
      const kept = cutBy(curvesOf(region), stretch.cuts);
      return kept.length === 0 ? [] : [asContour(kept)];
    });
  });
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

/** The pen at a point of a stroke: the point's own, or the contour's. */
export function penAt(c: Contour, i: number): Nib | null {
  const own = c.nodes[i]?.pen;
  return own ?? c.nib ?? null;
}

/** The pen at every point of a stroke, as the geometry wants it. */
function pensOf(c: Contour): PenShape[] {
  return c.nodes.map((_, i) => {
    const pen = penAt(c, i) ?? { angle: 0, width: 0 };
    return { angle: pen.angle, width: pen.width, thickness: pen.thickness ?? 0 };
  });
}

/**
 * The pen a fraction of the way from one pen to another, as a stroke's pen.
 *
 * What a point put into a stroke is given: the pen the stroke already had at that
 * place, so putting a point in changes nothing about the ink until the point's pen
 * is changed. The angle turns the short way round, over half a turn.
 */
export function blendNib(a: Nib, b: Nib, t: number): Nib {
  const pen = blendPen(
    { angle: a.angle, width: a.width, thickness: a.thickness ?? 0 },
    { angle: b.angle, width: b.width, thickness: b.thickness ?? 0 },
    t,
  );
  return pen.thickness > 0
    ? { angle: pen.angle, width: pen.width, thickness: pen.thickness }
    : { angle: pen.angle, width: pen.width };
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
  if (!g.contours.some(isDerived)) return g;
  return { ...g, contours: g.contours.flatMap((c) => inkOf(c, ids)) };
}

/**
 * Whether what a contour draws is worked out from it rather than being it: a
 * stroke, whose ink comes from its pen, or an outline with continuous corners,
 * whose drawing rounds them.
 */
export function isDerived(c: Contour): boolean {
  return c.nib !== undefined || hasContinuousCorners(c);
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
