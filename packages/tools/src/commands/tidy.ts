import {
  type FillAsWound,
  type FontDocument,
  fillAsWound,
  randomIds,
  tidyFont,
  untidyGlyphs,
} from "@typewright/font-model";

import { type ToolResult, result } from "../effects.js";
import type { EditorState } from "../state.js";
import { done } from "./shared.js";

/**
 * A font read from a font file, brought up to what it would be read as now.
 *
 * See `tidy.ts` in the model for what the two of these are and why they are
 * two. Each is the whole font at once and one step to take back.
 */

/** How many glyphs {@link tidyOutlines} would change. */
export function untidyCount(state: EditorState): number {
  return untidyGlyphs(state.document);
}

/**
 * Take out the points that sit on the point before them and the handles that
 * sit on their own point, in every glyph. No shape changes.
 */
export function tidyOutlines(state: EditorState): ToolResult {
  const document = tidyFont(state.document);
  if (document === state.document) return result(state);
  // Nothing selected afterwards: what was may be a point that has gone.
  return done(state, { ...state, document, selection: [] }, "Tidy imported outlines");
}

/** What filling the font as its file did would change, worked out and not yet done. */
export type FillPlan = FillAsWound & {
  /** The font it was worked out for, which is the only one it may be taken for. */
  readonly of: FontDocument;
};

/**
 * Work out which glyphs nesting fills differently from how their contours
 * wind, and what each would be redrawn as. Changes nothing: it is shown, and
 * then taken with {@link takeFill} or let go.
 */
export function planFill(state: EditorState): FillPlan {
  return { ...fillAsWound(state.document, randomIds()), of: state.document };
}

/**
 * Take a plan. Not where the font has changed since it was made: the glyphs it
 * redrew are then not the glyphs that are there.
 */
export function takeFill(state: EditorState, plan: FillPlan): ToolResult {
  if (plan.of !== state.document || plan.redrawn.length === 0) return result(state);
  return done(
    state,
    { ...state, document: plan.document, selection: [] },
    "Fill as the font file did",
  );
}
