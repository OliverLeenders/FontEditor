import { type HandleScales, type TunniStatus } from "@typewright/geometry";
import {
  type ContourId,
  type IdFactory,
  balanceSegment,
  contourById,
  insertNodeOnSegment,
  makeSegmentCurve,
  makeSegmentLine,
  reverseContour,
  segmentLambdas,
  segmentTunniStatus,
  setSegmentLambdas,
  updateContour,
} from "@typewright/font-model";
import { type SegmentRef } from "@typewright/view";
import { type ToolResult, begin, commit, result } from "../effects.js";
import { type EditorState, currentGlyph, editCurrentGlyph } from "../state.js";
import { done } from "./shared.js";

/**
 * Commands about a contour and its segments: which way round it runs, where a
 * point is inserted, and whether a segment is a line or a curve.
 */

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

// ---------------------------------------------------------------------------
// tension
//
// The same two numbers the Tunni controls move on the canvas, reachable as
// numbers: each handle's scale along its own line, where 1 is the point the two
// handle lines cross at. The panel shows them as percentages, because that is
// how a type designer already talks about a handle — "a fifty-five percent
// curve" — and because the ratio is the part that carries between segments,
// where the length in units does not.
// ---------------------------------------------------------------------------

/**
 * The handle scales of the segment the panel is working on, or `null` when there
 * is no such segment or it is a straight line.
 *
 * The *focused* segment rather than the hovered one. Hover follows the pointer,
 * so a field reading from it would change under the cursor on the way to being
 * typed into — and would be showing a different segment by the time it was.
 */
export function focusedSegmentScales(state: EditorState): HandleScales | null {
  const segment = state.focusedSegment;
  const glyph = currentGlyph(state);
  const c = glyph === null || segment === null ? null : contourById(glyph, segment.contourId);
  if (c === null || segment === null) return null;
  return segmentLambdas(c, segment.segmentIndex);
}

/** What the focused segment is, in the terms that decide whether λ means anything. */
export function focusedSegmentStatus(state: EditorState): TunniStatus | null {
  const segment = state.focusedSegment;
  const glyph = currentGlyph(state);
  const c = glyph === null || segment === null ? null : contourById(glyph, segment.contourId);
  if (c === null || segment === null) return null;
  return segmentTunniStatus(c, segment.segmentIndex);
}

function tensioned(
  state: EditorState,
  segment: SegmentRef,
  scales: HandleScales,
): EditorState | null {
  const document = editCurrentGlyph(state, (g) =>
    updateContour(g, segment.contourId, (c) => setSegmentLambdas(c, segment.segmentIndex, scales)),
  );
  return document === null ? null : { ...state, document };
}

/**
 * Set both handle scales, as one undoable step.
 *
 * Coalescing, for the reason `moveCoordinateTo` is: this is driven by a number
 * field, and typing "55" is two calls that should leave one step behind.
 */
export function setSegmentTension(
  state: EditorState,
  segment: SegmentRef,
  scales: HandleScales,
): ToolResult {
  const next = tensioned(state, segment, scales);
  if (next === null) return result(state);
  return result(next, [begin("Set tension"), commit]);
}

/**
 * The same edit with no transaction boundary of its own, for a control being
 * dragged.
 *
 * A slider is a gesture spread over many events, so the caller opens the step on
 * the press and closes it on the release — exactly as the canvas drags do — and
 * every value in between goes through here. Each one is computed from the scales
 * the drag *began* with rather than from the last frame's, so dragging to the
 * same place twice is one result and not two.
 */
export function holdSegmentTension(
  state: EditorState,
  segment: SegmentRef,
  scales: HandleScales,
): ToolResult {
  return result(tensioned(state, segment, scales) ?? state);
}
