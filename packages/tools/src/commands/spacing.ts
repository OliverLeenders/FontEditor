import {
  type GlyphName,
  centreGlyph,
  setLeftSidebearing,
  setRightSidebearing,
  sidebearings,
  updateGlyph,
} from "@fonteditor/font-model";
import { type ToolResult, begin, commit, result } from "../effects.js";
import { type EditorState, editCurrentGlyph } from "../state.js";
import { done } from "./shared.js";

/**
 * Commands about the space around a glyph rather than the shape of it.
 */

/**
 * Move one sidebearing of a named glyph by a step.
 *
 * Named rather than current, because the spacing view edits whichever letter is
 * selected in a line of text, which is usually not the glyph open for drawing.
 *
 * Coalescing is left on: holding an arrow key is one adjustment being made, and
 * a hundred undo entries for it would be useless. Nudging a *different* glyph or
 * a different side starts a new entry, because the label differs.
 */
export function nudgeSidebearing(
  state: EditorState,
  glyphName: GlyphName,
  side: "left" | "right",
  delta: number,
): ToolResult {
  if (delta === 0) return result(state);

  const document = updateGlyph(state.document, glyphName, (g) => {
    const current = sidebearings(g);
    if (current === null) return null;
    return side === "left"
      ? setLeftSidebearing(g, current.left + delta)
      : setRightSidebearing(g, current.right + delta);
  });
  if (document === null) return result(state);

  const label = side === "left" ? "Left sidebearing" : "Right sidebearing";
  return result({ ...state, document }, [begin(`${label} of ${glyphName}`), commit]);
}

/** Equal space either side, within the advance the glyph already has. */
export function centreCurrentGlyph(state: EditorState): ToolResult {
  const document = editCurrentGlyph(state, (g) => centreGlyph(g));
  return done(state, document === null ? null : { ...state, document }, "Centre glyph");
}
