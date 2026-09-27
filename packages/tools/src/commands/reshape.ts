import {
  type ContourId,
  type GlyphName,
  type IdFactory,
  type OffsetJoin,
  type Glyph,
  inLayer,
  offsetContour,
  putGlyph,
  randomIds,
  removeOverlap,
  simplifyContour,
  withLayer,
} from "@typewright/font-model";

import { type ToolResult, result } from "../effects.js";
import type { EditorState } from "../state.js";
import { done } from "./shared.js";

/**
 * Offsetting and simplifying: the two operations that change a contour's outline
 * without asking it to meet another one.
 *
 * Both follow the rule the rest of this family follows. A selection names the
 * contours to work on and everything else is left exactly as it was drawn,
 * components included; nothing selected means every closed contour the glyph draws
 * itself.
 */

/** Ids for the contours these produce, when a caller names none. */
const reshapeIds = randomIds();

/** How much litter is worth reporting, and what could not be done. */
export type ReshapeReport =
  | "nothing"
  | { readonly kind: "offset"; readonly contours: number }
  | { readonly kind: "simplified"; readonly points: number };

export type OffsetRequest = {
  readonly x: number;
  readonly y: number;
  readonly join: OffsetJoin;
};

/**
 * Offset the glyph's contours, or the selected ones, outwards by the distances
 * given.
 *
 * The union is taken afterwards, over the contours that were offset. An offset
 * that turns tighter than the distance folds over itself — the inside of a curve
 * has nowhere to go — and the fold is a crossing rather than a shape, so it is
 * resolved by the operation that resolves crossings. One undo step covers both,
 * because a designer asked for one thing.
 *
 * `"nothing"` where no contour could be offset: an open one, one with no area, or
 * distances that do not describe a pen.
 */
export function offsetAt(
  state: EditorState,
  name: GlyphName,
  request: OffsetRequest,
  only: ReadonlySet<ContourId> | null = null,
  ids: IdFactory = reshapeIds,
): { readonly outcome: ReshapeReport; readonly result: ToolResult } {
  const whole = state.document.glyphs[name];
  if (whole === undefined) return { outcome: "nothing", result: result(state) };

  const layer = name === state.currentGlyph ? state.layer : null;
  const g = inLayer(whole, layer);

  const made: ContourId[] = [];
  const contours = g.contours.map((c) => {
    if (only !== null && !only.has(c.id)) return c;
    const moved = offsetContour(c, ids, request);
    if (moved === null) return c;
    made.push(moved.id);
    return moved;
  });
  if (made.length === 0) return { outcome: "nothing", result: result(state) };

  const offset: Glyph = { ...g, contours };
  // A fold is a crossing, and the union is what takes crossings out. Only over
  // what was offset: a shape the offset did not touch is a shape nobody asked
  // about, which is the same rule the union itself follows.
  const cleaned = removeOverlap(offset, ids, new Set(made));
  const next = cleaned === null ? offset : cleaned.glyph;

  const after = {
    ...state,
    document: putGlyph(state.document, withLayer(whole, layer, next)),
    selection: [],
  };

  return {
    outcome: { kind: "offset", contours: made.length },
    result: done(state, after, only === null ? "Offset" : "Offset selection"),
  };
}

/**
 * Take out the points the outline does not need.
 *
 * The tolerance is in design units and comes from the caller, because what counts
 * as invisible depends on the em: a unit is a thousandth of the square on a
 * thousand-unit em and a two-thousandth on a 2048 one.
 *
 * `"nothing"` where every point is one the outline needs, which is what a tidy
 * drawing looks like from here.
 */
export function simplifyAt(
  state: EditorState,
  name: GlyphName,
  tolerance: number,
  only: ReadonlySet<ContourId> | null = null,
): { readonly outcome: ReshapeReport; readonly result: ToolResult } {
  const whole = state.document.glyphs[name];
  if (whole === undefined) return { outcome: "nothing", result: result(state) };

  const layer = name === state.currentGlyph ? state.layer : null;
  const g = inLayer(whole, layer);

  let taken = 0;
  const contours = g.contours.map((c) => {
    if (only !== null && !only.has(c.id)) return c;
    const tidier = simplifyContour(c, tolerance);
    if (tidier === null) return c;
    taken += c.nodes.length - tidier.nodes.length;
    return tidier;
  });
  if (taken === 0) return { outcome: "nothing", result: result(state) };

  const after = {
    ...state,
    document: putGlyph(state.document, withLayer(whole, layer, { ...g, contours })),
    // The points it named may be among the ones taken out, and a selection of
    // points that are gone draws nothing and moves nothing.
    selection: [],
  };

  return {
    outcome: { kind: "simplified", points: taken },
    result: done(state, after, only === null ? "Simplify" : "Simplify selection"),
  };
}
