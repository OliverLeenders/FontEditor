import { type ContourId, type Contour, contourById, segmentCount } from "@typewright/font-model";
import type { SegmentRef, Selection } from "@typewright/view";

import { type ToolResult, result } from "../effects.js";
import { type EditorState, currentGlyph } from "../state.js";

/**
 * Walking a contour from the keyboard.
 *
 * Drawing is mostly done with the pointer, and the one thing the pointer is bad
 * at is going *along* something: points a few units apart, a handle lying on
 * top of the point it belongs to, a segment behind its own Tunni controls. Each
 * of those is a fiddle to click and nothing at all to step onto.
 *
 * So Alt with the left and right arrows moves the selection one place around the
 * contour it is already on. What one place means follows what is selected — a
 * point steps to the next point, a segment to the next segment — because those
 * are the two things the inspector is about, and stepping ought to keep showing
 * the same kind of thing rather than swapping the panel underneath.
 *
 * Right is the way the contour runs, which is the order the points are stored in
 * and the direction the outline is drawn; left is against it. On a closed
 * contour the walk comes round; on an open one it stops at the end rather than
 * jumping to the far end, which would read as having gone the other way.
 */

/** Which way round the contour: with it, or against it. */
export type WalkDirection = 1 | -1;

/**
 * Step the selection one place along its contour.
 *
 * Nothing at all when there is nothing to step from and no contour to start on,
 * so a stray Alt-arrow on an empty canvas does nothing rather than selecting
 * something the person cannot see.
 */
export function stepSelection(state: EditorState, direction: WalkDirection): ToolResult {
  const glyph = currentGlyph(state);
  if (glyph === null) return result(state);

  // A focused segment is stepped as a segment, unless a single point is what is
  // actually selected: clicking a point after clicking a curve leaves the
  // segment focused, and the point is the newer answer to "what am I on".
  const point = onePoint(state.selection);
  if (point === null && state.focusedSegment !== null) {
    return steppedSegment(state, state.focusedSegment, direction);
  }
  if (point !== null) return steppedPoint(state, point, direction);

  // Several points is a set somebody gathered on purpose. Stepping would throw
  // it away, and an arrow key is not where that decision belongs.
  if (state.selection.length > 0) return result(state);

  // Nothing to step from: start at the first point of the first contour, which
  // is where a walk from nowhere should begin.
  const first = glyph.contours.find((c) => c.nodes.length > 0);
  const node = first?.nodes[0];
  if (first === undefined || node === undefined) return result(state);
  return result({
    ...state,
    selection: [{ contourId: first.id, nodeId: node.id, part: "point" }],
    focusedSegment: null,
  });
}

/** The one point a selection names, or `null` where it names none or several. */
function onePoint(selection: Selection): { contourId: ContourId; nodeId: string } | null {
  const points = selection.filter((item) => item.part === "point");
  // Several points is a set somebody gathered; stepping it would throw the set
  // away, and the arrows are not where that decision belongs.
  if (points.length !== 1) return null;
  const only = points[0]!;
  return { contourId: only.contourId, nodeId: only.nodeId };
}

function steppedPoint(
  state: EditorState,
  point: { contourId: ContourId; nodeId: string },
  direction: WalkDirection,
): ToolResult {
  const glyph = currentGlyph(state);
  const c = glyph === null ? null : contourById(glyph, point.contourId);
  if (c === null) return result(state);

  const index = c.nodes.findIndex((n) => n.id === point.nodeId);
  if (index < 0) return result(state);

  const next = around(index, direction, c.nodes.length, c.closed);
  const node = next === null ? null : c.nodes[next];
  if (node === undefined || node === null) return result(state);

  return result({
    ...state,
    selection: [{ contourId: c.id, nodeId: node.id, part: "point" }],
    // The curve panel follows the points: a segment focused by an earlier click
    // is not the segment the walk has arrived at.
    focusedSegment: null,
  });
}

function steppedSegment(
  state: EditorState,
  segment: SegmentRef,
  direction: WalkDirection,
): ToolResult {
  const glyph = currentGlyph(state);
  const c = glyph === null ? null : contourById(glyph, segment.contourId);
  if (c === null) return result(state);

  const count = segmentCount(c);
  if (count === 0) return result(state);

  const next = around(segment.segmentIndex, direction, count, c.closed);
  if (next === null) return result(state);

  return result({
    ...state,
    focusedSegment: { contourId: c.id, segmentIndex: next },
    // Its two ends, so the segment is visibly the thing being worked on and the
    // next Alt-arrow has the same segment to step from.
    selection: endsOf(c, next),
  });
}

/** The points a segment runs between, as a selection. */
function endsOf(c: Contour, segmentIndex: number): Selection {
  const from = c.nodes[segmentIndex];
  const to = c.nodes[(segmentIndex + 1) % c.nodes.length];
  if (from === undefined || to === undefined) return [];
  return [
    { contourId: c.id, nodeId: from.id, part: "point" },
    { contourId: c.id, nodeId: to.id, part: "point" },
  ];
}

/** One place along, coming round on a closed contour and stopping on an open one. */
function around(
  index: number,
  direction: WalkDirection,
  count: number,
  closed: boolean,
): number | null {
  const next = index + direction;
  if (next >= 0 && next < count) return next;
  if (!closed) return null;
  return next < 0 ? count - 1 : 0;
}
