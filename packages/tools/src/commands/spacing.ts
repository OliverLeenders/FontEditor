import {
  type GlyphName,
  type MetricKeys,
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

/**
 * Say where a glyph takes one of its three measurements from.
 *
 * An empty name means its own, which is what nearly every glyph says. Nothing
 * checks that the glyph named exists: a key is typed a character at a time, and
 * refusing `n` on the way to `nine` would make the field unusable. A key that
 * points nowhere is reported when the font is compiled, which is when it
 * matters.
 *
 * Not coalescing, unlike the nudges: this is a decision rather than an
 * adjustment, and one undo step should put it back.
 */
export function setMetricKey(
  state: EditorState,
  glyphName: GlyphName,
  which: keyof MetricKeys,
  from: string,
): ToolResult {
  const trimmed = from.trim();

  const document = updateGlyph(state.document, glyphName, (g) => {
    if (g.metricKeys[which] === trimmed) return null;
    // A glyph spaced from itself is a loop of one, and refusing it here saves
    // the reader from ever having to explain what that means.
    if (trimmed === glyphName) return null;
    return { ...g, metricKeys: { ...g.metricKeys, [which]: trimmed } };
  });
  if (document === null) return result(state);

  return done(state, { ...state, document }, "Spacing key");
}
