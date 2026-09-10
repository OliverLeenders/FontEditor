import { type Cubic, type Quadratic, evaluate, evaluateQuadratic, subcurve } from "./cubic.js";
import type { Vec2 } from "./vec2.js";

/**
 * Cubic curves, said in quadratics.
 *
 * TrueType outlines are quadratic: one control point per curve where a cubic
 * has two. A cubic cannot in general be written as a quadratic at all, so this
 * is an approximation — several quadratics per cubic, as many as it takes to
 * come within a tolerance nobody can see.
 *
 * That is the price of the TrueType flavour, and it is worth stating plainly:
 * the drawing is kept in cubics and the conversion happens on the way into the
 * file, exactly as the overlap removal and the direction correction do. What is
 * drawn stays what was drawn, and what is compiled is as close to it as the
 * format allows.
 */

/**
 * How far a converted curve may stray, in design units.
 *
 * One unit, which is the figure every other tool in the type world uses, and
 * measured the way they measure it: the distance between the two curves *at the
 * same parameter*, not the distance from a point on one to the nearest point on
 * the other.
 *
 * The difference matters and is worth knowing. Two curves can lie on top of one
 * another and still be a long way apart at equal parameters, because a
 * quadratic and a cubic run along the same path at different speeds. So this
 * measure always overstates how far the outline actually moved — a run within a
 * unit by this test is within a small fraction of one by eye — and being strict
 * with it costs points for no visible gain.
 */
export const QUADRATIC_TOLERANCE = 1;

/**
 * How many quadratics one cubic may become before the attempt is given up.
 *
 * Nothing in a letter needs more than a handful at the ordinary tolerance; the
 * cap is here so that a curve that cannot converge — a cusp, a loop — ends the
 * search rather than running it to nothing. High enough that a caller asking
 * for a tight tolerance gets it rather than getting the cap.
 */
const MOST = 32;

/**
 * A cubic as a run of quadratics.
 *
 * The cubic is cut into equal pieces and each piece approximated on its own;
 * the number of pieces goes up until the whole run is within tolerance. Trying
 * rather than deriving because the derivation is an inequality that has to
 * assume the worst — measuring what was actually produced gives fewer points
 * for the same fidelity, and the measuring is cheap.
 *
 * A curve that will not come within tolerance in sixteen pieces is returned at
 * sixteen anyway. There is no such curve in a letter: it takes a cusp or a loop
 * to get there, and the answer then is still much closer than the outline is to
 * the pixel grid.
 */
export function toQuadratics(c: Cubic, tolerance: number = QUADRATIC_TOLERANCE): Quadratic[] {
  for (let pieces = 1; pieces < MOST; pieces++) {
    const run = approximate(c, pieces);
    if (within(c, run, tolerance)) return run;
  }
  return approximate(c, MOST);
}

/**
 * The same cubic in several masters, converted to the same number of pieces.
 *
 * This is what a variable TrueType font needs and a static one does not. A
 * delta is the difference between two points, so the two outlines must have the
 * same points in the same order — and converting each master on its own does
 * not give that. The number of quadratics a cubic needs depends on how much it
 * bends, a Black is drawn with more bend than a Light, and the same segment
 * comes out as two pieces in one and three in the other. Two outlines with
 * different point counts have no differences to take.
 *
 * So the count is agreed rather than chosen: the smallest number of pieces that
 * brings *every* master within tolerance, used by all of them. The lightest
 * master carries a point or two it would not have needed on its own, which
 * costs a few bytes and nothing else.
 *
 * `null` where the curves cannot be converted together at all, which for this
 * caller means the glyph has to be written from the default master alone.
 */
