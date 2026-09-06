import type { Vec2 } from "@fonteditor/geometry";
import {
  type ComponentId,
  type ComponentSource,
  type Glyph,
  type IdFactory,
  addGlyphComponent,
  attachmentOffset,
  component,
  decomposedGlyph,
  glyphNamed,
  placedComponent,
  removeGlyphComponent,
  resolveGlyphComponents,
  updateGlyphComponent,
  updateGlyph,
  wouldRecurse,
} from "@fonteditor/font-model";

import { type ToolResult, begin, commit, result } from "../effects.js";
import { type EditorState, currentGlyph, editCurrentGlyph } from "../state.js";
import { done } from "./shared.js";

/**
 * Commands about the glyphs placed inside this one: putting one there, moving
 * it, lining it up with the anchors, and giving up the reference.
 *
 * A component is selected on its own — see `EditorState.selectedComponent` — for
 * the reason an anchor is: what it offers are operations on the reference, and
 * none of them is an operation on points.
 */

/** Everything a component may refer to: the rest of the font. */
export function componentSource(state: EditorState): ComponentSource {
  return { glyphOf: (name) => state.document.glyphs[name] ?? null };
}

/**
 * Place a glyph inside the current one.
 *
 * Landed on its anchors where both sides have a matching pair — an `acute`
 * carrying `_top` on a letter carrying `top` — and at the origin otherwise,
 * which is where a component with nothing to line up with belongs until it is
 * dragged. This is the whole point of anchors: the accent goes where the letter
 * says accents go, and moving that anchor later moves every accent with it.
 */
export function addComponent(state: EditorState, base: string, ids: IdFactory): ToolResult {
  const owner = currentGlyph(state);
  const accent = glyphNamed(state.document, base);
  if (owner === null || accent === null) return result(state);

  // Refused before it is made rather than drawn as nothing afterwards.
  if (wouldRecurse(componentSource(state), owner.name, base)) return result(state);

  const placed = component(ids.component(), base);
  const offset = attachmentOffset(owner, accent, placed.transform);
  const landed = offset === null ? placed : placedComponent(placed, offset.x, offset.y);

  const document = editCurrentGlyph(state, (g) => addGlyphComponent(g, landed));
  if (document === null) return result(state);

  return result({ ...state, document, selection: [], selectedComponent: landed.id }, [
    begin("Add component", false),
    commit,
  ]);
}

export function removeComponent(state: EditorState, id: ComponentId): ToolResult {
  const document = editCurrentGlyph(state, (g) => removeGlyphComponent(g, id));
  if (document === null) return result(state);

  const selectedComponent = state.selectedComponent === id ? null : state.selectedComponent;
  return done(state, { ...state, document, selectedComponent }, "Remove component");
}

/** Take the selected component away, which is what Backspace means while one is. */
export function deleteSelectedComponent(state: EditorState): ToolResult {
  return state.selectedComponent === null
    ? result(state)
    : removeComponent(state, state.selectedComponent);
}

/** Put a component at an exact offset, for a number typed into a field. */
export function moveComponentTo(state: EditorState, id: ComponentId, at: Vec2): ToolResult {
  const document = editCurrentGlyph(state, (g) =>
    updateGlyphComponent(g, id, (c) => placedComponent(c, at.x, at.y)),
  );
  if (document === null) return result(state);

  // Coalescing, as the coordinate fields are: typing "120" is three calls.
  return result({ ...state, document }, [begin("Move component"), commit]);
}

/**
 * Where a component would sit if it were placed by its anchors, or `null` when
 * the two glyphs share no pair to place it by.
 *
 * Offered to the interface so the action can be shown as unavailable rather than
 * shown and then quietly doing nothing.
 */
export function attachmentFor(state: EditorState, id: ComponentId): Vec2 | null {
  const owner = currentGlyph(state);
  const placed = owner?.components.find((c) => c.id === id);
  if (owner === null || placed === undefined) return null;

  const accent = glyphNamed(state.document, placed.base);
  return accent === null ? null : attachmentOffset(owner, accent, placed.transform);
}

/**
 * Put a component back where its anchors say it belongs.
 *
 * For after the letter's anchor has moved, or after the accent has been nudged
 * by hand and the nudge is regretted.
 */
export function attachComponent(state: EditorState, id: ComponentId): ToolResult {
  const at = attachmentFor(state, id);
  if (at === null) return result(state);

  const document = editCurrentGlyph(state, (g) =>
    updateGlyphComponent(g, id, (c) => placedComponent(c, at.x, at.y)),
  );
  if (document === null) return result(state);

  return done(state, { ...state, document }, "Align to anchors");
}

/**
 * Draw a glyph's components into it as contours, giving up the references.
 *
 * Named for the glyph rather than for the selected component: a composite is
 * decomposed as a whole. Taking one reference out of three and leaving the
 * others would produce a glyph half of which follows the letters it was built
 * from and half of which does not, which is a state nobody wants to be in
 * without having asked for it.
 */
export function decomposeGlyphAt(state: EditorState, name: string, ids: IdFactory): ToolResult {
  const source = componentSource(state);
  const document = updateGlyph(state.document, name, (g: Glyph) =>
    decomposedGlyph(g, (owner) =>
      resolveGlyphComponents(source, owner.name, owner.components, ids),
    ),
  );
  if (document === null || document === state.document) return result(state);

  return done(state, { ...state, document, selectedComponent: null }, "Decompose");
}

/** Decompose the glyph being edited. */
export function decomposeCurrentGlyph(state: EditorState, ids: IdFactory): ToolResult {
  return decomposeGlyphAt(state, state.currentGlyph, ids);
}
