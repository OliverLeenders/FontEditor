import {
  type FontDocument,
  type GlyphName,
  type MetricKeys,
  centreGlyph,
  parseMetricKey,
  resolvedMetrics,
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
 *
 * Refused for a side that takes its number from a key. The nudge would move the
 * drawing underneath a key that puts the number straight back when the font is
 * compiled, so it would look like a step that did nothing; the spacing view says
 * why instead.
 */
export function nudgeSidebearing(
  state: EditorState,
  glyphName: GlyphName,
  side: "left" | "right",
  delta: number,
): ToolResult {
  if (delta === 0) return result(state);
  if ((state.document.glyphs[glyphName]?.metricKeys[side] ?? "") !== "") return result(state);

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

/**
 * A measurement typed into a field that takes either a number or a key.
 *
 * The spacing view has one field per measurement rather than a number and a key
 * side by side, so what is typed says which it is: `=` and a glyph is a key —
 * `=o`, `=|b+10` — and a number is a number. Typing a number over a measurement
 * that has a key means the number, so the key goes, and both happen in one undo
 * step because they were one thing typed. A bare `=` drops the key and keeps the
 * number it gave, as {@link unlinkMetricKey} does.
 */
export function spaceFromText(
  state: EditorState,
  glyphName: GlyphName,
  which: keyof MetricKeys,
  text: string,
): ToolResult {
  const typed = text.trim();
  if (typed === "=") return unlinkMetricKey(state, glyphName, which);
  if (typed.startsWith("=")) return setMetricKey(state, glyphName, which, typed);

  const value = Number(typed);
  if (typed === "" || !Number.isFinite(value) || state.document.glyphs[glyphName] === undefined) {
    return result(state);
  }

  const unkeyed = withoutKey(state.document, glyphName, which);
  const spaced = measuredIn({ ...state, document: unkeyed }, glyphName, which, value) ?? unkeyed;
  if (spaced === state.document) return result(state);
  return done(state, { ...state, document: spaced }, measurementLabel(which, glyphName));
}

/**
 * Drop a key and keep the number it came to.
 *
 * The font is compiled with what the key resolves to, and that is also what the
 * fields show, so a glyph whose key is simply emptied jumps back to wherever it
 * was last drawn — which is rarely anywhere anybody wanted. Where the key could
 * not be followed there is no number to keep, and the glyph is left as drawn.
 */
export function unlinkMetricKey(
  state: EditorState,
  glyphName: GlyphName,
  which: keyof MetricKeys,
): ToolResult {
  const g = state.document.glyphs[glyphName];
  if (g === undefined || g.metricKeys[which] === "") return result(state);

  const resolved = resolvedMetrics(state.document, glyphName);
  const kept = resolved === null ? null : which === "width" ? resolved.advance : resolved[which];
  const unkeyed = withoutKey(state.document, glyphName, which);
  const spaced =
    kept === null
      ? unkeyed
      : (measuredIn({ ...state, document: unkeyed }, glyphName, which, kept) ?? unkeyed);

  return done(state, { ...state, document: spaced }, "Spacing key");
}

/** The document with one of a glyph's keys emptied. */
function withoutKey(
  document: FontDocument,
  glyphName: GlyphName,
  which: keyof MetricKeys,
): FontDocument {
  return (
    updateGlyph(document, glyphName, (g) =>
      g.metricKeys[which] === "" ? null : { ...g, metricKeys: { ...g.metricKeys, [which]: "" } },
    ) ?? document
  );
}

/** The document with one measurement set, or `null` where that changes nothing. */
function measuredIn(
  state: EditorState,
  glyphName: GlyphName,
  which: keyof MetricKeys,
  value: number,
): FontDocument | null {
  const out =
    which === "width"
      ? setGlyphAdvance(state, glyphName, value)
      : setSidebearing(state, glyphName, which, value);
  return out.state.document === state.document ? null : out.state.document;
}

function measurementLabel(which: keyof MetricKeys, glyphName: GlyphName): string {
  const said =
    which === "width" ? "Advance" : which === "left" ? "Left sidebearing" : "Right sidebearing";
  return `${said} of ${glyphName}`;
}
