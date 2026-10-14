import {
  type Cubic,
  cubic,
  endTangent,
  evaluate,
  isFlat,
  lineAsCubic,
  reverse,
  subcurve,
  tangent,
  unitRoots,
} from "./cubic.js";
import { fitOne } from "./fit.js";
import { halfNib, nibTangencies } from "./nib.js";
import {
  type PenProfile,
  type PenShape,
  type SegmentBlend,
  isBroad,
  isSquared,
  penExponent,
  penProfiles,
  penSupport,
  samePenShape,
  squarenessOf,
} from "./pen.js";
import type { Vec2 } from "./vec2.js";

/**
 * A stroke's ink drawn the same way in every master.
 *
 * A variable font says a glyph once and then how each of its points moves, so
 * every master has to come to the same points in the same order. The ink a
 * stroke is turned into for one font does not: its sides are fitted to within a
 * distance, cut where they fold, and joined by a union, and each of those gives
 * a different number of points for a pen a little wider.
 *
 * So here the ink is drawn as one line round it, to a plan made for all the
 * masters at once. The line is the pen's furthest reach to the right of the
 * path, followed along the path and back again: out along one side, round the
 * end with the pen's own edge, back along the other, round the start. Where the
 * path turns a corner the pen's edge is followed round by as much as the path
 * turned, whichever way that was.
 *
 * It is not the edge of the ink. On the inside of a bend tighter than the pen
 * it runs back over itself, and on the inside of a corner it crosses itself.
 * But filled by the non-zero rule it is the ink exactly: a line drawn this way
 * goes round every point the pen covered at least once and round no other point
 * at all, never the wrong way round — which is what is known of the sum of a
 * path and a convex shape, and why nothing here has to find a fold or cut one
 * out. A variable font may hold outlines that overlap themselves, and fills
 * them so.
 *
 * What is the same in every master is the plan: how many curves each stretch
 * of the path is drawn with, and which joins have the pen's edge in them.
 */

/** One master's stroke: its path, the pen at each point, and how the pen changes between. */
export type StrokeMaster = {
  readonly curves: readonly Cubic[];
  readonly pens: readonly PenShape[];
  readonly closed: boolean;
  readonly blends?: readonly (SegmentBlend | undefined)[];
  /** How each end of an open path is cut, where it is not left as the pen leaves it. */
  readonly cuts?: { readonly start?: PlannedCut; readonly end?: PlannedCut };
};

/**
 * A straight line an end of a stroke is cut by: the point it goes through, the
 * way it faces — away from the ink that is kept — the way the path was going
 * when it got there, and whether the end is then closed with half the pen's own
 * outline instead of with the cut itself.
 */
export type PlannedCut = {
  readonly through: Vec2;
  readonly normal: Vec2;
  readonly onward: Vec2;
  readonly nibbed: boolean;
  /**
   * How many segments before the one the end is on the cut may be made of: the
   * ones that come to its line steeply, as whoever asks has judged. A side of
   * the last segment that is past the line all its length is then stopped
   * where a side before it crosses. None, where it is not said.
   */
  readonly legs?: number;
  /**
   * Where along the path the part of the stroke this cut is made of begins, as
   * a segment's number and how far along it: the rest of the stroke is whole,
   * and has the pen standing at that place. Not said where the cut is made of
   * the whole stroke.
   */
  readonly from?: number;
};

/** A piece of the line round the ink, and whether it is a straight one. */
export type PlannedPiece = { readonly curve: Cubic; readonly line: boolean };

/** How far a side may stray from the pen's reach, in units, measured parameter for parameter. */
const SIDE_TOLERANCE = 0.1;
/** The most a side is let stray where no number of curves does better. */
const SIDE_LIMIT = 1;
/** The numbers of curves a stretch's side is tried with, fewest first. */
const SIDE_COUNTS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48];
/** Below this turn, in radians, a join is smooth and the pen's edge is not followed round it. */
const TURN = 1e-4;

/** One stretch of the path gone along one way: forwards along the right, or back along the left. */
type Leg = { readonly index: number; readonly forward: boolean };

/**
 * The line round each master's ink, as loops of pieces: the same loops, of the
 * same pieces, for every master.
 *
 * `null` where there is no one plan: the masters' paths have not the same
 * number of curves, a pen has no width, the pen is a broad edge in one place
 * and an oval in another, a broad edge that turns in a way its ends cannot be
 * followed through (see `turningSides`), a pen that is held and then changed
 * at a point, or a side no number of curves comes near. Whoever asked then
 * draws each master's ink for itself.
 *
 * `byCornersOnly`, a plan is wanted only where the pen's own corners and edges
 * draw the line, and `null` where its sides would be fitted to the pen's reach:
 * for whoever has a nearer way than that of making one master's ink.
 */
