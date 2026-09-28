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
    const piece = tangentJoin(
      start,
      leaving,
      incomingStraight ? 0 : (curvature(incoming, before) ?? 0),
      end,
      arriving,
      outgoingStraight ? 0 : (curvature(outgoing, after) ?? 0),
    );
    return piece === null ? null : { before, after, pieces: [{ curve: piece, line: false }] };
  }

  const pieces = cornerJoin(start, leaving, end, arriving, shape.smoothness);
  return pieces === null ? null : { before, after, pieces };
}

/**
 * One cubic from `start`, leaving along `leaving` with curvature `k0`, to `end`,
 * arriving along `arriving` with curvature `k3` — where one of the two curvatures
 * is nothing, which is the side that is a line.
 *
 * The handle lengths of a cubic fix its end curvatures. With α and β the handle
 * lengths, t₀ and t₃ the end directions and d the chord, κ₀α² = ⅔(t₀×d − β·t₀×t₃)
 * and κ₃β² = ⅔(d×t₃ − α·t₀×t₃). With one curvature nothing, its equation gives one
 * length outright, and the other equation gives the other.
 */
function tangentJoin(
  start: Vec2,
  leaving: Vec2,
  k0: number,
  end: Vec2,
  arriving: Vec2,
  k3: number,
): Cubic | null {
  const d = { x: end.x - start.x, y: end.y - start.y };
  const turn = cross(leaving, arriving);
  if (Math.abs(turn) < 1e-9) return null;
  const c0 = cross(leaving, d);
  const c3 = cross(d, arriving);

  // κ₀α² = ⅔(c₀ − β·turn) and κ₃β² = ⅔(c₃ − α·turn).
  let alpha: number;
  let beta: number;
  if (k3 === 0) {
    alpha = c3 / turn;
    beta = (c0 - 1.5 * k0 * alpha * alpha) / turn;
  } else {
    beta = c0 / turn;
    alpha = (c3 - 1.5 * k3 * beta * beta) / turn;
  }
  if (!(alpha > 0 && beta > 0) || !Number.isFinite(alpha) || !Number.isFinite(beta)) return null;

  return cubic(
    start,
    { x: start.x + leaving.x * alpha, y: start.y + leaving.y * alpha },
    { x: end.x - arriving.x * beta, y: end.y - arriving.y * beta },
    end,
  );
}

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
  // The side spends (1 + ξ) of what a plain round of the same radius would.
  const radius = reach / ((1 + xi) * Math.tan(half));
  const touch = radius * Math.tan(half);
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

  const phi = (theta * xi) / 2;
  const pieces: JoinPiece[] = [];
  const reachAt = (1 + xi) * touch;

  if (u > reachAt + 1e-9) pieces.push({ curve: straight(start, onIn(reachAt)), line: true });

  let arcFrom = onIn(touch);
  const ramps = phi > 1e-6;
  let rampOut: Cubic | null = null;
  if (ramps) {
    // The ramp's handle between its last two points, sized so its curvature
    // where it meets the arc is the arc's: L = 3r·tan²(φ/2) / (2 sin φ).
    const shortfall = radius * Math.tan(phi / 2);
    const handle = Math.min(
      (1.5 * radius * Math.tan(phi / 2) ** 2) / Math.sin(phi),
      (reachAt - (touch - shortfall)) / 2,
    );
    arcFrom = onCircle(onIn(touch), sign * phi);
    const arcTo = onCircle(onOut(touch), -sign * phi);
    pieces.push({
      curve: cubic(
        onIn(reachAt),
        onIn(touch - shortfall + handle),
        onIn(touch - shortfall),
        arcFrom,
      ),
      line: false,
    });
    rampOut = cubic(
      arcTo,
      onOut(touch - shortfall),
      onOut(touch - shortfall + handle),
      onOut(reachAt),
    );
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
const dot = (p: Vec2, q: Vec2): number => p.x * q.x + p.y * q.y;
const rotate = (p: Vec2, angle: number): Vec2 => ({
  x: p.x * Math.cos(angle) - p.y * Math.sin(angle),
  y: p.x * Math.sin(angle) + p.y * Math.cos(angle),
});
function unit(v: Vec2): Vec2 | null {
  const len = Math.hypot(v.x, v.y);
  return len === 0 || !Number.isFinite(len) ? null : { x: v.x / len, y: v.y / len };
}
