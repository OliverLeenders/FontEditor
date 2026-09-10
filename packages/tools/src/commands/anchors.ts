import type { Vec2 } from "@typewright/geometry";
import {
  type AnchorId,
  type Glyph,
  type IdFactory,
  addAnchor,
  anchor,
  anchorNamed,
  moveAnchorTo,
  removeAnchor,
  renameAnchor,
} from "@typewright/font-model";

import { type ToolResult, begin, commit, result } from "../effects.js";
import { type EditorState, currentGlyph, editCurrentGlyph } from "../state.js";
import { done } from "./shared.js";

/**
 * Commands about anchors: putting one down, naming it, moving it, taking it
 * away.
 *
 * An anchor is selected on its own rather than through `Selection` — see
 * `EditorState.selectedAnchor` — so every one of these names the anchor it acts
 * on, and the two that a panel drives read the selected one for themselves.
 */

/**
 * The names a new anchor is offered, in order.
 *
 * `top` first because that is what most of them are: an accent over a letter.
 * The rest of the alphabet of positions follows, and after that they are
 * numbered — a name that is taken cannot be reused, and a nameless anchor is
 * not written to the font at all.
 */
const USUAL = ["top", "bottom", "center", "ogonek", "horn"] as const;

export function freeAnchorName(g: Glyph): string {
  for (const name of USUAL) {
    if (anchorNamed(g, name) === null) return name;
  }
  for (let n = 1; ; n++) {
    const name = `anchor${String(n)}`;
    if (anchorNamed(g, name) === null) return name;
  }
}

/** Put an anchor at a point, named for what it most likely is. */
export function addAnchorAt(state: EditorState, at: Vec2, ids: IdFactory): ToolResult {
  const glyph = currentGlyph(state);
  if (glyph === null) return result(state);

  // On the grid, as a dragged one lands: placing by pointing is the same kind
  // of act as dragging, and a click that happened to land on 631.9 would put a
  // fraction into the font for no reason anybody chose.
  const placed = anchor(ids.anchor(), freeAnchorName(glyph), {
    x: Math.round(at.x),
    y: Math.round(at.y),
  });
  const document = editCurrentGlyph(state, (g) => addAnchor(g, placed));
  if (document === null) return result(state);

  // Selected as it lands, so it can be renamed or nudged without being hunted
  // for — and the point selection goes, since only one of the two can be what
  // the next key means.
  return result({ ...state, document, selection: [], selectedAnchor: placed.id }, [
    begin("Add anchor", false),
    commit,
  ]);
}

export function removeAnchorAt(state: EditorState, id: AnchorId): ToolResult {
  const document = editCurrentGlyph(state, (g) => removeAnchor(g, id));
  if (document === null) return result(state);

  const selectedAnchor = state.selectedAnchor === id ? null : state.selectedAnchor;
  return done(state, { ...state, document, selectedAnchor }, "Remove anchor");
}

/** Take the selected anchor away, which is what Backspace means while one is. */
export function deleteSelectedAnchor(state: EditorState): ToolResult {
  return state.selectedAnchor === null
    ? result(state)
    : removeAnchorAt(state, state.selectedAnchor);
}

/**
 * Rename an anchor.
 *
 * Refused where the name is already in use in this glyph — the model decides,
 * and hands back nothing — so a panel can offer the change and let it fail
 * rather than validating the same rule twice in two places.
 */
export function renameAnchorTo(state: EditorState, id: AnchorId, name: string): ToolResult {
  const document = editCurrentGlyph(state, (g) => renameAnchor(g, id, name));
  if (document === null) return result(state);

  // Coalescing: this is driven by a text field, and typing "top" is three calls.
  return result({ ...state, document }, [begin("Rename anchor"), commit]);
}

/** Put an anchor at an exact place, for a number typed into a field. */
export function moveAnchorToPoint(state: EditorState, id: AnchorId, at: Vec2): ToolResult {
  const document = editCurrentGlyph(state, (g) => moveAnchorTo(g, id, at));
  if (document === null) return result(state);

  return result({ ...state, document }, [begin("Move anchor"), commit]);
}
