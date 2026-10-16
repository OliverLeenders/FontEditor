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

  it("follows a broad edge that turns along the path, which pivots on itself", () => {
    // Its two ends' paths, and between them the path of the place it pivots on.
    const c = named("a broad nib turning along a curve");
    const planned = plannedStrokes([master(c)]);
    expect(planned).not.toBeNull();
    const d = disagreement(
      planned![0]!.map((loop) => loop.map((piece) => piece.curve)),
      sweep(c.curves, c.pens, c.closed, c.blends),
      60,
    );
    expect(d.checked).toBeGreaterThan(500);
    expect(d.missing).toEqual([]);
    expect(d.extra).toEqual([]);
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

  it("follows a hairpin narrower than the pen, its curves where its side swings", () => {
    // The path turns half round in a few hundredths of its length, and in that
    // sliver the inner side swings across the far half of the pen. No even
    // number of curves follows it, and the stroke was the default master's
    // ink at every weight; curves halved where they stray, in both masters at
    // once, do.
    const c = named("a round pen round a hairpin");
    const masters: StrokeMaster[] = [1, 1.6].map((wide) => ({
      curves: c.curves,
      pens: [
        { angle: 10, width: 50 * wide, thickness: 24 * wide, squareness: 0 },
        { angle: 45, width: 110 * wide, thickness: 46 * wide, squareness: 0 },
      ],
      closed: false,
    }));
    const planned = plannedStrokes(masters);
    expect(planned).not.toBeNull();
    expect(shapeOf(planned![0]!)).toBe(shapeOf(planned![1]!));
    for (const [at, m] of masters.entries()) {
      const d = disagreement(curvesOf(planned![at]!), sweep(m.curves, m.pens, m.closed), 70);
      expect(d.checked).toBeGreaterThan(1000);
      expect(d.missing).toEqual([]);
      expect(d.extra).toEqual([]);
    }
  });

  it("declines masters whose paths have not the same number of curves", () => {
    const one = master(named("a round pen round a sharp V"));
    expect(plannedStrokes([one, { ...one, curves: one.curves.slice(0, 1) }])).toBeNull();
  });

  it("draws an oval in one master and a broad edge in another to one plan", () => {
    // The broad edge drawn as the thinnest oval: the same pieces as the oval
    // master's, and its ink within a unit of the broad edge's own.
    const one = master(named("an oval pen round a sharp V"));
    const other = master(named("a broad nib round a sharp V"));
    const planned = plannedStrokes([one, other]);
    expect(planned).not.toBeNull();
    expect(shapeOf(planned![0]!)).toBe(shapeOf(planned![1]!));
    for (const [at, m] of [one, other].entries()) {
      const d = disagreement(curvesOf(planned![at]!), sweep(m.curves, m.pens, m.closed), 70);
      expect(d.checked).toBeGreaterThan(1000);
      expect(d.missing).toEqual([]);
      expect(d.extra).toEqual([]);
    }
  });

  it("draws a broad edge beside a rectangle as a rectangle", () => {
    // A rectangle with no thickness is a broad edge, so it is drawn by the
    // corners as the rectangle is, and exactly.
    const c = named("a broad nib round a sharp V");
    const box: StrokeMaster = {
      ...master(c),
      pens: c.pens.map((pen) => ({ ...pen, thickness: 30, squareness: 1 })),
    };
    const planned = plannedStrokes([master(c), box]);
    expect(planned).not.toBeNull();
    for (const [at, m] of [master(c), box].entries()) {
      const d = disagreement(curvesOf(planned![at]!), sweep(m.curves, m.pens, m.closed), 70);
      expect(d.missing).toEqual([]);
      expect(d.extra).toEqual([]);
    }
  });
});

