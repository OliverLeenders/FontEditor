import { type Cubic, cubic, curvature, derivative, endTangent, evaluate } from "./cubic.js";
import type { Vec2 } from "./vec2.js";

/**
 * A corner whose curvature changes continuously: the squircle.
 *
 * A rounded corner drawn as a circular arc meets its straight sides with a jump
 * in curvature — nothing on the straight, one over the radius on the arc — and the
 * eye reads the jump as a kink where the round begins. The corner every
 * application icon has been drawn with for a decade spends more of each side on
 * the round and ramps the curvature up from nothing instead, so there is no place
 * where it begins.
 *
 * Two shapes of join are made here. A *corner* — two sides meeting at an angle —
 * is rounded with a ramp out of each side, a circular arc between them, and the
 * ramps take a share of the turn set by `smoothness`: none is a plain circular
 * round, all of it is ramps meeting in the middle. A *tangent* join — a curve
 * running into a straight line along it — has no corner to round, and there one
 * cubic replaces the last of the curve and the first of the line, arriving on the
 * line with no curvature, so the curve settles into the line rather than hitting
 * it.
 *
 * The ramp is the construction the rounded rectangles of the last decade use: a
 * cubic whose first three control points lie on the side, which is what makes its
 * curvature nothing where it leaves the side, and whose last two leave the arc
 * along its tangent, with the handle between them sized so its curvature there is
 * the arc's. The circle is the one a plain round of the same radius would use, so
 * with no smoothness this is exactly the plain round.
 */

export type CornerShape = {
  /** How much of each side the join spends, as distance along the side. */
  readonly size: number;
  /** From nought, a plain circular round, to one, a round that is all ramp. */
  readonly smoothness: number;
};

/** A piece of the join, and whether it is a straight line. */
export type JoinPiece = { readonly curve: Cubic; readonly line: boolean };

/**
 * A join between two curves that meet at a point: where on each the join takes
 * over, as parameters, and the pieces that replace the two stretches it takes.
 */
export type ContinuousJoin = {
  /** The parameter on the incoming curve where the join begins. */
  readonly before: number;
  /** The parameter on the outgoing curve where the join ends. */
  readonly after: number;
  readonly pieces: readonly JoinPiece[];
  /**
   * The side whose end is worked out rather than set by the size, if either: at
   * a tangent join, the straight side, which the ramp spends as much of as it
   * needs to settle without overshooting.
   */
  readonly derived?: "before" | "after";
};

/** Below this turn, in radians, two curves meet along one direction: a tangent join. */
const TANGENT_TURN = 0.5 * (Math.PI / 180);

/**
 * The continuous join between a curve that arrives at a point and one that leaves
 * it, spending `shape.size` of each.
 *
 * `null` where there is nothing to do or nothing sensible to draw: two straight
 * lines in one line, two curves meeting smoothly (holding the curvature there is
 * the held node's work, not this), sides whose directions never meet ahead of the
 * cut, or a tangent join whose one cubic would need a handle pointing backwards.
 */
export function continuousJoin(
  incoming: Cubic,
  outgoing: Cubic,
  incomingStraight: boolean,
  outgoingStraight: boolean,
  shape: CornerShape,
): ContinuousJoin | null {
  if (!(shape.size > 0)) return null;

  const before = parameterAtDistance(incoming, shape.size, true);
  const after = parameterAtDistance(outgoing, shape.size, false);
  const start = evaluate(incoming, before);
  const end = evaluate(outgoing, after);
  const leaving = directionAt(incoming, before);
  const arriving = directionAt(outgoing, after);
  const atIn = endTangent(incoming, 1);
  const atOut = endTangent(outgoing, 0);
  if (leaving === null || arriving === null || atIn === null || atOut === null) return null;

  const turnAtPoint = Math.atan2(Math.abs(cross(atIn, atOut)), dot(atIn, atOut));
  if (turnAtPoint < TANGENT_TURN) {
    // Along one direction at the point. Only a curve running into a line has a
    // curvature to settle: two lines are one line, and two curves are the held
    // node's business.
    if (incomingStraight === outgoingStraight) return null;
    return outgoingStraight
      ? curveIntoLine(incoming, before, outgoing)
      : lineIntoCurve(incoming, outgoing, after);
  }

  const pieces = cornerJoin(start, leaving, end, arriving, shape.smoothness);
  return pieces === null ? null : { before, after, pieces };
}

/**
 * A curve running into a straight line along it: the last of the curve, from
 * parameter `before`, and as much of the line as the ramp needs, replaced by the
 * ramp — arriving on the line with no curvature, leaving the curve with its own.
 */
