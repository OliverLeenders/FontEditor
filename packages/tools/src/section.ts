import type { Vec2 } from "@typewright/geometry";
import { type Section, sectionAcross } from "@typewright/font-model";

import { type ToolResult, result } from "./effects.js";
import type { PointerInput } from "./input.js";
import { type EditorState, currentGlyph } from "./state.js";

/**
 * The section ruler: a line laid across the letter, and every width along it.
 *
 * The other half of measuring. `measure` answers "how thick is this stem",
 * square to the outline, for one stem at a time. This answers the question
 * behind the rhythm of a word: laid across an `n`, it reads stem, counter, stem
 * in a row, so the three can be compared as numbers rather than by eye.
 *
 * Like the measure tool it changes nothing — no transaction, no undo step. The
 * line stays where it was put until it is drawn again or the tool is left,
 * because a ruler you have to hold in place is a ruler you cannot work under.
 */

/** Angles the line snaps to with shift held, in radians. */
const STEP = Math.PI / 4;

export function pointerDown(state: EditorState, input: PointerInput): ToolResult {
  return result({
    ...state,
    cursor: input.point,
    section: { from: input.point, to: input.point, drawing: true },
  });
}

export function pointerMove(state: EditorState, input: PointerInput): ToolResult {
  const line = state.section;
  if (line === null || !line.drawing) return result({ ...state, cursor: input.point });

  const to = input.modifiers.shift ? held(line.from, input.point) : input.point;
  return result({ ...state, cursor: input.point, section: { ...line, to } });
}

export function pointerUp(state: EditorState): ToolResult {
  const line = state.section;
  if (line === null || !line.drawing) return result(state);

  // A line of no length is a click, and a click that left an invisible ruler
  // behind would be a tool that quietly stopped working.
  const empty = line.from.x === line.to.x && line.from.y === line.to.y;
  return result({ ...state, section: empty ? null : { ...line, drawing: false } });
}

/**
 * The nearest eighth-turn from where the line began.
 *
 * Level and upright are what a ruler is mostly wanted at — a horizontal cut
 * across the stems of an `n`, an upright one down through a bar — and eyeballing
 * either to within a tenth of a degree is exactly the sort of thing that makes
 * two readings disagree for no reason.
 */
function held(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const reach = Math.hypot(dx, dy);
  if (reach === 0) return to;

  const angle = Math.round(Math.atan2(dy, dx) / STEP) * STEP;
  return { x: from.x + Math.cos(angle) * reach, y: from.y + Math.sin(angle) * reach };
}

export function cancel(state: EditorState): ToolResult {
  return state.section === null ? result(state) : result({ ...state, section: null });
}

/**
 * What the ruler is reading, or `null` when there is no line or nothing under
 * it.
 *
 * Computed rather than stored, for the reason the measure tool's reading is: a
 * copy kept beside the outline is a second answer that can disagree with the
 * first the moment a point moves.
 */
export function shownSection(state: EditorState): Section | null {
  const glyph = currentGlyph(state);
  const line = state.section;
  if (glyph === null || line === null) return null;
  if (line.from.x === line.to.x && line.from.y === line.to.y) return null;

  return sectionAcross(glyph, line.from, line.to);
}
