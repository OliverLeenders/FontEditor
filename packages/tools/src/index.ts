/**
 * @typewright/tools
 *
 * Pointer and keyboard tools, as pure reducers over an explicit editor state.
 *
 * `(state, event) => { state, effects }` — no instance holding a half-finished
 * drag, no hidden mutation. A whole gesture is a list of synthetic events in a
 * test, and `edit-core` will be able to wrap these same functions in
 * transactions without them changing, because a reducer already hands back a new
 * state for every event.
 *
 * The effects are the seam. A tool knows where an undoable step begins and ends —
 * one `begin` at pointer-down, one `commit` at pointer-up, whatever happened in
 * between — so it says so, rather than leaving the history layer to infer it
 * later from a stream of state changes.
 */

export type { Modifiers, KeyInput, PointerInput } from "./input.js";
export { NO_MODIFIERS, keyInput, modifiers, pointerInput } from "./input.js";

export type { Effect, ToolResult } from "./effects.js";
export { abort, begin, commit, result } from "./effects.js";

export type { GuideScope, NewGlyph } from "./commands/index.js";

export type {
  EditorState,
  EditorStateInit,
  Gesture,
  PenState,
  ShapeDrag,
  ToolId,
} from "./state.js";
export {
  boxAngle,
  currentGlyph,
  editCurrentGlyph,
  editorState,
  marqueeRect,
  snapHold,
  tunniSegments,
} from "./state.js";

export {
  type KernSide,
  type TransformOrigin,
  BOX_CENTRE,
  addComponent,
  attachComponent,
  buildComposites,
  detachedComposites,
  reattachComposites,
  attachmentFor,
  componentSource,
  decomposeCurrentGlyph,
  decomposeGlyphAt,
  deleteSelectedComponent,
  flipComponent,
  moveComponentTo,
  addKernGroup,
  breakOutKern,
  deleteKernGroup,
  createGlyphs,
  deleteGlyph,
  deleteRefusal,
  extractHandles,
  extractSegmentHandles,
  addAnchorAt,
  addGuideAt,
  deleteSelectedGuide,
  guideById,
  guidesInForce,
  moveGuideBy,
  moveGuideTo,
  moveGuideToScope,
  pickGuide,
  currentImage,
  fitImageToGlyph,
  glyphBox,
  imagePlacement,
  moveImageBy,
  moveImageTo,
  placeImageByCrop,
  scaleImageTo,
  shownImageCrop,
  removeGuideAt,
  renameGuideTo,
  turnGuideTo,
  balanceSegmentAt,
  deleteSelectedAnchor,
  freeAnchorName,
  moveAnchorToPoint,
  removeAnchorAt,
  renameAnchorTo,
  focusedSegmentScales,
  focusedSegmentStatus,
  holdSegmentTension,
  centreCurrentGlyph,
  clearSelection,
  convertSegment,
  deleteSelectedPoints,
  insertPointOnSegment,
  kerningFor,
  kernGroupHolding,
  kernGroupPairs,
  kernGroupProblem,
  putGlyphInKernGroup,
  renameKernGroupTo,
  takeGlyphFromKernGroup,
  moveCoordinateTo,
  nudgeKern,
  removeComponent,
  setInfo,
  infoProblem,
  removeOverlapAt,
  overlapAt,
  selectedContourIds,
  type OverlapOutcome,
  renameCurrentGlyph,
  renameRefusal,
  roundCoordinates,
  roundGlyphAt,
  roundSelection,
  unroundedSelected,
  selectedCoordinate,
  selectedNode,
  setSegmentTension,
  unroundedCount,
  nudgeSidebearing,
  setGlyphAdvance,
  setMetricKey,
  setSidebearing,
  harmoniseSelection,
  nodeCanBeTangent,
  nodeCanHarmonise,
  nodeHasMissingHandle,
  selectContour,
  selectedCanBeTangent,
  selectedCurvature,
  transformOriginPoint,
  transformSelection,
  nodeHvLocked,
  segmentHasMissingHandle,
  retractHandle,
  reverseContourAt,
  reverseSelectedContour,
  segmentParameterAt,
  selectAllPoints,
  setNodeHvLock,
  setPointType,
} from "./commands/index.js";

export {
  clipboardText,
  deleteSelectedContours,
  parseClipboard,
  pasteContours,
  selectedContours,
} from "./clipboard.js";

export type { SelectOptions } from "./select.js";
export {
  BOX_HANDLE_PIXELS,
  BOX_OUTSET_PIXELS,
  cancel,
  handleVisibility,
  pickTarget,
  selectionBox,
  translateSelection,
} from "./select.js";

export type { PenOptions } from "./pen.js";
export { penPreview } from "./pen.js";

/**
 * The entry points route to whichever tool is active. Individual tools remain
 * reachable as `select` and `pen` for tests that want to drive one directly.
 */
export type { ToolOptions } from "./dispatch.js";
export {
  doubleClick,
  keyDown,
  pen,
  pointerDown,
  pointerLeave,
  pointerMove,
  pointerUp,
  select,
  keyHold,
  keyUp,
  setActiveTool,
} from "./dispatch.js";

export type { ShapeOptions } from "./shape.js";
export { shapePreview, shapeRect } from "./shape.js";

export type { KnifeOptions } from "./knife.js";
export { knifeStroke } from "./knife.js";

export type { MeasureOptions } from "./measure.js";
export { shownMeasurement } from "./measure.js";
export { shownSection } from "./section.js";
