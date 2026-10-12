import type { Cubic, PenShape } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import { STROKE_CASES } from "../../geometry/test/stroke-cases.js";
import { disagreement, sweep } from "../../geometry/test/sweep.js";
import { type Contour, segmentAt, segmentCount, segmentCubic } from "../src/contour.js";
import { contourOfCurves } from "../src/curves.js";
import { counterIds } from "../src/ids.js";
import { inkOf, inkRegions, plannedInk } from "../src/stroke.js";

/**
 * A pen of corners that turns along the stroke: a rectangle, or a broad edge.
 *
 * An edge of a pen that turns pivots, and between the instant one of its
 * corners stops drawing the side and the instant the next begins, the edge of
 * the ink is the place the edge pivots on, sliding from the one corner to the
 * other. What is asked is that the one line made of those — a corner's path,
 * the pivot's, the next corner's — filled, is the pen swept along the path.
 */

const ids = counterIds("turning");

const SIZES: readonly (readonly [number, number])[] = [
  [50, 24],
  [110, 46],
  [70, 60],
  [36, 20],
  [90, 30],
];
/** A pen for each point in turn, each turned `turn` degrees on from the last. */
const pensFor = (count: number, kind: "box" | "broad", turn: number): PenShape[] =>
  Array.from({ length: count }, (_, i) => {
    const [width, thickness] = SIZES[i % SIZES.length]!;
    return kind === "box"
      ? { angle: 10 + i * turn, width, thickness, squareness: 1 }
      : { angle: 10 + i * turn, width, thickness: 0 };
  });

const strokeOf = (
  curves: readonly Cubic[],
  closed: boolean,
  pens: readonly PenShape[],
): Contour => {
  const skeleton = contourOfCurves(
    curves.map((curve) => ({ curve, line: false })),
    ids,
    closed,
  );
  return {
    ...skeleton,
    nib: pens[0]!,
    nodes: skeleton.nodes.map((n, i) => ({ ...n, pen: pens[i % pens.length]! })),
  };
};

const loopsOf = (contours: readonly Contour[]): Cubic[][] =>
  contours.map((o) => {
    const out: Cubic[] = [];
    for (let i = 0; i < segmentCount(o); i++) {
      const s = segmentAt(o, i);
      if (s !== null) out.push(segmentCubic(s));
    }
    return out;
  });

const named = (name: string) => STROKE_CASES.find((c) => c.name === name)!;

describe.each(["box", "broad"] as const)("a pen of corners turning along a stroke: %s", (kind) => {
  const cases = [
    "an oval pen round a sharp V",
    "an oval pen along an S",
    "a pen widening along a line",
    "a drawn J with a sharp corner",
    "an oval pen round a closed square",
  ].map(named);

  it.each(cases)("is the one line round its ink: $name", { timeout: 480_000 }, (c) => {
    for (const turn of [12, 35]) {
      const pens = pensFor(c.closed ? c.curves.length : c.curves.length + 1, kind, turn);
      const stroke = strokeOf(c.curves, c.closed, pens);
      const truth = sweep(c.curves, pens, c.closed);
      const regions = inkRegions(stroke);
      // One line for an open path, two for a closed one: no pieces to join.
      expect(regions.length, `turning ${String(turn)}`).toBe(c.closed ? 2 : 1);

      const d = disagreement(loopsOf(regions), truth, 70);
      expect(d.checked).toBeGreaterThan(500);
      expect(d.missing, `turning ${String(turn)}`).toEqual([]);
      expect(d.extra, `turning ${String(turn)}`).toEqual([]);

      const joined = disagreement(loopsOf(inkOf(stroke, ids)), truth, 70);
      expect(joined.missing, `joined, turning ${String(turn)}`).toEqual([]);
      expect(joined.extra, `joined, turning ${String(turn)}`).toEqual([]);
    }
  });
});

describe("a pen of corners turning along a stroke", () => {
  it("is drawn in a few curves: a corner's path, the pivot's, the next corner's", () => {
    const line = named("a pen widening along a line");
    const pens = pensFor(2, "box", 12);
    const planned = plannedInk([strokeOf(line.curves, false, pens)], ids);
    expect(planned).not.toBeNull();
    // Three to a side, and the three edges of the pen at each end.
    expect(planned![0]![0]!.nodes.length).toBeLessThanOrEqual(12);
  });

  it(
    "is drawn the other way where it pivots through the end of the path",
    {
      timeout: 240_000,
    },
    () => {
      // Turning fast enough that the nib is still pivoting as the path ends:
      // nothing to follow there, and the ink is made as it was before.
      const j = named("a drawn J with a sharp corner");
      const pens = pensFor(j.curves.length + 1, "broad", -60);
      const stroke = strokeOf(j.curves, false, pens);
      expect(plannedInk([stroke], ids)).toBeNull();
      const d = disagreement(loopsOf(inkRegions(stroke)), sweep(j.curves, pens, false), 70);
      expect(d.missing).toEqual([]);
      expect(d.extra).toEqual([]);
    },
  );
});

describe("a pen of corners turning along a stroke, in two masters", () => {
  // The pen turned twelve degrees on at each point, and in the bold more than
  // twice the size: so a corner the light pen comes to just before the end of
  // a stretch the bold may come to just after it, or not at all.
  const pensOf = (c: { curves: readonly Cubic[] }, kind: "box" | "broad", scale: number) =>
    pensFor(c.curves.length + 1, kind, 12).map((pen) => ({
      ...pen,
      width: pen.width * scale,
      thickness: pen.thickness * scale,
    }));
  const cases = (["box", "broad"] as const).flatMap((kind) =>
    ["a pen widening along a line", "a drawn J with a sharp corner"].map(
      (name) => [kind, name] as const,
    ),
  );

  it.each(cases)(
    "is one plan, by its corners, and each master's ink: %s, %s",
    { timeout: 480_000 },
    (kind, name) => {
      const s = named(name);
      const pens = (k: "box" | "broad", scale: number): PenShape[] => pensOf(s, k, scale);
      const light = strokeOf(s.curves, false, pens(kind, 0.6));
      const bold = strokeOf(s.curves, false, pens(kind, 1.4));
      // By its corners or not at all: not the plan fitted to the pen's reach.
      const planned = plannedInk([light, bold], ids, true);
      expect(planned).not.toBeNull();
      expect(planned![0]![0]!.nodes).toHaveLength(planned![1]![0]!.nodes.length);
      for (const [at, scale] of [0.6, 1.4].entries()) {
        const d = disagreement(
          loopsOf(planned![at]!),
          sweep(s.curves, pens(kind, scale), false),
          70,
        );
        expect(d.checked).toBeGreaterThan(500);
        expect(d.missing).toEqual([]);
        expect(d.extra).toEqual([]);
      }
    },
  );
});
