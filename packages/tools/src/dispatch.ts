import type { IdFactory } from "@fonteditor/font-model";

import { type ToolResult, abort, result } from "./effects.js";
import type { KeyInput, PointerInput } from "./input.js";
import * as pen from "./pen.js";
import * as select from "./select.js";
import * as shape from "./shape.js";
import type { EditorState, ToolId } from "./state.js";

/**
 * Routes input to whichever tool is active.
 *
 * A switch rather than a registry of objects. It is fully typed, has no
 * indirection, and — the part that actually matters — the compiler names any
 * case a new tool forgets to handle. A plugin API might one day want registered
 * tool objects; until one exists, that is indirection bought for nobody.
 */
export type ToolOptions = select.SelectOptions &
  pen.PenOptions &
  shape.ShapeOptions & { readonly ids?: IdFactory };

export function pointerDown(
  state: EditorState,
  input: PointerInput,
  options: ToolOptions = {},
): ToolResult {
  switch (state.activeTool) {
    case "select":
      return select.pointerDown(state, input, options);
    case "pen":
      return pen.pointerDown(state, input, options);
    case "rect":
    case "ellipse":
      return shape.pointerDown(state, input, options);
  }
}

export function pointerMove(
  state: EditorState,
  input: PointerInput,
  options: ToolOptions = {},
): ToolResult {
  switch (state.activeTool) {
    case "select":
      return select.pointerMove(state, input, options);
    case "pen":
      return pen.pointerMove(state, input, options);
    case "rect":
    case "ellipse":
      return shape.pointerMove(state, input, options);
  }
}

export function pointerUp(
  state: EditorState,
  input?: PointerInput,
  options: ToolOptions = {},
): ToolResult {
  switch (state.activeTool) {
    case "select":
      return select.pointerUp(state, input);
    case "pen":
      return pen.pointerUp(state, input);
    case "rect":
    case "ellipse":
      return shape.pointerUp(state, input, options);
  }
}

export function pointerLeave(state: EditorState): ToolResult {
  switch (state.activeTool) {
    case "select":
      return select.pointerLeave(state);
    case "pen":
      return pen.pointerLeave(state);
    case "rect":
    case "ellipse":
      return shape.pointerLeave(state);
  }
}

export function doubleClick(
  state: EditorState,
  input: PointerInput,
  options: ToolOptions = {},
): ToolResult {
  switch (state.activeTool) {
    case "select":
      return select.doubleClick(state, input, options);
    case "pen":
      return pen.doubleClick(state);
    case "rect":
    case "ellipse":
      return result(state);
  }
}

export function keyDown(
  state: EditorState,
  input: KeyInput,
  options: ToolOptions = {},
): ToolResult {
  const shortcut = toolShortcut(input);
  if (shortcut !== null) return setActiveTool(state, shortcut);

  switch (state.activeTool) {
    case "select":
      return select.keyDown(state, input, options);
    case "pen":
      return pen.keyDown(state, input);
    case "rect":
    case "ellipse":
      return input.key === "Escape" ? shape.cancel(state) : result(state);
  }
}

/**
 * `P` and `V`, the conventional letters, and deliberately unmodified — a
 * shortcut with Ctrl or Meta belongs to the application, not the toolbox.
 * Ignored mid-gesture, since switching tools halfway through a drag is never
 * what was meant.
 */
function toolShortcut(input: KeyInput): ToolId | null {
  if (input.modifiers.ctrl || input.modifiers.meta || input.modifiers.alt) return null;
  const key = input.key.toLowerCase();
  if (key === "p") return "pen";
  if (key === "v") return "select";
  if (key === "r") return "rect";
  if (key === "e") return "ellipse";
  return null;
}

/**
 * Switch tools, tidying up after the one being left.
 *
 * An unfinished pen contour is finished rather than abandoned: reaching for the
 * select tool means you are done drawing, and leaving a half-built contour
 * dangling in the pen's memory would make the next `P` resume a shape you had
 * mentally moved on from.
 */
export function setActiveTool(state: EditorState, tool: ToolId): ToolResult {
  if (state.activeTool === tool) return result(state);
  if (state.gesture !== null) return result(state);

  // A shape half dragged out belongs to the tool being left, so it goes with it.
  if (state.shape !== null) return result({ ...state, shape: null, activeTool: tool }, [abort]);

  if (state.pen !== null) {
    const finished = pen.finish(state);
    return result({ ...finished.state, activeTool: tool }, finished.effects);
  }
  return result({ ...state, activeTool: tool });
}

export { pen, select, shape };
