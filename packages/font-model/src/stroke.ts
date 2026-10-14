import {
  type Cubic,
  type PenShape,
  type SegmentBlend,
  type Vec2,
  blendPen,
  clipLoop,
  derivative,
  endTangent,
  evaluate,
  flatten,
  fitCubics,
  isBroad,
  lineAsCubic,
  loopArea,
  penExponent,
  penPathStrokeParts,
  penProfiles,
  penSupport,
  plannedStrokes,
  reverseLoop,
  subcurve,
  unitRoots,
} from "@typewright/geometry";

import {
  type Contour,
  type Nib,
  nibOfShape,
  penShapeOf,
  segmentAt,
  segmentCount,
  segmentCubic,
} from "./contour.js";
import type { StrokeEnd } from "./node.js";
import {
  type EndSerif,
  type Serif,
  type SerifPiece,
  serifInset,
  serifOutline,
  serifRise,
  soundSerif,
  withSerifNumber,
} from "./serif.js";
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

  // A rectangular pen's ink is exact, and is one line round it: joined, that
  // line is the outline, its sides the path itself moved over by a corner of
  // the pen and its ends the pen's own straight edges. So with a broad edge
  // that widens or turns along the stroke.
  const exact = boxLine(c);
  if (exact !== null) {
    const outline = removeOverlap(glyph("", { contours: [...exact] }), ids);
    if (outline !== null) {
      const tidy = markInk(
        outline.glyph.contours.filter((r) => thickness(r) >= SLIVER).map(withoutPointsOnALine),
      );
      joinedInk.set(c, tidy);
      return tidy;
    }
  }

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
  // And it can be fooled without showing it: one outline, that joins no
  // further, with an edge some units from where any of the regions has one.
  // So what it gives back is asked whether it is the regions' ink, below.
  if (regions.length > 1 && (joined === null || (answer.length > 1 && joinsFurther(answer)))) {
    // Sliver-thin rings left out of this answer as of the union's: a hole a unit
    // long and a fraction wide, where two parts all but met, is a pinhole in the
    // letter, not a counter.
    answer = (unionByPolygons(regions, ids) ?? answer).filter((r) => thickness(r) >= SLIVER);
  } else if (regions.length > 1 && !isTheInkOf(answer, regions)) {
    // Looked at and found wanting. The other way of joining takes its place
    // only where it is itself the regions' ink: the looking can be wrong, beside
    // a fold or a hair of ink, and an answer that was right is not to be given
    // up for one that is not.
    const other = unionByPolygons(regions, ids)?.filter((r) => thickness(r) >= SLIVER);
    if (other !== undefined && isTheInkOf(other, regions)) answer = other;
  }
  answer = answer.map(withoutSpurs);
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
export function plannedInk(
  strokes: readonly Contour[],
  ids: IdFactory,
  byCornersOnly = false,
): Contour[][] | null {
  if (strokes.some((c) => c.nib === undefined || c.nodes.length < 2)) return null;
  // The serifs, which are outlines of their own laid over the ends: each end
  // has one in every master or in none.
  const serifs = (["start", "end"] as const).map((which) => {
    const each = strokes.map((c) => laidSerif(c, which));
    return each.every((s) => s !== null) ? each : each.every((s) => s === null) ? null : false;
  });
  if (serifs.includes(false)) return null;
  const [startSerifs, endSerifs] = serifs as (LaidSerif[] | null)[];
  const planned = plannedStrokes(
    strokes.map((c, at) => {
      const curves: Cubic[] = [];
      for (let i = 0; i < segmentCount(c); i++) {
        const segment = segmentAt(c, i);
        if (segment !== null) curves.push(segmentCubic(segment));
      }
      // The ends that are cut, as the plan wants them. An end whose cut is too
      // nearly along the path to make is left as the pen leaves it, here as in
      // a single font.
      const start = startSerifs?.[at]?.cut ?? strokeCut(c, "start");
      const end = endSerifs?.[at]?.cut ?? strokeCut(c, "end");
      // And how far back along the path each may be made: as far as a single
      // font's is.
      // And where the part of the stroke each is made of begins, the rest
      // being whole with the pen standing there — nowhere, where the two reach
      // into each other and the stroke is one stretch, as `stretchesOf` has it.
      const along = (p: Along): number => p.index + p.t;
      const endsFrom = end === null ? null : approach(curves, end.normal);
      const startsTo =
        start === null
          ? null
          : mirrored(approach(turnedRound(curves), start.normal), curves.length);
      const apart =
        endsFrom === null || startsTo === null || along(startsTo) < along(endsFrom) - 1e-9;
      const cuts = {
        ...(start === null
          ? {}
          : {
              start: {
                ...start,
                legs: cutLegs(curves, start, "start"),
                ...(apart && startsTo !== null ? { from: along(startsTo) } : {}),
              },
            }),
        ...(end === null
          ? {}
          : {
              end: {
                ...end,
                legs: cutLegs(curves, end, "end"),
                ...(apart && endsFrom !== null ? { from: along(endsFrom) } : {}),
              },
            }),
      };
      return {
        curves,
        pens: pensOf(c),
        closed: c.closed,
        blends: c.nodes.map((n) => n.blend),
        cuts,
      };
    }),
    byCornersOnly,
  );
  if (planned === null) return null;
  const laid = [startSerifs, endSerifs].flatMap((each) => {
    if (each == null) return [];
    // A piece is a line where it is one in every master, so they all have the
    // same points.
    const lines = each[0]!.pieces.map((_, i) =>
      each.every((s) => s.pieces[i]!.line || flat(s.pieces[i]!.curve)),
    );
    return [each.map((s) => s.pieces.map((piece, i) => ({ curve: piece.curve, line: lines[i]! })))];
  });
  return planned.map((loops, at) =>
    markInk([
      ...loops.map((loop) => contourOfCurves(loop, ids)),
      ...laid.map((each) => contourOfCurves(each[at]!, ids)),
    ]),
  );
}

/** Whether a curve is a straight line, or nothing at all. */
function flat(s: Cubic): boolean {
  return Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) < 1e-9
    ? Math.hypot(s.c1.x - s.a.x, s.c1.y - s.a.y) < 1e-9 &&
        Math.hypot(s.c2.x - s.a.x, s.c2.y - s.a.y) < 1e-9
    : straight(s);
}

/** A serif laid over an end of a stroke: the cut the stroke is stopped at, and the outline. */
type LaidSerif = { readonly cut: StrokeCut; readonly pieces: SerifPiece[] };

/**
 * The serif at one end of a stroke as an outline of its own laid over the end,
 * or `null` where that end has none or it cannot stand there.
 *
 * Where it stands is read off the stroke's own ink, as the stroke is drawn in
 * a single font: how wide the stroke is on the cut, and where its edges are a
 * serif's height further up.
 */
