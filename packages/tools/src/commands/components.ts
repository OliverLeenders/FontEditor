import type { Rect, Vec2 } from "@typewright/geometry";
import {
  type ComponentId,
  type ComponentSource,
  type FlipAxis,
  type Glyph,
  type IdFactory,
  addGlyphComponent,
  attachmentOffset,
  component,
  contourBounds,
  counterIds,
  decomposedGlyph,
  flippedComponent,
  glyphNamed,
  placedComponent,
  removeGlyphComponent,
  resolveComponent,
  resolveGlyphComponents,
  unionRect,
  updateGlyphComponent,
  updateGlyph,
  wouldRecurse,
} from "@typewright/font-model";

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
 * Turn a component over where it stands.
 *
 * The line it is mirrored about is the middle of what it draws, so the shape
 * stays where it was put and only faces the other way. Mirroring about the base
 * glyph's origin instead — which is what negating the scale on its own does —
 * would throw a `d` clear of the letter it was placed in, and the flip would
 * always be followed by dragging it back.
 *
 * A component that draws nothing has no middle to speak of. It is mirrored
 * about the origin then, which is invisible either way, rather than refused:
 * the base glyph may be drawn later, and the transform is the thing being
 * edited.
 */
export function flipComponent(state: EditorState, id: ComponentId, axis: FlipAxis): ToolResult {
  const owner = currentGlyph(state);
  const placed = owner?.components.find((c) => c.id === id);
  if (owner === null || placed === undefined) return result(state);

  // Ids for contours nothing will ever select: this is a measurement, and the
  // shapes are thrown away as soon as the box round them is known.
  const drawn = resolveComponent(
    componentSource(state),
    placed.base,
    placed.transform,
    counterIds(`flip-${id}`),
    [owner.name],
  );

  let box: Rect | null = null;
  for (const c of drawn) {
    const of = contourBounds(c);
    if (of !== null) box = unionRect(box, of);
  }

  const about =
    box === null
      ? 0
      : axis === "horizontal"
        ? (box.minX + box.maxX) / 2
        : (box.minY + box.maxY) / 2;

  const document = editCurrentGlyph(state, (g) =>
    updateGlyphComponent(g, id, (c) => flippedComponent(c, axis, about)),
  );
  if (document === null) return result(state);

  return done(state, { ...state, document }, "Flip component");
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
