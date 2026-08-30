import type { Vec2 } from "./vec2.js";

/**
 * A 2×3 affine transform, in the order fonts write it.
 *
 * Named `Affine` rather than `Transform` because `view` already owns a
 * `ViewTransform`, and the two are not interchangeable: that one is a camera —
 * uniform scale and a translation, screen-facing — while this is arbitrary,
 * lives in design space, and is what a component uses to place the glyph it
 * refers to.
 *
 * The field names and their order are UFO's and OpenType's, so reading and
 * writing either format is a copy rather than a conversion:
 *
 *     x' = x·xScale + y·yxScale + xOffset
 *     y' = x·xyScale + y·yScale + yOffset
 */
export type Affine = {
  readonly xScale: number;
  readonly xyScale: number;
  readonly yxScale: number;
  readonly yScale: number;
  readonly xOffset: number;
  readonly yOffset: number;
};

export const IDENTITY_AFFINE: Affine = {
  xScale: 1,
  xyScale: 0,
  yxScale: 0,
  yScale: 1,
  xOffset: 0,
  yOffset: 0,
};

/** The commonest case by far: a component simply moved into place. */
export function translation(xOffset: number, yOffset: number): Affine {
  return { ...IDENTITY_AFFINE, xOffset, yOffset };
}

export function applyAffine(t: Affine, p: Vec2): Vec2 {
  return {
    x: p.x * t.xScale + p.y * t.yxScale + t.xOffset,
    y: p.x * t.xyScale + p.y * t.yScale + t.yOffset,
  };
}

/**
 * `outer` applied after `inner`, as one transform.
 *
 * Needed because components nest: a glyph placed inside a glyph placed inside a
 * glyph must end up where the chain of placements says, and composing once per
 * level is cheaper and less error-prone than transforming the points repeatedly.
 */
export function composeAffine(outer: Affine, inner: Affine): Affine {
  return {
    xScale: outer.xScale * inner.xScale + outer.yxScale * inner.xyScale,
    xyScale: outer.xyScale * inner.xScale + outer.yScale * inner.xyScale,
    yxScale: outer.xScale * inner.yxScale + outer.yxScale * inner.yScale,
    yScale: outer.xyScale * inner.yxScale + outer.yScale * inner.yScale,
    xOffset: outer.xScale * inner.xOffset + outer.yxScale * inner.yOffset + outer.xOffset,
    yOffset: outer.xyScale * inner.xOffset + outer.yScale * inner.yOffset + outer.yOffset,
  };
}

/** True when this transform only moves, which is worth knowing for the interface. */
export function isTranslation(t: Affine): boolean {
  return t.xScale === 1 && t.yScale === 1 && t.xyScale === 0 && t.yxScale === 0;
}

/**
 * The determinant, whose sign says whether the transform flips the plane.
 *
 * A mirrored component has its contours running the other way round, which
 * reverses which side the fill is on — so a glyph made by mirroring another
 * needs its direction corrected, and this is how you know.
 */
export function affineDeterminant(t: Affine): number {
  return t.xScale * t.yScale - t.xyScale * t.yxScale;
}
