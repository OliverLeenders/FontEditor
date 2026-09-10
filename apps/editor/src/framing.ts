import type { FontInfo, Glyph } from "@typewright/font-model";
import { glyphBounds } from "@typewright/font-model";
import { type ViewTransform, fitRect } from "@typewright/view";

/** Space left around the em box, in screen pixels. */
const MARGIN = 60;

/**
 * The camera that frames a glyph on a canvas of the given size.
 *
 * Frames the em box rather than the outline, so switching glyphs does not
 * rescale the canvas under you — an `l` and an `o` should sit at the same size,
 * the way they will on the page. The outline is unioned in so a glyph that
 * overshoots its own metrics is still fully visible.
 *
 * `null` when there is nothing to frame against: a canvas of no size.
 */
export function frameGlyph(
  glyph: Glyph,
  info: Pick<FontInfo, "ascender" | "descender">,
  width: number,
  height: number,
): ViewTransform | null {
  if (width === 0 || height === 0) return null;

  const box = glyphBounds(glyph) ?? { minX: 0, minY: 0, maxX: glyph.advance, maxY: 0 };
  return fitRect(
    {
      minX: Math.min(0, box.minX),
      maxX: Math.max(glyph.advance, box.maxX),
      minY: Math.min(info.descender, box.minY),
      maxY: Math.max(info.ascender, box.maxY),
    },
    width,
    height,
    MARGIN,
  );
}
