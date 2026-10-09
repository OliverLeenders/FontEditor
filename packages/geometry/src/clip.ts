import { type Cubic, evaluate, lineAsCubic, subcurve, unitRoots } from "./cubic.js";
import type { Vec2 } from "./vec2.js";

/**
 * A closed loop of curves with everything on one side of a straight line taken
 * off: what is kept is where `(p − through) · normal` is nothing or less.
 *
 * Each curve is cut where it crosses the line — a cubic crosses a line at most
 * three times, and where is the roots of a cubic — and the pieces on the far
 * side are dropped. Where the loop left the near side and came back, the two
 * ends are joined straight along the line. That is all a cut by one line needs,
 * whatever shape the loop is: a loop that crosses the line more than twice comes
 * back with its parts joined by lines that run along the cut and enclose
 * nothing.
 *
 * Empty where the whole loop was on the far side.
 */
export function clipLoop(loop: readonly Cubic[], through: Vec2, normal: Vec2): Cubic[] {
  const side = (p: Vec2): number => (p.x - through.x) * normal.x + (p.y - through.y) * normal.y;

  const kept: Cubic[] = [];
  for (const c of loop) {
    // How far each control point is past the line is the curve's own distance
    // past it, in the same form: so the crossings are that cubic's roots.
    const f0 = side(c.a);
    const f1 = side(c.c1);
    const f2 = side(c.c2);
    const f3 = side(c.b);
    const roots = unitRoots(f3 - 3 * f2 + 3 * f1 - f0, 3 * (f2 - 2 * f1 + f0), 3 * (f1 - f0), f0)
      .filter((t) => t > 1e-9 && t < 1 - 1e-9)
      .sort((a, b) => a - b);
    const cuts = [0, ...roots.filter((t, i) => i === 0 || t - roots[i - 1]! > 1e-9), 1];
    for (let k = 0; k + 1 < cuts.length; k++) {
      const from = cuts[k]!;
      const to = cuts[k + 1]!;
      if (side(evaluate(c, (from + to) / 2)) > 0) continue;
      kept.push(from === 0 && to === 1 ? c : subcurve(c, from, to));
    }
  }
  if (kept.length === 0) return [];

  const out: Cubic[] = [];
  for (const [i, piece] of kept.entries()) {
    const before = kept[(i - 1 + kept.length) % kept.length]!;
    if (Math.hypot(piece.a.x - before.b.x, piece.a.y - before.b.y) > 1e-9) {
      out.push(lineAsCubic(before.b, piece.a));
    }
    out.push(piece);
  }
  return out;
}
