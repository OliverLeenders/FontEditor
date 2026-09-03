import { type Measurement, measureNormal } from "@fonteditor/font-model";
import { hoveredSegment } from "@fonteditor/view";

import { type ToolResult, result } from "./effects.js";
import { EMPTY_GLYPH } from "./gestures.js";
import type { PointerInput } from "./input.js";
import { type EditorState, currentGlyph } from "./state.js";

/**
 * The measure tool: point at a stem, read its width.
 *
 * It changes nothing, which makes it unlike every other tool here — there is no
 * transaction, no undo step, and pointer-up commits nothing. What it produces is
 * a reading, and the only state it keeps is whether that reading is following
 * the cursor or has been pinned in place.
 *
 * The live reading is not stored at all. It is a pure function of the cursor and
 * the segment under it, so the canvas works it out while drawing; keeping a copy
 * would be a second answer that could disagree with the first.
 */

/** How near the pointer must come, in screen pixels, to measure from a segment. */
const REACH = 40;

export function pointerMove(state: EditorState, input: PointerInput): ToolResult {
  // Tighter than the radius that wakes a Tunni control. Those should wake
  // generously, since they are large and you are reaching for them; a
  // measurement should be of the segment you are actually pointing at.
  const hovered = hoveredSegment(
    currentGlyph(state) ?? EMPTY_GLYPH,
    input.point,
    state.view,
    state.hoveredSegment,
    { enterPixels: REACH, stayPixels: REACH * 1.6 },
  );

  return result({ ...state, cursor: input.point, hoveredSegment: hovered });
}

/**
 * Pin the reading, or let go of a pinned one.
 *
 * Hovering alone would mean the number vanishes the moment you move the pointer
 * to do something about it, which is most of the times you would want it.
 */
export function pointerDown(state: EditorState, input: PointerInput): ToolResult {
  if (state.measure !== null) return result({ ...state, measure: null, cursor: input.point });

  const pinned = liveMeasurement({ ...state, cursor: input.point });
  return result({ ...state, cursor: input.point, measure: pinned });
}

export function pointerLeave(state: EditorState): ToolResult {
  // A pinned reading stays: it was pinned so it would still be there later.
  return result({
    ...state,
    cursor: null,
    hoveredSegment: state.measure === null ? null : state.hoveredSegment,
  });
}

export function cancel(state: EditorState): ToolResult {
  if (state.measure === null) return result(state);
  return result({ ...state, measure: null });
}

/**
 * What the measure tool is showing: the pinned reading if there is one, and
 * otherwise whatever the cursor is over.
 *
 * One function so the canvas and the status bar cannot disagree about which
 * measurement is on screen.
 */
export function shownMeasurement(state: EditorState): Measurement | null {
  return state.measure ?? liveMeasurement(state);
}

function liveMeasurement(state: EditorState): Measurement | null {
  const glyph = currentGlyph(state);
  const segment = state.hoveredSegment;
  if (glyph === null || segment === null || state.cursor === null) return null;

  return measureNormal(glyph, segment.contourId, segment.segmentIndex, state.cursor);
}
