/**
 * @fonteditor/tools
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

export type { NewGlyph } from "./commands.js";

export type { EditorState, EditorStateInit, Gesture, PenState, ShapeDrag, ToolId } from "./state.js";
export {
  currentGlyph,
  editCurrentGlyph,
  editorState,
  marqueeRect,
  snapHold,
  tunniSegments,
} from "./state.js";

export {
  addComponent,
  breakOutKern,
  createGlyphs,
  deleteGlyph,
  deleteRefusal,
  extractHandles,
  extractSegmentHandles,
  balanceSegmentAt,
  centreCurrentGlyph,
  clearSelection,
  convertSegment,
  deleteSelectedPoints,
  insertPointOnSegment,
  kerningFor,
  moveCoordinateTo,
  nudgeKern,
  removeComponent,
  renameCurrentGlyph,
  renameRefusal,
  roundCoordinates,
  roundGlyphAt,
  roundSelection,
  unroundedSelected,
  selectedCoordinate,
  unroundedCount,
  nudgeSidebearing,
  nodeHasMissingHandle,
  nodeHvLocked,
  segmentHasMissingHandle,
  retractHandle,
  reverseContourAt,
  reverseSelectedContour,
  segmentParameterAt,
  selectAllPoints,
  setNodeHvLock,
  setPointType,
} from "./commands.js";

export {
  clipboardText,
  deleteSelectedContours,
  parseClipboard,
  pasteContours,
  selectedContours,
} from "./clipboard.js";

export type { SelectOptions } from "./select.js";
export { cancel, handleVisibility, translateSelection } from "./select.js";

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
  setActiveTool,
} from "./dispatch.js";

export type { ShapeOptions } from "./shape.js";
export { shapePreview, shapeRect } from "./shape.js";

export type { KnifeOptions } from "./knife.js";
export { knifeStroke } from "./knife.js";

export { shownMeasurement } from "./measure.js";
