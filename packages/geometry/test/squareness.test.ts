import { describe, expect, it } from "vitest";

import { plannedStrokes } from "../src/convolution.js";
import type { Cubic } from "../src/cubic.js";
import { loopArea, reverseLoop } from "../src/nib.js";
import {
  type PenShape,
  blendPen,
  penExponent,
  penPathStroke,
  penProfiles,
  penSupport,
  samePenShape,
} from "../src/pen.js";
import { STROKE_CASES, type StrokeCase } from "./stroke-cases.js";
import { disagreement, sweep, winding } from "./sweep.js";

/**
 * A pen with corners: one more number, from the oval to a rectangle.
 *
 * The pen is asked one thing by everything that draws a stroke — how far it
 * reaches in a direction — so what is asked here is that the answer is the
 * oval's at nought and a rectangle's at one, and that the ink drawn with it is
 * the ink of that shape swept along the path the slow way.
 */

const pen = (squareness: number): PenShape => ({ angle: 0, width: 80, thickness: 40, squareness });
const named = (name: string): StrokeCase => STROKE_CASES.find((c) => c.name === name)!;
const filled = (c: StrokeCase): Cubic[][] =>
  penPathStroke(c.curves, c.pens, c.closed, undefined, c.blends).map((loop) =>
    loopArea(loop) < 0 ? reverseLoop(loop) : loop,
  );

describe("how far a pen with corners reaches", () => {
  it("is the oval's where it has no squareness", () => {
    const oval: PenShape = { angle: 20, width: 80, thickness: 40 };
    for (const u of [0, 0.4, 1.1, 2.5, 4]) {
      const d = { x: Math.cos(u), y: Math.sin(u) };
      expect(penSupport({ ...oval, squareness: 0 }, d)).toEqual(penSupport(oval, d));
    }
    expect(penExponent(oval)).toBe(2);
  });

  it("is its half-width along it and its half-thickness across it, however square", () => {
    for (const s of [0, 0.3, 0.7, 1]) {
      expect(penSupport(pen(s), { x: 1, y: 0 }).x).toBeCloseTo(40, 9);
      expect(penSupport(pen(s), { x: 0, y: 1 }).y).toBeCloseTo(20, 9);
    }
  });

  it("goes out to the corner as it gets squarer", () => {
    // Facing the corner of the box the pen sits in, which is at (40, 20).
    const towards = { x: 20, y: 40 };
    const reached = [0, 0.5, 1].map((s) => penSupport(pen(s), towards));
    expect(reached[0]!.x).toBeCloseTo(40 * Math.SQRT1_2, 6);
    expect(reached[1]!.x).toBeGreaterThan(reached[0]!.x + 4);
    // At one it is the corner to within a hundredth of the half-width.
    expect(reached[2]!.x).toBeGreaterThan(40 * 0.985);
    expect(reached[2]!.y).toBeGreaterThan(20 * 0.985);
  });

  it("crosses the diagonal of its box where its squareness says", () => {
    // Half way between the oval's 1/√2 and the corner's 1.
    const half = Math.SQRT1_2 + 0.5 * (1 - Math.SQRT1_2);
    const reached = penSupport(pen(0.5), { x: 20, y: 40 });
    expect(reached.x / 40).toBeCloseTo(half, 6);
    expect(reached.y / 20).toBeCloseTo(half, 6);
  });

  it("is never further than the box, nor short of the oval", () => {
    for (const s of [0.2, 0.6, 1]) {
      for (let k = 0; k < 64; k++) {
        const u = (k / 64) * Math.PI * 2;
        const d = { x: Math.cos(u), y: Math.sin(u) };
        const p = penSupport(pen(s), d);
        const oval = penSupport(pen(0), d);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(40 + 1e-9);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(20 + 1e-9);
        expect(p.x * d.x + p.y * d.y).toBeGreaterThanOrEqual(oval.x * d.x + oval.y * d.y - 1e-9);
      }
    }
  });
});

describe("a pen's squareness along a stroke", () => {
  it("is part of what makes two pens the same pen", () => {
    expect(samePenShape(pen(0.5), pen(0.5))).toBe(true);
    expect(samePenShape(pen(0.5), pen(0.6))).toBe(false);
    expect(samePenShape(pen(0), { angle: 0, width: 80, thickness: 40 })).toBe(true);
  });

  it("blends from one point's to the next's, with the pen's shape", () => {
    expect(blendPen(pen(0), pen(1), 0.25).squareness).toBeCloseTo(0.25, 9);
    // An oval blended with an oval says nothing of squareness, as it never did.
    expect("squareness" in blendPen(pen(0), pen(0), 0.5)).toBe(false);

    const line: Cubic = {
      a: { x: 0, y: 0 },
      c1: { x: 100, y: 0 },
      c2: { x: 200, y: 0 },
      b: { x: 300, y: 0 },
    };
    const profile = penProfiles([line], [pen(0), pen(1)], false)[0]!;
    expect(profile.constant).toBeNull();
    expect(profile.at(0.5).squareness).toBeCloseTo(0.5, 6);
  });
});

