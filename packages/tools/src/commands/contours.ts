import {
  type Cubic,
  type HandleScales,
  type TunniStatus,
  derivative,
  extrema,
  inflections,
} from "@typewright/geometry";
import {
  type Contour,
  type ContourId,
  type IdFactory,
  type NodeId,
  balanceSegment,
  contourById,
  contourIndex,
  insertNodeOnSegment,
  insertNodesOnSegment,
  makeSegmentCurve,
  makeSegmentLine,
  moveContourTo,
  reverseContour,
  segmentAt,
  segmentCount,
  segmentCubic,
  segmentLambdas,
  segmentTunniStatus,
  setSegmentLambdas,
  setStartNode,
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

// ---------------------------------------------------------------------------
// what two masters have to agree on
//
// Interpolation is arithmetic on corresponding points: the first node of the
// second contour here is averaged with the first node of the second contour
// there. Which node is first, and which contour is second, are therefore not
// drawing decisions once a font has two masters — and neither of them could be
// changed here until now. Both are repairs rather than edits: the shape does
// not move, only the order it is written in.
// ---------------------------------------------------------------------------

/**
 * Begin the contour at the selected point.
 *
 * Named rather than taken from the selection, because it is reached from the
 * menu on a point and the menu says which point it is about.
 */
export function startContourAt(
  state: EditorState,
  contourId: ContourId,
  nodeId: NodeId,
): ToolResult {
  const document = editCurrentGlyph(state, (g) =>
    updateContour(g, contourId, (c) => setStartNode(c, nodeId)),
  );
  return done(state, document === null ? null : { ...state, document }, "Start the contour here");
}

/** Whether beginning the contour here would change anything, for the menu. */
export function canStartContourAt(
  state: EditorState,
  contourId: ContourId,
  nodeId: NodeId,
): boolean {
  const glyph = currentGlyph(state);
  const c = glyph === null ? null : contourById(glyph, contourId);
  return c !== null && setStartNode(c, nodeId) !== null;
}

/**
 * Move a contour one place forward or back in the glyph's list.
 *
 * One place at a time, from the menu on the contour: a glyph has two or three
 * contours and nudging one of them past another is the whole of what anybody
 * needs. Where it lands is visible in the point numbers, which is why they are
 * worth turning on while doing this.
 */
export function moveContour(state: EditorState, contourId: ContourId, by: 1 | -1): ToolResult {
  const glyph = currentGlyph(state);
  const at = glyph === null ? -1 : contourIndex(glyph, contourId);
  if (glyph === null || at < 0) return result(state);

  const document = editCurrentGlyph(state, (g) => moveContourTo(g, contourId, at + by));
  return done(
    state,
    document === null ? null : { ...state, document },
    by > 0 ? "Send the contour back" : "Bring the contour forward",
  );
}

/** Where a contour sits, and how many there are, for the menu to say so. */
export function contourPlace(
  state: EditorState,
  contourId: ContourId,
): { at: number; of: number } | null {
  const glyph = currentGlyph(state);
  if (glyph === null) return null;
  const at = contourIndex(glyph, contourId);
  return at < 0 ? null : { at, of: glyph.contours.length };
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

// ---------------------------------------------------------------------------
// where a curve turns
//
// The two places a segment has that are worth a point of their own. An extreme
// is where the outline stops going one way in x or y and starts going the other
// — the top of an o, the side of a bowl — and every font format wants a point
// there: a TrueType curve is rounded to the grid at its points, and a shape with
// no point at its own top rounds into a flat. An inflection is where it stops
// bending one way and starts bending the other, which is the join two people
// draw differently and is where a single segment is hardest to control.
//
// Both are roots of a polynomial, so they are found rather than guessed, and
// both come out as parameters of the segment they were found on — which is why
// inserting them is the model's job and not done here one at a time.
// ---------------------------------------------------------------------------

/** A turn worth a point: where the curve reverses in x or y, or changes its bend. */
export type Turn = "extreme" | "inflection";

/**
 * How near an end, or another turn, a turn may be before it is the same point.
 *
 * In the parameter rather than in units, which is coarse where a segment is
 * long — and right anyway: two roots this close are one turn the arithmetic
 * found twice, whatever the segment measures.
 */
const TOGETHER = 1e-3;

/** The parameters of a segment's turns, with the ones nobody could tell apart dropped. */
function turnsOn(c: Contour, index: number, kind: Turn): number[] {
  const segment = segmentAt(c, index);
  if (segment === null || segment.kind === "line") return [];

  const geometry = segmentCubic(segment);
  const roots = kind === "extreme" ? extrema(geometry) : inflections(geometry);

  const kept: number[] = [];
  for (const t of roots) {
    if (t <= TOGETHER || t >= 1 - TOGETHER) continue;
    if (kept.some((each) => Math.abs(each - t) <= TOGETHER)) continue;
    if (kind === "extreme" && !turnsBack(geometry, t)) continue;
    kept.push(t);
  }
  return kept;
}

/**
 * Whether the curve really turns back at `t`, rather than pausing there.
 *
 * A doubled root is a place where one coordinate's speed touches zero and goes
 * on the way it was going — the middle of a flattened s, say. The arithmetic
 * calls it an extreme and a designer would not: nothing on either side of it is
 * further out, and a point there is a point in the way.
 */
function turnsBack(s: Cubic, t: number): boolean {
  const step = 1e-3;
  const before = derivative(s, Math.max(0, t - step));
  const after = derivative(s, Math.min(1, t + step));
  return before.x * after.x < 0 || before.y * after.y < 0;
}

/** Which contours an invocation with no segment of its own works on. */
function contoursIn(state: EditorState): ContourId[] {
  const chosen = new Set<ContourId>();
  for (const item of state.selection) chosen.add(item.contourId);
  if (state.focusedSegment !== null) chosen.add(state.focusedSegment.contourId);
  if (chosen.size > 0) return [...chosen];

  // Nothing is selected, so the glyph is what is being worked on. Adding the
  // extremes to a whole letter is the usual reason to ask for them at all.
  const glyph = currentGlyph(state);
  return glyph === null ? [] : glyph.contours.map((each) => each.id);
}

/**
 * Put a point at every turn of a contour that has not got one.
 *
 * Walked from the last segment back, because inserting into one renumbers the
 * segments after it and nothing before it.
 */
function turned(c: Contour, kind: Turn, ids: IdFactory): Contour | null {
  let next = c;
  let changed = false;
  for (let index = segmentCount(c) - 1; index >= 0; index--) {
    const added = insertNodesOnSegment(next, index, turnsOn(next, index, kind), ids);
    if (added === null) continue;
    next = added;
    changed = true;
  }
  return changed ? next : null;
}

/**
 * How many points would be added, for a menu item to know whether to offer
 * itself and a button to know whether to be live.
 */
export function turnsMissing(state: EditorState, segment: SegmentRef | null, kind: Turn): number {
  const glyph = currentGlyph(state);
  if (glyph === null) return 0;

  if (segment !== null) {
    const c = contourById(glyph, segment.contourId);
    return c === null ? 0 : turnsOn(c, segment.segmentIndex, kind).length;
  }

  let count = 0;
  for (const contourId of contoursIn(state)) {
    const c = contourById(glyph, contourId);
    if (c === null) continue;
    for (let index = 0; index < segmentCount(c); index++) count += turnsOn(c, index, kind).length;
  }
  return count;
}

/**
 * Add the points, on one segment or across whatever is being worked on.
 *
 * One step whichever it is: "add the extremes" is a single thing to have asked
 * for, and undoing it a point at a time would be a chore rather than a mercy.
 */
export function addPointsAtTurns(
  state: EditorState,
  segment: SegmentRef | null,
  kind: Turn,
  ids: IdFactory,
): ToolResult {
  const document = editCurrentGlyph(state, (g) => {
    if (segment !== null) {
      return updateContour(g, segment.contourId, (c) =>
        insertNodesOnSegment(c, segment.segmentIndex, turnsOn(c, segment.segmentIndex, kind), ids),
      );
    }

    let glyph = g;
    let changed = false;
    for (const contourId of contoursIn(state)) {
      const next = updateContour(glyph, contourId, (c) => turned(c, kind, ids));
      if (next === null) continue;
      glyph = next;
      changed = true;
    }
    return changed ? glyph : null;
  });

  return done(
    state,
    document === null ? null : { ...state, document },
    kind === "extreme" ? "Add points at extremes" : "Add points at inflections",
  );
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
