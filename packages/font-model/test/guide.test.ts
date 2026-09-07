import { vec } from "@fonteditor/geometry";
import { describe, expect, it } from "vitest";

import {
  distanceToGuide,
  guide,
  guideDirection,
  horizontalGuide,
  isHorizontal,
  isVertical,
  movedGuide,
  nearestOnGuide,
  normalAngle,
  turnedGuide,
  verticalGuide,
} from "../src/guide.js";

/**
 * A guide is a point and an angle, and everything else about it is derived.
 * These are the derivations, which is where the arithmetic can be wrong without
 * anything visibly breaking — a snap that pulls a point to the wrong side of a
 * line looks like a sticky drag rather than a sign error.
 */
describe("what a guide is", () => {
  it("lies flat at zero degrees and stands up at ninety", () => {
    expect(isHorizontal(horizontalGuide("g1", 500))).toBe(true);
    expect(isVertical(horizontalGuide("g1", 500))).toBe(false);

    expect(isVertical(verticalGuide("g2", 120))).toBe(true);
    expect(isHorizontal(verticalGuide("g2", 120))).toBe(false);
  });

  it("is the same line pointing either way", () => {
    expect(isHorizontal(guide("g1", vec(0, 0), 180))).toBe(true);
    expect(isVertical(guide("g2", vec(0, 0), 270))).toBe(true);
  });

  it("brings an angle into a number somebody would say out loud", () => {
    expect(normalAngle(-12)).toBe(348);
    expect(normalAngle(732)).toBe(12);
    expect(normalAngle(Number.NaN)).toBe(0);
    // Through the constructor too, so nothing downstream sees 732.
    expect(guide("g1", vec(0, 0), 450).angle).toBe(90);
    expect(turnedGuide(horizontalGuide("g1", 0), -90).angle).toBe(270);
  });

  it("points along itself", () => {
    const level = guideDirection(horizontalGuide("g1", 500));
    expect(level.x).toBeCloseTo(1, 10);
    expect(level.y).toBeCloseTo(0, 10);

    const upright = guideDirection(verticalGuide("g2", 120));
    expect(upright.x).toBeCloseTo(0, 10);
    expect(upright.y).toBeCloseTo(1, 10);
  });
});

describe("how far a point is from a guide", () => {
  it("measures across the line, not along it", () => {
    const level = horizontalGuide("g1", 500);
    // Along the line changes nothing; across it is the whole answer.
    expect(Math.abs(distanceToGuide(level, vec(0, 512)))).toBeCloseTo(12, 10);
    expect(Math.abs(distanceToGuide(level, vec(9000, 512)))).toBeCloseTo(12, 10);
    expect(distanceToGuide(level, vec(9000, 500))).toBeCloseTo(0, 10);
  });

  it("says which side, which is what stops a snap oscillating", () => {
    const level = horizontalGuide("g1", 500);
    const above = distanceToGuide(level, vec(0, 520));
    const below = distanceToGuide(level, vec(0, 480));

    expect(Math.sign(above)).not.toBe(Math.sign(below));
  });

  it("measures a slanted line the same way", () => {
    // Forty-five degrees through the origin: the point (100, 0) is 100/√2 away.
    const slant = guide("g1", vec(0, 0), 45);
    expect(Math.abs(distanceToGuide(slant, vec(100, 0)))).toBeCloseTo(100 / Math.SQRT2, 10);
  });

  it("finds the nearest point on the line", () => {
    const upright = verticalGuide("g1", 120);
    const near = nearestOnGuide(upright, vec(400, 300));

    expect(near.x).toBeCloseTo(120, 10);
    expect(near.y).toBeCloseTo(300, 10);
    expect(distanceToGuide(upright, near)).toBeCloseTo(0, 10);
  });
});

describe("moving one", () => {
  it("keeps its angle", () => {
    const slant = guide("g1", vec(0, 0), 12, "italic");
    const moved = movedGuide(slant, 100, 50);

    expect(moved.angle).toBe(12);
    expect(moved.name).toBe("italic");
    expect(moved.pt).toEqual({ x: 100, y: 50 });
  });

  it("moves a copy, never the original", () => {
    const before = horizontalGuide("g1", 500);
    movedGuide(before, 0, 12);

    expect(before.pt.y).toBe(500);
  });
});
