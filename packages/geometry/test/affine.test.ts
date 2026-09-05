import { describe, expect, it } from "vitest";

import {
  IDENTITY_AFFINE,
  about,
  affineDeterminant,
  applyAffine,
  composeAffine,
  isTranslation,
  keepsAxes,
  rotation,
  scaling,
  skewing,
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

describe("building a transform", () => {
  const at = (x: number, y: number) => ({ x, y });
  const near = (p: { x: number; y: number }, x: number, y: number) => {
    expect(p.x).toBeCloseTo(x, 6);
    expect(p.y).toBeCloseTo(y, 6);
  };

  it("scales about the origin", () => {
    near(applyAffine(scaling(2, 3), at(10, 10)), 20, 30);
  });

  it("takes a negative factor as a flip, which is the same operation", () => {
    near(applyAffine(scaling(-1, 1), at(10, 20)), -10, 20);
    expect(affineDeterminant(scaling(-1, 1))).toBeLessThan(0);
  });

  it("turns anticlockwise, which is the direction design units run in", () => {
    near(applyAffine(rotation(Math.PI / 2), at(100, 0)), 0, 100);
  });

  it("leans the verticals by the tangent of the angle", () => {
    // An italic: a point rises by its own height times the tangent.
    const italic = skewing(Math.atan(0.2), 0);
    near(applyAffine(italic, at(0, 100)), 20, 100);
    near(applyAffine(italic, at(0, 0)), 0, 0);
  });

  it("turns about a point rather than about the origin", () => {
    const half = about(rotation(Math.PI), at(50, 50));
    near(applyAffine(half, at(50, 50)), 50, 50);
    near(applyAffine(half, at(60, 50)), 40, 50);
  });

  it("knows which transforms leave an axis an axis", () => {
    // What the HV-lock means is "held level or upright", and only these keep it.
    expect(keepsAxes(scaling(2, 3))).toBe(true);
    expect(keepsAxes(scaling(-1, 1))).toBe(true);
    expect(keepsAxes(translation(10, 20))).toBe(true);
    expect(keepsAxes(rotation(Math.PI / 2))).toBe(true);
    expect(keepsAxes(rotation(0.3))).toBe(false);
    expect(keepsAxes(skewing(0.2, 0))).toBe(false);
  });
});
