import { describe, expect, it } from "vitest";

import { type PlannedPiece, type StrokeMaster, plannedStrokes } from "../src/convolution.js";
import { type Cubic, cubic } from "../src/cubic.js";
import type { PenShape } from "../src/pen.js";
import type { Vec2 } from "../src/vec2.js";
import { STROKE_CASES, type StrokeCase } from "./stroke-cases.js";
import { disagreement, sweep, winding } from "./sweep.js";

/**
 * A stroke's ink as one line round it, drawn to a plan every master shares.
 *
 * Two things are asked. That the line, filled by the non-zero rule, is the ink:
 * held against the pen swept along the path the slow way, as the other stroker
 * is. And that it is the same line in every master — the same loops of the same
 * pieces, straight where the others are straight — which is all a variable
 * font needs of it and the one thing the other stroker cannot give.
 */

const named = (name: string): StrokeCase => STROKE_CASES.find((c) => c.name === name)!;
const master = (c: StrokeCase): StrokeMaster => ({
  curves: c.curves,
  pens: c.pens,
  closed: c.closed,
  ...(c.blends === undefined ? {} : { blends: c.blends }),
});
const curvesOf = (loops: readonly (readonly PlannedPiece[])[]): Cubic[][] =>
  loops.map((loop) => loop.map((piece) => piece.curve));
const shapeOf = (loops: readonly (readonly PlannedPiece[])[]): string =>
  loops.map((loop) => loop.map((piece) => (piece.line ? "l" : "c")).join("")).join(" ");

const p = (x: number, y: number): Vec2 => ({ x, y });
const pens = (n: number, pen: PenShape): PenShape[] => Array.from({ length: n }, () => pen);

const fillsAsThePenDoes = (c: StrokeCase): void => {
  const planned = plannedStrokes([master(c)]);
  expect(planned).not.toBeNull();
  const d = disagreement(curvesOf(planned![0]!), sweep(c.curves, c.pens, c.closed, c.blends), 45);
  expect(d.checked).toBeGreaterThan(500);
  expect(d.missing).toEqual([]);
  expect(d.extra).toEqual([]);
};

// Every case, which is minutes of sweeping: asked for, as the other stroker's
// whole list is.
describe.skipIf(process.env["STROKE_DIAGNOSE"] === undefined)(
  "the line round every stroke's ink, against the pen swept along it",
  () => {
    it.each(STROKE_CASES.filter((c) => c.name !== "a broad nib turning along a curve"))(
      "fills as the pen does: $name",
      { timeout: 300_000 },
      fillsAsThePenDoes,
    );
  },
);

describe("the line round a stroke's ink, against the pen swept along it", () => {
  // One of each kind of thing the line does: a corner with an oval, a corner
  // and a pinch with a broad nib, a closed path, a pen that changes, a fold.
  it.each(
    [
      "an oval pen round a sharp V",
      "a zigzag with a broad nib",
      "a broad nib along an S, pinching",
      "an oval pen round a closed square",
      "an oval pen turning and swelling round a corner",
      "a thin oval round a bend that folds on the inside",
    ].map(named),
  )("fills as the pen does: $name", { timeout: 120_000 }, fillsAsThePenDoes);

  it.each(
    [
      "an oval pen round a sharp V",
      "a zigzag with a broad nib",
      "a path crossing itself",
      "a thin oval round a bend that folds on the inside",
    ].map(named),
  )("goes round nothing the wrong way: $name", { timeout: 120_000 }, (c) => {
    // What makes it safe to leave the line crossing itself: where it goes round
    // a point more than once it goes round it the same way every time, so no
    // part of it takes away what another part filled.
    const loops = curvesOf(plannedStrokes([master(c)])![0]!);
    const { minX, minY, maxX, maxY } = sweep(c.curves, c.pens, c.closed, c.blends).bounds;
    const step = Math.max(maxX - minX, maxY - minY) / 40;
    let least = Infinity;
    let most = -Infinity;
    for (let y = minY - step; y <= maxY + step; y += step) {
      for (let x = minX - step; x <= maxX + step; x += step) {
        const w = winding(loops, { x: x + 0.013, y: y + 0.007 });
        least = Math.min(least, w);
        most = Math.max(most, w);
      }
    }
    expect(least).toBe(0);
    expect(most).toBeGreaterThanOrEqual(1);
  });

  it("declines a broad edge that turns along the path, which pivots on itself", () => {
    expect(plannedStrokes([master(named("a broad nib turning along a curve"))])).toBeNull();
  });
});

