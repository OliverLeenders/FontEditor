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

export type { EditorState, EditorStateInit, Gesture, PenState, ToolId } from "./state.js";
export {
  currentGlyph,
  editCurrentGlyph,
  editorState,
  isDragging,
  marqueeRect,
  tunniSegments,
} from "./state.js";

export type { SelectOptions } from "./select.js";
export { cancel, translateSelection } from "./select.js";

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
