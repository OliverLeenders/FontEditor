import type { Rect, Vec2 } from "@typewright/geometry";

/**
 * The one place where design space meets screen space.
 *
 * Design space is y-up and measured in font units; screen space is y-down and
 * measured in CSS pixels. Everything below the renderer works in design units
 * and never sees a pixel — which is what stops a literal like the prototype's
 * `< 7` pixel hit radius from ending up inside model code, where it silently
 * means something different at every zoom level.
 *
 *   screen.x =  design.x · scale + tx
 *   screen.y = -design.y · scale + ty
 *
 * Uniform scale only: no rotation, no shear, no non-square aspect. A font editor
 * canvas needs none of them, and leaving them out keeps the inverse exact and
 * every tolerance conversion a single division.
 */
export type ViewTransform = {
  /** Screen pixels per design unit. Always positive. */
  readonly scale: number;
  readonly tx: number;
  readonly ty: number;
};

export const IDENTITY_VIEW: ViewTransform = { scale: 1, tx: 0, ty: 0 };

export const DEFAULT_MIN_SCALE = 0.002;
export const DEFAULT_MAX_SCALE = 40;

export function toScreen(v: ViewTransform, p: Vec2): Vec2 {
  return { x: p.x * v.scale + v.tx, y: -p.y * v.scale + v.ty };
}

export function toDesign(v: ViewTransform, p: Vec2): Vec2 {
  return { x: (p.x - v.tx) / v.scale, y: -(p.y - v.ty) / v.scale };
}

/**
 * Convert a screen-pixel tolerance into design units.
 *
 * Call this wherever a distance means "close enough to click": a hit radius is
 * a fact about fingers and screens, not about the font, so it has to be
 * expressed in pixels and converted at the boundary.
 */
export function screenTolerance(v: ViewTransform, pixels: number): number {
  return pixels / v.scale;
}

/** Convert a length in design units into screen pixels. */
export function toScreenLength(v: ViewTransform, units: number): number {
  return units * v.scale;
}

export function panBy(v: ViewTransform, dxScreen: number, dyScreen: number): ViewTransform {
  return { scale: v.scale, tx: v.tx + dxScreen, ty: v.ty + dyScreen };
}

/**
 * Zoom about a fixed screen point — the anchor stays over the same design
 * coordinate throughout, which is what makes wheel-zoom feel like the canvas is
 * being pulled towards the cursor rather than drifting under it.
 */
export function zoomAt(
  v: ViewTransform,
  screenAnchor: Vec2,
  factor: number,
  minScale = DEFAULT_MIN_SCALE,
  maxScale = DEFAULT_MAX_SCALE,
): ViewTransform {
  if (!Number.isFinite(factor) || factor <= 0) return v;
  const scale = clamp(v.scale * factor, minScale, maxScale);
  const fixed = toDesign(v, screenAnchor);
  return {
    scale,
    tx: screenAnchor.x - fixed.x * scale,
    ty: screenAnchor.y + fixed.y * scale,
  };
}

export function setScaleAt(
  v: ViewTransform,
  screenAnchor: Vec2,
  scale: number,
  minScale = DEFAULT_MIN_SCALE,
  maxScale = DEFAULT_MAX_SCALE,
): ViewTransform {
  if (!Number.isFinite(scale) || scale <= 0) return v;
  return zoomAt(v, screenAnchor, clamp(scale, minScale, maxScale) / v.scale, minScale, maxScale);
}

/**
 * A transform that frames `rect` inside a viewport, centred, with `padding`
 * pixels of margin on every side.
 *
 * Returns `null` for a viewport or rectangle with no area — there is no sensible
 * framing of nothing, and a caller that gets `null` should leave the view alone
 * rather than jump somewhere arbitrary.
 */
export function fitRect(
  rect: Rect,
  viewportWidth: number,
  viewportHeight: number,
  padding = 24,
  minScale = DEFAULT_MIN_SCALE,
  maxScale = DEFAULT_MAX_SCALE,
): ViewTransform | null {
  const usableWidth = viewportWidth - padding * 2;
  const usableHeight = viewportHeight - padding * 2;
  if (usableWidth <= 0 || usableHeight <= 0) return null;

  const width = rect.maxX - rect.minX;
  const height = rect.maxY - rect.minY;
  if (!(width > 0) && !(height > 0)) return null;

  const scaleX = width > 0 ? usableWidth / width : Number.POSITIVE_INFINITY;
  const scaleY = height > 0 ? usableHeight / height : Number.POSITIVE_INFINITY;
  const scale = clamp(Math.min(scaleX, scaleY), minScale, maxScale);

  const centreX = (rect.minX + rect.maxX) / 2;
  const centreY = (rect.minY + rect.maxY) / 2;

  return {
    scale,
    tx: viewportWidth / 2 - centreX * scale,
    ty: viewportHeight / 2 + centreY * scale,
  };
}

/** The design-space rectangle currently visible in a viewport of this size. */
export function visibleRect(v: ViewTransform, viewportWidth: number, viewportHeight: number): Rect {
  const topLeft = toDesign(v, { x: 0, y: 0 });
  const bottomRight = toDesign(v, { x: viewportWidth, y: viewportHeight });
  return {
    minX: Math.min(topLeft.x, bottomRight.x),
    minY: Math.min(topLeft.y, bottomRight.y),
    maxX: Math.max(topLeft.x, bottomRight.x),
    maxY: Math.max(topLeft.y, bottomRight.y),
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
