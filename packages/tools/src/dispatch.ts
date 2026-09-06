import type { IdFactory } from "@fonteditor/font-model";

import { type ToolResult, abort, result } from "./effects.js";
import type { KeyInput, PointerInput } from "./input.js";
import * as pen from "./pen.js";
import * as select from "./select.js";
import * as knife from "./knife.js";
import * as measure from "./measure.js";
import * as section from "./section.js";
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
  shape.ShapeOptions &
  knife.KnifeOptions & { readonly ids?: IdFactory };

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
    case "knife":
      return knife.pointerDown(state, input);
    case "section":
      return section.pointerDown(state, input);
    case "measure":
      return measure.pointerDown(state, input);
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
    case "knife":
      return knife.pointerMove(state, input);
    case "measure":
      return measure.pointerMove(state, input);
    case "section":
      return section.pointerMove(state, input);
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
    case "knife":
      return knife.pointerUp(state, input, options);
    case "measure":
      // Nothing to commit: a measurement changes nothing.
      return result(state);
    case "section":
      // Nothing to commit either, but the line stops following the pointer.
      return section.pointerUp(state);
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
    case "knife":
      return knife.pointerLeave(state);
    case "measure":
      return measure.pointerLeave(state);
    case "section":
      // The line stays: it was put there to be read, and the pointer has to
      // leave the canvas to reach anything that reads it.
      return result({ ...state, cursor: null });
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
    case "knife":
    case "measure":
    case "section":
      return result(state);
  }
}

export function keyDown(
  state: EditorState,
  input: KeyInput,
  options: ToolOptions = {},
): ToolResult {
  if (heldTool(input) !== null) return keyHold(state, input);

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
    case "knife":
      return input.key === "Escape" ? knife.cancel(state) : result(state);
    case "measure":
      return input.key === "Escape" ? measure.cancel(state) : result(state);
    case "section":
      return input.key === "Escape" ? section.cancel(state) : result(state);
  }
}

/**
 * `P` and `V`, the conventional letters, and deliberately unmodified — a
 * shortcut with Ctrl or Meta belongs to the application, not the toolbox.
 * Ignored mid-gesture, since switching tools halfway through a drag is never
 * what was meant.
 *
 * `M` is not here: it is held rather than pressed. See {@link HELD}.
 */
function toolShortcut(input: KeyInput): ToolId | null {
  if (input.modifiers.ctrl || input.modifiers.meta || input.modifiers.alt) return null;
  const key = input.key.toLowerCase();
  if (key === "p") return "pen";
  if (key === "v") return "select";
  if (key === "r") return "rect";
  if (key === "e") return "ellipse";
  if (key === "k") return "knife";
  if (key === "l") return "section";
  return null;
}

/**
 * The keys that borrow a tool for as long as they are held.
 *
 * Measuring is not a mode anybody stays in: you are drawing, you want to know
 * how wide the stem is, and then you are drawing again. Held, it costs a key and
 * gives the drawing tool back by itself — where a switch costs two presses and
 * the memory of which mode you left the editor in.
 *
 * The ruler that *is* a mode is the section line, on `L`: it is laid across the
 * letter and then worked under, so it has to stay.
 */
const HELD: Readonly<Record<string, ToolId | undefined>> = { m: "measure" };

function heldTool(input: KeyInput): ToolId | null {
  if (input.modifiers.ctrl || input.modifiers.meta || input.modifiers.alt) return null;
  return HELD[input.key.toLowerCase()] ?? null;
}

/**
 * Borrow a tool while its key is down.
 *
 * Remembers what to give back, and does nothing if the tool is already in hand —
 * a held key repeats, and the second event must not record the borrowed tool as
 * the one to return to.
 */
export function keyHold(state: EditorState, input: KeyInput): ToolResult {
  const tool = heldTool(input);
  if (tool === null || busy(state)) return result(state);
  if (state.activeTool === tool) return result(state);

  const borrowed = setActiveTool(state, tool);
  return result({ ...borrowed.state, heldFrom: state.activeTool }, borrowed.effects);
}

/**
 * Whether the tool in hand is in the middle of something.
 *
 * Borrowing is only ever a good idea between things. Mid-drag it would swap the
 * tool out from under the pointer, and with a pen contour half drawn it would be
 * worse than that: leaving the pen finishes the contour, and the key that
 * finished it is one that promised to give everything back.
 */
function busy(state: EditorState): boolean {
  return (
    state.gesture !== null ||
    state.pen !== null ||
    state.shape !== null ||
    state.knife !== null ||
    state.section?.drawing === true
  );
}

/** Give back whatever a held key borrowed. */
export function keyUp(state: EditorState, input: KeyInput): ToolResult {
  const tool = heldTool(input);
  if (tool === null || state.heldFrom === null) return result(state);
  if (state.activeTool !== tool) return result({ ...state, heldFrom: null });

  const back = setActiveTool(state, state.heldFrom);
  return result({ ...back.state, heldFrom: null }, back.effects);
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
  if (state.knife !== null) return result({ ...state, knife: null, activeTool: tool }, [abort]);
  // A pinned measurement belongs to the measure tool and goes with it.
  //
  // The ruler's line does not. It is a note about the glyph rather than an
  // unfinished edit, and holding `M` to check one stem — which borrows a tool
  // and gives it back — would otherwise take the line you were working under
  // with it. It is drawn only under its own tool, so nothing is left lying
  // about; Escape is how it goes.
  if (state.measure !== null) return result({ ...state, measure: null, activeTool: tool });

  if (state.pen !== null) {
    const finished = pen.finish(state);
    return result({ ...finished.state, activeTool: tool }, finished.effects);
  }
  return result({ ...state, activeTool: tool });
}

export { knife, measure, pen, section, select, shape };
