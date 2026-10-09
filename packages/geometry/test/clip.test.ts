import { describe, expect, it } from "vitest";

import { clipLoop } from "../src/clip.js";
import { type Cubic, lineAsCubic } from "../src/cubic.js";
import { arcCubics } from "../src/index.js";
import { loopArea } from "../src/nib.js";
import type { Vec2 } from "../src/vec2.js";

/**
 * A loop cut by a straight line, the far side taken off.
 */

const p = (x: number, y: number): Vec2 => ({ x, y });
const polygon = (...points: Vec2[]): Cubic[] =>
  points.map((a, i) => lineAsCubic(a, points[(i + 1) % points.length]!));
const square = polygon(p(0, 0), p(100, 0), p(100, 100), p(0, 100));
/** How much of a loop is left, as a share of another: the measure is the same for both. */
const share = (part: readonly Cubic[], whole: readonly Cubic[]): number =>
  Math.abs(loopArea(part)) / Math.abs(loopArea(whole));

describe("a loop cut by a line", () => {
  it("is itself where none of it is past the line", () => {
    expect(clipLoop(square, p(0, 200), p(0, 1))).toEqual(square);
  });

  it("is nothing where all of it is", () => {
    expect(clipLoop(square, p(0, -10), p(0, 1))).toEqual([]);
  });

  it("is closed along the line where it was cut", () => {
    // The top forty units off a square.
    const cut = clipLoop(square, p(0, 60), p(0, 1));

    expect(share(cut, square)).toBeCloseTo(0.6, 9);
    expect(Math.max(...cut.flatMap((c) => [c.a.y, c.b.y]))).toBeCloseTo(60, 9);
    // Every piece starts where the one before it ended.
    for (const [i, piece] of cut.entries()) {
      const before = cut[(i - 1 + cut.length) % cut.length]!;
      expect(Math.hypot(piece.a.x - before.b.x, piece.a.y - before.b.y)).toBeLessThan(1e-9);
    }
  });

  it("cuts at a slant, keeping the side the normal points away from", () => {
    // The corner beyond x + y = 150: a triangle of fifty by fifty.
    const cut = clipLoop(square, p(150, 0), p(1, 1));
    expect(share(cut, square)).toBeCloseTo(0.875, 9);
  });

  it("cuts curves where they cross, not where their points are", () => {
    // Half a circle of radius fifty.
    const circle = [
      ...arcCubics(p(0, 0), p(50, 0), p(-50, 0), true),
      ...arcCubics(p(0, 0), p(-50, 0), p(50, 0), true),
    ];
    const cut = clipLoop(circle, p(0, 0), p(1, 0));

    expect(share(cut, circle)).toBeCloseTo(0.5, 4);
    expect(Math.max(...cut.flatMap((c) => [c.a.x, c.b.x]))).toBeLessThan(1e-6);
  });

  it("keeps both parts of a loop the line goes through twice", () => {
    // A U, its two arms cut off below their tops and above the bowl.
    const u = polygon(
      p(0, 0),
      p(100, 0),
      p(100, 100),
      p(70, 100),
      p(70, 30),
      p(30, 30),
      p(30, 100),
      p(0, 100),
    );
    const cut = clipLoop(u, p(0, 60), p(0, 1));
    // The bowl, thirty high, and thirty more of each arm.
    expect(share(cut, square)).toBeCloseTo(0.48, 9);
  });
});
