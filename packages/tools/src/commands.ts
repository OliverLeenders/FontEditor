import { type Vec2, project } from "@fonteditor/geometry";
import {
  type ContourId,
  type IdFactory,
  type NodeId,
  type NodeType,
  balanceSegment,
  centreGlyph,
  contourById,
  insertNodeOnSegment,
  makeSegmentCurve,
  makeSegmentLine,
  nodeById,
  removeNode,
  reverseContour,
  segmentAt,
  segmentCubic,
  segmentIndexForHandle,
  setHandle,
  setHvLock,
  setNodeType,
  updateContour,
} from "@fonteditor/font-model";
import type { SegmentRef, Selection } from "@fonteditor/view";

import { type ToolResult, begin, commit, result } from "./effects.js";
import { type EditorState, currentGlyph, editCurrentGlyph } from "./state.js";

/**
 * One-shot edits, as opposed to gestures.
 *
 * A tool spreads a transaction across many events — press, move, release. These
 * happen all at once, so each opens and closes its own in a single call. They are
 * what a context menu, a keyboard shortcut or an inspector button invokes, and
 * putting them here rather than in the interface keeps them testable and keeps
 * three call sites from growing three slightly different versions of the same
 * edit.
 *
 * Every one returns the state unchanged when it cannot do anything, so a caller
 * never has to check first.
 */

function done(state: EditorState, next: EditorState | null, label: string): ToolResult {
  if (next === null) return result(state);
  return result(next, [begin(label, false), commit]);
}

// ---------------------------------------------------------------------------
// points
// ---------------------------------------------------------------------------

/** Set the type of every selected on-curve point, or of one named point. */
export function setPointType(
  state: EditorState,
  type: NodeType,
  only?: { contourId: ContourId; nodeId: NodeId },
): ToolResult {
  const targets: Array<{ contourId: ContourId; nodeId: NodeId }> =
    only !== undefined
      ? [only]
      : state.selection
          .filter((item) => item.part === "point")
          .map((item) => ({ contourId: item.contourId, nodeId: item.nodeId }));

  if (targets.length === 0) return result(state);

  let editor = state;
  for (const target of targets) {
    const document = editCurrentGlyph(editor, (g) =>
      updateContour(g, target.contourId, (c) => setNodeType(c, target.nodeId, type)),
    );
    if (document !== null) editor = { ...editor, document };
  }
  return done(state, editor === state ? null : editor, type === "corner" ? "Make corner" : "Make smooth");
}

/**
 * Turn the axis constraint on or off for a node.
 *
 * Switching it on also straightens the handles — see `setHvLock` in the model
 * for why, and for what that means on a smooth node.
 */
export function setNodeHvLock(
  state: EditorState,
  contourId: ContourId,
  nodeId: NodeId,
  locked: boolean,
): ToolResult {
  const document = editCurrentGlyph(state, (g) =>
    updateContour(g, contourId, (c) => setHvLock(c, nodeId, locked)),
  );
  return done(
    state,
    document === null ? null : { ...state, document },
    locked ? "Lock to axis" : "Unlock from axis",
  );
}

export function nodeHvLocked(state: EditorState, contourId: ContourId, nodeId: NodeId): boolean {
  const glyph = currentGlyph(state);
  const c = glyph === null ? null : contourById(glyph, contourId);
  return (c === null ? null : nodeById(c, nodeId))?.hvLock ?? false;
}

/**
 * Remove the selected on-curve points.
 *
 * Handles in the selection are ignored: Backspace on a handle should not delete
 * the point it belongs to, which is a much larger edit than the one asked for.
 */
export function deleteSelectedPoints(state: EditorState): ToolResult {
  const points = state.selection.filter((item) => item.part === "point");
  if (points.length === 0) return result(state);

  let editor = state;
  for (const item of points) {
    const document = editCurrentGlyph(editor, (g) =>
      updateContour(g, item.contourId, (c) => removeNode(c, item.nodeId)),
    );
    if (document !== null) editor = { ...editor, document };
  }
  if (editor === state) return result(state);

  return done(
    state,
    { ...editor, selection: [], focusedSegment: null, hoveredSegment: null },
    points.length === 1 ? "Delete point" : "Delete points",
  );
}

