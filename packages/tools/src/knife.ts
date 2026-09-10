import type { Vec2 } from "@typewright/geometry";
import { type IdFactory, type KnifeCut, cutGlyph, randomIds } from "@typewright/font-model";

import { type ToolResult, abort, begin, commit, result } from "./effects.js";
import type { GestureOptions } from "./gestures.js";
import type { PointerInput } from "./input.js";
import { type EditorState, currentGlyph, editCurrentGlyph } from "./state.js";

/**
 * The knife: a stroke drawn across the glyph, and the shapes it leaves.
 *
 * A drag like the shape tools, and unlike them in one way that matters — the
 * stroke is not snapped. Snapping exists so a point lands where you meant it,
 * and a cut is not a point: what matters is which side of the outline the stroke
 * passes, and pulling its ends onto whole units or onto the x-height would move
 * the cut somewhere you did not aim.
 */

export type KnifeOptions = GestureOptions & {
  readonly ids?: IdFactory;
};

const fallbackIds = randomIds();

export function pointerDown(state: EditorState, input: PointerInput): ToolResult {
  return result({
    ...state,
    cursor: input.point,
    // Nothing that existed before the cut will exist after it, so a selection
    // pointing into the old contours would be pointing at nothing.
    selection: [],
    knife: { from: input.point, to: input.point },
  });
}

export function pointerMove(state: EditorState, input: PointerInput): ToolResult {
  const knife = state.knife;
  if (knife === null) return result({ ...state, cursor: input.point });
  return result({ ...state, cursor: input.point, knife: { ...knife, to: input.point } });
}

export function pointerUp(
  state: EditorState,
  _input?: PointerInput,
  options: KnifeOptions = {},
): ToolResult {
  const knife = state.knife;
  if (knife === null) return result(state);

  const settled: EditorState = { ...state, knife: null };
  const glyph = currentGlyph(settled);
  if (glyph === null) return result(settled, [abort]);

  const cut = cutGlyph(glyph, knife.from, knife.to, options.ids ?? fallbackIds);
  // A stroke that crossed nothing is not a cut, and committing one would put a
  // step in the history that changes nothing and undoes nothing.
  if (cut === null || cut.glyph === glyph) return result(settled, [abort]);

  const document = editCurrentGlyph(settled, () => cut.glyph);
  if (document === null) return result(settled, [abort]);

  return result({ ...settled, document }, [begin(labelFor(cut), false), commit]);
}

/**
 * What the stroke did, for the undo menu.
 *
 * The knife divides a shape, joins two into one, or simply puts a point in, and
 * a history of steps all called "Cut" is one nobody can read backwards. Naming
 * the marking case apart is the one that matters: it changed nothing about the
 * shape, so an undo that came back to it would otherwise look like a no-op.
 */
function labelFor(cut: KnifeCut): string {
  if (cut.marked > 0 && cut.divided === 0)
    return cut.marked === 1 ? "Insert point" : "Insert points";
  return "Cut";
}

/** Leaving the canvas abandons the stroke; a half-drawn cut is not a cut. */
export function pointerLeave(state: EditorState): ToolResult {
  if (state.knife === null) return result({ ...state, cursor: null });
  return result({ ...state, cursor: null, knife: null }, [abort]);
}

export function cancel(state: EditorState): ToolResult {
  if (state.knife === null) return result(state);
  return result({ ...state, knife: null }, [abort]);
}

/** The stroke as it stands, for the canvas to draw. */
export function knifeStroke(state: EditorState): readonly [Vec2, Vec2] | null {
  const knife = state.knife;
  if (knife === null) return null;
  return [knife.from, knife.to];
}