function laidSerif(c: Contour, which: "start" | "end"): LaidSerif | null {
  if (strokeCut(c, which)?.serif === undefined) return null;
  const stretches = stretchesOf(c);
  const stretch = which === "start" ? stretches[0] : stretches[stretches.length - 1];
  const cut = which === "start" ? stretch?.cuts[0] : stretch?.cuts[stretch.cuts.length - 1];
  if (stretch === undefined || cut?.serif === undefined) return null;
  const parts = stretchParts(stretch);
  const stood = serifEnd([...parts.loops, ...parts.sweeps.flat()], cut, false);
  return stood === null ? null : { cut: stood.cut, pieces: stood.pieces };
}

/**
 * How far an outline's edge may be from the ink it is the outline of, in units:
 * it is not that ink where it is out by the first of these and by the second.
 *
 * Two, and both: beside a corner a step of the first may land in the ink of the
 * side round the corner, and say "wrong" of an outline that is right — which
 * costs the exact answer, the other way of joining being a fitted one. An edge
 * that is really out is out by more than a unit, and for some length.
 */
const TRUE_WITHIN = [0.6, 1.2] as const;
/** Pieces of an outline shorter than this are not asked about. */
const TOO_SHORT_TO_ASK = 8;

/**
 * Whether an outline is the outline of some regions' ink: whether, a little
 * inside its edge, there is ink, and a little outside it there is none.
 *
 * Asked of what the union of curves hands back. That union is exact where it
 * is right, and is kept for that; but edges lying all but along each other can
 * fool it into following the wrong one, and it then hands back an outline as
 * confidently as ever — one outline, nothing to join further — with a side of a
 * stroke five units from where the stroke's side is. Nothing told that from a
 * right answer but looking.
 *
 * At a few points along each piece of the outline that is long enough to have
 * a middle. Which side of a piece is inside is asked of the outline itself.
 * Ink too thin for a step inside the edge to stay in it answers "no" with no
 * fault of the union's, and is then joined the other way, which is no loss.
 */
function isTheInkOf(outline: readonly Contour[], regions: readonly Contour[]): boolean {
  const ringsOf = (contours: readonly Contour[]): Vec2[][] =>
    contours.map((c) => curvesOf(c).flatMap((curve) => flatten(curve, 0.02).slice(0, -1)));
  const goesRound = (rings: readonly (readonly Vec2[])[], q: Vec2): boolean => {
    let w = 0;
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        const side = (b.x - a.x) * (q.y - a.y) - (q.x - a.x) * (b.y - a.y);
        if (a.y <= q.y) {
          if (b.y > q.y && side > 0) w++;
        } else if (b.y <= q.y && side < 0) w--;
      }
    }
    return w !== 0;
  };
  const own = ringsOf(outline);
  const ink = ringsOf(regions);
  for (const c of outline) {
    for (const piece of curvesOf(c)) {
      if (Math.hypot(piece.b.x - piece.a.x, piece.b.y - piece.a.y) < TOO_SHORT_TO_ASK) continue;
      for (const t of [0.3, 0.5, 0.7]) {
        const p = evaluate(piece, t);
        const v = derivative(piece, t);
        const speed = Math.hypot(v.x, v.y);
        if (speed < 1e-9) continue;
        const right = { x: v.y / speed, y: -v.x / speed };
        const at = (d: number): Vec2 => ({ x: p.x + right.x * d, y: p.y + right.y * d });
        const onRight = goesRound(own, at(TRUE_WITHIN[0]));
        const onLeft = goesRound(own, at(-TRUE_WITHIN[0]));
        // Ink both sides or neither: too thin there to say anything of.
        if (onRight === onLeft) continue;
        const inward = onRight ? 1 : -1;
        if (TRUE_WITHIN.every((d) => !goesRound(ink, at(inward * d)))) return false;
        if (TRUE_WITHIN.every((d) => goesRound(ink, at(-inward * d)))) return false;
      }
    }
  }
  return true;
}

/** How far apart the two ends of a spur's mouth may be, in units. */
const SPUR_MOUTH = 0.5;

/**
 * An outline without its spurs: where it leaves its edge by a straight line,
 * and comes back by another to all but the place it left.
 *
 * Two parts of a stroke's ink that meet along a line — the wedge that fills
 * the inside of a corner and the band beside it, both with a side from the
 * edge of the ink to the path's own point — meet to within what a curve is
 * flattened to and no nearer, and joined they leave the line between them
 * standing: a slit no wider than a fiftieth of a unit, from the edge into the
 * middle of the stroke and back. Nothing a font shows, but two points and two
 * lines lying on each other for whoever opens the outline, and a notch for a
 * rasteriser that looks closely enough.
 *
 * Longer than its mouth is wide by a good deal, or it is a notch that was
 * drawn; and the mouth closed at the point the outline left by.
 */
function withoutSpurs(c: Contour): Contour {
  let nodes = c.nodes;
  for (let again = true; again && nodes.length > 4;) {
    again = false;
    const count = nodes.length;
    for (let i = 0; i < count; i++) {
      const left = nodes[(i - 1 + count) % count]!;
      const tip = nodes[i]!;
      const back = nodes[(i + 1) % count]!;
      if (tip.in !== null || tip.out !== null || left.out !== null || back.in !== null) continue;
      const mouth = Math.hypot(back.pt.x - left.pt.x, back.pt.y - left.pt.y);
      const length = Math.min(
        Math.hypot(tip.pt.x - left.pt.x, tip.pt.y - left.pt.y),
        Math.hypot(tip.pt.x - back.pt.x, tip.pt.y - back.pt.y),
      );
      if (mouth > SPUR_MOUTH || length < 8 * mouth || length < 2) continue;
      const closed = { ...left, out: back.out, type: "corner" as const };
      const gone = new Set([tip, back]);
      nodes = nodes.map((n) => (n === left ? closed : n)).filter((n) => !gone.has(n));
      again = true;
      break;
    }
  }
  return nodes === c.nodes ? c : { ...c, nodes };
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
  // The one line round a rectangular pen's ink goes round every point of the
  // ink and nothing else, so filled as it is, it is the ink.
  const exact = boxLine(c);
  if (exact !== null) {
    regionsOf.set(c, exact);
    return exact;
  }
  const parts = strokeParts(c);
  const regions = [...parts.pieces, ...parts.folds.flat()];
  markInk(regions);
  regionsOf.set(c, regions);
  return regions;
}