function curveIntoLine(incoming: Cubic, before: number, outgoing: Cubic): ContinuousJoin | null {
  const start = evaluate(incoming, before);
  const leaving = directionAt(incoming, before);
  const along = endTangent(outgoing, 0);
  const k = Math.abs(curvature(incoming, before) ?? 0);
  if (leaving === null || along === null || !(k > 1e-12)) return null;

  const piece = rampTo(outgoing.a, along, start, leaving, k, 1);
  if (piece === null) return null;
  const spent = dot(sub(piece.a, outgoing.a), along);
  const length = distanceTo(outgoing.a, outgoing.b);
  if (!(spent > 1e-9 && spent < length)) return null;
  return {
    before,
    after: parameterAtDistance(outgoing, spent, false),
    pieces: [{ curve: reversed(piece), line: false }],
    derived: "after",
  };
}

/** A straight line running into a curve along it: the mirror of {@link curveIntoLine}. */
function lineIntoCurve(incoming: Cubic, outgoing: Cubic, after: number): ContinuousJoin | null {
  const end = evaluate(outgoing, after);
  const arriving = directionAt(outgoing, after);
  const along = endTangent(incoming, 1);
  const k = Math.abs(curvature(outgoing, after) ?? 0);
  if (arriving === null || along === null || !(k > 1e-12)) return null;

  const back = { x: -arriving.x, y: -arriving.y };
  const piece = rampTo(incoming.b, along, end, back, k, -1);
  if (piece === null) return null;
  const spent = dot(sub(incoming.b, piece.a), along);
  const length = distanceTo(incoming.a, incoming.b);
  if (!(spent > 1e-9 && spent < length)) return null;
  return {
    before: parameterAtDistance(incoming, spent, true),
    after,
    pieces: [{ curve: piece, line: false }],
    derived: "before",
  };
}

/**
 * The ramp from a line into a point `end` where a curve has curvature `k`: in
 * travel order from the line, a point on the line, two more on it, and `end`.
 *
 * The line runs through `through` along `along`. `toward` is the direction
 * from `end` along its tangent to where that tangent meets the line, which is
 * the ramp's third point; `away` says which way along the line from there the
 * ramp's far end lies, +1 along it and −1 back. Its second point is the handle
 * that gives `end` the curvature `k` from the third, and its first further by
 * as much as keeps the curvature rising all the way — see {@link rampReach}.
 */
function rampTo(
  through: Vec2,
  along: Vec2,
  end: Vec2,
  toward: Vec2,
  k: number,
  away: 1 | -1,
): Cubic | null {
  const turn = cross(toward, along);
  if (Math.abs(turn) < 1e-9) return null;
  const reach = cross(sub(through, end), along) / turn;
  if (!(reach > 1e-9)) return null;
  const meet = { x: end.x + toward.x * reach, y: end.y + toward.y * reach };
  const direction = { x: along.x * away, y: along.y * away };
  return ramp(meet, direction, end, k, Math.abs(turn));
}

/**
 * A ramp cubic: `meet` on the line is its third point, its second is `handle`
 * further along `direction`, and its first further still, as far as keeps the
 * curvature rising from nothing at the line to `k` at `end`.
 */
function ramp(meet: Vec2, direction: Vec2, end: Vec2, k: number, sine: number): Cubic | null {
  const a = distanceTo(meet, end);
  const handle = (1.5 * k * a * a) / sine;
  if (!(handle > 0) || !Number.isFinite(handle)) return null;
  const at = (distance: number): Vec2 => ({
    x: meet.x + direction.x * distance,
    y: meet.y + direction.y * distance,
  });
  const spread = rampReach((lambda) => cubic(at(handle * (1 + lambda)), at(handle), meet, end));
  return cubic(at(handle * (1 + spread)), at(handle), meet, end);
}

/** The spreads a ramp's first handle is tried at, as multiples of its second. */
const RAMP_SPREAD_LEAST = 0.1;
const RAMP_SPREAD_MOST = 4;
const RAMP_SPREAD_STEP = 0.05;

/** How much more overshoot than the least a gentler ramp is allowed. */
const RAMP_SLACK = 0.005;

/**
 * How far past its second point a ramp's first reaches, as a multiple of the
 * handle between its second and third.
 *
 * The ramp's curvature has to go from nothing at the line to what the curve or
 * arc it runs into has at its end, and one cubic cannot always do that without
 * going past the end's curvature and coming back down to it — which a comb shows
 * as a horn where the ramp meets the round. Too short a first handle and it
 * shoots up at the line instead. So the spreads are tried in steps, and the one
 * whose curvature goes least past the end's is taken — the longest of those within
 * a hair of the least, since a longer ramp eases the curvature up more gently.
 */
