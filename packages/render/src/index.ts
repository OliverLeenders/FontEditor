/**
 * @fonteditor/render
 *
 * Canvas drawing for the glyph editing surface.
 *
 * Two layers. `drawScene` and its parts are pure functions of a {@link Scene}
 * and a {@link Canvas2D} — no state, no scheduling, no canvas ownership, and no
 * DOM: the context is a hand-written interface naming only the members the
 * renderer uses, so a plain recording object satisfies it and the drawing can be
 * asserted on in a test. `CanvasSurface` is the thin shell that owns the element,
 * the device-pixel ratio and the frame loop.
 *
 * The renderer reads the document and never writes it. Which segment is awake,
 * what is selected, where the view sits — all of it arrives in the scene, so a
 * frame is reproducible from its inputs alone.
 */

export type { Canvas2D } from "./context.js";

export type { RenderPalette } from "./palette.js";
export { DARK_PALETTE, LIGHT_PALETTE } from "./palette.js";

export type {
  HorizontalGuide,
  RenderMetrics,
  RenderOptions,
  Scene,
  SceneInit,
} from "./scene.js";
export { DEFAULT_METRICS, DEFAULT_OPTIONS, scene } from "./scene.js";

export {
  clearBackground,
  drawFilledPreview,
  drawGuides,
  drawHandles,
  drawMarquee,
  drawNodes,
  drawOutline,
  drawPenPreview,
  drawScene,
  drawTunniControls,
  isActive,
} from "./draw.js";

export type { FrameCallback } from "./surface.js";
export { CanvasSurface } from "./surface.js";
