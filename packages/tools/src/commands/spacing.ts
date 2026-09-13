import {
  type GlyphName,
  type MetricKeys,
  centreGlyph,
  parseMetricKey,
  setAdvance,
  setLeftSidebearing,
  setRightSidebearing,
  sidebearings,
  updateGlyph,
} from "@typewright/font-model";
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

  // Measured through the font, so a composite is spaced by the letter it draws.
  const document = updateGlyph(state.document, glyphName, (g) => {
    const current = sidebearings(g, state.document);
    if (current === null) return null;
    return side === "left"
      ? setLeftSidebearing(g, current.left + delta, state.document)
      : setRightSidebearing(g, current.right + delta, state.document);
  });
  if (document === null) return result(state);

  const label = side === "left" ? "Left sidebearing" : "Right sidebearing";
  return result({ ...state, document }, [begin(`${label} of ${glyphName}`), commit]);
}

/**
 * Set one sidebearing of a named glyph outright.
 *
 * The nudge above moves a measurement by a step; this is told what the
 * measurement should be, which is what a typed field means. Named rather than
 * current for the same reason the nudge is.
 *
 * Not coalescing, unlike the nudge: a typed number is a decision, and one undo
 * step should put it back.
 */
export function setSidebearing(
  state: EditorState,
  glyphName: GlyphName,
  side: "left" | "right",
  value: number,
): ToolResult {
  if (!Number.isFinite(value)) return result(state);
  const wanted = Math.round(value);

  const document = updateGlyph(state.document, glyphName, (g) => {
    const current = sidebearings(g, state.document);
    if (current === null) return null;
    if ((side === "left" ? current.left : current.right) === wanted) return null;
    return side === "left"
      ? setLeftSidebearing(g, wanted, state.document)
      : setRightSidebearing(g, wanted, state.document);
  });
  if (document === null) return result(state);

  const label = side === "left" ? "Left sidebearing" : "Right sidebearing";
  return done(state, { ...state, document }, `${label} of ${glyphName}`);
}

/**
 * Set a named glyph's advance outright.
 *
 * Beside the sidebearings because it is the third of the same three numbers, and
 * a glyph with no outline — a space — has this one and no others.
 */
export function setGlyphAdvance(
  state: EditorState,
  glyphName: GlyphName,
  value: number,
): ToolResult {
  if (!Number.isFinite(value)) return result(state);
  // Never negative: an advance is how far the pen moves on, and a font with a
  // letter that moves it backwards is not a font anybody meant to make.
  const wanted = Math.max(0, Math.round(value));

  const document = updateGlyph(state.document, glyphName, (g) =>
    g.advance === wanted ? null : setAdvance(g, wanted),
  );
  if (document === null) return result(state);

  return done(state, { ...state, document }, `Advance of ${glyphName}`);
}

/** Equal space either side, within the advance the glyph already has. */
export function centreCurrentGlyph(state: EditorState): ToolResult {
  const document = editCurrentGlyph(state, (g) => centreGlyph(g, state.document));
  return done(state, document === null ? null : { ...state, document }, "Centre glyph");
}

/**
 * Say where a glyph takes one of its three measurements from.
 *
 * An empty key means its own, which is what nearly every glyph says. A key is
 * a glyph name with perhaps an offset or a bar for the other side — see
 * `parseMetricKey` — and a leading `=` is taken off, since that is how a key is
 * told from a number where both are typed into one field. Nothing checks that
 * the glyph named exists: a key is typed a character at a time, and refusing
 * `n` on the way to `nine` would make the field unusable. A key that points
 * nowhere is reported when the font is compiled, which is when it matters.
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
  const trimmed = from.trim().replace(/^=\s*/, "");
  const read = parseMetricKey(trimmed);

  const document = updateGlyph(state.document, glyphName, (g) => {
    if (g.metricKeys[which] === trimmed) return null;
    // A glyph spaced from the same side of itself is a loop of one, and
    // refusing it here saves the reader from ever having to explain what that
    // means. Its *other* side is a different matter: that is a symmetrical `o`.
    if (read !== null && read.glyph === glyphName && !read.opposite) return null;
    return { ...g, metricKeys: { ...g.metricKeys, [which]: trimmed } };
  });
  if (document === null) return result(state);

  return done(state, { ...state, document }, "Spacing key");
}

