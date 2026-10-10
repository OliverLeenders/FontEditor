import {
  type Cubic,
  cubic,
  endTangent,
  evaluate,
  lineAsCubic,
  reverse,
  subcurve,
  tangent,
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
        if (turns) loop.push(...joins[at]!.pieces);
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
