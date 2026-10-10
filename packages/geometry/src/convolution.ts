import {
  type Cubic,
  cubic,
  endTangent,
  evaluate,
  lineAsCubic,
  reverse,
  subcurve,
  tangent,
  unitRoots,
} from "./cubic.js";
import { halfNib, nibTangencies } from "./nib.js";
import {
  type PenProfile,
  type PenShape,
  type SegmentBlend,
  isBroad,
  isSquared,
  penProfiles,
  penSupport,
  samePenShape,
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
 * and an oval in another or a broad edge that changes along the path, a pen
 * that is held and then changed at a point, or a side no number of curves comes
 * near. Whoever asked then draws each master's ink for itself.
 */
export function plannedStrokes(masters: readonly StrokeMaster[]): PlannedPiece[][][] | null {
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

  // A pen with corners has no circle to be made into, which is how the pen's
  // edge is followed round a join here: not yet drawn to one plan.
  if (masters.some((m) => m.pens.some(isSquared))) return null;

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
  // A broad edge that turns or widens along the path pivots on itself, and its
  // ink is not the reach of its two ends: that is left to the other way.
  if (broad && masters.some((m) => m.pens.some((pen) => !samePenShape(pen, m.pens[0]!)))) {
    return null;
  }

  const profiles = masters.map((m) => penProfiles(m.curves, m.pens, m.closed, m.blends));
  if (profiles.some((p) => p.length !== count)) return null;

  // Once round an open path is out along it and back; a closed one is two lines,
  // one each way round.
  const there: Leg[] = first.curves.map((_, index) => ({ index, forward: true }));
  const back: Leg[] = [...there].reverse().map((leg) => ({ ...leg, forward: false }));
  const cycles = first.closed ? [there, back] : [[...there, ...back]];

  const sides = broad ? broadSides(masters) : ovalSides(masters, profiles);
  if (sides === null) return null;

  // The ends that are cut: the side arriving at each and the side leaving it
  // stopped at the cut, and what goes between them in place of the pen's edge.
  const closures = masters.map(() => new Map<string, PlannedPiece[]>());
  for (const [at, m] of masters.entries()) {
    for (const end of ["end", "start"] as const) {
      const cut = cutAt(m, end);
      if (cut === undefined) continue;
      const index = end === "end" ? count - 1 : 0;
      // Out along the right to the far end and back along the left: so the far
      // end is come to forwards, and the near end backwards.
      const arriving: Leg = { index, forward: end === "end" };
      const leaving: Leg = { index, forward: end !== "end" };
      const pen = profiles[at]![index]!.at(end === "end" ? 1 : 0);
      const made = cutTurn(sides[at]!.get(key(arriving))!, sides[at]!.get(key(leaving))!, cut, pen);
      if (made === null) return null;
      sides[at]!.set(key(arriving), made.arriving);
      sides[at]!.set(key(leaving), made.leaving);
      closures[at]!.set(`${key(arriving)}>${key(leaving)}`, made.closure);
    }
  }

  const out: PlannedPiece[][][] = masters.map(() => []);
  for (const cycle of cycles) {
    const loops: PlannedPiece[][] = masters.map(() => []);
    for (const [k, leg] of cycle.entries()) {
      const next = cycle[(k + 1) % cycle.length]!;
      const joins = masters.map((m, at) =>
        joinOf(m, profiles[at]!, leg, next, sides[at]!.get(key(leg))!, sides[at]!.get(key(next))!),
      );
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
  return out;
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
      if (drawn.some((d) => d.some((side) => side === null))) return null;
      chosen = drawn;
      if (worst <= SIDE_TOLERANCE) break;
      if (pieces === SIDE_COUNTS[SIDE_COUNTS.length - 1] && worst > SIDE_LIMIT) return null;
    }
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
  arriving: readonly PlannedPiece[],
  leaving: readonly PlannedPiece[],
  cut: PlannedCut,
  pen: PenShape,
): { arriving: PlannedPiece[]; leaving: PlannedPiece[]; closure: PlannedPiece[] } | null {
  const from = stoppedAt(arriving, cut);
  const to = startedAt(leaving, cut);
  if (from === null || to === null) return null;
  if (!cut.nibbed || isBroad(pen)) {
    return {
      arriving: from.pieces,
      leaving: to.pieces,
      closure: [{ curve: lineAsCubic(from.at, to.at), line: true }],
    };
  }

  const across = Math.hypot(to.at.x - from.at.x, to.at.y - from.at.y);
  const depth = (pen.thickness / 2) * (across / pen.width);
  const short: PlannedCut = {
    ...cut,
    through: { x: cut.through.x - cut.normal.x * depth, y: cut.through.y - cut.normal.y * depth },
  };
  const a = stoppedAt(arriving, short);
  const b = startedAt(leaving, short);
  if (a === null || b === null) return null;

  const facing = cut.normal.x * cut.onward.x + cut.normal.y * cut.onward.y;
  const out = { x: (cut.onward.x / facing) * depth, y: (cut.onward.y / facing) * depth };
  const middle = { x: (a.at.x + b.at.x) / 2, y: (a.at.y + b.at.y) / 2 };
  const half = { x: a.at.x - middle.x, y: a.at.y - middle.y };
  const tip = { x: middle.x + out.x, y: middle.y + out.y };
  const by = (p: Vec2, v: Vec2, k: number): Vec2 => ({ x: p.x + v.x * k, y: p.y + v.y * k });
  return {
    arriving: a.pieces,
    leaving: b.pieces,
    closure: [
      { curve: cubic(a.at, by(a.at, out, QUARTER), by(tip, half, QUARTER), tip), line: false },
      { curve: cubic(tip, by(tip, half, -QUARTER), by(b.at, out, QUARTER), b.at), line: false },
    ],
  };
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