describe("the ink of a pen with corners, against the pen swept along the path", () => {
  const squaredCase = (name: string, squareness: number): StrokeCase => {
    const c = named(name);
    return {
      ...c,
      name: `${c.name}, squareness ${String(squareness)}`,
      pens: c.pens.map((p) => ({ ...p, squareness })),
    };
  };

  it.each([
    squaredCase("an oval pen round a sharp V", 0.5),
    squaredCase("an oval pen round a sharp V", 1),
    squaredCase("an oval pen along an S", 0.6),
    squaredCase("an oval pen along an S", 1),
    squaredCase("an oval pen round a closed square", 1),
    squaredCase("an oval pen round a bend tighter than itself", 0.8),
  ])("fills as the pen does: $name", { timeout: 240_000 }, (c) => {
    const d = disagreement(filled(c), sweep(c.curves, c.pens, c.closed, c.blends), 45);
    expect(d.checked).toBeGreaterThan(500);
    expect(d.missing).toEqual([]);
    expect(d.extra).toEqual([]);
  });
});

describe("the line round the ink of a pen with corners, drawn to one plan", () => {
  const squaredCase = (name: string, squareness: number): StrokeCase => {
    const c = named(name);
    return {
      ...c,
      name: `${c.name}, squareness ${String(squareness)}`,
      pens: c.pens.map((p) => ({ ...p, squareness })),
    };
  };
  const planned = (c: StrokeCase) =>
    plannedStrokes([{ curves: c.curves, pens: c.pens, closed: c.closed }]);
  const curvesOf = (loops: readonly (readonly { curve: Cubic }[])[]): Cubic[][] =>
    loops.map((loop) => loop.map((piece) => piece.curve));
  const shapeOf = (loops: readonly (readonly { line: boolean }[])[]): string =>
    loops.map((loop) => loop.map((piece) => (piece.line ? "l" : "c")).join("")).join(" ");

  it.each([
    squaredCase("an oval pen round a sharp V", 0.5),
    squaredCase("an oval pen round a sharp V", 1),
    squaredCase("an oval pen along an S", 0.6),
    squaredCase("an oval pen along an S", 1),
    squaredCase("an oval pen round a closed square", 1),
    squaredCase("an oval pen round a bend tighter than itself", 0.8),
  ])("fills as the pen does: $name", { timeout: 240_000 }, (c) => {
    const loops = planned(c);
    expect(loops).not.toBeNull();
    const swept = sweep(c.curves, c.pens, c.closed, c.blends);
    const d = disagreement(curvesOf(loops![0]!), swept, 45);
    expect(d.checked).toBeGreaterThan(500);
    expect(d.missing).toEqual([]);
    expect(d.extra).toEqual([]);
  });

  it("goes round nothing the wrong way", { timeout: 120_000 }, () => {
    for (const c of [
      squaredCase("an oval pen round a sharp V", 1),
      squaredCase("an oval pen along an S", 0.6),
    ]) {
      const loops = curvesOf(planned(c)![0]!);
      const { minX, minY, maxX, maxY } = sweep(c.curves, c.pens, c.closed, c.blends).bounds;
      const step = Math.max(maxX - minX, maxY - minY) / 40;
      let least = Infinity;
      for (let y = minY - step; y <= maxY + step; y += step) {
        for (let x = minX - step; x <= maxX + step; x += step) {
          least = Math.min(least, winding(loops, { x: x + 0.013, y: y + 0.007 }));
        }
      }
      expect(least).toBe(0);
    }
  });

  it("is the same pieces in an oval master and a square one", () => {
    const c = named("an oval pen along an S");
    const with_ = (squareness: number, width: number) => ({
      curves: c.curves,
      pens: c.pens.map((p) => ({ ...p, width, squareness })),
      closed: c.closed,
    });
    const masters = [with_(0, 60), with_(0.5, 90), with_(1, 130)];
    const loops = plannedStrokes(masters);
    expect(loops).not.toBeNull();
    expect(shapeOf(loops![1]!)).toBe(shapeOf(loops![0]!));
    expect(shapeOf(loops![2]!)).toBe(shapeOf(loops![0]!));
    expect(loops![0]![0]!.length).toBeLessThan(200);
  });
});
