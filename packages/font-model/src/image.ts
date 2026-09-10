import { type Affine, IDENTITY_AFFINE, type Vec2, applyAffine } from "@typewright/geometry";

/**
 * A picture to draw against: a scan, a photograph of lettering, a letter from
 * another font.
 *
 * The file is the font's and the placement is the glyph's, which is the whole
 * design. One scan of an alphabet sheet is a single file in the font, and each
 * letter carries its own transform onto it — so twenty-six glyphs trace from
 * one image without twenty-six copies of it, and moving the `b` does not move
 * the `a`.
 *
 * That is also exactly what UFO does, which is not a coincidence: the format
 * got here first, and following it means a tracing set up here is still there
 * when the source is opened in something else.
 *
 * The bytes are not in this model. They are megabytes, they never change, and
 * putting them in a document that history keeps a copy of on every edit would
 * make undo cost a scan. They live beside the font — see `@typewright/storage`
 * for the working store and `@typewright/disk` for a folder on a disk — and the
 * name here is how the two find each other.
 */
export type ImageRef = {
  /** The file in the font's images, by name: `sheet-01.png`. */
  readonly name: string;
  /**
   * Image space to design units.
   *
   * Image space is pixels with the origin at the bottom left and y running up,
   * one pixel to one unit before the transform — UFO's convention, and the one
   * that makes an untransformed image sit on the baseline at its natural size.
   */
  readonly transform: Affine;
  /** UFO's colour string, carried through untouched, or `null`. */
  readonly color: string | null;
};

export function imageRef(
  name: string,
  transform: Affine = IDENTITY_AFFINE,
  color: string | null = null,
): ImageRef {
  return { name, transform, color };
}

/** Where a point of the image lands in the glyph. */
export function imagePoint(image: ImageRef, pixel: Vec2): Vec2 {
  return applyAffine(image.transform, pixel);
}

/**
 * The transform that lays a rectangle of the image onto a rectangle of the
 * glyph, which is how a letter is picked off a sheet.
 *
 * Both rectangles are given in their own space and by two corners, and the
 * result maps one onto the other without rotation or shear: a crop is a
 * decision about which part of the picture this letter is, not about turning
 * it. A rectangle with no width or no height gives `null` — there is no
 * transform that opens out a line.
 */
export function placeCrop(
  crop: { readonly from: Vec2; readonly to: Vec2 },
  onto: { readonly from: Vec2; readonly to: Vec2 },
): Affine | null {
  const cropWidth = crop.to.x - crop.from.x;
  const cropHeight = crop.to.y - crop.from.y;
  if (cropWidth === 0 || cropHeight === 0) return null;

  const xScale = (onto.to.x - onto.from.x) / cropWidth;
  const yScale = (onto.to.y - onto.from.y) / cropHeight;

  return {
    xScale,
    xyScale: 0,
    yxScale: 0,
    yScale,
    xOffset: onto.from.x - crop.from.x * xScale,
    yOffset: onto.from.y - crop.from.y * yScale,
  };
}

/**
 * The part of the image a glyph is showing, in image pixels.
 *
 * The inverse of the placement, and the reason the sheet view needs no data of
 * its own: "where does the sheet sit behind the b" and "which part of the sheet
 * is the b" are one number read two ways, so moving either moves the other.
 *
 * `null` where the transform collapses — a scale of zero has no inverse, and
 * nothing is being shown.
 */
export function shownCrop(
  image: ImageRef,
  onto: { readonly from: Vec2; readonly to: Vec2 },
): { from: Vec2; to: Vec2 } | null {
  const back = invertAffine(image.transform);
  if (back === null) return null;

  const one = applyAffine(back, onto.from);
  const two = applyAffine(back, onto.to);
  return {
    from: { x: Math.min(one.x, two.x), y: Math.min(one.y, two.y) },
    to: { x: Math.max(one.x, two.x), y: Math.max(one.y, two.y) },
  };
}

/**
 * The transform that undoes another, or `null` where there is none.
 *
 * Here rather than in the geometry package because this is the only thing that
 * has ever needed it: the editor's own transforms are built forwards, and the
 * one case where a transform has to be read backwards is asking a picture which
 * part of itself is on screen.
 */
export function invertAffine(t: Affine): Affine | null {
  const determinant = t.xScale * t.yScale - t.xyScale * t.yxScale;
  if (determinant === 0 || !Number.isFinite(determinant)) return null;

  const xScale = t.yScale / determinant;
  const xyScale = -t.xyScale / determinant;
  const yxScale = -t.yxScale / determinant;
  const yScale = t.xScale / determinant;

  return {
    xScale,
    xyScale,
    yxScale,
    yScale,
    xOffset: -(t.xOffset * xScale + t.yOffset * yxScale),
    yOffset: -(t.xOffset * xyScale + t.yOffset * yScale),
  };
}
