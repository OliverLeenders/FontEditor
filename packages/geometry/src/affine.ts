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

/**
 * A scale about the origin.
 *
 * A negative factor is a flip, which is the same operation and needs no name of
 * its own: mirroring horizontally is scaling x by −1.
 */
export function scaling(xScale: number, yScale: number): Affine {
  return { ...IDENTITY_AFFINE, xScale, yScale };
}

/** A rotation about the origin, anticlockwise, in radians. */
export function rotation(radians: number): Affine {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { xScale: cos, xyScale: sin, yxScale: -sin, yScale: cos, xOffset: 0, yOffset: 0 };
}

/**
 * A shear about the origin, in radians.
 *
 * `x` leans the verticals, which is what an italic is: a point rises by its own
 * height times the tangent of the angle. `y` does the same to the horizontals,
 * which is rarer but is the same operation on the other axis.
 */
export function skewing(x: number, y: number): Affine {
  return {
    xScale: 1,
    xyScale: Math.tan(y),
    yxScale: Math.tan(x),
    yScale: 1,
    xOffset: 0,
    yOffset: 0,
  };
}

/**
 * A transform applied about a point rather than about the origin.
 *
 * Written out because it is the form every interface actually wants: nobody
 * scales about (0, 0), they scale about the middle of what they selected.
 */
export function about(t: Affine, centre: Vec2): Affine {
  return composeAffine(
    composeAffine(translation(centre.x, centre.y), t),
    translation(-centre.x, -centre.y),
  );
}

/**
 * Whether the transform sends each axis to an axis.
 *
 * What the HV-lock means is "this handle is held level or upright". A scale, a
 * flip or a quarter turn keeps that true; a rotation by anything else or a shear
 * does not, and a flag left on afterwards would be a lock that does not hold.
 */
export function keepsAxes(t: Affine): boolean {
  // Judged against the size of the matrix rather than against exact zero: a
  // quarter turn is built from a cosine, and the cosine of a right angle is
  // 6e-17 rather than nothing. A flag decided by whether that lands on zero
  // would depend on how the transform was written down.
  const scale = Math.max(
    Math.abs(t.xScale),
    Math.abs(t.xyScale),
    Math.abs(t.yxScale),
    Math.abs(t.yScale),
  );
  if (scale === 0) return false;

  const tiny = 1e-9 * scale;
  const straight = Math.abs(t.xyScale) <= tiny && Math.abs(t.yxScale) <= tiny;
  const turned = Math.abs(t.xScale) <= tiny && Math.abs(t.yScale) <= tiny;
  return straight || turned;
}
