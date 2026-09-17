import {
  type ContourId,
  type GlyphName,
  type IdFactory,
  inLayer,
  putGlyph,
  removeOverlap,
  withLayer,
  randomIds,
} from "@typewright/font-model";
import { type ToolResult, result } from "../effects.js";
import { type EditorState } from "../state.js";
import { done } from "./shared.js";

/**
 * Removing the overlap between the contours of one glyph, or between a few of
 * them.
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

/**
 * The contours the selection claims, or `null` for the whole glyph.
 *
 * A contour is claimed by *any* of its points being selected, rather than by
 * all of them — the same rule copying uses, and for the same reason: a partial
 * contour is not a thing either operation has an answer for. Overlap is a fact
 * about a contour rather than about its points, so touching it is claiming it,
 * and a marquee that missed one node still means the shape it drew a box round.
 */
export function selectedContourIds(state: EditorState): ReadonlySet<ContourId> | null {
  if (state.selection.length === 0) return null;
  return new Set(state.selection.map((item) => item.contourId));
}

export function overlapAt(
  state: EditorState,
  name: GlyphName,
  only: ReadonlySet<ContourId> | null = null,
  ids: IdFactory = overlapIds,
): { readonly outcome: OverlapOutcome; readonly result: ToolResult } {
  const whole = state.document.glyphs[name];
  if (whole === undefined) return { outcome: "clean", result: result(state) };
  // The open glyph in the layer being drawn; any other glyph as the font draws it.
  const layer = name === state.currentGlyph ? state.layer : null;
  const g = inLayer(whole, layer);

  const union = removeOverlap(g, ids, only);
  if (union === null) return { outcome: "refused", result: result(state) };
  if (union.crossings === 0) return { outcome: "clean", result: result(state) };

  // The selection named nodes that the union has replaced with new ones, so
  // there is nothing left for it to point at. Clearing it is the honest answer:
  // a selection of ids that no longer exist draws nothing and moves nothing,
  // and undo puts the old one back with the old contours.
  const after = {
    ...state,
    document: putGlyph(state.document, withLayer(whole, layer, union.glyph)),
    selection: [],
  };

  return {
    outcome: union.crossings,
    result: done(state, after, only === null ? "Remove overlap" : "Remove overlap in selection"),
  };
}

/** Remove overlap from one glyph, for callers with nothing to say about it. */
export function removeOverlapAt(
  state: EditorState,
  name: GlyphName,
  ids: IdFactory = overlapIds,
): ToolResult {
  return overlapAt(state, name, null, ids).result;
}
