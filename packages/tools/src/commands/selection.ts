import { type Vec2, project } from "@fonteditor/geometry";
import { type ContourId, contourById, segmentAt, segmentCubic } from "@fonteditor/font-model";
import {
  type SegmentRef,
  type Selection,
  type SelectionItem,
  addItems,
  itemPoint,
  sameSelection,
} from "@fonteditor/view";
import { type ToolResult, begin, commit, result } from "../effects.js";
import { translateSelection } from "../gestures.js";
import { type EditorState, currentGlyph, editCurrentGlyph } from "../state.js";

/**
 * Commands about what is selected and where it sits: choosing points, reading
 * one coordinate, and moving one to an exact place.
 */

/**
 * The one selected point or handle, when there is exactly one.
 *
 * `null` for none and for several: a coordinate field showing one of six
 * selected points would be showing an arbitrary one, and typing into it would
 * move only that one — neither of which is what the number appears to promise.
 */
export function selectedCoordinate(
  state: EditorState,
): { readonly item: SelectionItem; readonly point: Vec2 } | null {
  if (state.selection.length !== 1) return null;
  const item = state.selection[0]!;

  const glyph = currentGlyph(state);
  const point = glyph === null ? null : itemPoint(glyph, item);
  return point === null ? null : { item, point };
}

/**
 * Put a point or handle at an exact position.
 *
 * Goes through the same translation a drag uses, so a handle typed into keeps a
 * smooth node smooth by swinging its other side — the same thing that would have
 * happened had it been dragged there.
 */
export function moveCoordinateTo(state: EditorState, item: SelectionItem, point: Vec2): ToolResult {
  const glyph = currentGlyph(state);
  const from = glyph === null ? null : itemPoint(glyph, item);
  if (from === null) return result(state);

  const delta = { x: point.x - from.x, y: point.y - from.y };
  if (delta.x === 0 && delta.y === 0) return result(state);

  const document = editCurrentGlyph(state, (g) => translateSelection(g, [item], delta));
  if (document === null) return result(state);

  // Coalescing, unlike most one-shot commands: this is driven by a number field,
  // and every keystroke in one is a call. Without it, typing "520" would leave
  // three undo steps behind — 5, then 52, then 520.
  return result({ ...state, document }, [
    begin(item.part === "point" ? "Set point position" : "Set handle position"),
    commit,
  ]);
}

/**
 * Select every on-curve point in the glyph.
 *
 * Points only. Including handles would make the next arrow-key nudge move each
 * handle as well as the node carrying it, which doubles every offset.
 */
export function selectAllPoints(state: EditorState): ToolResult {
  const glyph = currentGlyph(state);
  if (glyph === null) return result(state);

  const selection: Selection = glyph.contours.flatMap((c) =>
    c.nodes.map((n) => ({ contourId: c.id, nodeId: n.id, part: "point" as const })),
  );
  if (selection.length === 0) return result(state);
  return result({ ...state, selection });
}

export function clearSelection(state: EditorState): ToolResult {
  if (state.selection.length === 0) return result(state);
  return result({ ...state, selection: [] });
}

/**
 * Where along a segment a click landed, for "insert point here".
 *
 * `null` at the very ends, where inserting would duplicate an existing point
 * rather than add one.
 */
export function segmentParameterAt(
  state: EditorState,
  segment: SegmentRef,
  p: Vec2,
): number | null {
  const glyph = currentGlyph(state);
  const c = glyph === null ? null : contourById(glyph, segment.contourId);
  if (c === null) return null;

  const found = segmentAt(c, segment.segmentIndex);
  if (found === null) return null;

  const { t } = project(segmentCubic(found), p);
  return t > 0.001 && t < 0.999 ? t : null;
}

/**
 * Select every on-curve point of one contour.
 *
 * The handles are left out for the same reason the arrow keys leave them out: a
 * point carries its own, so selecting both would say twice what is about to
 * move. What this is for is the whole letter-shape at once — to transform it, to
 * nudge it, to see its box.
 *
 * `additive` adds to what is already selected rather than replacing it, so a
 * shape made of several contours can be gathered one at a time.
 */
export function selectContour(
  state: EditorState,
  contourId: ContourId,
  additive = false,
): ToolResult {
  const glyph = currentGlyph(state);
  const c = glyph === null ? null : contourById(glyph, contourId);
  if (c === null || c.nodes.length === 0) return result(state);

  const items: Selection = c.nodes.map((n) => ({
    contourId,
    nodeId: n.id,
    part: "point" as const,
  }));
  const selection = additive ? addItems(state.selection, items) : items;

  // The same selection is not a change, and handing back a new array would mark
  // the session dirty and set the autosave going for nothing.
  return result(sameSelection(selection, state.selection) ? state : { ...state, selection });
}
