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

export type { Adjustment, Positioner, Shaper } from "./run.js";
export type { WheelIntent, WheelLike } from "./wheel.js";
export { wheelIntent } from "./wheel.js";

export type { Selection, SelectionItem, SelectionPart } from "./selection.js";
export {
  addItems,
  hasItem,
  itemForTarget,
  itemPoint,
  itemsInRect,
  removeItems,
  sameItem,
  selectionKey,
  selectionBounds,
  selectionPoints,
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

export type { GlyphRun, PlacedGlyph, ProofLine } from "./run.js";
export {
  EMPTY_RUN,
  glyphAtX,
  layoutParagraph,
  layoutRun,
  occurrencesOf,
  paragraphWidth,
  placedAt,
} from "./run.js";

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

export type { SnapHold, SnapLine, SnapSource, Snapping } from "./snap.js";
export {
  NO_HOLD,
  NO_SNAPPING,
  SNAP_PIXELS,
  SNAP_STAY_PIXELS,
  SNAP_STICKINESS,
  metricLine,
  sameLine,
  snapDelta,
  snapPoint,
  toGrid,
} from "./snap.js";

export type { AlignmentLines, AlignmentOptions } from "./alignment.js";
export { alignmentLines } from "./alignment.js";

export type { BoxAnchor, BoxHandle } from "./transformbox.js";
export {
  BOX_ANCHORS,
  TURN_STEP,
  boxHandlePoint,
  boxPivot,
  boxScale,
  boxTurn,
  pickBoxHandle,
} from "./transformbox.js";
