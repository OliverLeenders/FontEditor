import { describe, expect, it } from "vitest";

import {
  IDENTITY_AFFINE,
  affineDeterminant,
  applyAffine,
  composeAffine,
  isTranslation,
  translation,
} from "../src/affine.js";

const p = { x: 10, y: 20 };

describe("applyAffine", () => {
  it("leaves a point alone under the identity", () => {
    expect(applyAffine(IDENTITY_AFFINE, p)).toEqual(p);
  });

  it("moves a point", () => {
    expect(applyAffine(translation(5, -3), p)).toEqual({ x: 15, y: 17 });
  });

  it("scales about the origin", () => {
    const double = { ...IDENTITY_AFFINE, xScale: 2, yScale: 3 };
    expect(applyAffine(double, p)).toEqual({ x: 20, y: 60 });
  });

  it("mirrors", () => {
    expect(applyAffine({ ...IDENTITY_AFFINE, xScale: -1 }, p)).toEqual({ x: -10, y: 20 });
  });

  it("skews in the direction the field names promise", () => {
    // xyScale contributes x into y; yxScale contributes y into x.
    expect(applyAffine({ ...IDENTITY_AFFINE, xyScale: 0.5 }, p)).toEqual({ x: 10, y: 25 });
    expect(applyAffine({ ...IDENTITY_AFFINE, yxScale: 0.5 }, p)).toEqual({ x: 20, y: 20 });
  });
});

describe("composeAffine", () => {
  it("is the identity on either side", () => {
    const t = { xScale: 2, xyScale: 0.3, yxScale: -0.1, yScale: 1.5, xOffset: 7, yOffset: -4 };
    expect(composeAffine(IDENTITY_AFFINE, t)).toEqual(t);
    expect(composeAffine(t, IDENTITY_AFFINE)).toEqual(t);
  });

  it("agrees with applying the two in turn", () => {
    // The property that matters: composing once must equal transforming twice,
    // or a nested component lands somewhere its own placement never asked for.
    const inner = {
      xScale: 2,
      xyScale: 0.25,
      yxScale: -0.5,
      yScale: 1.5,
      xOffset: 30,
      yOffset: -10,
    };
    const outer = { xScale: -1, xyScale: 0.1, yxScale: 0.2, yScale: 0.5, xOffset: -5, yOffset: 12 };

    for (const point of [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: -33, y: 7.5 },
    ]) {
      const twice = applyAffine(outer, applyAffine(inner, point));
      const once = applyAffine(composeAffine(outer, inner), point);
      expect(once.x).toBeCloseTo(twice.x, 10);
      expect(once.y).toBeCloseTo(twice.y, 10);
    }
  });

  it("stacks translations", () => {
    expect(composeAffine(translation(3, 4), translation(10, 20))).toEqual(translation(13, 24));
  });

  it("does not commute, and says so", () => {
    const move = translation(10, 0);
    const scale = { ...IDENTITY_AFFINE, xScale: 2 };
    expect(composeAffine(move, scale)).not.toEqual(composeAffine(scale, move));
  });
});

describe("isTranslation", () => {
  it("recognises a plain move", () => {
    expect(isTranslation(IDENTITY_AFFINE)).toBe(true);
    expect(isTranslation(translation(100, -50))).toBe(true);
  });

  it("rejects anything that scales, skews or mirrors", () => {
    expect(isTranslation({ ...IDENTITY_AFFINE, xScale: 2 })).toBe(false);
    expect(isTranslation({ ...IDENTITY_AFFINE, xScale: -1 })).toBe(false);
    expect(isTranslation({ ...IDENTITY_AFFINE, xyScale: 0.1 })).toBe(false);
  });
});

describe("affineDeterminant", () => {
  it("is one for a move, and negative when the plane is flipped", () => {
    expect(affineDeterminant(translation(9, 9))).toBe(1);
    expect(affineDeterminant({ ...IDENTITY_AFFINE, xScale: -1 })).toBe(-1);
    expect(affineDeterminant({ ...IDENTITY_AFFINE, xScale: 2, yScale: 3 })).toBe(6);
  });
});
