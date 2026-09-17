import {
  type FontDocument,
  type Glyph,
  type GlyphName,
  addLayer,
  clearLayer,
  copyToLayer,
  hasLayer,
  layerLabel,
  layerProblem,
  putGlyph,
  removeLayer,
  swapWithLayer,
} from "@typewright/font-model";

import { type ToolResult, result } from "../effects.js";
import type { EditorState } from "../state.js";
import { done } from "./shared.js";

/**
 * Drawing in a layer, and moving drawings between a glyph's layers.
 *
 * Choosing a layer to draw in is not an edit — it is where the tools are
 * pointed, like choosing a glyph — unless the font has no such layer yet, in
 * which case the layer is added, and that is an edit, undone like one. The
 * commands that move drawings are edits to the glyphs named, one undo step
 * however many.
 */

/** What is dropped when the drawing being edited changes under the tools. */
function pointedElsewhere(state: EditorState, layer: string | null): EditorState {
  return {
    ...state,
    layer,
    selection: [],
    selectedAnchor: null,
    selectedGuide: null,
    selectedComponent: null,
    pen: null,
    gesture: null,
    boxFrame: null,
  };
}

/**
 * Draw in a layer, or in the main drawing for `null`.
 *
 * A layer the font does not have yet — the background, the first time — is
 * added, as its own undoable step, so that what is drawn in it has somewhere
 * to be written.
 */
export function drawInLayer(state: EditorState, layer: string | null): ToolResult {
  if (layer === state.layer) return result(state);
  const next = pointedElsewhere(state, layer);
  if (layer === null || hasLayer(state.document, layer)) return result(next);
  if (layerProblem(state.document, layer) !== null) return result(state);
  return done(
    state,
    { ...next, document: addLayer(state.document, layer) },
    `Add layer ${layerLabel(layer)}`,
  );
}

/** Add a layer to the font. Nothing where the name is empty or taken. */
export function addLayerNamed(state: EditorState, name: string): ToolResult {
  if (layerProblem(state.document, name) !== null) return result(state);
  return done(
    state,
    { ...state, document: addLayer(state.document, name.trim()) },
    `Add layer ${layerLabel(name.trim())}`,
  );
}

/** Remove a layer, and every glyph's drawing in it. */
export function removeLayerNamed(state: EditorState, name: string): ToolResult {
  if (!hasLayer(state.document, name)) return result(state);
  const document = removeLayer(state.document, name);
  const after = state.layer === name ? pointedElsewhere(state, null) : state;
  return done(state, { ...after, document }, `Remove layer ${layerLabel(name)}`);
}

/** Apply a change to each named glyph, adding the layer first where the font lacks it. */
function acrossGlyphs(
  state: EditorState,
  names: readonly GlyphName[],
  layer: string,
  change: (g: Glyph) => Glyph,
  label: string,
): ToolResult {
  let document: FontDocument = hasLayer(state.document, layer)
    ? state.document
    : addLayer(state.document, layer);
  for (const name of names) {
    const g = document.glyphs[name];
    if (g === undefined) continue;
    const changed = change(g);
    if (changed !== g) document = putGlyph(document, changed);
  }
  if (document === state.document) return result(state);
  // A drawing that was traded under the tools leaves nothing selected to point at.
  const touched = names.includes(state.currentGlyph);
  const after = touched ? pointedElsewhere(state, state.layer) : state;
  const several = names.length === 1 ? "" : ` in ${String(names.length)} glyphs`;
  return done(state, { ...after, document }, `${label}${several}`);
}

/** Copy each glyph's main drawing into a layer, over what was there. */
export function copyToLayerAt(
  state: EditorState,
  names: readonly GlyphName[],
  layer: string,
): ToolResult {
  return acrossGlyphs(
    state,
    names,
    layer,
    (g) => copyToLayer(g, layer),
    `Copy to ${layerLabel(layer)}`,
  );
}

/** Trade each glyph's main drawing and its drawing in a layer. */
export function swapWithLayerAt(
  state: EditorState,
  names: readonly GlyphName[],
  layer: string,
): ToolResult {
  return acrossGlyphs(
    state,
    names,
    layer,
    (g) => swapWithLayer(g, layer),
    `Swap with ${layerLabel(layer)}`,
  );
}

/** Take each glyph's drawing out of a layer. */
export function clearLayerAt(
  state: EditorState,
  names: readonly GlyphName[],
  layer: string,
): ToolResult {
  if (!hasLayer(state.document, layer)) return result(state);
  return acrossGlyphs(
    state,
    names,
    layer,
    (g) => clearLayer(g, layer),
    `Clear ${layerLabel(layer)}`,
  );
}