function rampReach(build: (spread: number) => Cubic): number {
  const overshoot = (spread: number): number => {
    const c = build(spread);
    const end = Math.abs(curvature(c, 1) ?? 0);
    if (!(end > 0)) return Infinity;
    // How far it goes past the end's curvature, and how much it falls back on the
    // way up: either shows in a comb as a ripple.
    let most = 0;
    let last = 0;
    let falls = 0;
    for (let i = 1; i < RAMP_SAMPLES; i++) {
      const k = Math.abs(curvature(c, i / RAMP_SAMPLES) ?? 0);
      most = Math.max(most, k);
      if (k < last) falls += last - k;
      last = k;
    }
    return (Math.max(most, end) + falls) / end;
  };
  const tried: { spread: number; over: number }[] = [];
  for (let s = RAMP_SPREAD_LEAST; s <= RAMP_SPREAD_MOST + 1e-9; s += RAMP_SPREAD_STEP) {
    tried.push({ spread: s, over: overshoot(s) });
  }
  const least = Math.min(...tried.map((t) => t.over));
  let best = RAMP_SPREAD_LEAST;
  for (const t of tried) if (t.over <= least + RAMP_SLACK) best = t.spread;
  return best;
}

/** How many places a ramp's curvature is checked at. */
const RAMP_SAMPLES = 32;

/**
 * A rounded corner between two sides, leaving `start` along `leaving` and
 * arriving at `end` along `arriving`: ramp, arc, ramp.
 *
 * Worked in the frame of the two directions: the lines they run along meet at a
 * vertex, and the round is built against those lines. On straight sides that is
 * exact; on a curved side the round leaves the curve along its direction, and
 * where the two sides are cut at different distances from the vertex the longer
 * one keeps a straight stretch along its direction up to where the round begins.
 */
function cornerJoin(
  start: Vec2,
  leaving: Vec2,
  end: Vec2,
  arriving: Vec2,
  smoothness: number,
): JoinPiece[] | null {
  const turnSine = cross(leaving, arriving);
  if (Math.abs(turnSine) < 1e-12) return null;
  // Where the two directions meet: start + u·leaving = end − v·arriving.
  const chord = { x: end.x - start.x, y: end.y - start.y };
  const u = cross(chord, arriving) / turnSine;
  const v = cross(leaving, chord) / turnSine;
  if (!(u > 1e-9 && v > 1e-9)) return null;
  const vertex = { x: start.x + leaving.x * u, y: start.y + leaving.y * u };

  const theta = Math.atan2(Math.abs(turnSine), dot(leaving, arriving));
  const half = theta / 2;
  const xi = Math.min(1, Math.max(0, smoothness));
  const reach = Math.min(u, v);
  const phi = (theta * xi) / 2;
  const ramps = phi > 1e-6;

  // The round worked out for a radius of one, which says how much of a side it
  // spends per unit of radius; the radius is then whatever makes that the size.
  // For one, the ramp is found in a frame where the circle touches the line at the
  // origin and the line runs along x: the ramp ends φ round the circle, its third
  // point where the tangent there meets the line, tan(φ/2) along.
  let perRadius = Math.tan(half);
  let spread = 0;
  if (ramps) {
    const shortfall1 = Math.tan(phi / 2);
    const handle1 = (1.5 * shortfall1 * shortfall1) / Math.sin(phi);
    const end1 = { x: Math.sin(phi), y: 1 - Math.cos(phi) };
    const at1 = (distance: number): Vec2 => ({ x: shortfall1 - distance, y: 0 });
    spread = rampReach((lambda) => cubic(at1(handle1 * (1 + lambda)), at1(handle1), at1(0), end1));
    perRadius = Math.tan(half) - shortfall1 + handle1 * (1 + spread);
  }
  const radius = reach / perRadius;
  const touch = radius * Math.tan(half);
  const reachAt = reach;
  const sign = turnSine > 0 ? 1 : -1;

  const inward = unit({ x: arriving.x - leaving.x, y: arriving.y - leaving.y });
  if (inward === null) return null;
  const centre = {
    x: vertex.x + (inward.x * radius) / Math.cos(half),
    y: vertex.y + (inward.y * radius) / Math.cos(half),
  };
  const onIn = (distance: number): Vec2 => ({
    x: vertex.x - leaving.x * distance,
    y: vertex.y - leaving.y * distance,
  });
  const onOut = (distance: number): Vec2 => ({
    x: vertex.x + arriving.x * distance,
    y: vertex.y + arriving.y * distance,
  });
  const onCircle = (from: Vec2, angle: number): Vec2 => {
    const r = rotate({ x: from.x - centre.x, y: from.y - centre.y }, angle);
    return { x: centre.x + r.x, y: centre.y + r.y };
  };

  const pieces: JoinPiece[] = [];

  if (u > reachAt + 1e-9) pieces.push({ curve: straight(start, onIn(reachAt)), line: true });

  let arcFrom = onIn(touch);
  let rampOut: Cubic | null = null;
  if (ramps) {
    // The ramp's handle between its last two points, sized so its curvature
    // where it meets the arc is the arc's: L = 3r·tan²(φ/2) / (2 sin φ); and its
    // first handle the multiple of that found for a radius of one.
    const shortfall = radius * Math.tan(phi / 2);
    const handle = (1.5 * radius * Math.tan(phi / 2) ** 2) / Math.sin(phi);
    arcFrom = onCircle(onIn(touch), sign * phi);
    const arcTo = onCircle(onOut(touch), -sign * phi);
    const far = touch - shortfall + handle * (1 + spread);
    pieces.push({
      curve: cubic(onIn(far), onIn(touch - shortfall + handle), onIn(touch - shortfall), arcFrom),
      line: false,
    });
    rampOut = cubic(arcTo, onOut(touch - shortfall), onOut(touch - shortfall + handle), onOut(far));
  }

  pieces.push(...arc(centre, radius, arcFrom, theta - 2 * phi, sign));
  if (rampOut !== null) pieces.push({ curve: rampOut, line: false });
  if (v > reachAt + 1e-9) pieces.push({ curve: straight(onOut(reachAt), end), line: true });
  return pieces;
}

