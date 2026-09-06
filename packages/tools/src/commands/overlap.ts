import {
  type GlyphName,
  type IdFactory,
  putGlyph,
  removeOverlap,
  randomIds,
} from "@fonteditor/font-model";
import { type ToolResult, result } from "../effects.js";
import { type EditorState } from "../state.js";
import { done } from "./shared.js";

/**
 * Removing the overlap between the contours of one glyph.
 */

/** Ids for the nodes and contours a union produces, when a caller names none. */
const overlapIds = randomIds();

/**
 * What removing overlap from a glyph would do, without doing it.
 *
 * Three answers, because there are three things worth saying afterwards: a
 * number of crossings that were resolved, "nothing was overlapping", and "this
 * could not be resolved". The last is the one that matters — two edges lying
 * exactly along each other have no crossing points to split at, and a tool that
 * quietly reshaped the letter there would be worse than one that declines.
 */
export type OverlapOutcome = "clean" | "refused" | number;

export function overlapAt(
  state: EditorState,
  name: GlyphName,
  ids: IdFactory = overlapIds,
): { readonly outcome: OverlapOutcome; readonly result: ToolResult } {
  const g = state.document.glyphs[name];
  if (g === undefined) return { outcome: "clean", result: result(state) };

  const union = removeOverlap(g, ids);
  if (union === null) return { outcome: "refused", result: result(state) };
  if (union.crossings === 0) return { outcome: "clean", result: result(state) };

  return {
    outcome: union.crossings,
    result: done(
      state,
      { ...state, document: putGlyph(state.document, union.glyph) },
      "Remove overlap",
    ),
  };
}

/** Remove overlap from one glyph, for callers with nothing to say about it. */
export function removeOverlapAt(
  state: EditorState,
  name: GlyphName,
  ids: IdFactory = overlapIds,
): ToolResult {
  return overlapAt(state, name, ids).result;
}
