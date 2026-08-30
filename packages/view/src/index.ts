/**
 * @fonteditor/view
 *
 * The boundary between design space and screen space, and everything the
 * pointer can address.
 *
 * Pure and canvas-free: this package computes *where* things are and *what* is
 * under the cursor, and never draws. The renderer will depend on it; it will
 * never depend on the renderer. That split is what keeps hit testing something
 * you can assert on in a test rather than something you have to click to check.
 */

export type { ViewTransform } from "./transform.js";
export {
  DEFAULT_MAX_SCALE,
  DEFAULT_MIN_SCALE,
  IDENTITY_VIEW,
  fitRect,
  panBy,
  screenTolerance,
  setScaleAt,
  toDesign,
  toScreen,
  toScreenLength,
  visibleRect,
  zoomAt,
} from "./transform.js";

export type { Selection, SelectionItem, SelectionPart } from "./selection.js";
export {
  EMPTY_SELECTION,
  addItems,
  hasItem,
  hasPoint,
  itemForTarget,
  itemPosition,
  itemsInRect,
  rectBetween,
  removeItems,
  sameItem,
  selectionKey,
  toggleItem,
} from "./selection.js";

export type { ActivationOptions, SegmentRef } from "./proximity.js";
export {
  DEFAULT_ENTER_PIXELS,
  DEFAULT_STAY_PIXELS,
  DEFAULT_STICKINESS,
  hoveredSegment,
  sameSegment,
  segmentProximity,
} from "./proximity.js";

export type { GlyphRun, PlacedGlyph } from "./run.js";
export { EMPTY_RUN, glyphAtX, layoutRun, occurrencesOf, placedAt } from "./run.js";

export type { CellBox, GridLayout, GridOptions } from "./grid.js";
export {
  DEFAULT_GRID,
  cellBox,
  cellIndexAt,
  gridLayout,
  scrollToCell,
  visibleCells,
} from "./grid.js";

export type { HandleVisibility, Hit, HitIndex, HitKind, HitOptions, HitTarget } from "./hit.js";
export {
  ALL_HANDLES,
  PICK_PRIORITY,
  PICK_TOLERANCE_SCALE,
  buildHitIndex,
  distanceToTarget,
  handleIsVisible,
  nodesInRect,
  pick,
  pickAll,
  pickOf,
} from "./hit.js";