export function plannedStrokes(
  masters: readonly StrokeMaster[],
  byCornersOnly = false,
): PlannedPiece[][][] | null {
  const first = masters[0];
  if (first === undefined) return null;
  const count = first.curves.length;
  if (count === 0) return null;

  for (const m of masters) {
    if (m.curves.length !== count || m.closed !== first.closed) return null;
    if (m.pens.length < (m.closed ? count : count + 1)) return null;
    if (m.pens.some((pen) => !(pen.width > 0))) return null;
    if (m.blends?.some((b) => b?.angle === "step" || b?.shape === "step") === true) return null;
    for (const curve of m.curves) {
      if (endTangent(curve, 0) === null) return null;
    }
  }

  // A pen with corners in any master, and every master is drawn the way such a
  // pen is: its sides fitted between the places the path runs along one of the
  // pen's own sides, and the pen's edge at a join walked and fitted, where an
  // oval's sides are given by their speed and its edge is made from a circle.
  // An oval drawn that way comes to the same ink in other pieces, and the
  // pieces are what the masters have to share.
  // A rectangle, the same one all along the stroke, in every master: drawn
  // exactly, as a broad edge is and for the same reason. See `boxSides`.
  const box = masters.every((m) =>
    m.pens.every((pen) => isBox(pen) && samePenShape(pen, m.pens[0]!)),
  );
  // And a rectangle that changes its size along the stroke, held at one angle:
  // its corners still, and the edges between them. See `changingSides`.
  let sized = !box && masters.every((m) => m.pens.every(isBox) && heldAtOneAngle(m));
  // And one that turns as well, where its corners and edges can be followed:
  // see `turningSides`. Where they cannot it is drawn as any pen with corners.
  const profiles = masters.map((m) => penProfiles(m.curves, m.pens, m.closed, m.blends));
  if (profiles.some((p) => p.length !== count)) return null;
  const turned =
    !box && !sized && masters.every((m) => m.pens.every(isBox))
      ? turningSides(masters, profiles, boxCorners)
      : null;
  if (turned !== null) sized = true;
  const cornered = !box && !sized && masters.some((m) => m.pens.some(isSquared));
  if (byCornersOnly && cornered) return null;

  // An end is cut in every master or in none, and closed the same way in all:
  // what closes it is pieces of the line, and the masters share their pieces.
  const cutAt = (m: StrokeMaster, end: "start" | "end"): PlannedCut | undefined =>
    m.closed ? undefined : m.cuts?.[end];
  for (const end of ["start", "end"] as const) {
    const one = cutAt(first, end);
    for (const m of masters) {
      const other = cutAt(m, end);
      if ((other === undefined) !== (one === undefined)) return null;
      if (other !== undefined && one !== undefined && other.nibbed !== one.nibbed) return null;
    }
  }

  const broad = masters.every((m) => m.pens.every(isBroad));
  const oval = masters.every((m) => m.pens.every((pen) => !isBroad(pen)));
  if (!broad && !oval) return null;
  // A broad edge that widens along the path is its two ends still, each going
  // its own way; one that turns pivots on itself, and between its ends the
  // edge of its ink is the place it pivots on. See `turningSides`.
  const widening =
    broad && masters.some((m) => m.pens.some((pen) => !samePenShape(pen, m.pens[0]!)));
  const pivoting = widening && !masters.every(heldAtOneAngle);

  // Once round an open path is out along it and back; a closed one is two lines,
  // one each way round.
  const there: Leg[] = first.curves.map((_, index) => ({ index, forward: true }));
  const back: Leg[] = [...there].reverse().map((leg) => ({ ...leg, forward: false }));
  const cycles = first.closed ? [there, back] : [[...there, ...back]];

  const sides = broad
    ? pivoting
      ? turningSides(masters, profiles, nibEnds)
      : widening
        ? changingSides(masters, profiles, nibEnds)
        : broadSides(masters)
    : box
      ? boxSides(masters)
      : turned !== null
        ? turned
        : sized
          ? changingSides(masters, profiles, boxCorners)
          : cornered
            ? corneredSides(masters, profiles)
            : ovalSides(masters, profiles);
  if (sides === null) return null;

  // The ends that are cut: the side arriving at each and the side leaving it
  // stopped at the cut, and what goes between them in place of the pen's edge.
  //
  // A side is stopped where it crosses the line, and on a last segment a few
  // units long it may not: the pen is wider than the segment is long, and the
  // side of it is past the line from end to end. It is then the side of the
  // segment before that is stopped, as far back as the cut is said to reach,
  // and the sides between are no more than the point it stopped at — with
  // nothing of the pen's edge at the joins between them. How far back, each
  // side, is the same in every master or there is no one plan.
  //
  // And where no side before it may be stopped either — a bar, and a drop at
  // the end of it shorter than the pen is thick: the bar is not on its way to
  // the foot's line, and is not cut by it — the stroke is drawn as the two
  // things it is. The bar whole, to the point the drop begins at, with the pen
  // standing there as it stands at any end. And the drop as what lies between
  // its two sides, from the pen at that point to the cut: a side that is past
  // the line all its length is no part of that, and what is kept then begins
  // on the line across the pen from one side's beginning to the other's. The
  // two overlap, in the pen at the point between them, and are filled as one.
  const closures = masters.map(() => new Map<string, PlannedPiece[]>());
  type Made = NonNullable<ReturnType<typeof cutTurn>>;
  const legsOf = (end: "start" | "end", forward: boolean): Leg[] =>
    // Out along the right to the far end and back along the left: so the far
    // end is come to forwards, and the near end backwards. And the legs each
    // way from there, back along the path.
    Array.from({ length: count }, (_, i) => ({
      index: end === "end" ? count - 1 - i : i,
      forward,
    }));
  /** One master's end cut: as one line with the rest, or apart from the point `apart` legs back. */
  const cutOf = (at: number, end: "start" | "end", apart: number | null): Made | null => {
    const cut = cutAt(masters[at]!, end)!;
    const index = end === "end" ? count - 1 : 0;
    const arrivingLegs = legsOf(end, end === "end");
    const leavingLegs = legsOf(end, end !== "end");
    const most = apart ?? Math.min(Math.max(0, cut.legs ?? 0), count - 1);
    const sideOf = (leg: Leg): PlannedPiece[] => sides[at]!.get(key(leg))!;
    // Across the pen where the part begins: from where the side that arrives
    // at the cut sets out to where the side that leaves it comes back.
    const sets = sideOf(arrivingLegs[most]!)[0]!.curve.a;
    const back = sideOf(leavingLegs[most]!);
    const comes = back[back.length - 1]!.curve.b;
    const across = (by: PlannedCut, here: Vec2, there: Vec2): Vec2 => {
      const a = pastCut(by, here);
      const b = pastCut(by, there);
      const u = a <= 0 || b >= 0 ? 0 : a / (a - b);
      return { x: here.x + (there.x - here.x) * u, y: here.y + (there.y - here.y) * u };
    };
    const stopper =
      (legs: readonly Leg[], stop: typeof stoppedAt, here: Vec2, there: Vec2) =>
      (by: PlannedCut): Stopped | null => {
        for (let k = 0; k <= most; k++) {
          const stopped = stop(sideOf(legs[k]!), by);
          if (stopped !== null) return { ...stopped, back: k };
        }
        if (apart === null) return null;
        // Past the line all its length: what is kept begins across the pen.
        const on = across(by, here, there);
        return {
          pieces: [...sideOf(legs[most]!).map((p) => pointPiece(on, p.line)), pointPiece(on, true)],
          at: on,
          back: most,
        };
      };
    return cutTurn(
      stopper(arrivingLegs, stoppedAt, sets, comes),
      stopper(leavingLegs, startedAt, comes, sets),
      // Half a rectangle laid along a cut is the cut.
      box || sized ? { ...cut, nibbed: false } : cut,
      profiles[at]![index]!.at(end === "end" ? 1 : 0),
      cornered,
    );
  };
  const reached: string[] = masters.map(() => "");
  /** How many legs back from each end its cut is drawn apart from, where it is. */
  const parted: { start: number | null; end: number | null } = { start: null, end: null };
  for (const end of ["end", "start"] as const) {
    if (cutAt(first, end) === undefined) continue;
    let made = masters.map((_, at) => cutOf(at, end, null));
    if (made.some((m) => m === null)) {
      // The point the part begins at: a point of the path, and the same one in
      // every master, with something of the path either side of it.
      const begins = masters.map((m) => cutAt(m, end)!.from);
      const node = begins[0];
      if (node === undefined || first.closed || !(node > 0) || !(node < count)) return null;
      if (Math.abs(node - Math.round(node)) > 1e-9) return null;
      if (begins.some((b) => b === undefined || Math.abs(b - node) > 1e-9)) return null;
      const legs = end === "end" ? count - Math.round(node) : Math.round(node);
      parted[end] = legs - 1;
      made = masters.map((_, at) => cutOf(at, end, legs - 1));
      if (made.some((m) => m === null)) return null;
    }
    const arrivingLegs = legsOf(end, end === "end");
    const leavingLegs = legsOf(end, end !== "end");
    for (const [at, m] of made.entries()) {
      const { arriving, leaving, closure } = m!;
      reached[at] = `${reached[at] ?? ""}${end}:${String(arriving.back)}/${String(leaving.back)} `;
      sides[at]!.set(key(arrivingLegs[arriving.back]!), arriving.pieces);
      for (let i = 0; i < arriving.back; i++) {
        sides[at]!.set(key(arrivingLegs[i]!), [pointPiece(arriving.at, true)]);
        closures[at]!.set(`${key(arrivingLegs[i + 1]!)}>${key(arrivingLegs[i]!)}`, []);
      }
      sides[at]!.set(key(leavingLegs[leaving.back]!), leaving.pieces);
      for (let i = 0; i < leaving.back; i++) {
        sides[at]!.set(key(leavingLegs[i]!), [pointPiece(leaving.at, true)]);
        closures[at]!.set(`${key(leavingLegs[i]!)}>${key(leavingLegs[i + 1]!)}`, []);
      }
      closures[at]!.set(`${key(arrivingLegs[0]!)}>${key(leavingLegs[0]!)}`, closure);
      const apart = parted[end];
      if (apart !== null) {
        // And across the pen, from where the one side came back to where the
        // other sets out, in place of the pen's edge round that end.
        const came = sides[at]!.get(key(leavingLegs[apart]!))!;
        const sets = sides[at]!.get(key(arrivingLegs[apart]!))!;
        closures[at]!.set(`${key(leavingLegs[apart]!)}>${key(arrivingLegs[apart]!)}`, [
          { curve: lineAsCubic(came[came.length - 1]!.curve.b, sets[0]!.curve.a), line: true },
        ]);
      }
    }
  }
  if (reached.some((how) => how !== reached[0])) return null;

  // Once round each thing that is drawn: the stroke, and a part of it cut
  // apart at either end.
  const rounds: Leg[][] = [];
  if (parted.start === null && parted.end === null) {
    rounds.push(...cycles);
  } else {
    const lo = parted.start === null ? 0 : parted.start + 1;
    const hi = parted.end === null ? count : count - 1 - parted.end;
    if (lo >= hi) return null;
    const round = (a: number, b: number): Leg[] => {
      const out_ = there.slice(a, b);
      return [...out_, ...[...out_].reverse().map((leg) => ({ ...leg, forward: false }))];
    };
    rounds.push(round(lo, hi));
    if (parted.start !== null) rounds.push(round(0, lo));
    if (parted.end !== null) rounds.push(round(hi, count));
  }

  const out: PlannedPiece[][][] = masters.map(() => []);
  // The corners of the path a turning rectangle comes to in the middle of
  // pivoting: see below, where the pen is laid at them.
  const pivotedAt = new Map<number, Leg>();
  for (const cycle of rounds) {
    const loops: PlannedPiece[][] = masters.map(() => []);
    for (const [k, leg] of cycle.entries()) {
      const next = cycle[(k + 1) % cycle.length]!;
      const each = masters.map((m, at) => ({
        master: m,
        profiles: profiles[at]!,
        before: sides[at]!.get(key(leg))!,
        after: sides[at]!.get(key(next))!,
      }));
      const joins =
        box || sized
          ? boxJoins(each, leg, next, sized ? 3 : 2)
          : cornered
            ? corneredJoins(each, leg, next)
            : each.map((j) => joinOf(j.master, j.profiles, leg, next, j.before, j.after));
      if (turned !== null && !(leg.index === next.index && leg.forward !== next.forward)) {
        const partWay = each.some(({ master, profiles: own, before, after }) => {
          const curve = master.curves[leg.index]!;
          const centre = leg.forward ? curve.b : curve.a;
          const arriving = heading(curve, leg, 1);
          const leaving = heading(master.curves[next.index]!, next, 0);
          if (arriving === null || leaving === null) return false;
          if (Math.abs(arriving.x * leaving.y - arriving.y * leaving.x) <= TURN) return false;
          const corners = boxCorners(own[leg.index]!.at(leg.forward ? 1 : 0));
          const off = (p: Vec2): boolean =>
            corners.every((c) => Math.hypot(centre.x + c.x - p.x, centre.y + c.y - p.y) > 1e-6);
          return off(before[before.length - 1]!.curve.b) || off(after[0]!.curve.a);
        });
        if (partWay) pivotedAt.set(leg.forward ? leg.index + 1 : leg.index, leg);
      }
      // The pen's edge at a join goes into every master or into none.
      const turns = joins.some((j) => j.turns);
      for (const [at, loop] of loops.entries()) {
        loop.push(...sides[at]!.get(key(leg))!);
        const closure = closures[at]!.get(`${key(leg)}>${key(next)}`);
        if (closure !== undefined) loop.push(...closure);
        else if (turns) loop.push(...joins[at]!.pieces);
      }
    }
    for (const [at, loop] of loops.entries()) out[at]!.push(loop);
  }

  // The pen standing at a corner of the path it came to pivoting.
  //
  // A side that ends part way along the pen's edge is joined to the next
  // along that edge: which is the edge of the ink where the path goes
  // straight on, the pen going on turning. At a corner of the path it is not.
  // The pen stands there, all of it ink, and the line from part way along one
  // of its edges to a corner of it leaves some of that out. So it is laid
  // there whole, a loop of its own over the rest, in every master where a side
  // ends so in any.
  for (const leg of pivotedAt.values()) {
    for (const [at, m] of masters.entries()) {
      const curve = m.curves[leg.index]!;
      out[at]!.push(
        penLoop(
          profiles[at]![leg.index]!.at(leg.forward ? 1 : 0),
          leg.forward ? curve.b : curve.a,
          "box",
        ),
      );
    }
  }

  // The pen standing where the part of the stroke a cut is made of begins.
  //
  // The stroke before that place is whole, and ends with the pen standing
  // there: at a corner a few units short of the cut, the pen reaches past the
  // cut's line, and that much of it is ink — the stroke's before the corner,
  // which nothing cut. The line round the stroke has it only as the pen's edge
  // followed round the inside of the corner, and with the sides either side
  // of that stopped at the cut it goes round nothing. So the pen is laid there
  // whole, a loop of its own over the rest, in every master where it reaches
  // past the line in any.
  if (!broad) {
    for (const end of ["start", "end"] as const) {
      // Drawn apart, the stroke before it ends with the pen standing there.
      if (parted[end] !== null) continue;
      const stood = masters.map((m, at) => {
        const cut = cutAt(m, end);
        if (cut?.from === undefined || !(cut.from > 0) || !(cut.from < count)) return null;
        const index = Math.min(count - 1, Math.floor(cut.from));
        const t = cut.from - index;
        const pen = profiles[at]![index]!.at(t);
        const centre = evaluate(m.curves[index]!, t);
        const reach_ = penSupport(pen, cut.normal);
        const past = pastCut(cut, centre) + reach_.x * cut.normal.x + reach_.y * cut.normal.y;
        return { pen, centre, past };
      });
      if (stood.some((s) => s === null) || !stood.some((s) => s!.past > 0.01)) continue;
      for (const [at, s] of stood.entries()) {
        out[at]!.push(
          penLoop(s!.pen, s!.centre, box || sized ? "box" : cornered ? "cornered" : "oval"),
        );
      }
    }
  }
  return out;
}

/**
 * A pen's own outline, standing at a place, as a loop the way round that ink
 * goes: four straight edges for a rectangle, four quarters for an oval, and
 * for a pen with corners eight curves, a flat and the turn at the end of it
 * each.
 */
function penLoop(pen: PenShape, centre: Vec2, kind: "box" | "cornered" | "oval"): PlannedPiece[] {
  if (kind === "box") {
    const corners = boxCorners(pen).map((c) => ({ x: centre.x + c.x, y: centre.y + c.y }));
    return corners.map((c, k) => ({
      curve: lineAsCubic(c, corners[(k + 1) % corners.length]!),
      line: true,
    }));
  }
  const angle = (pen.angle * Math.PI) / 180;
  const half = { x: (Math.cos(angle) * pen.width) / 2, y: (Math.sin(angle) * pen.width) / 2 };
  const out = {
    x: (-Math.sin(angle) * pen.thickness) / 2,
    y: (Math.cos(angle) * pen.thickness) / 2,
  };
  const to = (h: number, o: number): Vec2 => ({
    x: centre.x + half.x * h + out.x * o,
    y: centre.y + half.y * h + out.y * o,
  });
  if (kind === "cornered") {
    const back = { x: -half.x, y: -half.y };
    const under = { x: -out.x, y: -out.y };
    return [
      ...halfOutline(pen, to(1, 0), to(-1, 0), centre, half, out),
      ...halfOutline(pen, to(-1, 0), to(1, 0), centre, back, under),
    ];
  }
  const stops = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const;
  return stops.map(([h, o], k) => {
    const [h1, o1] = stops[(k + 1) % 4]!;
    return {
      curve: cubic(
        to(h, o),
        to(h + (h1 - h) * (h === 0 ? QUARTER : 0), o + (o1 - o) * (o === 0 ? QUARTER : 0)),
        to(h1 + (h - h1) * (h1 === 0 ? QUARTER : 0), o1 + (o - o1) * (o1 === 0 ? QUARTER : 0)),
        to(h1, o1),
      ),
      line: false,
    };
  });
}

const key = (leg: Leg): string => `${String(leg.index)}${leg.forward ? "+" : "-"}`;

/** The direction a leg is going at `s` of the way along it, or `null` at a cusp. */
function heading(curve: Cubic, leg: Leg, s: number): Vec2 | null {
  const t = leg.forward ? s : 1 - s;
  const along = t <= 0 ? endTangent(curve, 0) : t >= 1 ? endTangent(curve, 1) : tangent(curve, t);
  if (along === null) return null;
  return leg.forward ? along : { x: -along.x, y: -along.y };
}

/** A direction turned a quarter turn to the right: the side a line round the ink keeps the pen on. */
const rightOf = (d: Vec2): Vec2 => ({ x: d.y, y: -d.x });

/** Where the pen reaches furthest to the right of a leg, at `s` of the way along it. */
function reach(curve: Cubic, profile: PenProfile, leg: Leg, s: number): Vec2 | null {
  const t = leg.forward ? s : 1 - s;
  const along = heading(curve, leg, s);
  if (along === null) return null;
  const at = evaluate(curve, t);
  const by = penSupport(profile.at(t), rightOf(along));
  return { x: at.x + by.x, y: at.y + by.y };
}

/**
 * Both sides of every stretch for an oval pen, each drawn with as many curves as
 * the master that needs most of them.
 *
 * A side is the pen's reach as the path's parameter goes from nought to one,
 * which is a smooth thing to follow even where the side itself turns back in a
 * point: so each curve is given where the side is and how fast it is going at
 * its two ends, and is as near as its length to the fourth power.
 */
function ovalSides(
  masters: readonly StrokeMaster[],
  profiles: readonly (readonly PenProfile[])[],
): Map<string, PlannedPiece[]>[] | null {
  const out = masters.map(() => new Map<string, PlannedPiece[]>());
  const count = masters[0]!.curves.length;

  for (let index = 0; index < count; index++) {
    const legs: Leg[] = [
      { index, forward: true },
      { index, forward: false },
    ];
    let chosen: (Cubic[] | null)[][] | null = null;
    for (const pieces of SIDE_COUNTS) {
      let worst = 0;
      const drawn = masters.map((m, at) =>
        legs.map((leg) => {
          const side = hermiteSide(m.curves[index]!, profiles[at]![index]!, leg, pieces);
          if (side === null) return null;
          worst = Math.max(worst, side.strays);
          return side.curves;
        }),
      );
      if (drawn.some((d) => d.some((side) => side === null))) {
        chosen = null;
        break;
      }
      chosen = drawn;
      if (worst <= SIDE_TOLERANCE) break;
      if (pieces === SIDE_COUNTS[SIDE_COUNTS.length - 1] && worst > SIDE_LIMIT) chosen = null;
    }
    // Where no even number of curves will do, curves where they are needed:
    // see `refinedSides`. Only then, so that a stroke drawn the even way is
    // drawn as it always was.
    chosen ??= refinedSides(masters, profiles, index, legs);
    if (chosen === null) return null;
    for (const [at, sides] of chosen.entries()) {
      for (const [l, leg] of legs.entries()) {
        out[at]!.set(
          key(leg),
          sides[l]!.map((curve) => ({ curve, line: false })),
        );
      }
    }
  }
  return out;
}

