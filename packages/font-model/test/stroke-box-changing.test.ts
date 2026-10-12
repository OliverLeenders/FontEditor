import type { Cubic, PenShape } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import { STROKE_CASES } from "../../geometry/test/stroke-cases.js";
import { disagreement, sweep } from "../../geometry/test/sweep.js";
import { type Contour, segmentAt, segmentCount, segmentCubic } from "../src/contour.js";
import { contourOfCurves } from "../src/curves.js";
import { counterIds } from "../src/ids.js";
import { inkOf, inkRegions } from "../src/stroke.js";

/**
 * A rectangular pen that changes its size along the stroke, held at one angle.
 *
 * Its corners draw the edge of its ink still, each going its own way as the pen
 * grows or shrinks, with the pen's own straight edges across between them. What
 * is asked is that the one line round it, filled, is the pen swept along the
 * path — and that a pen which turns as well is still drawn, the other way.
 */

const ids = counterIds("box-changing");

/** A broad edge of a width for each point in turn, all at one angle. */
const edgesFor = (count: number, angle: number): PenShape[] =>
  Array.from({ length: count }, (_, i) => ({
    angle,
    width: SIZES[i % SIZES.length]![0],
    thickness: 0,
  }));

/** A rectangle of a size for each point in turn, all at one angle. */
const SIZES: readonly (readonly [number, number])[] = [
  [50, 24],
  [110, 46],
  [70, 60],
  [36, 20],
  [90, 30],
];
const pensFor = (count: number, angle: number): PenShape[] =>
  Array.from({ length: count }, (_, i) => {
    const [width, thickness] = SIZES[i % SIZES.length]!;
    return { angle, width, thickness, squareness: 1 };
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

describe("a rectangular pen changing its size along a stroke", () => {
  const cases = [
    "an oval pen round a sharp V",
    "an oval pen along an S",
    "an oval pen round a closed square",
    "a pen widening along a line",
    "a zigzag with a broad nib",
    "a drawn J with a sharp corner",
  ].map((name) => STROKE_CASES.find((c) => c.name === name)!);

  it.each(cases)("is the one line round its ink: $name", { timeout: 240_000 }, (c) => {
    for (const angle of [0, 20, 75]) {
      const pens = pensFor(c.closed ? c.curves.length : c.curves.length + 1, angle);
      const stroke = strokeOf(c.curves, c.closed, pens);
      const regions = inkRegions(stroke);
      // One line for an open path, two for a closed one: no pieces to join.
      expect(regions.length, `at ${String(angle)}`).toBe(c.closed ? 2 : 1);

      const d = disagreement(loopsOf(regions), sweep(c.curves, pens, c.closed), 60);
      expect(d.checked).toBeGreaterThan(500);
      expect(d.missing, `at ${String(angle)}`).toEqual([]);
      expect(d.extra, `at ${String(angle)}`).toEqual([]);

      const joined = disagreement(loopsOf(inkOf(stroke, ids)), sweep(c.curves, pens, c.closed), 60);
      expect(joined.missing, `joined, at ${String(angle)}`).toEqual([]);
      expect(joined.extra, `joined, at ${String(angle)}`).toEqual([]);
    }
  });

  it("has straight sides along a straight stem that tapers", () => {
    const line = STROKE_CASES.find((c) => c.name === "a pen widening along a line")!;
    const pens = pensFor(line.curves.length + 1, 0);
    const ink = inkOf(strokeOf(line.curves, false, pens), ids);
    expect(ink).toHaveLength(1);
    expect(ink[0]!.nodes.every((n) => n.in === null && n.out === null)).toBe(true);
  });

  it("ends on the cut where its foot is cut", () => {
    const line = STROKE_CASES.find((c) => c.name === "a pen widening along a line")!;
    const pens = pensFor(line.curves.length + 1, 20);
    const stroke = strokeOf(line.curves, false, pens);
    const last = stroke.nodes.length - 1;
    const end = stroke.nodes[last]!.pt;
    const cut = {
      ...stroke,
      nodes: stroke.nodes.map((n, i) =>
        i === last ? { ...n, end: { cut: "square" as const } } : n,
      ),
    };
    const before = stroke.nodes[last - 1]!.pt;
    const along = Math.hypot(end.x - before.x, end.y - before.y);
    const past = (p: { x: number; y: number }): number =>
      ((p.x - end.x) * (end.x - before.x) + (p.y - end.y) * (end.y - before.y)) / along;
    const ink = inkOf(cut, ids);
    expect(ink).toHaveLength(1);
    expect(Math.max(...ink[0]!.nodes.map((n) => past(n.pt)))).toBeCloseTo(0, 6);
  });

  it("is drawn the other way where the pen turns as well", () => {
    const s = STROKE_CASES.find((c) => c.name === "an oval pen along an S")!;
    const pens = pensFor(s.curves.length + 1, 0).map((pen, i) => ({ ...pen, angle: i * 25 }));
    const stroke = strokeOf(s.curves, false, pens);
    const d = disagreement(loopsOf(inkRegions(stroke)), sweep(s.curves, pens, false), 60);
    expect(d.missing).toEqual([]);
    expect(d.extra).toEqual([]);
  });
});

describe("a broad edge widening and narrowing along a stroke", () => {
  const cases = [
    "a broad nib round a sharp V",
    "a broad nib along an S, pinching",
    "an oval pen along an S",
    "a zigzag with a broad nib",
    "a drawn J with a sharp corner",
  ].map((name) => STROKE_CASES.find((c) => c.name === name)!);

  it.each(cases)("is the one line round its ink: $name", { timeout: 240_000 }, (c) => {
    for (const angle of [0, 30, 75]) {
      const pens = edgesFor(c.closed ? c.curves.length : c.curves.length + 1, angle);
      const stroke = strokeOf(c.curves, c.closed, pens);
      const truth = sweep(c.curves, pens, c.closed);
      const regions = inkRegions(stroke);
      expect(regions.length, `at ${String(angle)}`).toBe(c.closed ? 2 : 1);

      const d = disagreement(loopsOf(regions), truth, 80);
      expect(d.checked).toBeGreaterThan(300);
      expect(d.missing, `at ${String(angle)}`).toEqual([]);
      expect(d.extra, `at ${String(angle)}`).toEqual([]);

      const joined = disagreement(loopsOf(inkOf(stroke, ids)), truth, 80);
      expect(joined.missing, `joined, at ${String(angle)}`).toEqual([]);
      expect(joined.extra, `joined, at ${String(angle)}`).toEqual([]);
    }
  });
});
