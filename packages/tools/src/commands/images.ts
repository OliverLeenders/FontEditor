import type { Affine, Vec2 } from "@fonteditor/geometry";
import { type ImageRef, placeCrop, setGlyphImage, shownCrop } from "@fonteditor/font-model";

import { type ToolResult, begin, commit, result } from "../effects.js";
import { type EditorState, currentGlyph, editCurrentGlyph } from "../state.js";

/**
 * Where the picture behind a glyph sits.
 *
 * Every one of these is the same transform said a different way — by two
 * numbers for the corner, by one for the size, by a rectangle picked off a
 * sheet — because the thing being decided is always "which part of the picture
 * is this letter, and how big". Keeping them here rather than in the panel
 * means the sheet view and the inspector cannot disagree about what a placement
 * means.
 */

/** The picture behind the current glyph, if there is one. */
export function currentImage(state: EditorState): ImageRef | null {
  return currentGlyph(state)?.image ?? null;
}

function withImage(state: EditorState, change: (image: ImageRef) => ImageRef): ToolResult {
  const image = currentImage(state);
  if (image === null) return result(state);

  const next = change(image);
  if (next === image) return result(state);

  const document = editCurrentGlyph(state, (g) => setGlyphImage(g, next));
  // Coalescing: these are driven by fields and drags, and a placement is one
  // decision however many times the number moved on the way to it.
  return document === null
    ? result(state)
    : result({ ...state, document }, [begin("Place the picture"), commit]);
}

/** Move the picture, keeping its size: a nudge, or a drag on the canvas. */
export function moveImageBy(state: EditorState, dx: number, dy: number): ToolResult {
  return withImage(state, (image) => ({
    ...image,
    transform: {
      ...image.transform,
      xOffset: image.transform.xOffset + dx,
      yOffset: image.transform.yOffset + dy,
    },
  }));
}

/** Put its lower-left corner at an exact place, for a number typed in. */
export function moveImageTo(state: EditorState, at: Vec2): ToolResult {
  return withImage(state, (image) => ({
    ...image,
    transform: { ...image.transform, xOffset: at.x, yOffset: at.y },
  }));
}

/**
 * Scale it about its own corner.
 *
 * Both axes together unless told otherwise, because a tracing scaled unevenly
 * is a tracing of a letter nobody drew. The uneven case exists for a photograph
 * taken at an angle, where it is the correction rather than the distortion.
 */
export function scaleImageTo(state: EditorState, xScale: number, yScale = xScale): ToolResult {
  if (!Number.isFinite(xScale) || !Number.isFinite(yScale)) return result(state);
  if (xScale === 0 || yScale === 0) return result(state);

  return withImage(state, (image) => ({
    ...image,
    transform: { ...image.transform, xScale, yScale },
  }));
}

/**
 * Lay the picture across the glyph, from descender to ascender.
 *
 * The one placement worth a button: a scan of a single letter arrives at some
 * number of pixels that has nothing to do with the em, and this is the guess
 * that puts it roughly where the letter is so it can be nudged rather than
 * hunted for. It keeps the picture's proportions — a squashed tracing is worse
 * than a misplaced one.
 */
export function fitImageToGlyph(
  state: EditorState,
  size: { readonly width: number; readonly height: number },
): ToolResult {
  if (size.width <= 0 || size.height <= 0) return result(state);

  const { ascender, descender } = state.document.info;
  const tall = ascender - descender;
  if (tall <= 0) return result(state);

  const scale = tall / size.height;
  const glyph = currentGlyph(state);
  const wide = size.width * scale;

  return withImage(state, (image) => ({
    ...image,
    transform: {
      xScale: scale,
      xyScale: 0,
      yxScale: 0,
      yScale: scale,
      // Centred across the advance, and sitting on the descender: the letter is
      // somewhere in the middle of a scan of it.
      xOffset: ((glyph?.advance ?? wide) - wide) / 2,
      yOffset: descender,
    },
  }));
}

/**
 * Place the picture so that a rectangle of it lands on a rectangle of the glyph.
 *
 * This is what picking a letter off a sheet is: draw a box round the `b`, say
 * where the baseline and the cap height are, and the arithmetic is the same for
 * every letter on the sheet.
 */
export function placeImageByCrop(
  state: EditorState,
  crop: { readonly from: Vec2; readonly to: Vec2 },
  onto: { readonly from: Vec2; readonly to: Vec2 },
): ToolResult {
  const transform = placeCrop(crop, onto);
  if (transform === null) return result(state);

  return withImage(state, (image) => ({ ...image, transform }));
}

/**
 * The part of the picture the glyph is showing, in image pixels.
 *
 * The inverse of the placement, which is why the sheet view needs no data of
 * its own: the rectangle it draws round a letter *is* that letter's placement,
 * read backwards.
 */
export function shownImageCrop(
  state: EditorState,
  onto: { readonly from: Vec2; readonly to: Vec2 },
): { from: Vec2; to: Vec2 } | null {
  const image = currentImage(state);
  return image === null ? null : shownCrop(image, onto);
}

/** The box a crop is laid onto: the glyph's advance, descender to ascender. */
export function glyphBox(state: EditorState): { from: Vec2; to: Vec2 } {
  const { ascender, descender } = state.document.info;
  const advance = currentGlyph(state)?.advance ?? 0;
  return { from: { x: 0, y: descender }, to: { x: advance, y: ascender } };
}

/** The placement as it stands, for a panel that shows the numbers. */
export function imagePlacement(state: EditorState): Affine | null {
  return currentImage(state)?.transform ?? null;
}
