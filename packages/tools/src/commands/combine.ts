import {
  type ContourId,
  type GlyphName,
  type IdFactory,
  type SetOperation,
  combineContours,
  inLayer,
  putGlyph,
  randomIds,
  withLayer,
} from "@typewright/font-model";

import { type ToolResult, result } from "../effects.js";
import type { EditorState } from "../state.js";
import { done } from "./shared.js";

/**
 * Subtract, intersect and exclude: what to do with two shapes besides joining
 * them.
 *
 * The selection is the tool and everything else is what it is applied to, which
 * is the way a designer works — draw the shape that says where the notch goes,
 * select it, take it away. It is also the only reading that needs no second
 * gesture: the union already means "everything" when nothing is selected, and
 * these mean nothing at all without a tool, so an empty selection is the answer
 * to which operation is available rather than a case to handle.
 *
 * Components are left alone, as they are for any operation the selection scoped.
 * A selection names contours; a component is not one of the shapes it can name,
 * and turning one into outlines because something was drawn across it is a
 * decision for the person who drew it — the whole-glyph union is where that
 * happens, and it says so when it does.
 */

/** Ids for the contours an operation produces, when a caller names none. */
const combineIds = randomIds();

/**
 * How an operation ended, as the interface needs to say it.
 *
 * The three that are not a result are worth distinguishing, because they read as
 * a button that did nothing and each has a different reason: the shapes do not
 * overlap, there would be nothing left, or the edges could not be resolved.
 */
export type CombineReport =
  "apart" | "empty" | "refused" | { readonly places: number; readonly operation: SetOperation };

export function combineAt(
  state: EditorState,
  name: GlyphName,
  operation: SetOperation,
  tool: ReadonlySet<ContourId>,
  ids: IdFactory = combineIds,
): { readonly outcome: CombineReport; readonly result: ToolResult } {
  const whole = state.document.glyphs[name];
  if (whole === undefined) return { outcome: "apart", result: result(state) };

  // The open glyph in the layer being drawn; any other glyph as the font draws it.
  const layer = name === state.currentGlyph ? state.layer : null;
  const g = inLayer(whole, layer);

  const outcome = combineContours(g, ids, operation, tool);
  if (outcome.kind !== "done") return { outcome: outcome.kind, result: result(state) };

  // The selection named points the operation has replaced, so there is nothing
  // left for it to point at — the same as the union, and for the same reason.
  const after = {
    ...state,
    document: putGlyph(state.document, withLayer(whole, layer, outcome.glyph)),
    selection: [],
  };

  return {
    outcome: { places: outcome.places, operation },
    result: done(state, after, LABELS[operation]),
  };
}

/** What each operation is called in the undo list. */
const LABELS: Record<SetOperation, string> = {
  subtract: "Subtract",
  intersect: "Intersect",
  exclude: "Exclude",
};