/**
 * The line round the ink of a stroke drawn with one rectangular pen all along
 * it, or `null` for any other stroke.
 *
 * A rectangle is the one pen with thickness whose ink has an exact answer: its
 * reach to either side is a corner, so the edge of the ink is the path moved
 * over by that corner, with one of the pen's own edges across wherever the path
 * runs along it. Any other pen with corners is fitted. The line is the one a
 * variable font gets (see `plannedInk`), drawn here for the one master there
 * is; it crosses itself inside a corner of the path, and is joined into an
 * outline by whoever wants one.
 *
 * And of a rectangle that changes its size or turns along the stroke, and of
 * a broad edge that does — a pen of two corners: the ink is still its corners'
 * paths, with the pen's edge across between them or, where the pen turns, the
 * path of the place that edge pivots on. A broad edge that stays as it is has
 * its own exact answer, and is left to it. `null` too where the pen turns in a
 * way that cannot be followed, and the ink is then made the other way.
 */
function boxLine(c: Contour): readonly Contour[] | null {
  if (c.nib === undefined || c.nodes.length < 2) return null;
  const known = boxLines.get(c);
  if (known !== undefined) return known;
  const pens = pensOf(c);
  const first = pens[0]!;
  const box =
    first.thickness >= OVAL_FROM &&
    first.width > 0 &&
    // Whatever size it is at each point and however it is turned: its corners
    // draw the edge of its ink still, and between them the place an edge
    // pivots on.
    pens.every((pen) => (pen.squareness ?? 0) >= 1 && pen.width > 0 && pen.thickness >= OVAL_FROM);
  const edge =
    pens.every((pen) => pen.thickness < OVAL_FROM && pen.width > 0) &&
    pens.some((pen) => pen.width !== first.width || pen.angle !== first.angle);
  // By its corners or not at all: a rectangle turning in a way that cannot be
  // followed would be planned by its reach, and one master's ink has a nearer
  // way than that.
  const line = box || edge ? (plannedInk([c], regionIds, true)?.[0] ?? null) : null;
  boxLines.set(c, line);
  return line;
}

const boxLines = new WeakMap<Contour, readonly Contour[] | null>();

/**
 * A contour without the points that sit part way along a straight edge.
 *
 * The line round a rectangular pen's ink has them by its making: the corner
 * that draws a side hands over to the next along the pen's own edge, and where
 * that edge runs the way the path does the two are one straight line with a
 * point in the middle of it.
 */