describe("the line round a stroke's ink, in two masters", () => {
  // A light and a bold of one drawn S: the path a little different, the pen
  // more than twice as wide, and thick enough in the bold to fold the inside
  // of the first bend where the light does not.
  const light = named("a thin oval round a bend that folds on the inside");
  const bold: StrokeMaster = {
    curves: light.curves.map((c) =>
      cubic(
        p(c.a.x * 1.1, c.a.y),
        p(c.c1.x * 1.1, c.c1.y),
        p(c.c2.x * 1.1, c.c2.y),
        p(c.b.x * 1.1, c.b.y),
      ),
    ),
    pens: pens(8, { angle: 20, width: 180, thickness: 60 }),
    closed: false,
  };
  const thin: StrokeMaster = {
    ...master(light),
    pens: pens(8, { angle: 30, width: 30, thickness: 8 }),
  };

  it("is the same loops of the same pieces in each", () => {
    const planned = plannedStrokes([thin, master(light), bold])!;
    expect(planned).toHaveLength(3);
    expect(shapeOf(planned[1]!)).toBe(shapeOf(planned[0]!));
    expect(shapeOf(planned[2]!)).toBe(shapeOf(planned[0]!));
    // One line round an open path, and not a great many pieces of it.
    expect(planned[0]).toHaveLength(1);
    expect(planned[0]![0]!.length).toBeLessThan(120);
  });

  // Half a minute of sweeping, so asked for with the rest. What a font holds is
  // asked on every push all the same: fontTools draws the proof font at each
  // weight and the fill is compared there (`tools/otf-check/check_vf_strokes.py`).
  it.skipIf(process.env["STROKE_DIAGNOSE"] === undefined)(
    "is still each master's ink, drawn to the plan they share",
    { timeout: 240_000 },
    () => {
      const planned = plannedStrokes([thin, master(light), bold])!;
      // The two at the ends, the middle one being a case on its own above.
      for (const [at, m] of [thin, master(light), bold].entries()) {
        if (at === 1) continue;
        const d = disagreement(curvesOf(planned[at]!), sweep(m.curves, m.pens, m.closed), 40);
        expect(d.missing).toEqual([]);
        expect(d.extra).toEqual([]);
      }
    },
  );

  it(
    "is the same pieces for a broad nib whose path runs along it in one master only",
    {
      timeout: 120_000,
    },
    () => {
      // A quarter turn drawn with a nib at forty-five degrees crosses the nib's
      // direction half way; with the nib upright it never does.
      const turn = [cubic(p(0, 0), p(0, 110), p(90, 200), p(200, 200))];
      const crossing: StrokeMaster = {
        curves: turn,
        pens: pens(2, { angle: 45, width: 80, thickness: 0 }),
        closed: false,
      };
      const clear: StrokeMaster = {
        curves: turn,
        pens: pens(2, { angle: 135, width: 80, thickness: 0 }),
        closed: false,
      };
      const planned = plannedStrokes([clear, crossing])!;
      expect(shapeOf(planned[0]!)).toBe(shapeOf(planned[1]!));
      for (const [at, m] of [clear, crossing].entries()) {
        const d = disagreement(curvesOf(planned[at]!), sweep(m.curves, m.pens, m.closed), 45);
        expect(d.missing).toEqual([]);
        expect(d.extra).toEqual([]);
      }
    },
  );

  it("declines masters whose paths have not the same number of curves", () => {
    const one = master(named("a round pen round a sharp V"));
    expect(plannedStrokes([one, { ...one, curves: one.curves.slice(0, 1) }])).toBeNull();
  });

  it("declines an oval in one master and a broad edge in another", () => {
    const one = master(named("an oval pen round a sharp V"));
    const other = master(named("a broad nib round a sharp V"));
    expect(plannedStrokes([one, other])).toBeNull();
  });
});