/** Retract one handle, which turns its segment into a line if both are gone. */
export function retractHandle(
  state: EditorState,
  contourId: ContourId,
  nodeId: NodeId,
  part: "in" | "out",
): ToolResult {
  const document = editCurrentGlyph(state, (g) =>
    updateContour(g, contourId, (c) => setHandle(c, nodeId, part, null)),
  );
  if (document === null) return result(state);
  return done(
    state,
    { ...state, document, selection: state.selection.filter((item) => item.part === "point") },
    "Retract handle",
  );
}

// ---------------------------------------------------------------------------
// contours
// ---------------------------------------------------------------------------

/**
 * Reverse the direction a contour is drawn in.
 *
 * Node ids survive, so anything selected stays selected — the shapes are the
 * same points, walked the other way.
 */
export function reverseContourAt(state: EditorState, contourId: ContourId): ToolResult {
  const document = editCurrentGlyph(state, (g) =>
    updateContour(g, contourId, (c) => reverseContour(c)),
  );
  return done(state, document === null ? null : { ...state, document }, "Reverse contour");
}

/** Reverse whichever contour the selection or the focused segment sits in. */
export function reverseSelectedContour(state: EditorState): ToolResult {
  const contourId = state.selection[0]?.contourId ?? state.focusedSegment?.contourId ?? null;
  if (contourId === null) return result(state);
  return reverseContourAt(state, contourId);
}

// ---------------------------------------------------------------------------
// segments
// ---------------------------------------------------------------------------

export function insertPointOnSegment(
  state: EditorState,
  segment: SegmentRef,
  t: number,
  ids: IdFactory,
): ToolResult {
  const document = editCurrentGlyph(state, (g) =>
    updateContour(g, segment.contourId, (c) =>
      insertNodeOnSegment(c, segment.segmentIndex, t, ids),
    ),
  );
  return done(state, document === null ? null : { ...state, document }, "Insert point");
}

export function convertSegment(
  state: EditorState,
  segment: SegmentRef,
  to: "line" | "curve",
): ToolResult {
  const document = editCurrentGlyph(state, (g) =>
    updateContour(g, segment.contourId, (c) =>
      to === "line"
        ? makeSegmentLine(c, segment.segmentIndex)
        : makeSegmentCurve(c, segment.segmentIndex),
    ),
  );
  return done(
    state,
    document === null ? null : { ...state, document },
    to === "line" ? "Make line" : "Make curve",
  );
}

export function balanceSegmentAt(state: EditorState, segment: SegmentRef): ToolResult {
  const document = editCurrentGlyph(state, (g) =>
    updateContour(g, segment.contourId, (c) => balanceSegment(c, segment.segmentIndex)),
  );
  return done(state, document === null ? null : { ...state, document }, "Balance handles");
}

/** The segment a handle shapes, for menus opened on a handle. */
export function segmentForHandle(
  state: EditorState,
  contourId: ContourId,
  nodeId: NodeId,
  part: "in" | "out",
): SegmentRef | null {
  const glyph = currentGlyph(state);
  const c = glyph === null ? null : contourById(glyph, contourId);
  if (c === null) return null;
  const segmentIndex = segmentIndexForHandle(c, nodeId, part);
  return segmentIndex === null ? null : { contourId, segmentIndex };
}

// ---------------------------------------------------------------------------
// spacing
// ---------------------------------------------------------------------------

/** Equal space either side, within the advance the glyph already has. */
export function centreCurrentGlyph(state: EditorState): ToolResult {
  const document = editCurrentGlyph(state, (g) => centreGlyph(g));
  return done(state, document === null ? null : { ...state, document }, "Centre glyph");
}

// ---------------------------------------------------------------------------
// selection
// ---------------------------------------------------------------------------

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