/** A circular arc from `from` turning `sweep` radians about `centre`, in quarter turns at most. */
function arc(centre: Vec2, radius: number, from: Vec2, sweep: number, sign: number): JoinPiece[] {
  if (!(sweep > 1e-6)) return [];
  const count = Math.ceil(sweep / (Math.PI / 2));
  const step = sweep / count;
  const handle = (4 / 3) * Math.tan(step / 4) * radius;
  const out: JoinPiece[] = [];
  let a = from;
  for (let i = 0; i < count; i++) {
    const radial = { x: a.x - centre.x, y: a.y - centre.y };
    const next = rotate(radial, sign * step);
    const b = { x: centre.x + next.x, y: centre.y + next.y };
    // Along the direction of travel: the radius turned a quarter the way the arc turns.
    const ta = unit(rotate(radial, (sign * Math.PI) / 2))!;
    const tb = unit(rotate(next, (sign * Math.PI) / 2))!;
    out.push({
      curve: cubic(
        a,
        { x: a.x + ta.x * handle, y: a.y + ta.y * handle },
        { x: b.x - tb.x * handle, y: b.y - tb.y * handle },
        b,
      ),
      line: false,
    });
    a = b;
  }
  return out;
}

/** How many chords a curve is measured by, for distance along it. */
const CHORDS = 64;

/**
 * The parameter a distance along a curve from its start — or back from its end —
 * measured over chords. A distance beyond the curve's length is its other end.
 */
export function parameterAtDistance(s: Cubic, distance: number, fromEnd: boolean): number {
  const table = new Float64Array(CHORDS + 1);
  let last = s.a;
  for (let k = 1; k <= CHORDS; k++) {
    const p = evaluate(s, k / CHORDS);
    table[k] = table[k - 1]! + Math.hypot(p.x - last.x, p.y - last.y);
    last = p;
  }
  const total = table[CHORDS]!;
  if (!(total > 0)) return fromEnd ? 0 : 1;
  const target = fromEnd ? total - distance : distance;
  if (target <= 0) return 0;
  if (target >= total) return 1;
  let k = 1;
  while (table[k]! < target) k++;
  const f = (target - table[k - 1]!) / (table[k]! - table[k - 1]!);
  return (k - 1 + f) / CHORDS;
}

/** The unit direction of travel at `t`, the limit one at an end whose handle is retracted. */
function directionAt(s: Cubic, t: number): Vec2 | null {
  if (t <= 0) return endTangent(s, 0);
  if (t >= 1) return endTangent(s, 1);
  return unit(derivative(s, t));
}

function straight(a: Vec2, b: Vec2): Cubic {
  return cubic(
    a,
    { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
    { x: a.x + ((b.x - a.x) * 2) / 3, y: a.y + ((b.y - a.y) * 2) / 3 },
    b,
  );
}

const cross = (p: Vec2, q: Vec2): number => p.x * q.y - p.y * q.x;
const sub = (p: Vec2, q: Vec2): Vec2 => ({ x: p.x - q.x, y: p.y - q.y });
const distanceTo = (p: Vec2, q: Vec2): number => Math.hypot(p.x - q.x, p.y - q.y);
const reversed = (s: Cubic): Cubic => cubic(s.b, s.c2, s.c1, s.a);
const dot = (p: Vec2, q: Vec2): number => p.x * q.x + p.y * q.y;
const rotate = (p: Vec2, angle: number): Vec2 => ({
  x: p.x * Math.cos(angle) - p.y * Math.sin(angle),
  y: p.x * Math.sin(angle) + p.y * Math.cos(angle),
});
function unit(v: Vec2): Vec2 | null {
  const len = Math.hypot(v.x, v.y);
  return len === 0 || !Number.isFinite(len) ? null : { x: v.x / len, y: v.y / len };
}