describe("a pen held and then changed at a point, in two masters", () => {
  // The stroke is two that meet at the point, each with its pen standing whole
  // there: the one arriving holding its pen, the one leaving with the next.
  const SIZES = [
    [50, 24],
    [110, 46],
    [70, 60],
    [36, 20],
  ] as const;
  const pensFor = (count: number, wide: number, kind: "oval" | "box"): PenShape[] =>
    Array.from({ length: count }, (_, i) => {
      const [width, thickness] = SIZES[i % SIZES.length]!;
      return {
        angle: 10 + i * 30,
        width: width * wide,
        thickness: thickness * wide,
        squareness: kind === "box" ? 1 : 0,
      };
    });
  const cases = [
    ["an oval pen turning and swelling round a corner", "oval", { angle: "step", shape: "linear" }],
    ["a drawn J with a sharp corner", "oval", { angle: "linear", shape: "step" }],
    ["a zigzag with a broad nib", "box", { angle: "step", shape: "step" }],
    ["an oval pen round a closed square", "oval", { angle: "step", shape: "step" }],
  ] as const;

  // Minutes of sweeping, a minute or two a case: asked for, and run every night.
  it.skipIf(process.env["STROKE_DIAGNOSE"] === undefined).each(cases)(
    "is its ink, the same in both: %s, %s",
    { timeout: 240_000 },
    (name, kind, step) => {
      const c = named(name);
      const n = c.closed ? c.curves.length : c.curves.length + 1;
      // A step on the first segment, and on every other one after.
      const blends = c.curves.map((_, i) => (i % 2 === 0 ? step : undefined));
      const masters: StrokeMaster[] = [1, 1.6].map((wide) => ({
        curves: c.curves,
        pens: pensFor(n, wide, kind),
        closed: c.closed,
        blends,
      }));
      const planned = plannedStrokes(masters);
      expect(planned).not.toBeNull();
      expect(shapeOf(planned![0]!)).toBe(shapeOf(planned![1]!));
      for (const [at, m] of masters.entries()) {
        const d = disagreement(
          curvesOf(planned![at]!),
          sweep(m.curves, m.pens, m.closed, m.blends),
          70,
        );
        expect(d.checked).toBeGreaterThan(1000);
        expect(d.missing).toEqual([]);
        expect(d.extra).toEqual([]);
      }
    },
  );

  it("declines masters that change their pens at different points", () => {
    const c = named("a drawn J with a sharp corner");
    const n = c.curves.length + 1;
    const step = { angle: "step", shape: "linear" } as const;
    const one: StrokeMaster = {
      curves: c.curves,
      pens: pensFor(n, 1, "oval"),
      closed: false,
      blends: [step],
    };
    const other: StrokeMaster = { ...one, blends: [undefined, step] };
    expect(plannedStrokes([one, other])).toBeNull();
  });
});

/**
 * The plans themselves, quickly: that one is made, and is the same in every
 * master. Whether each fills as its pen does is asked of them by the sweeps
 * above and every night; this is what runs on every push.
 */
describe("one plan for every master, made quickly", () => {
  const SIZES = [
    [50, 24],
    [110, 46],
    [70, 60],
    [36, 20],
    [90, 30],
  ] as const;
  const broadPens = (count: number, turn: number, wide: number): PenShape[] =>
    Array.from({ length: count }, (_, i) => ({
      angle: 10 + i * turn,
      width: SIZES[i % SIZES.length]![0] * wide,
      thickness: 0,
    }));
  const planOf = (masters: StrokeMaster[]): string[] => {
    const planned = plannedStrokes(masters);
    expect(planned).not.toBeNull();
    return planned!.map(shapeOf);
  };

  it("is made for a broad edge whose masters turn it by different amounts", () => {
    const c = named("a drawn J with a sharp corner");
    const n = c.curves.length + 1;
    const [one, two] = planOf(
      [12, 32].map((turn, at) => ({
        curves: c.curves,
        pens: broadPens(n, turn, at === 0 ? 1 : 1.6),
        closed: false,
      })),
    );
    expect(one).toBe(two);
  });

  it("is made for a broad edge still pivoting where an open path ends", () => {
    const c = named("a drawn J with a sharp corner");
    const n = c.curves.length + 1;
    const [one, two] = planOf(
      [1, 1.6].map((wide) => ({ curves: c.curves, pens: broadPens(n, -60, wide), closed: false })),
    );
    expect(one).toBe(two);
  });

  it("is made for a broad edge beside an oval, and beside a rectangle", () => {
    const c = named("a drawn J with a sharp corner");
    const n = c.curves.length + 1;
    for (const squareness of [0, 1]) {
      const rounder = broadPens(n, 12, 1.6).map((pen) => ({ ...pen, thickness: 40, squareness }));
      const [one, two] = planOf([
        { curves: c.curves, pens: broadPens(n, 12, 1), closed: false },
        { curves: c.curves, pens: rounder, closed: false },
      ]);
      expect(one).toBe(two);
    }
  });

  it("is made a part at a time where the pen is changed at a point", () => {
    const c = named("a drawn J with a sharp corner");
    const n = c.curves.length + 1;
    const step = { angle: "step", shape: "step" } as const;
    // Changed at the second point and the fourth: three parts, a loop each.
    const blends = [step, undefined, step, undefined];
    const masters: StrokeMaster[] = [1, 1.6].map((wide) => ({
      curves: c.curves,
      pens: broadPens(n, 12, wide).map((pen) => ({ ...pen, thickness: 30 * wide })),
      closed: false,
      blends,
    }));
    const [one, two] = planOf(masters);
    expect(one).toBe(two);
    expect(one!.split(" ")).toHaveLength(3);
  });

  it("is begun at a point the pen changes at, on a closed path", () => {
    const c = named("an oval pen round a closed square");
    const step = { angle: "step", shape: "linear" } as const;
    const masters: StrokeMaster[] = [1, 1.6].map((wide) => ({
      curves: c.curves,
      pens: c.pens.map((pen) => ({ ...pen, width: pen.width * wide })),
      closed: true,
      blends: [undefined, step, undefined, step],
    }));
    const [one, two] = planOf(masters);
    expect(one).toBe(two);
    // Two parts, each open from one point of change to the other.
    expect(one!.split(" ")).toHaveLength(2);
  });
});