/**
 * The four directions a pen faces at its corners: where its outline turns
 * tightest, half way between its length and its breadth as the outline itself
 * goes. For an oval they are four places like any other; the squarer the pen,
 * the more of a corner each is.
 */
function cornerFacings(pen: PenShape): Vec2[] {
  const a = pen.width / 2;
  const b = pen.thickness / 2;
  const size = Math.hypot(a, b);
  if (!(size > 0)) return [];
  const angle = (pen.angle * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // In the pen's own frame the outline faces (b, a) where it crosses the
  // diagonal of its box, whatever its exponent.
  return [
    [b, a],
    [-b, a],
    [-b, -a],
    [b, -a],
  ].map(([x, y]) => ({
    x: (cos * x! - sin * y!) / size,
    y: (sin * x! + cos * y!) / size,
  }));
}

/**
 * Where along a leg the pen's reach passes one of the pen's corners: where the
 * side, which has been running along one flat of the pen, turns to run along
 * the next.
 */
function pastCorners(curve: Cubic, profile: PenProfile, leg: Leg): number[] {
  const STEPS = 256;
  const facing = (s: number): Vec2 | null => {
    const along = heading(curve, leg, s);
    return along === null ? null : rightOf(along);
  };
  const found: number[] = [];
  for (let corner = 0; corner < 4; corner++) {
    const value = (s: number): number | null => {
      const f = facing(s);
      const c = cornerFacings(profile.at(leg.forward ? s : 1 - s))[corner];
      if (f === null || c === undefined) return null;
      // Nothing while the pen is facing the other way altogether.
      if (f.x * c.x + f.y * c.y <= 0) return null;
      return f.x * c.y - f.y * c.x;
    };
    let before = value(0);
    for (let k = 1; k <= STEPS; k++) {
      const here = value(k / STEPS);
      if (before !== null && here !== null && before * here < 0) {
        let lo = (k - 1) / STEPS;
        let hi = k / STEPS;
        const sign = Math.sign(before);
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2;
          const v = value(mid);
          if (v !== null && Math.sign(v) === sign) lo = mid;
          else hi = mid;
        }
        found.push((lo + hi) / 2);
      }
      before = here;
    }
  }
  return found.filter((t) => t > 1e-3 && t < 1 - 1e-3).sort((a, b) => a - b);
}

/** A unit vector from one point towards another, or `null` where they are one point. */
function towards(from: Vec2, to: Vec2): Vec2 | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length < 1e-12 ? null : { x: dx / length, y: dy / length };
}

/** A place along a leg, and where the pen reaches there. */
type Reached = { readonly s: number; readonly p: Vec2 };

/** How far apart, in units, the places a cornered side is read at are let be. */
const READ_APART = 3;

/**
 * One side of a stretch, read closely: where the pen reaches at places along
 * the leg near enough together that the side is all but straight between them.
 *
 * Not evenly by the path's parameter. Where a flat of the pen is laid along
 * the path the reach crosses the whole flat in next to no distance of path,
 * and places evenly spaced step over all of it in one go; so a gap too long is
 * halved until it is not, or is too short a piece of path to halve.
 */
function readSide(curve: Cubic, profile: PenProfile, leg: Leg): Reached[] | null {
  const at = (s: number): Reached | null => {
    const p = reach(curve, profile, leg, s);
    return p === null ? null : { s, p };
  };
  const START = 64;
  const out: Reached[] = [];
  for (let k = 0; k <= START; k++) {
    const here = at(k / START);
    if (here === null) return null;
    out.push(here);
  }
  for (let i = 0; i + 1 < out.length && out.length < 6000;) {
    const a = out[i]!;
    const b = out[i + 1]!;
    if (Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y) > READ_APART && b.s - a.s > 1e-7) {
      const middle = at((a.s + b.s) / 2);
      if (middle === null) return null;
      out.splice(i + 1, 0, middle);
    } else {
      i++;
    }
  }
  return out;
}

/**
 * Where along a leg a side turns back: where it stops going the way the path is
 * going and goes the other way, or stops going the other way.
 *
 * The inside of a bend tighter than the pen, where the pen's reach runs back
 * over ink already laid. A side is a smooth thing to follow either side of
 * such a place and not through it, so it is one of the places a side is cut.
 */
function turnsBack(curve: Cubic, leg: Leg, side: readonly Reached[]): number[] {
  const out: number[] = [];
  let before = 0;
  for (let i = 0; i + 1 < side.length; i++) {
    const a = side[i]!;
    const b = side[i + 1]!;
    const along = heading(curve, leg, (a.s + b.s) / 2);
    if (along === null) continue;
    const forward = (b.p.x - a.p.x) * along.x + (b.p.y - a.p.y) * along.y;
    if (Math.abs(forward) < 1e-9) continue;
    const way = Math.sign(forward);
    if (before !== 0 && way !== before) out.push(a.s);
    before = way;
  }
  return out.filter((t) => t > 1e-3 && t < 1 - 1e-3);
}

/**
 * A run of a side between two of its cuts, in `pieces` curves of about a
 * length each, and how far the worst of them strays.
 *
 * Cut by how far along the side each place is, and each piece fitted to the
 * places in it, leaving and arriving the way the side is going there: at an
 * end of the run the way it sets off or comes in, since the run before it may
 * have come from the other direction.
 */