export function toQuadraticsTogether(
  curves: readonly Cubic[],
  tolerance: number = QUADRATIC_TOLERANCE,
): Quadratic[][] | null {
  if (curves.length === 0) return null;

  for (let pieces = 1; pieces < MOST; pieces++) {
    const runs = curves.map((c) => approximate(c, pieces));
    if (runs.every((run, i) => within(curves[i]!, run, tolerance))) return runs;
  }

  // Every master at the cap. One of them is outside tolerance — a cusp or a
  // loop — but they still agree about their points, which is what the caller
  // cannot do without.
  return curves.map((c) => approximate(c, MOST));
}

/** The cubic cut into equal pieces, each turned into one quadratic. */
function approximate(c: Cubic, pieces: number): Quadratic[] {
  const out: Quadratic[] = [];

  for (let i = 0; i < pieces; i++) {
    const from = i / pieces;
    const to = (i + 1) / pieces;
    out.push(oneQuadratic(subcurve(c, from, to)));
  }

  return out;
}

/**
 * The single quadratic nearest a cubic.
 *
 * Its control point is where the two end tangents cross: a quadratic's control
 * point is on both of its end tangents by definition, so that crossing is the
 * only candidate that starts and ends in the right direction as well as the
 * right place.
 *
 * Where the tangents are parallel there is no crossing, and the answer is the
 * average of the cubic's own controls — which is what the crossing tends
 * towards as the curve flattens.
 */
function oneQuadratic(c: Cubic): Quadratic {
  const crossing = intersect(
    c.a,
    direction(c.a, [c.c1, c.c2, c.b]),
    c.b,
    direction(c.b, [c.c2, c.c1, c.a]),
  );
  const q = crossing ?? { x: (c.c1.x + c.c2.x) / 2, y: (c.c1.y + c.c2.y) / 2 };

  return { a: c.a, q, b: c.b };
}

/**
 * Whether a run of quadratics stays within tolerance of the cubic.
 *
 * Sampled rather than bounded, and at the same parameter rather than at the
 * nearest point — see the tolerance above for what that measure is and is not.
 * Every piece is checked at several places along itself against the part of the
 * cubic it stands for, and the whole run has to pass: a curve that is close for
 * most of its length and wrong at one end is exactly the failure this exists to
 * catch, and that end is a join between segments where the eye goes.
 */
function within(c: Cubic, run: readonly Quadratic[], tolerance: number): boolean {
  const pieces = run.length;
  // Densely: the acceptance is what decides how many pieces are used, so a
  // sample too coarse to find the worst place accepts a run that is over the
  // tolerance everywhere between the samples.
  const steps = 24;

  for (const [i, quadratic] of run.entries()) {
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const on = evaluateQuadratic(quadratic, t);
      const wanted = evaluate(c, (i + t) / pieces);

      if (Math.hypot(on.x - wanted.x, on.y - wanted.y) > tolerance) return false;
    }
  }

  return true;
}

/**
 * The direction a curve leaves a point in.
 *
 * The first control that is not sitting on the point itself. A curve drawn with
 * a retracted handle has its first control *on* its anchor, and the direction it
 * actually leaves in is towards the second — which is what the derivative says
 * too, once the first term vanishes. Falling back on the average of the controls
 * there put the control point in the middle of the curve rather than on its
 * tangent, and the error was twenty times what it should have been.
 */
function direction(from: Vec2, towards: readonly Vec2[]): Vec2 | null {
  for (const point of towards) {
    const dx = point.x - from.x;
    const dy = point.y - from.y;
    if (dx !== 0 || dy !== 0) return { x: dx, y: dy };
  }
  return null;
}

/** Where two lines cross, or `null` where they are parallel. */
function intersect(a: Vec2, da: Vec2 | null, b: Vec2, db: Vec2 | null): Vec2 | null {
  if (da === null || db === null) return null;

  const denominator = da.x * db.y - da.y * db.x;
  if (Math.abs(denominator) < 1e-12) return null;

  const t = ((b.x - a.x) * db.y - (b.y - a.y) * db.x) / denominator;
  return { x: a.x + da.x * t, y: a.y + da.y * t };
}