function withoutPointsOnALine(c: Contour): Contour {
  if (c.nodes.length < 4) return c;
  const straight = (n: Contour["nodes"][number]): boolean => n.in === null && n.out === null;
  // Two points in one place first, where a side cut short has pieces of no
  // length: one of them is kept, to be asked about like any other.
  const apart = c.nodes.filter((n, i) => {
    const after = c.nodes[(i + 1) % c.nodes.length]!;
    return !(
      straight(n) &&
      straight(after) &&
      Math.hypot(after.pt.x - n.pt.x, after.pt.y - n.pt.y) < 1e-9
    );
  });
  const count = apart.length;
  if (count < 4) return count === c.nodes.length || count < 3 ? c : { ...c, nodes: apart };
  const kept = apart.filter((n, i) => {
    if (!straight(n)) return true;
    const before = apart[(i - 1 + count) % count]!;
    const after = apart[(i + 1) % count]!;
    if (before.out !== null || after.in !== null) return true;
    const ax = n.pt.x - before.pt.x;
    const ay = n.pt.y - before.pt.y;
    const bx = after.pt.x - n.pt.x;
    const by = after.pt.y - n.pt.y;
    const size = Math.hypot(ax, ay) * Math.hypot(bx, by);
    // On the line, and going the same way along it.
    return Math.abs(ax * by - ay * bx) > size * 1e-9 || ax * bx + ay * by < 0;
  });
  return kept.length === c.nodes.length || kept.length < 3 ? c : { ...c, nodes: kept };
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
    const ends = endsOf([...parts.loops, ...parts.sweeps.flat()], stretch.cuts);
    for (const loop of parts.loops) {
      const kept = cutBy(loop, ends.cuts);
      if (kept.length > 0) pieces.push(regionOf(kept));
    }
    for (const chain of parts.sweeps) {
      const steps = chain.map((step) => cutBy(step, ends.cuts)).filter((kept) => kept.length > 0);
      if (steps.length > 0) folds.push(steps.map(regionOf));
    }
    for (const cap of ends.caps) pieces.push(regionOf(cap));
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

/** Below this depth, in units, an end shaped by the pen is the plain cut. */
const SHALLOWEST_CAP = 0.25;

/**
 * The cuts a stretch's ink is really cut by, and what closes each end that is
 * shaped by the pen.
 *
 * An end shaped by the pen is half the pen's outline laid along the cut: as wide
 * as the stroke is where it is cut, and as deep in proportion as the pen is
 * thick to its width, so that it is the pen's own shape and not a squashed one.
 * Its tip is on the line through the last point, where a plain cut's edge is, so
 * the point is still where the ink ends. The stroke is cut that depth short of
 * the point, and the half outline stands on the edge that leaves.
 *
 * How wide the stroke is there is read off the ink: where the line crosses it.
 * A pen held at an angle makes a stroke narrower than itself, and by how much
 * depends on which way the path was going.
 */
function endsOf(
  loops: readonly (readonly Cubic[])[],
  cuts: readonly StrokeCut[],
): { cuts: StrokeCut[]; caps: Cubic[][] } {
  const made: StrokeCut[] = [];
  const caps: Cubic[][] = [];
  for (const cut of cuts) {
    const plain = (): void => void made.push(cut);
    if (cut.serif !== undefined) {
      const stood = serifEnd(loops, cut, true);
      if (stood === null) {
        plain();
      } else {
        made.push(stood.cut);
        caps.push(
          stood.pieces
            .map((piece) => piece.curve)
            .filter((s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > 1e-9),
        );
      }
      continue;
    }
    if (!cut.nibbed || !(cut.pen.thickness > 0) || !(cut.pen.width > 0)) {
      plain();
      continue;
    }
    const across = crossing(loops, cut);
    if (across === null) {
      plain();
      continue;
    }
    const depth = (cut.pen.thickness / 2) * ((across.to - across.from) / cut.pen.width);
    if (!(depth >= SHALLOWEST_CAP)) {
      plain();
      continue;
    }
    const short: StrokeCut = {
      ...cut,
      through: {
        x: cut.through.x - cut.normal.x * depth,
        y: cut.through.y - cut.normal.y * depth,
      },
    };
    const edge = crossing(loops, short);
    if (edge === null) {
      plain();
      continue;
    }
    made.push(short);
    caps.push(halfPen(short, edge.from, edge.to, depth));
  }
  return { cuts: made, caps };
}

/**
 * A serif stood on a cut: its outline, and the cut the stroke is stopped at
 * under it. `null` where the cut misses the ink, or the serif has no height.
 *
 * The serif's foot is on the cut's line, so the last point is still where the
 * ink ends. Its sides come back to the stroke's edges, which are read off the
 * ink in two places — on the line, and at the top of the serif — and taken to
 * be straight between: so the serif is as wide as the stroke is there, and
 * leans as the stroke does.
 *
 * `joined`, the stroke is stopped at the top of the serif and the serif stands
 * on the edge that leaves, sharing it, as an end shaped by the pen does: the
 * two are one outline with nothing lying along anything. Not joined — a
 * variable font, whose overlaps stay, or a stroke too short to be measured at
 * the serif's top — the stroke is stopped inside the serif and the two overlap.
 *
 * Too short is the last of the stroke — its last segment, from where that
 * turned to come to the line — not reaching back as far as the serif's top and
 * the pen's own reach beyond it. Short of that the line at the serif's top
 * crosses the pen standing at the corner before, or the stroke that came
 * round that corner, and what it reads there is not the width of this part of
 * the stroke: the arm of an r, the last stroke of a k's leg. There the serif's
 * sides run as the path was going when it reached the line, from the width the
 * stroke has on the line.
 */
function serifEnd(
  loops: readonly (readonly Cubic[])[],
  cut: StrokeCut,
  joined: boolean,
): { cut: StrokeCut; pieces: SerifPiece[] } | null {
  const serif = cut.serif;
  if (serif === undefined) return null;
  const foot = crossing(loops, cut);
  const rise = serifRise(serif);
  if (foot === null || !(rise > 0)) return null;
  const above = (by: number): StrokeCut => ({
    ...cut,
    through: { x: cut.through.x - cut.normal.x * by, y: cut.through.y - cut.normal.y * by },
  });
  const room = cut.back ?? Infinity;
  const reach = penSupport(cut.pen, cut.normal);
  const past = Math.abs(reach.x * cut.normal.x + reach.y * cut.normal.y);
  const measured = room >= rise + past ? crossing(loops, above(rise)) : null;
  // Where it cannot be measured, as the stroke was going when it got here.
  const along = { x: -cut.normal.y, y: cut.normal.x };
  const facing = cut.normal.x * cut.onward.x + cut.normal.y * cut.onward.y;
  const lean = (-(cut.onward.x * along.x + cut.onward.y * along.y) / facing) * rise;
  const top = measured ?? { from: foot.from + lean, to: foot.to + lean };
  const pieces = serifOutline(serif, {
    through: cut.through,
    normal: cut.normal,
    foot,
    top,
    rise,
  });
  if (pieces === null) return null;
  return {
    cut: above(joined && measured !== null ? rise : serifInset(serif, room)),
    pieces,
  };
}

/**
 * Where a cut's line crosses some ink: the first and the last of it, measured
 * along the line from the point the cut goes through. `null` where it misses.
 */
function crossing(
  loops: readonly (readonly Cubic[])[],
  cut: StrokeCut,
): { from: number; to: number } | null {
  const along = { x: -cut.normal.y, y: cut.normal.x };
  let from = Infinity;
  let to = -Infinity;
  for (const loop of loops) {
    for (const piece of clipLoop(loop, cut.through, cut.normal)) {
      for (const p of [piece.a, piece.b]) {
        const dx = p.x - cut.through.x;
        const dy = p.y - cut.through.y;
        if (Math.abs(dx * cut.normal.x + dy * cut.normal.y) > 1e-6) continue;
        const at = dx * along.x + dy * along.y;
        from = Math.min(from, at);
        to = Math.max(to, at);
      }
    }
  }
  return to - from > 1e-6 ? { from, to } : null;
}

/**
 * Half the pen's outline standing on a cut, from one end of the edge to the
 * other and `depth` out from it, closed along the edge.
 *
 * The outline said by its own equation, as wide as the edge: a point round half
 * a circle with each coordinate raised to two over the pen's exponent, which is
 * a half oval for an oval and a box with two rounded corners for a squarer pen.
 */
function halfPen(cut: StrokeCut, from: number, to: number, depth: number): Cubic[] {
  const along = { x: -cut.normal.y, y: cut.normal.x };
  const middle = (from + to) / 2;
  const half = (to - from) / 2;
  const power = 2 / penExponent(cut.pen);
  const raised = (v: number): number => Math.sign(v) * Math.pow(Math.abs(v), power);
  // Out from the edge the way the stroke was going, not square to the cut: on
  // a cut that slants across the stroke the half outline leans with it, and
  // leaves each side of the stroke the way that side was going. Square to the
  // cut it met one side at a corner and the other in a notch. As far out from
  // the line either way, so the tip is still on the line through the point.
  const facing = cut.normal.x * cut.onward.x + cut.normal.y * cut.onward.y;
  const lean = { x: cut.onward.x / facing, y: cut.onward.y / facing };
  const STEPS = 48;
  const points: Vec2[] = [];
  for (let k = 0; k <= STEPS; k++) {
    const u = (k / STEPS) * Math.PI;
    // The two ends exactly on the edge, whatever the sine of half a turn is.
    const a = middle + half * raised(Math.cos(u));
    const out = k === 0 || k === STEPS ? 0 : depth * raised(Math.sin(u));
    points.push({
      x: cut.through.x + along.x * a + lean.x * out,
      y: cut.through.y + along.y * a + lean.y * out,
    });
  }
  const arc = fitCubics(points, 0.02);
  return [...arc, lineAsCubic(points[STEPS]!, points[0]!)];
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
  /** The pen the stroke has at that end. */
  readonly pen: PenShape;
  /** Whether the end is closed with half the pen's outline, not the cut itself. */
  readonly nibbed: boolean;
  /** The serif standing on the cut, where there is one. */
  readonly serif?: Serif;
  /**
   * How far back from the line, square to it, the part of the stroke that is
   * cut begins: the last of the stroke, from where it turned to come to the
   * line. Said by whoever worked that part out, and absent until then.
   */
  readonly back?: number;
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
  const pen = penShapeOf(penAt(c, which === "start" ? 0 : c.nodes.length - 1) ?? c.nib);
  const serif = node.end.serif;
  // A serif closes the end, whatever else it was closed with.
  if (serif !== undefined && serif.height > 0) {
    return { through: node.pt, normal, onward, pen, nibbed: false, serif };
  }
  return { through: node.pt, normal, onward, pen, nibbed: node.end.shape === "nib" };
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
  // Past a serif's tips too, which have handles of their own on the same line.
  const reach =
    node.end.serif === undefined ? 0 : Math.max(node.end.serif.left, node.end.serif.right);
  const half = Math.max(pen.width, pen.thickness ?? 0) / 2 + reach + CUT_HANDLE_PAST;
  const at = (by: number): Vec2 => ({ x: node.pt.x + along.x * by, y: node.pt.y + along.y * by });
  return { through: node.pt, from: at(-half), to: at(half), knob: at(half) };
}

/**
 * Where a serif is taken hold of, a handle to a number.
 *
 * Its two tips, on the line it stands on, and its height, on the middle of the
 * stroke as high up it as the serif goes: those three always. The rest are on
 * the side that reaches further, and are there where they have something to
 * say. `slope` is the middle of the serif's top, which comes down as the tip
 * thins. `bracket` is where the bracket leaves the stroke's edge, which goes
 * up the stroke as the bracket grows. `round` is where the round of the tip
 * leaves the serif's top, which comes in from the tip's corner. `cup` hangs a
 * little under the foot and goes up with the hollow — a quarter of the way
 * across the stroke, not under its middle, where the stroke's own last point
 * is and the handle would go up through it.
 */
export type SerifHandles = {
  readonly left: Vec2;
  readonly right: Vec2;
  readonly height: Vec2;
  readonly cup: Vec2;
  readonly slope?: Vec2;
  readonly bracket?: Vec2;
  readonly round?: Vec2;
};

/** A part of a serif that is dragged on the canvas: the number it sets. */
export type SerifHandle = keyof SerifHandles;

/** Every handle a serif may have, the three it always has first. */
export const SERIF_HANDLES: readonly SerifHandle[] = [
  "left",
  "right",
  "height",
  "cup",
  "slope",
  "bracket",
  "round",
];

/** How far under the foot the cup's handle hangs, in units. */
const CUP_HANDLE_BELOW = 16;

/** The most of a serif's height its foot is hollowed by, as `serifOutline` has it. */
const CUP_HANDLE_MOST = 0.75;

/**
 * Where a serif stands, as dragging it wants to know: the line's point, which
 * way along it is rightwards on the page and which way is up the stroke, where
 * the stroke's two edges are along it, and how far rightwards those edges go
 * for each unit up the stroke.
 */
type SerifFrame = {
  readonly through: Vec2;
  readonly rightwards: Vec2;
  readonly up: Vec2;
  readonly footLeft: number;
  readonly footRight: number;
  readonly lean: number;
};

const serifFrames = new WeakMap<Contour, Partial<Record<"start" | "end", SerifFrame | null>>>();

/**
 * The frame of the serif at an end, or `null` where that end has none or it
 * cannot stand there. Remembered by the stroke: it is asked at every move of
 * the pointer over a glyph with a serif selected, and depends on the stroke's
 * path and pen but not on the serif's numbers — not that it could tell.
 */
function serifFrame(c: Contour, which: "start" | "end"): SerifFrame | null {
  const known = serifFrames.get(c)?.[which];
  if (known !== undefined) return known;
  const found = ((): SerifFrame | null => {
    if (strokeCut(c, which)?.serif === undefined) return null;
    const stretches = stretchesOf(c);
    const stretch = which === "start" ? stretches[0] : stretches[stretches.length - 1];
    const cut = which === "start" ? stretch?.cuts[0] : stretch?.cuts[stretch.cuts.length - 1];
    if (stretch === undefined || cut?.serif === undefined) return null;
    const parts = stretchParts(stretch);
    const foot = crossing([...parts.loops, ...parts.sweeps.flat()], cut);
    if (foot === null) return null;
    const along = { x: -cut.normal.y, y: cut.normal.x };
    // As `serifOutline` has left and right: by the page.
    const flipped = along.x < -1e-9 || (Math.abs(along.x) <= 1e-9 && along.y < 0);
    const rightwards = flipped ? { x: -along.x, y: -along.y } : along;
    const facing = cut.normal.x * cut.onward.x + cut.normal.y * cut.onward.y;
    return {
      through: cut.through,
      rightwards,
      up: { x: -cut.normal.x, y: -cut.normal.y },
      footLeft: flipped ? -foot.to : foot.from,
      footRight: flipped ? -foot.from : foot.to,
      // Back up the stroke the way it came.
      lean: -(cut.onward.x * rightwards.x + cut.onward.y * rightwards.y) / facing,
    };
  })();
  serifFrames.set(c, { ...serifFrames.get(c), [which]: found });
  return found;
}

/**
 * The side of a serif its other handles are on: the one that reaches further,
 * the right where they reach alike. `null` for a serif that reaches neither
 * way, which has no tip to slope or round and no corner to bracket.
 */
function handledSide(
  serif: Serif,
  frame: SerifFrame,
): { readonly out: 1 | -1; readonly edge: number; readonly reach: number } | null {
  if (!(Math.max(serif.left, serif.right) > 0)) return null;
  return serif.right >= serif.left
    ? { out: 1, edge: frame.footRight, reach: serif.right }
    : { out: -1, edge: frame.footLeft, reach: serif.left };
}

/** The handles of the serif at an end of a stroke, or `null` where there is none. */
export function serifHandles(c: Contour, which: "start" | "end"): SerifHandles | null {
  const frame = serifFrame(c, which);
  const node = which === "start" ? c.nodes[0] : c.nodes[c.nodes.length - 1];
  if (frame === null || node?.end?.serif === undefined) return null;
  const serif = soundSerif(node.end.serif);
  const at = (a: number, h: number): Vec2 => ({
    x: frame.through.x + frame.rightwards.x * a + frame.up.x * h,
    y: frame.through.y + frame.rightwards.y * a + frame.up.y * h,
  });
  const middle = (frame.footLeft + frame.footRight) / 2;
  const always = {
    left: at(frame.footLeft - serif.left, 0),
    right: at(frame.footRight + serif.right, 0),
    height: at(middle, serif.height),
    cup: at(
      frame.footLeft + (frame.footRight - frame.footLeft) / 4,
      Math.min(serif.cup, serif.height * CUP_HANDLE_MOST) - CUP_HANDLE_BELOW,
    ),
  };
  const side = handledSide(serif, frame);
  const tip = serif.height * (1 - serif.slope);
  if (side === null) {
    // Reaching neither way, what is rounded is the stroke's own corners. The
    // handle hangs under the right one, as the cup's does under the foot, and
    // comes in under the stroke as the round grows.
    if (!(tip > 1e-6)) return always;
    const rounded = Math.min((serif.round * tip) / 2, (frame.footRight - frame.footLeft) / 2);
    return { ...always, round: at(frame.footRight - rounded, -CUP_HANDLE_BELOW) };
  }

  const rounded = Math.min((serif.round * tip) / 2, side.reach);
  const run = serif.bracket * Math.max(0, side.reach - rounded);
  return {
    ...always,
    slope: at(side.edge + (side.out * side.reach) / 2, (tip + serif.height) / 2),
    bracket: at(side.edge + frame.lean * (serif.height + run), serif.height + run),
    // A tip that comes to a point has no corner to round.
    ...(tip > 1e-6 ? { round: at(side.edge + side.out * (side.reach - rounded), tip) } : {}),
  };
}

/**
 * The serif an end has when one of its handles is dragged to `towards`, or
 * `null` where that changes nothing.
 *
 * A tip goes along the line the serif stands on and no nearer than the
 * stroke's own edge; the height goes up the stroke and no lower than one unit,
 * a serif of no height being no serif and having no handle to bring it back
 * by. Those and the cup in whole units, as they are typed, and the shares in
 * whole per cent. Each handle is read where the pointer is along the one way
 * it goes, whatever else the drag does.
 */
export function serifDragged(
  c: Contour,
  which: "start" | "end",
  handle: SerifHandle,
  towards: Vec2,
): EndSerif | null {
  const frame = serifFrame(c, which);
  const node = which === "start" ? c.nodes[0] : c.nodes[c.nodes.length - 1];
  const serif = node?.end?.serif;
  if (frame === null || serif === undefined) return null;
  const dx = towards.x - frame.through.x;
  const dy = towards.y - frame.through.y;
  const along = dx * frame.rightwards.x + dy * frame.rightwards.y;
  const up = dx * frame.up.x + dy * frame.up.y;
  const share = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
  const sound = soundSerif(serif);
  const side = handledSide(sound, frame);
  const tip = sound.height * (1 - sound.slope);

  let value: number;
  switch (handle) {
    case "left":
      value = Math.max(0, Math.round(frame.footLeft - along));
      break;
    case "right":
      value = Math.max(0, Math.round(along - frame.footRight));
      break;
    case "height":
      value = Math.max(1, Math.round(up));
      break;
    case "cup":
      value = Math.min(
        Math.floor(sound.height * CUP_HANDLE_MOST),
        Math.max(0, Math.round(up + CUP_HANDLE_BELOW)),
      );
      break;
    case "slope":
      // The middle of the top is half way between the tip's top and the height.
      if (!(sound.height > 0)) return null;
      value = share(1 - (2 * up - sound.height) / sound.height);
      break;
    case "bracket": {
      if (side === null) return null;
      const rounded = Math.min((sound.round * tip) / 2, side.reach);
      const room = side.reach - rounded;
      if (!(room > 1e-9)) return null;
      value = share((up - sound.height) / room);
      break;
    }
    case "round": {
      if (!(tip > 1e-6)) return null;
      // In from the tip's corner along the top; or, reaching neither way, in
      // from the stroke's right edge under the foot.
      const most =
        side === null
          ? Math.min(tip / 2, (frame.footRight - frame.footLeft) / 2)
          : Math.min(tip / 2, side.reach);
      if (!(most > 1e-9)) return null;
      const inward =
        side === null
          ? frame.footRight - along
          : side.out * (side.edge + side.out * side.reach - along);
      value = share((Math.min(most, Math.max(0, inward)) * 2) / tip);
      break;
    }
  }
  return value === serif[handle] ? null : withSerifNumber(serif, handle, value);
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
 * the bowl of a u hangs below the feet of its stems. So only the last of the
 * stroke is carried on and cut, as a stretch of its own — its last segment, from
 * where that last turns to come towards the cut — and the rest is left whole. Each stretch has the pen standing at both its ends, so they
 * overlap where they meet, as the segments of a stroke always have.
 */
function stretchesOf(c: Contour): Stretch[] {
  const nib = c.nib;
  if (nib === undefined || !(nib.width > 0) || c.nodes.length < 2) return [];
  const drawn = curvesOf(c);
  if (drawn.length === 0) return [];
  const drawnPens = pensOf(c);
  const drawnBlends = c.nodes.map((n) => n.blend);

  const start = strokeCut(c, "start");
  const end = strokeCut(c, "end");
  if (start === null && end === null) {
    return [{ curves: drawn, pens: drawnPens, blends: drawnBlends, closed: c.closed, cuts: [] }];
  }

  // The segment an end is on, cut in two where it stops coming towards the
  // cut: only what comes after that is carried on and cut. See `lastApproach`.
  const curves = [...drawn];
  const pens = [...drawnPens];
  const blends = [...drawnBlends];
  const profiles = penProfiles(drawn, drawnPens, false, drawnBlends);
  const splitAt = (index: number, t: number, pen: PenShape): void => {
    const whole = curves[index]!;
    curves.splice(index, 1, subcurve(whole, 0, t), subcurve(whole, t, 1));
    pens.splice(index + 1, 0, pen);
    // Both halves blend the way the whole one did.
    blends.splice(index + 1, 0, blends[index]);
  };
  // How much of the stroke each cut is made of: back from its end to where the
  // path last turned to come to the line, through as many segments as come
  // steeply to it. See `approach`.
  let endsFrom = end === null ? null : approach(drawn, end.normal);
  let startsTo =
    start === null ? null : mirrored(approach(turnedRound(drawn), start.normal), drawn.length);
  const along = (p: { index: number; t: number }): number => p.index + p.t;
  let whole = false;
  // Meeting at the one place the path turns counts as reaching: an arch cut at
  // both feet is one stretch, not two that meet at its top.
  const reaching =
    endsFrom !== null &&
    startsTo !== null &&
    (along(startsTo) > along(endsFrom) ||
      (startsTo.found && endsFrom.found && along(startsTo) >= along(endsFrom)));
  if (endsFrom !== null && startsTo !== null && reaching) {
    // The two reach into each other. One that was found, by the path turning,
    // is kept and the other stops at it; where both were found, or neither,
    // the stroke is one stretch and both cuts are made of all of it.
    if (endsFrom.found && !startsTo.found) startsTo = { ...endsFrom, found: false };
    else if (startsTo.found && !endsFrom.found) endsFrom = { ...startsTo, found: false };
    else whole = true;
  }

  // Indices into `curves` as they are cut in two: the last curve of the
  // start's stretch, and the first of the end's.
  let startLast: number | null = null;
  let endFirst: number | null = null;
  if (!whole) {
    if (endsFrom !== null) {
      endFirst = endsFrom.index;
      if (endsFrom.t > 1e-9 && endsFrom.t < 1 - 1e-9) {
        splitAt(endsFrom.index, endsFrom.t, profiles[endsFrom.index]!.at(endsFrom.t));
        endFirst = endsFrom.index + 1;
      } else if (endsFrom.t >= 1 - 1e-9) {
        endFirst = endsFrom.index + 1;
      }
    }
    if (startsTo !== null) {
      startLast = startsTo.index;
      // Where the end's cut was made in the same segment, the same place is
      // further along what is left of it.
      const sameSegment =
        endsFrom !== null && endsFrom.index === startsTo.index && endFirst === endsFrom.index + 1;
      const t = sameSegment && endsFrom !== null ? startsTo.t / endsFrom.t : startsTo.t;
      if (startsTo.t <= 1e-9) {
        startLast = startsTo.index - 1;
      } else if (t < 1 - 1e-9) {
        splitAt(startsTo.index, t, profiles[startsTo.index]!.at(startsTo.t));
        if (endFirst !== null) endFirst += 1;
      }
    }
  }
  const count = curves.length;

  // How far on the stroke is carried: until the pen's furthest reach is past the cut.
  const carried = (cut: StrokeCut, pen: PenShape): Vec2 => {
    const reach = Math.max(pen.width, pen.thickness) / 2 + 2;
    const by = reach / (cut.normal.x * cut.onward.x + cut.normal.y * cut.onward.y);
    return { x: cut.through.x + cut.onward.x * by, y: cut.through.y + cut.onward.y * by };
  };
  const before = start === null ? null : lineAsCubic(carried(start, pens[0]!), start.through);
  const after = end === null ? null : lineAsCubic(end.through, carried(end, pens[count]!));

  if (whole || (startLast !== null && endFirst !== null && startLast >= endFirst)) {
    return [
      {
        curves: [
          ...(before === null ? [] : [before]),
          ...curves,
          ...(after === null ? [] : [after]),
        ],
        pens: [
          ...(before === null ? [] : [pens[0]!]),
          ...pens,
          ...(after === null ? [] : [pens[count]!]),
        ],
        blends: [
          ...(before === null ? [] : [undefined]),
          ...blends.slice(0, count),
          ...(after === null ? [] : [undefined]),
        ],
        closed: false,
        cuts: [
          ...(start === null ? [] : [withBack(start, curves[count - 1]!.b)]),
          ...(end === null ? [] : [withBack(end, curves[0]!.a)]),
        ],
      },
    ];
  }

  const out: Stretch[] = [];
  if (start !== null && before !== null && startLast !== null && startLast >= 0) {
    out.push({
      curves: [before, ...curves.slice(0, startLast + 1)],
      pens: [pens[0]!, ...pens.slice(0, startLast + 2)],
      blends: [undefined, ...blends.slice(0, startLast + 1)],
      closed: false,
      cuts: [withBack(start, curves[startLast]!.b)],
    });
  }
  const middleFrom = startLast === null ? 0 : startLast + 1;
  const middleTo = endFirst === null ? count : endFirst;
  if (middleTo > middleFrom) {
    out.push({
      curves: curves.slice(middleFrom, middleTo),
      pens: pens.slice(middleFrom, middleTo + 1),
      blends: blends.slice(middleFrom, middleTo),
      closed: false,
      cuts: [],
    });
  }
  if (end !== null && after !== null && endFirst !== null && endFirst < count) {
    out.push({
      curves: [...curves.slice(endFirst), after],
      pens: [...pens.slice(endFirst, count + 1), pens[count]!],
      blends: [...blends.slice(endFirst, count), undefined],
      closed: false,
      cuts: [withBack(end, curves[endFirst]!.a)],
    });
  }
  return out;
}

/**
 * How many segments before the one an end is on its cut is made of: the ones
 * {@link approach} takes it back through, whole or in part.
 */
function cutLegs(curves: readonly Cubic[], cut: StrokeCut, which: "start" | "end"): number {
  if (curves.length < 2) return 0;
  if (which === "end") {
    const from = approach(curves, cut.normal);
    return Math.max(0, curves.length - 1 - from.index - (from.t >= 1 - 1e-9 ? 1 : 0));
  }
  const to = mirrored(approach(turnedRound(curves), cut.normal), curves.length);
  return Math.max(0, to.index - (to.t <= 1e-9 ? 1 : 0));
}

/** A place along a path: a segment and how far along it, and whether the path turning found it. */
type Along = { readonly index: number; readonly t: number; readonly found: boolean };

/**
 * How steeply a segment has to come to a cut's line to be cut by it with the
 * segment after it: the sine of thirty degrees.
 *
 * A cut is made of the last of the stroke, and the last of it may be more than
 * its last segment — the foot of a stem that came down a diagonal and turned
 * upright a few units from the line has the pen still standing at that turn,
 * and reaching past the line. So the cut goes back through the segments that
 * come to the line. Steeply: a bar that slopes a little towards the line of the
 * foot under it is not on its way to that line, and cut by it would have the
 * underside of the whole bar shaved off.
 */
const STEEPLY = 0.5;

/**
 * Where the last of a path begins that comes to a line facing `normal` at its
 * end: the last segment from where it last turned to come to the line, or the
 * whole of it, and before that every segment that comes to the line steeply
 * all the way — or, of the first that does not, the last of it that does.
 */
function approach(curves: readonly Cubic[], normal: Vec2): Along {
  const last = curves.length - 1;
  const turned = lastApproach(curves[last]!, normal, "end");
  if (turned !== null) return { index: last, t: turned, found: true };
  for (let i = last - 1; i >= 0; i--) {
    const curve = curves[i]!;
    // From its end backwards, an eighth at a time: how far back it is still
    // coming steeply.
    let from = 8;
    while (
      from > 0 &&
      comesSteeply(curve, (from - 1) / 8, normal) &&
      comesSteeply(curve, from / 8, normal)
    ) {
      from--;
    }
    if (from === 8) return { index: i + 1, t: 0, found: false };
    const turn = lastApproach(curve, normal, "end");
    if (turn !== null && turn >= from / 8) return { index: i, t: turn, found: true };
    if (from > 0) return { index: i, t: from / 8, found: false };
  }
  return { index: 0, t: 0, found: false };
}

/** Whether a curve, at `t`, is going towards a line facing `normal` at least so steeply. */
function comesSteeply(curve: Cubic, t: number, normal: Vec2): boolean {
  const v = derivative(curve, Math.min(1 - 1e-6, Math.max(1e-6, t)));
  const speed = Math.hypot(v.x, v.y);
  return speed > 1e-9 && (v.x * normal.x + v.y * normal.y) / speed >= STEEPLY;
}

/** A path the other way round: its last curve first, each from its end to its beginning. */
function turnedRound(curves: readonly Cubic[]): Cubic[] {
  return [...curves].reverse().map((c) => ({ a: c.b, c1: c.c2, c2: c.c1, b: c.a }));
}

/** A place along a path turned round, as the place it is along the path itself. */
function mirrored(at: Along, count: number): Along {
  // Turned round, `index` counted from the end and `t` from the segment's end.
  return { index: count - 1 - at.index, t: 1 - at.t, found: at.found };
}

/** A cut with how far back from its line the part of the stroke it cuts begins, at `from`. */
function withBack(cut: StrokeCut, from: Vec2): StrokeCut {
  const back = (cut.through.x - from.x) * cut.normal.x + (cut.through.y - from.y) * cut.normal.y;
  return { ...cut, back };
}

/**
 * Where along the segment an end is on the path last turns to come towards the
 * cut at that end: the parameter, or `null` where it comes towards it all the
 * way, or turns so near an end of the segment as makes no difference.
 *
 * A cut is a line, and a line goes on across the whole glyph. A segment that
 * rises over a hump before coming down to its end has been on the far side of
 * that line's direction once already, and cut whole it lost a bite out of its
 * near end to a cut made at its far one. What the cut is for is the last of the
 * segment, where the path is coming to the line and does not leave it again:
 * from where its distance from the line last stops growing. How fast that
 * distance changes is the path's speed across the line, a quadratic in the
 * parameter, so where it stops is one of two roots.
 */
function lastApproach(curve: Cubic, normal: Vec2, which: "start" | "end"): number | null {
  const d0 = { x: curve.c1.x - curve.a.x, y: curve.c1.y - curve.a.y };
  const d1 = { x: curve.c2.x - curve.c1.x, y: curve.c2.y - curve.c1.y };
  const d2 = { x: curve.b.x - curve.c2.x, y: curve.b.y - curve.c2.y };
  const across = (v: Vec2): number => v.x * normal.x + v.y * normal.y;
  const roots = unitRoots(
    0,
    across({ x: d0.x - 2 * d1.x + d2.x, y: d0.y - 2 * d1.y + d2.y }),
    2 * across({ x: d1.x - d0.x, y: d1.y - d0.y }),
    across(d0),
  ).filter((t) => t > 1e-3 && t < 1 - 1e-3);
  if (roots.length === 0) return null;
  return which === "end" ? Math.max(...roots) : Math.min(...roots);
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
    const byCurves =
      regions.length < 2
        ? regions
        : (removeOverlap(glyph("", { contours: regions }), ids)?.glyph.contours ?? null);
    // Looked at, as the whole stroke's is: see `isTheInkOf`. The other way of
    // joining takes its place where it declined, or where it is found wanting
    // and the other is not.
    let whole = byCurves ?? unionByPolygons(regions, ids) ?? regions;
    if (byCurves !== null && regions.length > 1 && !isTheInkOf(byCurves, regions)) {
      const other = unionByPolygons(regions, ids);
      if (other !== null && isTheInkOf(other, regions)) whole = other;
    }
    const loops = whole.map(curvesOf);
    const ends = endsOf(loops, stretch.cuts);
    // Turned as the union left them: a hole in it stays a hole.
    return [
      ...loops.flatMap((loop) => {
        const kept = cutBy(loop, ends.cuts);
        return kept.length === 0 ? [] : [asContour(kept)];
      }),
      ...ends.caps.map(regionOf),
    ];
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

/**
 * Why a stroke cannot be drawn to one plan in every master, in words for
 * somebody who drew it: what about the pen to change, where there is one
 * thing that is the reason.
 *
 * Asked of a stroke {@link plannedInk} has said no to, and of the same stroke
 * as each master has it. The reasons are the ones a pen gives that there is
 * no plan for: a broad edge in one master and a rounder pen in another, a pen
 * held and then changed at a point, a broad edge turned so far between two of
 * its points that its ends cannot be followed round. Anything else is said as
 * what it is, that the ink does not come to the same points.
 */
export function whyNotOnePlan(strokes: readonly Contour[]): string {
  const known = knownPenProblem(strokes);
  if (known !== null) return known;
  // A broad edge that turns along the stroke by one amount in one master and
  // another in the next: the commonest that is left, and one with something
  // to do about it.
  const pens = strokes.map(pensOf);
  const turns = (own: readonly PenShape[]): number[] =>
    own.slice(1).map((pen, i) => pen.angle - own[i]!.angle);
  const first = turns(pens[0] ?? []);
  if (
    pens.flat().every(isBroad) &&
    pens.some((own) => turns(own).some((turn, i) => Math.abs(turn - (first[i] ?? turn)) > 1e-6))
  ) {
    return "its broad edge turns along the stroke by different amounts in different masters, in a way that cannot be followed yet; turned the same way in each, or by less between two points, it varies";
  }
  return "its ink does not come to the same points in every master";
}

/**
 * What about a stroke's pen is known to keep it from varying, without trying
 * to plan it: `null` where nothing is, which is not to say it will vary.
 *
 * What the check between two masters asks, where planning every stroke of the
 * font would be seconds; {@link whyNotOnePlan} asks it first.
 */
export function knownPenProblem(strokes: readonly Contour[]): string | null {
  if (strokes.some((c) => c.nib === undefined)) return null;
  const pens = strokes.map(pensOf);
  const all = pens.flat();
  const broad = all.filter(isBroad).length;
  if (broad > 0 && broad < all.length) {
    return "its pen is a broad edge in one place and a rounder pen in another, and a pen cannot change kind between masters or along a stroke";
  }
  if (
    strokes.some((c) => c.nodes.some((n) => n.blend?.angle === "step" || n.blend?.shape === "step"))
  ) {
    return "its pen is held and then changed at a point, which cannot vary";
  }
  if (broad > 0) {
    let most = 0;
    for (const [at, own] of pens.entries()) {
      const c = strokes[at]!;
      const count = c.closed ? own.length : own.length - 1;
      for (let i = 0; i < count; i++) {
        const turn = Math.abs(own[(i + 1) % own.length]!.angle - own[i]!.angle) % 180;
        most = Math.max(most, Math.min(turn, 180 - turn));
      }
    }
    if (most >= SHARPEST_TURN) {
      return `its broad edge turns ${String(Math.round(most))}° between two of its points, further than its ends can be followed round; put a point between them`;
    }
  }
  return null;
}

/**
 * How far a broad edge may turn between two points of a stroke and still be
 * followed round, as far as the strokes it has been tried on go: sixty degrees
 * between two points is where every one of them stopped being followed.
 */
const SHARPEST_TURN = 60;

/** The pen at every point of a stroke, as the geometry wants it. */
function pensOf(c: Contour): PenShape[] {
  return c.nodes.map((_, i) => {
    return penShapeOf(penAt(c, i) ?? { angle: 0, width: 0 });
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
  return nibOfShape(blendPen(penShapeOf(a), penShapeOf(b), t));
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

/** Whether two pens are the same pen: angle, width, thickness and squareness, absent being none. */
export function samePen(a: Nib, b: Nib): boolean {
  return (
    a.angle === b.angle &&
    a.width === b.width &&
    (a.thickness ?? 0) === (b.thickness ?? 0) &&
    (a.squareness ?? 0) === (b.squareness ?? 0)
  );
}

/** Whether a curve is a straight line, which is how a line is kept a line. */
function straight(s: Cubic): boolean {
  const span = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
  if (span === 0) return false;
  const off = (p: { x: number; y: number }) =>
    Math.abs((s.b.x - s.a.x) * (p.y - s.a.y) - (p.x - s.a.x) * (s.b.y - s.a.y)) / span;
  return off(s.c1) < 1e-9 && off(s.c2) < 1e-9;
}