function fittedRun(run: readonly Reached[], pieces: number): { curves: Cubic[]; strays: number } {
  const first = run[0]!.p;
  const last = run[run.length - 1]!.p;
  const along: number[] = [0];
  for (let i = 1; i < run.length; i++) {
    const a = run[i - 1]!.p;
    const b = run[i]!.p;
    along.push(along[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const whole = along[along.length - 1]!;
  if (run.length < 2 || whole < 1e-9) {
    return {
      curves: Array.from({ length: pieces }, () => cubic(first, first, last, last)),
      strays: 0,
    };
  }
  const going = (i: number): Vec2 => {
    for (let reach_ = 1; reach_ < run.length; reach_++) {
      const a = run[Math.max(0, i - reach_)]!.p;
      const b = run[Math.min(run.length - 1, i + reach_)]!.p;
      const d = towards(a, b);
      if (d !== null) return d;
    }
    return { x: 1, y: 0 };
  };

  const curves: Cubic[] = [];
  let strays = 0;
  let start = 0;
  for (let j = 1; j <= pieces; j++) {
    let end = run.length - 1;
    if (j < pieces) {
      end = start;
      while (end < run.length - 1 && along[end]! < (whole * j) / pieces) end++;
    }
    const fitted = fitOne(
      run.slice(start, end + 1).map((r) => r.p),
      going(start),
      going(end),
    );
    strays = Math.max(strays, fitted.strays);
    curves.push(fitted.curve);
    start = end;
  }
  return { curves, strays };
}

/** The part of a closely read side between two places along the leg, both ends on them exactly. */
function between(
  side: readonly Reached[],
  ends: (s: number) => Reached | null,
  from: number,
  to: number,
): Reached[] {
  const inside = side.filter((r) => r.s > from + 1e-9 && r.s < to - 1e-9);
  const first = ends(from);
  const last = ends(to);
  return [...(first === null ? [] : [first]), ...inside, ...(last === null ? [] : [last])];
}

/**
 * Both sides of every stretch for a pen with corners in some master.
 *
 * Each side is read closely and cut in two kinds of place. Where the pen's
 * reach passes one of the pen's corners, and the side that was running along
 * one flat of the pen turns to run along the next: the squarer the pen, the
 * sharper the turn. And where the side turns back on itself, inside a bend
 * tighter than the pen. A master whose side is
 * not cut where another's is, is cut at the same places. Between the cuts every
 * master has the same number of pieces, as many as the one that needs most,
 * each about as long as the next.
 */
function corneredSides(
  masters: readonly StrokeMaster[],
  profiles: readonly (readonly PenProfile[])[],
): Map<string, PlannedPiece[]>[] | null {
  const out = masters.map(() => new Map<string, PlannedPiece[]>());
  const count = masters[0]!.curves.length;

  for (let index = 0; index < count; index++) {
    for (const forward of [true, false]) {
      const leg: Leg = { index, forward };
      const read: Reached[][] = [];
      const found: number[][] = [];
      for (const [at, m] of masters.entries()) {
        const curve = m.curves[index]!;
        const profile = profiles[at]![index]!;
        const side = readSide(curve, profile, leg);
        if (side === null) return null;
        read.push(side);
        const cuts = [...pastCorners(curve, profile, leg), ...turnsBack(curve, leg, side)].sort(
          (a, b) => a - b,
        );
        found.push(cuts.filter((t, i) => i === 0 || t - cuts[i - 1]! > 1e-4));
      }
      const most = found.reduce((best, f) => (f.length > best.length ? f : best), found[0]!);
      const bounds = found.map((own) => [0, ...cutsLike(most, own), 1]);

      const ends = masters.map((m, at) => (s: number): Reached | null => {
        const p = reach(m.curves[index]!, profiles[at]![index]!, leg, s);
        return p === null ? null : { s, p };
      });
      const chosen: PlannedPiece[][] = masters.map(() => []);
      // Run by run: each has as many pieces as the master that needs most of
      // them for that run, and no more because another run needed more.
      for (let span = 0; span + 1 < bounds[0]!.length; span++) {
        const runs = masters.map((_, at) =>
          between(read[at]!, ends[at]!, bounds[at]![span]!, bounds[at]![span + 1]!),
        );
        let fitted: Cubic[][] = [];
        for (const pieces of SIDE_COUNTS) {
          let worst = 0;
          fitted = runs.map((run) => {
            const made = fittedRun(run, pieces);
            worst = Math.max(worst, made.strays);
            return made.curves;
          });
          if (worst <= SIDE_TOLERANCE) break;
          if (pieces === SIDE_COUNTS[SIDE_COUNTS.length - 1] && worst > SIDE_LIMIT) return null;
        }
        for (const [at, curves] of fitted.entries()) {
          for (const curve of curves) chosen[at]!.push({ curve, line: false });
        }
      }
      for (const side of chosen) {
        // Each piece starts exactly where the one before it ended.
        for (let k = 1; k < side.length; k++) {
          const c = side[k]!.curve;
          side[k] = { curve: cubic(side[k - 1]!.curve.b, c.c1, c.c2, c.b), line: false };
        }
      }
      for (const [at, side] of chosen.entries()) out[at]!.set(key(leg), side);
    }
  }
  return out;
}

/** The numbers of curves each run of the pen's edge at a join is tried with, fewest first. */
const EDGE_COUNTS = [1, 2, 3, 4, 6];

/**
 * The pen's own edge, standing at a point, from where it reaches furthest in
 * one direction round by `sweep` to where it reaches furthest in another, in
 * `pieces` curves of about a length — and how far the worst strays.
 *
 * Walked by the direction the edge faces, which puts the places it is read at
 * close together round a corner and few along a flat, and cut into pieces by
 * how far along the edge they are. The way the edge is going where it faces a
 * direction is that direction turned a quarter turn, whatever the pen.
 */
function edgeArc(
  pen: PenShape,
  centre: Vec2,
  from: Vec2,
  sweep: number,
  pieces: number,
): { curves: Cubic[]; strays: number } {
  const facing = (f: number): Vec2 => {
    const by = sweep * f;
    const cos = Math.cos(by);
    const sin = Math.sin(by);
    return { x: from.x * cos - from.y * sin, y: from.x * sin + from.y * cos };
  };
  const at = (f: number): { f: number; p: Vec2 } => {
    const by = penSupport(pen, facing(f));
    return { f, p: { x: centre.x + by.x, y: centre.y + by.y } };
  };
  // Read by the direction the edge faces, and then closer wherever that left
  // a gap: along a flat of a square pen the whole flat is one direction.
  const START = 96;
  const read = Array.from({ length: START + 1 }, (_, k) => at(k / START));
  for (let i = 0; i + 1 < read.length && read.length < 4000;) {
    const a = read[i]!;
    const b = read[i + 1]!;
    if (Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y) > READ_APART && b.f - a.f > 1e-9) {
      read.splice(i + 1, 0, at((a.f + b.f) / 2));
    } else {
      i++;
    }
  }
  const points = read.map((r) => r.p);
  const along: number[] = [0];
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1]!;
    const b = points[k]!;
    along.push(along[k - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const end = points.length - 1;
  const way = sweep < 0 ? -1 : 1;
  // The way the edge is going where it faces a direction is that direction
  // turned a quarter turn — but along a flat it faces one way from end to end,
  // and at a sharp corner every way within a hair: so the way it is going is
  // read off the places either side, as a side's is.
  const going = (k: number): Vec2 => {
    for (let wide = 1; wide <= end; wide++) {
      const d = towards(points[Math.max(0, k - wide)]!, points[Math.min(end, k + wide)]!);
      if (d !== null) return d;
    }
    const f = facing(read[k]!.f);
    return { x: -f.y * way, y: f.x * way };
  };

  // Cut where the edge passes a corner of the pen, which half a turn of it
  // does twice and less than half a turn twice at most: so into three runs
  // always, the ones a master has no corner for being runs of no length at
  // the end.
  const corners = cornerFacings(pen);
  const marks: number[] = [];
  for (let k = 1; k < end && marks.length < 2; k++) {
    const a = facing(read[k - 1]!.f);
    const b = facing(read[k]!.f);
    if (
      corners.some(
        (c) => a.x * c.x + a.y * c.y > 0 && (a.x * c.y - a.y * c.x) * (b.x * c.y - b.y * c.x) < 0,
      )
    ) {
      marks.push(k);
    }
  }
  while (marks.length < 2) marks.push(end);
  const bounds = [0, ...marks, end];

  const curves: Cubic[] = [];
  let strays = 0;
  for (let run = 0; run + 1 < bounds.length; run++) {
    const first = bounds[run]!;
    const last = bounds[run + 1]!;
    const length = along[last]! - along[first]!;
    let start = first;
    for (let j = 1; j <= pieces; j++) {
      let stop = last;
      if (j < pieces) {
        stop = start;
        while (stop < last && along[stop]! - along[first]! < (length * j) / pieces) stop++;
      }
      const fitted = fitOne(points.slice(start, stop + 1), going(start), going(stop));
      strays = Math.max(strays, fitted.strays);
      curves.push(fitted.curve);
      start = stop;
    }
  }
  return { curves, strays };
}

/**
 * What goes between the end of one leg and the start of the next in every
 * master, for a pen with corners in some: {@link joinOf}, with the pen's edge
 * walked and fitted and every master given as many curves as the one that
 * needs most.
 */
function corneredJoins(
  each: readonly {
    readonly master: StrokeMaster;
    readonly profiles: readonly PenProfile[];
    readonly before: readonly PlannedPiece[];
    readonly after: readonly PlannedPiece[];
  }[],
  leg: Leg,
  next: Leg,
): { pieces: PlannedPiece[]; turns: boolean }[] {
  const turned = each.map(({ master, profiles, before, after }) => {
    const from = before[before.length - 1]!.curve.b;
    const to = after[0]!.curve.a;
    const uTurn = leg.index === next.index && leg.forward !== next.forward && !master.closed;
    const arriving = heading(master.curves[leg.index]!, leg, 1);
    const leaving = heading(master.curves[next.index]!, next, 0);
    const curve = master.curves[leg.index]!;
    const centre = leg.forward ? curve.b : curve.a;
    const pen = profiles[leg.index]!.at(leg.forward ? 1 : 0);
    let sweep = 0;
    if (arriving !== null && leaving !== null) {
      sweep = Math.atan2(
        arriving.x * leaving.y - arriving.y * leaving.x,
        arriving.x * leaving.x + arriving.y * leaving.y,
      );
    }
    if (uTurn) sweep = Math.PI;
    return {
      from,
      to,
      centre,
      pen,
      sweep,
      uTurn,
      facing: arriving === null ? null : rightOf(arriving),
    };
  });
  const turns = turned.some((t) => t.uTurn || Math.abs(t.sweep) > TURN);

  let chosen: Cubic[][] = [];
  for (const pieces of EDGE_COUNTS) {
    let worst = 0;
    chosen = turned.map((t) => {
      if (t.facing === null) return Array.from({ length: pieces }, () => lineAsCubic(t.from, t.to));
      const arc = edgeArc(t.pen, t.centre, t.facing, t.sweep, pieces);
      worst = Math.max(worst, arc.strays);
      return arc.curves;
    });
    if (worst <= SIDE_TOLERANCE) break;
  }
  return turned.map((t, at) => {
    const curves = chosen[at]!;
    // Ending exactly where the sides either side of it do.
    const first = curves[0]!;
    const last = curves[curves.length - 1]!;
    curves[0] = cubic(t.from, first.c1, first.c2, first.b);
    curves[curves.length - 1] = cubic(
      curves.length === 1 ? t.from : last.a,
      last.c1,
      last.c2,
      t.to,
    );
    return { pieces: curves.map((curve) => ({ curve, line: false })), turns };
  });
}

/**
 * Both sides of one stretch, in every master, with curves as short as they
 * need to be where they need to be and no shorter elsewhere.
 *
 * Even pieces fail where the side does almost all its going in a sliver of
 * the path: round a hairpin narrower than the pen, the path turns half round in
 * a few hundredths of its length, and in that sliver the side swings across
 * the far half of the pen's outline. Forty-eight even pieces put one there;
 * it wants dozens. So a piece is halved where it strays, and the halves again,
 * until each is near enough.
 *
 * Halved in every master and on both sides at once, wherever any of them
 * strays: the masters must come to the same pieces, and a piece one of them
 * needs halved is halved for all. `null` where a piece has been halved so far
 * that halving it again would not be a curve worth having, or the side cannot
 * be followed at all.
 */
function refinedSides(
  masters: readonly StrokeMaster[],
  profiles: readonly (readonly PenProfile[])[],
  index: number,
  legs: readonly Leg[],
): Cubic[][][] | null {
  const sides = masters.flatMap((m, at) =>
    legs.map((leg) => sideOf(m.curves[index]!, profiles[at]![index]!, leg)),
  );
  // Each piece as the parameter it runs over, halved where it strays.
  const spans: [number, number][] = [];
  const split = (s0: number, s1: number, depth: number): boolean => {
    let worst = 0;
    for (const side of sides) {
      const piece = hermitePiece(side, s0, s1);
      if (piece === null) return false;
      worst = Math.max(worst, piece.strays);
    }
    if (worst <= SIDE_TOLERANCE || (depth >= REFINE_DEPTH && worst <= SIDE_LIMIT)) {
      spans.push([s0, s1]);
      return true;
    }
    if (depth >= REFINE_DEPTH) return false;
    const middle = (s0 + s1) / 2;
    return split(s0, middle, depth + 1) && split(middle, s1, depth + 1);
  };
  if (!split(0, 1, 0) || spans.length > REFINE_PIECES) return null;

  const out: Cubic[][][] = [];
  for (let at = 0; at < masters.length; at++) {
    const each: Cubic[][] = [];
    for (let l = 0; l < legs.length; l++) {
      const side = sides[at * legs.length + l]!;
      const curves: Cubic[] = [];
      for (const [s0, s1] of spans) {
        const piece = hermitePiece(side, s0, s1);
        if (piece === null) return null;
        curves.push(piece.curve);
      }
      each.push(curves);
    }
    out.push(each);
  }
  return out;
}

/** How deep a piece is halved, at most: a piece a thousandth of the stretch. */
const REFINE_DEPTH = 10;
/** How many pieces a side may come to: as many as the most even pieces are tried with, twice. */
const REFINE_PIECES = 96;

/** One side of a stretch as where it is and how fast it is going, at each place along the path. */
type Side = {
  readonly at: (s: number) => Vec2 | null;
  readonly speed: (s: number) => Vec2 | null;
};

function sideOf(curve: Cubic, profile: PenProfile, leg: Leg): Side {
  const at = (s: number): Vec2 | null => reach(curve, profile, leg, Math.min(1, Math.max(0, s)));
  // How fast the side is going, by a step short enough for it to be straight over.
  const step = 1e-5;
  const speed = (s: number): Vec2 | null => {
    const from = Math.max(0, s - step);
    const to = Math.min(1, s + step);
    const a = at(from);
    const b = at(to);
    if (a === null || b === null) return null;
    return { x: (b.x - a.x) / (to - from), y: (b.y - a.y) / (to - from) };
  };
  return { at, speed };
}

/** One curve of a side, from where and how fast it is at each end, and how far it strays. */
function hermitePiece(
  side: Side,
  s0: number,
  s1: number,
): { readonly curve: Cubic; readonly strays: number } | null {
  const p0 = side.at(s0);
  const p1 = side.at(s1);
  const v0 = side.speed(s0);
  const v1 = side.speed(s1);
  if (p0 === null || p1 === null || v0 === null || v1 === null) return null;
  const third = (s1 - s0) / 3;
  const curve = cubic(
    p0,
    { x: p0.x + v0.x * third, y: p0.y + v0.y * third },
    { x: p1.x - v1.x * third, y: p1.y - v1.y * third },
    p1,
  );
  if (![curve.c1.x, curve.c1.y, curve.c2.x, curve.c2.y].every(Number.isFinite)) return null;
  let strays = 0;
  for (const u of [0.25, 0.5, 0.75]) {
    const truly = side.at(s0 + (s1 - s0) * u);
    if (truly === null) return null;
    const drawn = evaluate(curve, u);
    strays = Math.max(strays, Math.hypot(drawn.x - truly.x, drawn.y - truly.y));
  }
  return { curve, strays };
}

/** One side of a stretch in `pieces` curves, and how far the worst of them strays. */
function hermiteSide(
  curve: Cubic,
  profile: PenProfile,
  leg: Leg,
  pieces: number,
): { curves: Cubic[]; strays: number } | null {
  const at = (s: number): Vec2 | null => reach(curve, profile, leg, Math.min(1, Math.max(0, s)));
  // How fast the side is going, by a step short enough for it to be straight over.
  const step = 1e-5;
  const speed = (s: number): Vec2 | null => {
    const from = Math.max(0, s - step);
    const to = Math.min(1, s + step);
    const a = at(from);
    const b = at(to);
    if (a === null || b === null) return null;
    return { x: (b.x - a.x) / (to - from), y: (b.y - a.y) / (to - from) };
  };

  const curves: Cubic[] = [];
  let strays = 0;
  for (let k = 0; k < pieces; k++) {
    const s0 = k / pieces;
    const s1 = (k + 1) / pieces;
    const p0 = at(s0);
    const p1 = at(s1);
    const v0 = speed(s0);
    const v1 = speed(s1);
    if (p0 === null || p1 === null || v0 === null || v1 === null) return null;
    const third = (s1 - s0) / 3;
    const piece = cubic(
      p0,
      { x: p0.x + v0.x * third, y: p0.y + v0.y * third },
      { x: p1.x - v1.x * third, y: p1.y - v1.y * third },
      p1,
    );
    if (![piece.c1.x, piece.c1.y, piece.c2.x, piece.c2.y].every(Number.isFinite)) return null;
    for (const u of [0.25, 0.5, 0.75]) {
      const truly = at(s0 + (s1 - s0) * u);
      if (truly === null) return null;
      const drawn = evaluate(piece, u);
      strays = Math.max(strays, Math.hypot(drawn.x - truly.x, drawn.y - truly.y));
    }
    curves.push(piece);
  }
  return { curves, strays };
}

/**
 * Both sides of every stretch for a broad edge, which are exact.
 *
 * A broad edge's reach to one side is one of its two ends, so a side is the path
 * itself moved over by half the nib — until the path runs along the nib, where
 * the other end takes over and the side crosses from one to the other along the
 * nib itself. A curve runs along a fixed direction at most twice, so a stretch
 * is three pieces of the path at most with a line across between them; and it
 * is that many in every master, a master whose path does not cross the nib
 * there being cut at the same places and its lines across having no length.
 */
function broadSides(masters: readonly StrokeMaster[]): Map<string, PlannedPiece[]>[] | null {
  const out = masters.map(() => new Map<string, PlannedPiece[]>());
  const count = masters[0]!.curves.length;

  for (let index = 0; index < count; index++) {
    const found = masters.map((m) => {
      const pen = m.pens[0]!;
      return nibTangencies(m.curves[index]!, halfNib(pen.angle, pen.width));
    });
    const most = found.reduce((best, f) => (f.length > best.length ? f : best), found[0]!);

    for (const [at, m] of masters.entries()) {
      const curve = m.curves[index]!;
      const pen = m.pens[0]!;
      const cuts = cutsLike(most, found[at]!);
      const bounds = [0, ...cuts, 1];
      for (const leg of [
        { index, forward: true },
        { index, forward: false },
      ]) {
        const pieces: PlannedPiece[] = [];
        const spans = bounds.slice(0, -1).map((from, k) => [from, bounds[k + 1]!] as const);
        for (const [from, to] of leg.forward ? spans : [...spans].reverse()) {
          const middle = (from + to) / 2;
          const along = tangent(curve, middle) ?? endTangent(curve, 0);
          if (along === null) return null;
          const facing = rightOf(leg.forward ? along : { x: -along.x, y: -along.y });
          const by = penSupport(pen, facing);
          const part = to > from ? subcurve(curve, from, to) : pointCurve(evaluate(curve, from));
          const moved = movedBy(leg.forward ? part : reverse(part), by);
          const before = pieces[pieces.length - 1];
          if (before !== undefined) {
            pieces.push({ curve: lineAsCubic(before.curve.b, moved.a), line: true });
          }
          pieces.push({ curve: moved, line: false });
        }
        out[at]!.set(key(leg), pieces);
      }
    }
  }
  return out;
}

/** Whether a pen is a rectangle outright: all the squareness there is, and some thickness. */
function isBox(pen: PenShape): boolean {
  return !isBroad(pen) && squarenessOf(pen) >= 1;
}

/**
 * The four corners of a rectangular pen, from its middle, anticlockwise.
 */
function boxCorners(pen: PenShape): Vec2[] {
  const a = pen.width / 2;
  const b = pen.thickness / 2;
  const angle = (pen.angle * Math.PI) / 180;
  const u = { x: Math.cos(angle), y: Math.sin(angle) };
  const v = { x: -u.y, y: u.x };
  return [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ].map(([i, j]) => ({ x: u.x * a * i! + v.x * b * j!, y: u.y * a * i! + v.y * b * j! }));
}

/**
 * The corner of a rectangular pen that reaches furthest to the right of the way
 * it is going — and, where it is going along one of its own edges and two
 * corners reach as far, the one behind. That is the corner whose path is the
 * edge of the ink: the one in front is on the same line, further on, and is
 * come to round the end of the stroke.
 */
function leadingCorner(corners: readonly Vec2[], going: Vec2): number {
  const facing = rightOf(going);
  let best = 0;
  let bestReach = -Infinity;
  let bestAhead = Infinity;
  for (const [k, c] of corners.entries()) {
    const reach_ = c.x * facing.x + c.y * facing.y;
    const ahead = c.x * going.x + c.y * going.y;
    if (reach_ > bestReach + 1e-9 || (Math.abs(reach_ - bestReach) <= 1e-9 && ahead < bestAhead)) {
      best = k;
      bestReach = reach_;
      bestAhead = ahead;
    }
  }
  return best;
}

/**
 * Both sides of every stretch for a rectangular pen, which are exact.
 *
 * A rectangle's reach to one side is one of its four corners, so a side is the
 * path itself moved over by that corner — until the path runs along one of the
 * pen's edges, where the next corner takes over and the side crosses from one
 * to the other along that edge. It is a broad edge's side with two directions
 * to run along where a broad edge has one: a curve runs along a fixed direction
 * at most twice, so a stretch is five pieces of the path at most with a line
 * across between them, and that many in every master.
 */
function boxSides(masters: readonly StrokeMaster[]): Map<string, PlannedPiece[]>[] | null {
  const out = masters.map(() => new Map<string, PlannedPiece[]>());
  const count = masters[0]!.curves.length;

  for (let index = 0; index < count; index++) {
    const found = masters.map((m) => {
      const pen = m.pens[0]!;
      const angle = (pen.angle * Math.PI) / 180;
      const u = { x: Math.cos(angle), y: Math.sin(angle) };
      const cuts = [
        ...nibTangencies(m.curves[index]!, u),
        ...nibTangencies(m.curves[index]!, { x: -u.y, y: u.x }),
      ].sort((a, b) => a - b);
      return cuts.filter((t, i) => i === 0 || t - cuts[i - 1]! > 1e-9);
    });
    const most = found.reduce((best, f) => (f.length > best.length ? f : best), found[0]!);
    // A stretch that is a straight line in every master is straight pieces in
    // every master: said so, since whoever joins the line into an outline can
    // then take the points off the middle of an edge.
    const straight = masters.every((m) => isFlat(m.curves[index]!, 1e-9));

    for (const [at, m] of masters.entries()) {
      const curve = m.curves[index]!;
      const corners = boxCorners(m.pens[0]!);
      const bounds = [0, ...cutsLike(most, found[at]!), 1];
      for (const leg of [
        { index, forward: true },
        { index, forward: false },
      ]) {
        const pieces: PlannedPiece[] = [];
        const spans = bounds.slice(0, -1).map((from, k) => [from, bounds[k + 1]!] as const);
        for (const [from, to] of leg.forward ? spans : [...spans].reverse()) {
          const along = tangent(curve, (from + to) / 2) ?? endTangent(curve, 0);
          if (along === null) return null;
          const going = leg.forward ? along : { x: -along.x, y: -along.y };
          const by = corners[leadingCorner(corners, going)]!;
          const part = to > from ? subcurve(curve, from, to) : pointCurve(evaluate(curve, from));
          const moved = movedBy(leg.forward ? part : reverse(part), by);
          const before = pieces[pieces.length - 1];
          if (before !== undefined) {
            pieces.push({ curve: lineAsCubic(before.curve.b, moved.a), line: true });
          }
          pieces.push({ curve: moved, line: straight });
        }
        out[at]!.set(key(leg), pieces);
      }
    }
  }
  return out;
}

/** Whether every pen along a master's path is held at the one angle. */
const heldAtOneAngle = (m: StrokeMaster): boolean =>
  m.pens.every((pen) => pen.angle === m.pens[0]!.angle);

/** The two ends of a broad edge, from its middle. */
function nibEnds(pen: PenShape): Vec2[] {
  const half = halfNib(pen.angle, pen.width);
  return [half, { x: -half.x, y: -half.y }];
}

/**
 * How many places along a leg are asked which corner of the pen draws its side
 * there. Where the answer changes between two of them the place is then found
 * closely; this is only how near together two changes may be and both be seen.
 * A stroke is drawn again at every move of a drag, and at four times as many
 * places a broad edge that widens took three times as long as it had.
 */
const CORNER_STEPS = 64;

/**
 * Both sides of every stretch for a pen of corners and straight edges — a
 * rectangle, or a broad edge, which is one of two corners — that changes its
 * size along the path and is held at one angle.
 *
 * The edge of the ink is then still the path of one corner at a time, with one
 * of the pen's own edges across where the next takes over. But each corner goes
 * its own way now, the path's and its own outward or inward as the pen grows or
 * shrinks, and so it is by its own going that a corner is asked whether it
 * draws the side: it does where the whole pen is to the left of the way it is
 * going. An edge of the pen keeps its direction, the angle being held, so its
 * two corners go as fast across it as each other, and the edge is the edge of
 * the ink whole at the instant neither is going across it: a straight line from
 * one corner to the next, as it is for a pen that does not change.
 *
 * A corner's path is the path moved over by something that changes with the
 * distance gone, and is no cubic: it is drawn with as many as bring it within
 * a tenth of a unit, the same number in every master — one, and a straight one,
 * along a straight stretch the pen changes evenly along.
 *
 * `null` where no corner draws the side: a pen growing faster than it moves
 * covers its own corners' paths, and the edge of its ink is the pen as it ends.
 */
function changingSides(
  masters: readonly StrokeMaster[],
  profiles: readonly (readonly PenProfile[])[],
  cornersOf: (pen: PenShape) => Vec2[],
): Map<string, PlannedPiece[]>[] | null {
  const out = masters.map(() => new Map<string, PlannedPiece[]>());
  const count = masters[0]!.curves.length;

  for (let index = 0; index < count; index++) {
    const straight = masters.every(
      (m, at) =>
        isFlat(m.curves[index]!, 1e-9) &&
        (profiles[at]![index]!.constant !== null ||
          (m.blends?.[index]?.shape ?? "linear") === "linear"),
    );

    for (const forward of [true, false]) {
      const leg: Leg = { index, forward };
      const each = masters.map((m, at) => {
        const curve = m.curves[index]!;
        const profile = profiles[at]![index]!;
        const t = (s: number): number => (forward ? s : 1 - s);
        const corner = (k: number, s: number): Vec2 => cornersOf(profile.at(t(s)))[k]!;
        /** Where corner `k` is, `s` of the way along the leg. */
        const trace = (k: number, s: number): Vec2 => {
          const p = evaluate(curve, t(s));
          const c = corner(k, s);
          return { x: p.x + c.x, y: p.y + c.y };
        };
        /** How fast it is going there, by a step short enough to be straight over. */
        const speed = (k: number, s: number, from = 0, to = 1): Vec2 => {
          const a = Math.max(from, s - 1e-5);
          const b = Math.min(to, s + 1e-5);
          const p = trace(k, a);
          const q = trace(k, b);
          return { x: (q.x - p.x) / (b - a), y: (q.y - p.y) / (b - a) };
        };
        /** The corner that draws the side there, or `null` where none does. */
        const drawing = (s: number): number | null => {
          const going = heading(curve, leg, s);
          if (going === null) return null;
          const corners = cornersOf(profile.at(t(s)));
          let strict: number | null = null;
          let behind: number | null = null;
          for (const [k, c] of corners.entries()) {
            // A pen that is not changing here goes the way the path does, all of it.
            const w = profile.constant === null ? speed(k, s) : going;
            const size = Math.hypot(w.x, w.y);
            let least = Infinity;
            for (const other of [1, corners.length - 1]) {
              const e = corners[(k + other) % corners.length]!;
              const ex = e.x - c.x;
              const ey = e.y - c.y;
              const length = Math.hypot(ex, ey);
              if (!(length > 0) || !(size > 0)) continue;
              least = Math.min(least, (w.x * ey - w.y * ex) / (size * length));
            }
            if (least === Infinity) continue;
            if (least > 1e-6) {
              // Two that do, and the edge of the ink is not one line.
              if (strict !== null) return null;
              strict = k;
            } else if (least >= -1e-6) {
              // Going along one of its own edges: the corner behind, the one
              // in front being on the same line further on.
              const ahead = (j: number): number =>
                corners[j]!.x * going.x + corners[j]!.y * going.y;
              if (behind === null || ahead(k) < ahead(behind)) behind = k;
            }
          }
          return strict ?? behind;
        };

        // Where the corner that draws the side changes.
        const cuts: number[] = [];
        let before = drawing(0.5 / CORNER_STEPS);
        if (before === null) return null;
        for (let i = 1; i < CORNER_STEPS; i++) {
          const s = (i + 0.5) / CORNER_STEPS;
          const here = drawing(s);
          if (here === null) return null;
          if (here !== before) {
            let lo = (i - 0.5) / CORNER_STEPS;
            let hi = s;
            for (let n = 0; n < 48; n++) {
              const mid = (lo + hi) / 2;
              if (drawing(mid) === before) lo = mid;
              else hi = mid;
            }
            cuts.push((lo + hi) / 2);
          }
          before = here;
        }
        return { trace, speed, drawing, cuts };
      });
      if (each.some((e) => e === null)) return null;
      const found = each.map((e) => e!.cuts);
      const most = found.reduce((best, f) => (f.length > best.length ? f : best), found[0]!);
      const bounds = found.map((own) => [0, ...cutsLike(most, own), 1]);

      const chosen: PlannedPiece[][] = masters.map(() => []);
      for (let span = 0; span + 1 < bounds[0]!.length; span++) {
        const runs: { at: (s: number) => Vec2; speed: (s: number) => Vec2 }[] = [];
        for (const [at, e] of each.entries()) {
          const from = bounds[at]![span]!;
          const to = bounds[at]![span + 1]!;
          const k = e!.drawing((from + to) / 2);
          if (k === null) return null;
          runs.push({
            at: (f) => e!.trace(k, from + (to - from) * f),
            speed: (f) => {
              const v = e!.speed(k, from + (to - from) * f, from, to);
              return { x: v.x * (to - from), y: v.y * (to - from) };
            },
          });
        }

        let fitted: Cubic[][] = [];
        if (straight) {
          fitted = runs.map((run) => [lineAsCubic(run.at(0), run.at(1))]);
        } else {
          for (const pieces of SIDE_COUNTS) {
            let worst = 0;
            fitted = runs.map((run) => {
              const made = hermiteRun(run.at, run.speed, pieces);
              worst = Math.max(worst, made.strays);
              return made.curves;
            });
            if (worst <= SIDE_TOLERANCE) break;
            if (pieces === SIDE_COUNTS[SIDE_COUNTS.length - 1] && worst > SIDE_LIMIT) return null;
          }
        }
        for (const [at, curves] of fitted.entries()) {
          const side = chosen[at]!;
          const last = side[side.length - 1];
          // Across to the next corner along the pen's own edge.
          if (last !== undefined) {
            side.push({ curve: lineAsCubic(last.curve.b, curves[0]!.a), line: true });
          }
          for (const curve of curves) side.push({ curve, line: straight });
        }
      }
      for (const [at, side] of chosen.entries()) out[at]!.set(key(leg), side);
    }
  }
  return out;
}

/** The step a turning pen's corners are asked how fast they are going over, of a stretch. */
const GOING_OVER = 1 / 96;

/** A stretch of a side: one corner's path, or the edge between two as the pen turns on it. */
type TurningRun =
  | { readonly kind: "corner"; readonly k: number; readonly from: number; readonly to: number }
  | {
      readonly kind: "edge";
      readonly k: number;
      readonly next: number;
      readonly from: number;
      readonly to: number;
      /** The end of it that is not at a corner: the stretch begins or ends with the pen mid-pivot. */
      readonly open?: "start" | "end";
    }
  /** No length: where a corner is at an instant, standing in for a run another master has. */
  | { readonly kind: "point"; readonly k: number; readonly from: number; readonly to: number }
  | {
      /** Along the pen's edge as it is at an instant, between corner `k` and the place it pivots on. */
      readonly kind: "over";
      readonly k: number;
      readonly next: number;
      readonly from: number;
      readonly to: number;
      /** To the corner from the pivot, or from the corner to it. */
      readonly toCorner: boolean;
      /** All the edge: to the corner from corner `next`, and not from the pivot. */
      readonly whole?: boolean;
    };

/**
 * Both sides of every stretch for a pen of corners and straight edges that
 * turns along the path, whatever else it does.
 *
 * A corner draws the side while the whole pen is to the left of the way the
 * corner is going, as it does for a pen held at an angle. But an edge of a pen
 * that turns has its two corners going across it at different speeds, and
 * between the instant one stops going outward and the instant the other
 * starts, the edge of the ink is neither: it is the place on the pen's edge
 * that is going along the edge and not across it — the place the edge pivots
 * on — which slides from the one corner to the other. So a side is a corner's
 * path as far as that corner draws it, the path of the pivot along the edge to
 * the next corner, and that corner's path from where it begins to draw.
 *
 * The second corner may begin before the first has stopped. The pivot then
 * goes back in time from the one to the other, and the line with it: it runs
 * back over itself, round the ink both corners drew, as it does inside a bend.
 *
 * A stretch may begin or end with the pen in the middle of that, neither
 * corner drawing: its side then begins or ends part way along the pen's edge,
 * and is joined to the next stretch's along that edge.
 *
 * And the pen may be in the middle of that as the path comes to a point: one
 * corner began before the point and the other stops after it. The line would
 * go back from the one stretch into the one before, and each stretch has its
 * own. So each is given what is its own of it, and they meet on the pen's edge
 * as it is at the point. The stretch before: its corner to the point, along the
 * edge to the pivot, the pivot back to where the second corner began, and that
 * corner to the point. The stretch after: the first corner on to where it
 * stops, the pivot back to the point, along the edge to the second corner, and
 * that corner on. What is added is the edge gone along and back, which is
 * round nothing.
 *
 * A master whose side has fewer of these than another's — a heavier pen comes
 * to the next corner a little before the end of a stretch where a lighter one
 * comes to it a little after — has the rest with no length, at whichever end
 * of the stretch the other has them.
 *
 * `null` where the corners cannot be followed so — two draw the side all a
 * stretch long, or two that have no edge between them, or the pen is pivoting
 * as an open path ends — and where the masters' sides are not made of the
 * same stretches in the same order even so.
 */
function turningSides(
  masters: readonly StrokeMaster[],
  profiles: readonly (readonly PenProfile[])[],
  cornersOf: (pen: PenShape) => Vec2[],
): Map<string, PlannedPiece[]>[] | null {
  const out = masters.map(() => new Map<string, PlannedPiece[]>());
  const count = masters[0]!.curves.length;
  const TIE = 1e-6;

  for (let index = 0; index < count; index++) {
    const straight = masters.every(
      (m, at) => isFlat(m.curves[index]!, 1e-9) && profiles[at]![index]!.constant !== null,
    );
    for (const forward of [true, false]) {
      const leg: Leg = { index, forward };
      // With the line taken back round what two corners drew as a stretch
      // ends, and without: one master may end a stretch so and another not,
      // and it is a few units of the pen's own ink at the point, laid there
      // by the stretch after as well.
      const followed = (closing: boolean) => {
        const each = masters.map((m, at) => {
          const curve = m.curves[index]!;
          const profile = profiles[at]![index]!;
          const t = (s: number): number => (forward ? s : 1 - s);
          const cornersAt = (s: number): Vec2[] => cornersOf(profile.at(t(s)));
          const n = cornersAt(0).length;
          const trace = (k: number, s: number): Vec2 => {
            const p = evaluate(curve, t(s));
            const c = cornersAt(s)[k]!;
            return { x: p.x + c.x, y: p.y + c.y };
          };
          // How fast a corner is going, over a step and not at an instant. A pen
          // changes by the distance gone, which is read off a table of chords:
          // how fast it turns steps a little from one chord to the next, and the
          // place an edge pivots on — one going divided by the difference of two
          // — steps some units along the edge with it. Along the edge, which is
          // along the line it draws, so nothing is out of place; but a line that
          // jumps is not one to fit a curve to. Over a step as long as a chord
          // the turning has no steps in it.
          const speed = (k: number, s: number): Vec2 => {
            const a = Math.max(0, s - GOING_OVER);
            const b = Math.min(1, s + GOING_OVER);
            const p = trace(k, a);
            const q = trace(k, b);
            return { x: (q.x - p.x) / (b - a), y: (q.y - p.y) / (b - a) };
          };
          /** How far corner `k` is going to the right of its edge towards corner `k + by`. */
          const across = (k: number, by: number, s: number): number => {
            const corners = cornersAt(s);
            const c = corners[k]!;
            const e = corners[(k + by) % n]!;
            const w = speed(k, s);
            return w.x * (e.y - c.y) - w.y * (e.x - c.x);
          };
          /** That, as a share of all its going, and with a tie taken for drawing. */
          const drawn = (k: number, by: number, s: number): number => {
            const corners = cornersAt(s);
            const c = corners[k]!;
            const e = corners[(k + by) % n]!;
            const w = speed(k, s);
            const size = Math.hypot(w.x, w.y) * Math.hypot(e.x - c.x, e.y - c.y);
            return size > 0 ? across(k, by, s) / size + TIE : TIE;
          };
          const edgesOf = n === 2 ? [1] : [1, n - 1];
          const draws = (k: number, s: number, margin = 0): boolean =>
            edgesOf.every((by) => drawn(k, by, s) > margin);

          /** Where corner `k` stops or starts going outward of an edge, along the leg. */
          const turns = (k: number, by: number): { s: number; starts: boolean }[] => {
            const found: { s: number; starts: boolean }[] = [];
            let before = drawn(k, by, 0);
            for (let i = 1; i <= CORNER_STEPS; i++) {
              const here = drawn(k, by, i / CORNER_STEPS);
              if (before > 0 !== here > 0) {
                let lo = (i - 1) / CORNER_STEPS;
                let hi = i / CORNER_STEPS;
                for (let j = 0; j < 48; j++) {
                  const mid = (lo + hi) / 2;
                  if (drawn(k, by, mid) > 0 === before > 0) lo = mid;
                  else hi = mid;
                }
                found.push({ s: (lo + hi) / 2, starts: here > 0 });
              }
              before = here;
            }
            return found;
          };
          const known = new Map<string, { s: number; starts: boolean }[]>();
          const turnsOf = (k: number, by: number): { s: number; starts: boolean }[] => {
            const name = `${String(k)}/${String(by)}`;
            const had = known.get(name);
            if (had !== undefined) return had;
            const made = turns(k, by);
            known.set(name, made);
            return made;
          };

          /** The place the edge from corner `k` to corner `next` pivots on, at `s`. */
          const pivotAt = (k: number, next: number, s: number, tie = 0.5): Vec2 => {
            const a = across(k, (next - k + n) % n, s);
            const corners = cornersAt(s);
            const c = corners[k]!;
            const e = corners[next]!;
            const w = speed(next, s);
            const b = w.x * (e.y - c.y) - w.y * (e.x - c.x);
            const share = a === b ? tie : a / (a - b);
            const p = trace(k, s);
            const q = trace(next, s);
            return { x: p.x + (q.x - p.x) * share, y: p.y + (q.y - p.y) * share };
          };

          // Whether the stretch begins or ends where an open path does. The pen
          // stands whole there and the line goes round it, from a corner to a
          // corner: a pen pivoting as the path ends is not followed.
          const atAnEnd = {
            start: !m.closed && index === (forward ? 0 : count - 1),
            end: !m.closed && index === (forward ? count - 1 : 0),
          };

          // The corner the stretch begins with: the one that draws there, and of
          // two going along an edge of the pen, the one behind.
          const going = heading(curve, leg, 0);
          if (going === null) return null;
          const first = cornersAt(0);
          const candidates = first.map((_, k) => k).filter((k) => draws(k, 0));
          const sure = candidates.filter((k) => draws(k, 0, 2 * TIE));
          if (sure.length > 2) return null;
          const ahead = (k: number): number => first[k]!.x * going.x + first[k]!.y * going.y;
          const backOf = (by: number): number => (n - by) % n || 1;

          const runs: TurningRun[] = [];
          let from = 0;
          let k: number;
          // A corner that has drawn the side since before the stretch began,
          // with the one the stretch begins with: the edge between them is
          // going outward at both its ends.
          let began: number | null = null;
          if (sure.length === 2) {
            // The stretch begins with the one that stops, and the first to.
            const [a, b] = sure as [number, number];
            const by = edgesOf.find((e) => (a + e) % n === b);
            if (by === undefined) return null;
            const stops = (c: number, e: number): number =>
              turnsOf(c, e).find((turn) => !turn.starts)?.s ?? Infinity;
            const mine = stops(a, by);
            const its = stops(b, backOf(by));
            if (mine === Infinity && its === Infinity) return null;
            k = mine <= its ? a : b;
            began = mine <= its ? b : a;
            runs.push({
              kind: "over",
              k,
              next: began,
              from: 0,
              to: 0,
              toCorner: true,
              whole: true,
            });
          } else if (candidates.length > 0) {
            k = candidates.reduce((best, c) => (ahead(c) < ahead(best) ? c : best));
          } else {
            // None: the pen is pivoting on an edge as the stretch begins. The
            // corner that is first to begin drawing, across an edge neither it
            // nor the corner at the other end of it is going outward of yet.
            let begin: { s: number; next: number; by: number } | null = null;
            for (let c = 0; c < n; c++) {
              for (const by of edgesOf) {
                if (drawn(c, by, 0) > 0 || drawn((c + by) % n, backOf(by), 0) > 0) continue;
                // The near edge of the pen and not the far one: each of its two
                // corners is going outward of the other edge it is a corner of.
                if (n > 2 && (drawn(c, backOf(by), 0) <= 0 || drawn((c + by) % n, by, 0) <= 0)) {
                  continue;
                }
                for (const turn of turnsOf(c, by)) {
                  if (!turn.starts) continue;
                  if (begin === null || turn.s < begin.s) begin = { s: turn.s, next: c, by };
                }
              }
            }
            if (begin === null || atAnEnd.start) return null;
            runs.push({
              kind: "edge",
              k: (begin.next + begin.by) % n,
              next: begin.next,
              from: 0,
              to: begin.s,
              open: "start",
            });
            k = begin.next;
            from = begin.s;
          }
          for (;;) {
            if (runs.length > 24) return null;
            let stop: { s: number; by: number } | null = null;
            for (const by of edgesOf) {
              for (const turn of turnsOf(k, by)) {
                if (turn.starts || turn.s <= from + 1e-9) continue;
                if (stop === null || turn.s < stop.s) stop = { s: turn.s, by };
              }
            }
            if (stop === null) {
              if (began !== null) return null;
              runs.push({ kind: "corner", k, from, to: 1 });
              // And another may have begun to draw before this one stops: the
              // pivot back to where it did, and it to the end of the stretch.
              for (const by of edgesOf) {
                const other = (k + by) % n;
                if (!closing || !draws(other, 1, 2 * TIE)) continue;
                let begins: number | null = null;
                for (const turn of turnsOf(other, backOf(by))) {
                  if (turn.starts && turn.s > from + 1e-9) begins = turn.s;
                }
                if (begins === null) continue;
                // Drawing from there to the end, by both its edges.
                const began_ = begins;
                if (
                  !draws(other, (began_ + 1) / 2) ||
                  edgesOf.some((e) => turnsOf(other, e).some((turn) => turn.s > began_ + 1e-9))
                ) {
                  continue;
                }
                runs.push({ kind: "over", k, next: other, from: 1, to: 1, toCorner: false });
                runs.push({ kind: "edge", k, next: other, from: 1, to: begins, open: "start" });
                runs.push({ kind: "corner", k: other, from: begins, to: 1 });
                // And ends at the corner it came to the end with.
                runs.push({
                  kind: "over",
                  k,
                  next: other,
                  from: 1,
                  to: 1,
                  toCorner: true,
                  whole: true,
                });
                break;
              }
              break;
            }
            runs.push({ kind: "corner", k, from, to: stop.s });
            const next = (k + stop.by) % n;
            if (began !== null) {
              // Back to the beginning of the stretch, and on with the corner
              // that was drawing already.
              if (next !== began) return null;
              runs.push({ kind: "edge", k, next, from: stop.s, to: 0, open: "end" });
              runs.push({ kind: "over", k: next, next: k, from: 0, to: 0, toCorner: true });
              k = next;
              from = 0;
              began = null;
              continue;
            }
            let begins: number | null = null;
            for (const turn of turnsOf(next, backOf(stop.by))) {
              if (!turn.starts) continue;
              if (begins === null || Math.abs(turn.s - stop.s) < Math.abs(begins - stop.s)) {
                begins = turn.s;
              }
            }
            if (begins === null) {
              // Not in this stretch. Not yet, and the stretch ends with the pen
              // pivoting — or it began before the stretch did, which is two
              // corners drawing through a point of the path.
              if (drawn(next, backOf(stop.by), stop.s) > 0 || atAnEnd.end) return null;
              runs.push({ kind: "edge", k, next, from: stop.s, to: 1, open: "end" });
              break;
            }
            runs.push({ kind: "edge", k, next, from: stop.s, to: begins });
            k = next;
            from = begins;
          }

          /** A run as where it is and how fast it is going, from nought to one. */
          const along = (
            run: TurningRun,
          ): { at: (f: number) => Vec2; speed: (f: number) => Vec2 } => {
            const span = run.to - run.from;
            if (run.kind === "point") {
              const here = trace(run.k, run.from);
              return { at: () => here, speed: () => ({ x: 0, y: 0 }) };
            }
            if (run.kind === "over") {
              const corner = trace(run.k, run.from);
              const pivot =
                run.whole === true ? trace(run.next, run.from) : pivotAt(run.k, run.next, run.from);
              const [a, b] = run.toCorner ? [pivot, corner] : [corner, pivot];
              const by = { x: b.x - a.x, y: b.y - a.y };
              return { at: (f) => ({ x: a.x + by.x * f, y: a.y + by.y * f }), speed: () => by };
            }
            if (run.kind === "corner") {
              return {
                at: (f) => trace(run.k, run.from + span * f),
                speed: (f) => {
                  const s = run.from + span * f;
                  const lo = Math.min(run.from, run.to);
                  const hi = Math.max(run.from, run.to);
                  const a = Math.max(lo, s - 1e-5);
                  const b = Math.min(hi, s + 1e-5);
                  if (!(b > a)) return { x: 0, y: 0 };
                  const p = trace(run.k, a);
                  const q = trace(run.k, b);
                  return { x: ((q.x - p.x) / (b - a)) * span, y: ((q.y - p.y) / (b - a)) * span };
                },
              };
            }
            const between = (f: number): Vec2 => {
              // No time between them: the pen's edge as it is at that instant.
              if (Math.abs(span) < 1e-7) {
                const start = trace(run.k, run.from);
                const end = trace(run.next, run.to);
                return { x: start.x + (end.x - start.x) * f, y: start.y + (end.y - start.y) * f };
              }
              return pivotAt(run.k, run.next, run.from + span * f, f);
            };
            return {
              // Its ends on the corners exactly; how fast it is going is asked of
              // the pivot itself, which is a hair from them there.
              at: (f) =>
                f <= 0 && run.open !== "start"
                  ? trace(run.k, run.from)
                  : f >= 1 && run.open !== "end"
                    ? trace(run.next, run.to)
                    : between(Math.min(1, Math.max(0, f))),
              speed: (f) => {
                const a = Math.max(0, f - 1e-4);
                const b = Math.min(1, f + 1e-4);
                const p = between(a);
                const q = between(b);
                return { x: (q.x - p.x) / (b - a), y: (q.y - p.y) / (b - a) };
              },
            };
          };
          return { runs, along };
        });
        if (each.some((e) => e === null)) return null;
        // As many runs in every master as in the one with most: the rest with
        // no length, at the end of the stretch that one has its last at.
        const most = each.reduce(
          (best, e) => (e!.runs.length > best.length ? e!.runs : best),
          [...each[0]!.runs],
        );
        const atTheEnd = most[most.length - 1]!.from >= 0.5;
        const made = each.map((e) => {
          const runs = [...e!.runs];
          while (runs.length < most.length) {
            if (atTheEnd) {
              const last = runs[runs.length - 1]!;
              const k = last.kind === "edge" ? last.next : last.k;
              runs.push({ kind: "point", k, from: last.to, to: last.to });
            } else {
              const first = runs[0]!;
              const k = first.kind === "over" && first.whole === true ? first.next : first.k;
              runs.unshift({ kind: "point", k, from: first.from, to: first.from });
            }
          }
          return runs;
        });
        const kindOf = (r: TurningRun): string =>
          r.kind === "corner"
            ? "c"
            : r.kind === "edge"
              ? (r.open ?? "edge")[0]!
              : r.kind === "over"
                ? `over ${String(r.toCorner)} ${String(r.whole === true)}`
                : "";
        for (let r = 0; r < most.length; r++) {
          const said = made.map((runs) => kindOf(runs[r]!)).filter((kind) => kind !== "");
          if (said.some((kind) => kind !== said[0])) return null;
        }
        return { each, made, most };
      };
      const way = followed(true) ?? followed(false);
      if (way === null) return null;
      const { each, made, most } = way;

      const chosen: PlannedPiece[][] = masters.map(() => []);
      for (let r = 0; r < most.length; r++) {
        const runs = each.map((e, at) => e!.along(made[at]![r]!));
        // Along the pen's edge is a straight line, whatever the path is.
        const line =
          made.some((m) => m[r]!.kind === "over") ||
          (straight && made.every((m) => m[r]!.kind !== "edge"));
        let fitted: Cubic[][] = [];
        if (line) {
          fitted = runs.map((run) => [lineAsCubic(run.at(0), run.at(1))]);
        } else {
          for (const pieces of SIDE_COUNTS) {
            let worst = 0;
            fitted = runs.map((run) => {
              const made = hermiteRun(run.at, run.speed, pieces);
              worst = Math.max(worst, made.strays);
              return made.curves;
            });
            if (worst <= SIDE_TOLERANCE) break;
            if (pieces === SIDE_COUNTS[SIDE_COUNTS.length - 1] && worst > SIDE_LIMIT) return null;
          }
        }
        for (const [at, curves] of fitted.entries()) {
          const side = chosen[at]!;
          for (const curve of curves) {
            const last = side[side.length - 1];
            // Each piece from exactly where the one before it ended.
            side.push({
              curve: last === undefined ? curve : cubic(last.curve.b, curve.c1, curve.c2, curve.b),
              line,
            });
          }
        }
      }
      for (const [at, side] of chosen.entries()) out[at]!.set(key(leg), side);
    }
  }
  return out;
}

/**
 * A run given by where it is and how fast it is going, from nought to one, in
 * `pieces` curves, and how far the worst of them strays.
 */
function hermiteRun(
  at: (f: number) => Vec2,
  speed: (f: number) => Vec2,
  pieces: number,
): { curves: Cubic[]; strays: number } {
  const curves: Cubic[] = [];
  let strays = 0;
  for (let k = 0; k < pieces; k++) {
    const f0 = k / pieces;
    const f1 = (k + 1) / pieces;
    const p0 = curves[k - 1]?.b ?? at(f0);
    const p1 = at(f1);
    const v0 = speed(f0);
    const v1 = speed(f1);
    const third = (f1 - f0) / 3;
    const piece = cubic(
      p0,
      { x: p0.x + v0.x * third, y: p0.y + v0.y * third },
      { x: p1.x - v1.x * third, y: p1.y - v1.y * third },
      p1,
    );
    for (const u of [0.25, 0.5, 0.75]) {
      const truly = at(f0 + (f1 - f0) * u);
      const drawn = evaluate(piece, u);
      strays = Math.max(strays, Math.hypot(drawn.x - truly.x, drawn.y - truly.y));
    }
    curves.push(piece);
  }
  return { curves, strays };
}

/**
 * What goes between the end of one leg and the start of the next for a
 * rectangular pen: the pen's edges, from the corner the one ends at to the
 * corner the other starts from, and always two of them.
 *
 * Round the end of an open path it is two edges, the pen's front; at a corner
 * of the path one or two, the way the path turned; at a smooth join none, both
 * with no length. Two straight pieces in every master whichever it is — or
 * three, `edges`, for a pen that changes its size, which may end with three
 * of its edges showing.
 */
function boxJoins(
  each: readonly {
    readonly master: StrokeMaster;
    readonly profiles: readonly PenProfile[];
    readonly before: readonly PlannedPiece[];
    readonly after: readonly PlannedPiece[];
  }[],
  leg: Leg,
  next: Leg,
  edges: 2 | 3,
): { pieces: PlannedPiece[]; turns: boolean }[] {
  const made = each.map(({ master, profiles, before, after }) => {
    const from = before[before.length - 1]!.curve.b;
    const to = after[0]!.curve.a;
    const uTurn = leg.index === next.index && leg.forward !== next.forward && !master.closed;
    const curve = master.curves[leg.index]!;
    const centre = leg.forward ? curve.b : curve.a;
    // The pen as it is at the join, which is the pen of the point there.
    const corners = boxCorners(profiles[leg.index]!.at(leg.forward ? 1 : 0)).map((c) => ({
      x: centre.x + c.x,
      y: centre.y + c.y,
    }));
    const nearest = (p: Vec2): number => {
      let best = 0;
      for (const [k, c] of corners.entries()) {
        if (
          Math.hypot(c.x - p.x, c.y - p.y) <
          Math.hypot(corners[best]!.x - p.x, corners[best]!.y - p.y)
        ) {
          best = k;
        }
      }
      return best;
    };
    const first = nearest(from);
    const last = nearest(to);
    const round = (last - first + 4) % 4;
    // Round the end of an open path the line goes on round the pen the way it
    // goes round the ink, by as many edges as are between the two corners: the
    // two of its front for a pen that does not change, one for a pen that has
    // been shrinking — both sides drawn by its front corners — and three for
    // one that has been growing, whose sides are drawn by the two behind.
    // Half way round at a corner of the path is whichever way the path turned.
    const through: Vec2[] = [];
    if (uTurn) {
      for (let k = 1; k < round; k++) through.push(corners[(first + k) % 4]!);
    } else if (round === 2) {
      const arriving = heading(curve, leg, 1);
      const leaving = heading(master.curves[next.index]!, next, 0);
      const turn =
        arriving === null || leaving === null ? 1 : arriving.x * leaving.y - arriving.y * leaving.x;
      through.push(corners[(first + (turn >= 0 ? 1 : 3)) % 4]!);
    }
    // As many pieces whichever it is, the ones not needed of no length.
    const stops = [from, ...through.slice(0, edges - 1)];
    while (stops.length < edges) stops.push(to);
    stops.push(to);
    return {
      pieces: stops
        .slice(0, -1)
        .map((stop, k) => ({ curve: lineAsCubic(stop, stops[k + 1]!), line: true })),
      turns: uTurn || round !== 0,
    };
  });
  const turns = made.some((j) => j.turns);
  return made.map((j) => ({ pieces: j.pieces, turns }));
}

/**
 * A master's own cuts made up to as many as the master with the most has, each
 * of its own kept and the rest taken from that master, in order.
 */
function cutsLike(most: readonly number[], own: readonly number[]): number[] {
  if (own.length >= most.length) return [...own];
  const taken = new Set<number>();
  for (const t of own) {
    let nearest = -1;
    for (const [k, other] of most.entries()) {
      if (taken.has(k)) continue;
      if (nearest < 0 || Math.abs(other - t) < Math.abs(most[nearest]! - t)) nearest = k;
    }
    if (nearest >= 0) taken.add(nearest);
  }
  const borrowed = most.filter((_, k) => !taken.has(k));
  return [...own, ...borrowed].sort((a, b) => a - b);
}

const pointCurve = (p: Vec2): Cubic => cubic(p, p, p, p);

const movedBy = (s: Cubic, by: Vec2): Cubic => {
  const moved = (p: Vec2): Vec2 => ({ x: p.x + by.x, y: p.y + by.y });
  return cubic(moved(s.a), moved(s.c1), moved(s.c2), moved(s.b));
};

/** How far a point is past a cut's line: nothing or less is kept. */
const pastCut = (cut: PlannedCut, p: Vec2): number =>
  (p.x - cut.through.x) * cut.normal.x + (p.y - cut.through.y) * cut.normal.y;

/** Where a curve crosses a cut's line, as parameters in order. */
function cutCrossings(cut: PlannedCut, c: Cubic): number[] {
  const f0 = pastCut(cut, c.a);
  const f1 = pastCut(cut, c.c1);
  const f2 = pastCut(cut, c.c2);
  const f3 = pastCut(cut, c.b);
  return unitRoots(f3 - 3 * f2 + 3 * f1 - f0, 3 * (f2 - 2 * f1 + f0), 3 * (f1 - f0), f0).sort(
    (a, b) => a - b,
  );
}

/** A point carried along the way the path was going until it is on a cut's line. */
function ontoCut(cut: PlannedCut, p: Vec2): Vec2 {
  const facing = cut.normal.x * cut.onward.x + cut.normal.y * cut.onward.y;
  const by = -pastCut(cut, p) / facing;
  return { x: p.x + cut.onward.x * by, y: p.y + cut.onward.y * by };
}

const pointPiece = (p: Vec2, line: boolean): PlannedPiece => ({ curve: cubic(p, p, p, p), line });

/**
 * A side stopped where it comes to a cut, as the same number of pieces and one
 * more: a straight one that carries it on to the line where it stops short.
 *
 * A side that is past the line when it ends is cut where it last crossed, and
 * every piece after that is a piece of no length at the crossing: there in
 * every master, as a master whose side stops short has the carrying-on piece
 * and this one has it with no length. `null` where the whole side is past the
 * line, and there is nothing of it to stop.
 */
function stoppedAt(
  pieces: readonly PlannedPiece[],
  cut: PlannedCut,
): { pieces: PlannedPiece[]; at: Vec2 } | null {
  const last = pieces[pieces.length - 1];
  if (last === undefined) return null;
  if (pastCut(cut, last.curve.b) <= 0) {
    const at = ontoCut(cut, last.curve.b);
    return { pieces: [...pieces, { curve: lineAsCubic(last.curve.b, at), line: true }], at };
  }
  for (let i = pieces.length - 1; i >= 0; i--) {
    const piece = pieces[i]!;
    const crossings = cutCrossings(cut, piece.curve);
    const t = crossings[crossings.length - 1];
    if (t === undefined) continue;
    const at = evaluate(piece.curve, t);
    return {
      pieces: [
        ...pieces.slice(0, i),
        { curve: subcurve(piece.curve, 0, t), line: piece.line },
        ...pieces.slice(i + 1).map((p) => pointPiece(at, p.line)),
        pointPiece(at, true),
      ],
      at,
    };
  }
  return null;
}

/** A side started where it leaves a cut: {@link stoppedAt}, the other way round. */
function startedAt(
  pieces: readonly PlannedPiece[],
  cut: PlannedCut,
): { pieces: PlannedPiece[]; at: Vec2 } | null {
  const turned = [...pieces].reverse().map((p) => ({ curve: reverse(p.curve), line: p.line }));
  const stopped = stoppedAt(turned, cut);
  if (stopped === null) return null;
  return {
    pieces: [...stopped.pieces].reverse().map((p) => ({ curve: reverse(p.curve), line: p.line })),
    at: stopped.at,
  };
}

/**
 * A side stopped at a cut: its pieces, where it stopped, and how many legs
 * before the end's own the side is that was stopped.
 */
type Stopped = { readonly pieces: PlannedPiece[]; readonly at: Vec2; readonly back: number };

/** A quarter of a circle as one curve: how far along its tangents the handles go. */
const QUARTER = (4 / 3) * (Math.SQRT2 - 1);

/**
 * An end that is cut: the side that comes to it and the side that leaves it,
 * each stopped at the cut, and what goes between them.
 *
 * Between them is the cut itself, one straight piece along it. Or, for an end
 * closed with the pen's shape, half the pen's outline: as wide as the stroke is
 * where the line crosses it, as deep in proportion as the pen is thick to its
 * width, leaning the way the path was going, and standing on a line that much
 * short of the cut so that its tip is on the cut. A half oval is two quarters,
 * and each is one curve. A broad edge has no shape but a line, and is closed
 * with the cut whichever was asked.
 *
 * The same as the ink a single font gets, which is the stroke carried on and
 * cut: a side carried on is carried on straight, the pen not changing past the
 * end of the path.
 */
function cutTurn(
  arriving: (by: PlannedCut) => Stopped | null,
  leaving: (by: PlannedCut) => Stopped | null,
  cut: PlannedCut,
  pen: PenShape,
  cornered: boolean,
): { arriving: Stopped; leaving: Stopped; closure: PlannedPiece[] } | null {
  const from = arriving(cut);
  const to = leaving(cut);
  if (from === null || to === null) return null;
  if (!cut.nibbed || isBroad(pen)) {
    return {
      arriving: from,
      leaving: to,
      closure: [{ curve: lineAsCubic(from.at, to.at), line: true }],
    };
  }

  const across = Math.hypot(to.at.x - from.at.x, to.at.y - from.at.y);
  const depth = (pen.thickness / 2) * (across / pen.width);
  const short: PlannedCut = {
    ...cut,
    through: { x: cut.through.x - cut.normal.x * depth, y: cut.through.y - cut.normal.y * depth },
  };
  const a = arriving(short);
  const b = leaving(short);
  if (a === null || b === null) return null;

  const facing = cut.normal.x * cut.onward.x + cut.normal.y * cut.onward.y;
  const out = { x: (cut.onward.x / facing) * depth, y: (cut.onward.y / facing) * depth };
  const middle = { x: (a.at.x + b.at.x) / 2, y: (a.at.y + b.at.y) / 2 };
  const half = { x: a.at.x - middle.x, y: a.at.y - middle.y };
  const tip = { x: middle.x + out.x, y: middle.y + out.y };
  const by = (p: Vec2, v: Vec2, k: number): Vec2 => ({ x: p.x + v.x * k, y: p.y + v.y * k });
  if (cornered) {
    return {
      arriving: a,
      leaving: b,
      closure: halfOutline(pen, a.at, b.at, middle, half, out),
    };
  }
  return {
    arriving: a,
    leaving: b,
    closure: [
      { curve: cubic(a.at, by(a.at, out, QUARTER), by(tip, half, QUARTER), tip), line: false },
      { curve: cubic(tip, by(tip, half, -QUARTER), by(b.at, out, QUARTER), b.at), line: false },
    ],
  };
}

/**
 * Half the outline of a pen with corners, standing on the edge of a cut: from
 * one end of the edge out to its tip and back to the other, in four curves, a
 * corner's worth to each.
 *
 * The outline said by its own equation, as the single font's is: a point round
 * half a circle with each coordinate raised to two over the pen's exponent.
 * Cut at the tip and half way to it either side, where a square pen's corners
 * are, so that each piece is a flat and the turn at the end of it.
 */
function halfOutline(
  pen: PenShape,
  from: Vec2,
  to: Vec2,
  middle: Vec2,
  half: Vec2,
  out: Vec2,
): PlannedPiece[] {
  const power = 2 / penExponent(pen);
  const raised = (v: number): number => Math.sign(v) * Math.pow(Math.abs(v), power);
  const at = (u: number): Vec2 => {
    const along = raised(Math.cos(u));
    const outward = raised(Math.sin(u));
    return {
      x: middle.x + half.x * along + out.x * outward,
      y: middle.y + half.y * along + out.y * outward,
    };
  };
  const unit = (v: Vec2): Vec2 => {
    const length = Math.hypot(v.x, v.y);
    return length === 0 ? { x: 1, y: 0 } : { x: v.x / length, y: v.y / length };
  };
  const quarter = Math.PI / 4;
  // Which way the outline is going at each cut: out from the edge, towards the
  // tip along it, back in — and between those, as it is going there.
  const going = (k: number): Vec2 => {
    if (k === 0) return unit(out);
    if (k === 2) return unit({ x: -half.x, y: -half.y });
    if (k === 4) return unit({ x: -out.x, y: -out.y });
    const a = at(k * quarter - 1e-4);
    const b = at(k * quarter + 1e-4);
    return unit({ x: b.x - a.x, y: b.y - a.y });
  };
  const pieces: PlannedPiece[] = [];
  const STEPS = 16;
  for (let k = 0; k < 4; k++) {
    const points: Vec2[] = [];
    for (let i = 0; i <= STEPS; i++) points.push(at((k + i / STEPS) * quarter));
    if (k === 0) points[0] = from;
    if (k === 3) points[STEPS] = to;
    pieces.push({ curve: fitOne(points, going(k), going(k + 1)).curve, line: false });
  }
  for (let k = 1; k < pieces.length; k++) {
    const c = pieces[k]!.curve;
    pieces[k] = { curve: cubic(pieces[k - 1]!.curve.b, c.c1, c.c2, c.b), line: false };
  }
  return pieces;
}

/**
 * What goes between the end of one leg and the start of the next: the pen's edge,
 * followed round from where it reached at the one to where it reaches at the
 * other, and whether that is any way at all.
 *
 * At the end of an open path the next leg is the same stretch coming back, and
 * the pen's edge is followed half way round it, in front of the path. At a
 * corner it is followed by as much as the path turned and the way it turned,
 * which on the inside of the corner is backwards — and is what keeps the line
 * from going round anything the wrong way.
 *
 * An oval's edge is two curves, each a quarter of it at most. A broad edge's is
 * the nib itself, a straight line from one end to the other, or nothing.
 */
function joinOf(
  master: StrokeMaster,
  profiles: readonly PenProfile[],
  leg: Leg,
  next: Leg,
  before: readonly PlannedPiece[],
  after: readonly PlannedPiece[],
): { pieces: PlannedPiece[]; turns: boolean } {
  const from = before[before.length - 1]!.curve.b;
  const to = after[0]!.curve.a;
  const uTurn = leg.index === next.index && leg.forward !== next.forward && !master.closed;

  const pen = profiles[leg.index]!.at(leg.forward ? 1 : 0);
  if (isBroad(pen)) {
    const apart = Math.hypot(to.x - from.x, to.y - from.y);
    return { pieces: [{ curve: lineAsCubic(from, to), line: true }], turns: uTurn || apart > 1e-9 };
  }

  const arriving = heading(master.curves[leg.index]!, leg, 1);
  const leaving = heading(master.curves[next.index]!, next, 0);
  const curve = master.curves[leg.index]!;
  const centre = leg.forward ? curve.b : curve.a;
  if (arriving === null || leaving === null) {
    return { pieces: [{ curve: lineAsCubic(from, to), line: false }], turns: false };
  }

  // In the space where the pen is a circle, the directions it faces at the two
  // ends; the map there keeps which way round is which.
  const a = pen.width / 2;
  const b = pen.thickness / 2;
  const angle = (pen.angle * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const inward = (r: Vec2): number =>
    Math.atan2(b * (-sin * r.x + cos * r.y), a * (cos * r.x + sin * r.y));
  const outward = (theta: number): Vec2 => {
    const x = a * Math.cos(theta);
    const y = b * Math.sin(theta);
    return { x: centre.x + cos * x - sin * y, y: centre.y + sin * x + cos * y };
  };
  // The direction round the circle at an angle, as the pen has it.
  const round = (theta: number): Vec2 => {
    const x = -a * Math.sin(theta);
    const y = b * Math.cos(theta);
    return { x: cos * x - sin * y, y: sin * x + cos * y };
  };

  const start = inward(rightOf(arriving));
  let sweep = inward(rightOf(leaving)) - start;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  if (uTurn) sweep = Math.PI;

  const pieces: PlannedPiece[] = [];
  for (const half of [0, 1]) {
    const t0 = start + (sweep * half) / 2;
    const t1 = start + (sweep * (half + 1)) / 2;
    const k = (4 / 3) * Math.tan((t1 - t0) / 4);
    const p0 = half === 0 ? from : outward(t0);
    const p1 = half === 1 ? to : outward(t1);
    const d0 = round(t0);
    const d1 = round(t1);
    pieces.push({
      curve: cubic(
        p0,
        { x: p0.x + d0.x * k, y: p0.y + d0.y * k },
        { x: p1.x - d1.x * k, y: p1.y - d1.y * k },
        p1,
      ),
      line: false,
    });
  }
  return { pieces, turns: uTurn || Math.abs(sweep) > TURN };
}
