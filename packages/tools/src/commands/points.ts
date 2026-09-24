import {
  type ContourId,
  type NodeId,
  type Node as NodeShape,
  type HandleLock,
  type NodeType,
  NO_LOCK,
  canBeTangent,
  contourById,
  curvatureAround,
  harmoniseNode,
  extendHandle,
  extendSegmentHandles,
  isHalfHandled,
  nodeById,
  nodeIndex,
  removeNodeFitted,
  setHandle,
  setHvLock,
  setNodeType,
  updateContour,
} from "@typewright/font-model";
import { type SegmentRef } from "@typewright/view";
import { type ToolResult, result } from "../effects.js";
import { type EditorState, currentGlyph, editCurrentGlyph } from "../state.js";
import { done } from "./shared.js";

/**
 * Commands about one point, or the points that are selected: what type it is,
 * what its handles do, and taking it out of the contour.
 */

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
  return done(state, editor === state ? null : editor, `Make ${type}`);
}

/**
 * Whether a node could truthfully be tangent.
 *
 * Asked before the type is offered rather than after it is refused: a button
 * that does nothing when pressed teaches nothing about why.
 */
export function nodeCanBeTangent(
  state: EditorState,
  contourId: ContourId,
  nodeId: NodeId,
): boolean {
  const glyph = currentGlyph(state);
  const c = glyph === null ? null : contourById(glyph, contourId);
  if (c === null) return false;
  const index = nodeIndex(c, nodeId);
  return index >= 0 && canBeTangent(c, index);
}

/**
 * The one node the handle fields act on, when the selection names exactly one.
 *
 * A handle belongs to a node, so selecting either says which node is meant: the
 * point itself, or one of the two handles hanging off it. Anything else — no
 * selection, or several — is `null`, for the reason {@link selectedCoordinate}
 * is: fields that showed one arbitrary member of a set would promise to edit the
 * set and edit one of it.
 */
export function selectedNode(
  state: EditorState,
): { readonly contourId: ContourId; readonly nodeId: NodeId; readonly node: NodeShape } | null {
  if (state.selection.length !== 1) return null;
  const item = state.selection[0]!;

  const glyph = currentGlyph(state);
  const c = glyph === null ? null : contourById(glyph, item.contourId);
  const found = c === null ? null : nodeById(c, item.nodeId);
  if (found === null) return null;
  return { contourId: item.contourId, nodeId: item.nodeId, node: found };
}

/**
 * The curvature either side of the one selected node, and what it means.
 *
 * `radius` rather than curvature itself, because a radius is a length in the
 * units the letter is drawn in — "this side turns as if on a circle of 320" —
 * where curvature is a number with no size anybody has a feel for. The ratio is
 * the reading that matters: one is a join the light crosses without a crease.
 */
export function selectedCurvature(state: EditorState): {
  readonly before: number;
  readonly after: number;
  readonly ratio: number;
} | null {
  const found = selectedNode(state);
  const glyph = currentGlyph(state);
  const c = found === null || glyph === null ? null : contourById(glyph, found.contourId);
  if (found === null || c === null) return null;

  const k = curvatureAround(c, found.nodeId);
  if (k === null) return null;

  const before = Math.abs(k.before);
  const after = Math.abs(k.after);
  if (before === 0 || after === 0) return null;

  // The larger over the smaller, so the number reads the same whichever side is
  // tighter: 1 is agreement and 3 is a join three times sharper on one side.
  const ratio = before > after ? before / after : after / before;
  return { before: 1 / before, after: 1 / after, ratio };
}

/**
 * Move every selected node to where the curvature either side of it agrees.
 *
 * Nodes that cannot be harmonised are passed over rather than refused: a
 * selection is usually a whole shape, and "some of these are corners" is not a
 * reason to leave the rest crooked.
 */
export function harmoniseSelection(state: EditorState): ToolResult {
  let editor = state;
  for (const item of state.selection) {
    if (item.part !== "point") continue;
    const document = editCurrentGlyph(editor, (g) =>
      updateContour(g, item.contourId, (c) => harmoniseNode(c, item.nodeId)),
    );
    if (document !== null) editor = { ...editor, document };
  }
  return done(state, editor === state ? null : editor, "Harmonise");
}

/**
 * Whether harmonising would move anything in the selection.
 *
 * Any rather than every: the command harmonises the joins that have two
 * curvatures to reconcile and leaves the rest alone, so offering it whenever it
 * would do *something* says the truth about what pressing it does.
 */
export function selectionCanHarmonise(state: EditorState): boolean {
  return state.selection.some(
    (item) => item.part === "point" && nodeCanHarmonise(state, item.contourId, item.nodeId),
  );
}

/** Whether a node is one harmonising would move, for the menu to offer it. */
export function nodeCanHarmonise(
  state: EditorState,
  contourId: ContourId,
  nodeId: NodeId,
): boolean {
  const glyph = currentGlyph(state);
  const c = glyph === null ? null : contourById(glyph, contourId);
  return c !== null && harmoniseNode(c, nodeId) !== null;
}

/** Whether every selected point could be tangent, for the inspector's button. */
export function selectedCanBeTangent(state: EditorState): boolean {
  const points = state.selection.filter((item) => item.part === "point");
  if (points.length === 0) return false;
  return points.every((item) => nodeCanBeTangent(state, item.contourId, item.nodeId));
}

/**
 * Turn the axis constraint on or off, for one handle or for both.
 *
 * Switching it on also straightens the handle — see `setHvLock` in the model for
 * why, and for what that means on a smooth node.
 */
export function setNodeHvLock(
  state: EditorState,
  contourId: ContourId,
  nodeId: NodeId,
  which: "in" | "out" | "both",
  locked: boolean,
): ToolResult {
  const document = editCurrentGlyph(state, (g) =>
    updateContour(g, contourId, (c) => setHvLock(c, nodeId, which, locked)),
  );

  const side =
    which === "both" ? "handles" : which === "in" ? "incoming handle" : "outgoing handle";
  return done(
    state,
    document === null ? null : { ...state, document },
    locked ? `Lock ${side} to axis` : `Unlock ${side} from axis`,
  );
}

/** Which of a node's handles are held to an axis. */
export function nodeHvLocked(state: EditorState, contourId: ContourId, nodeId: NodeId): HandleLock {
  const glyph = currentGlyph(state);
  const c = glyph === null ? null : contourById(glyph, contourId);
  return (c === null ? null : nodeById(c, nodeId))?.hvLock ?? NO_LOCK;
}

/**
 * The nodes a selection names, each once.
 *
 * A node is in the selection whether it was the point or one of its handles
 * that was picked, and a selection holding a point and its own handle names one
 * node twice. What acts on nodes wants each of them once.
 */
function selectedNodes(state: EditorState): { contourId: ContourId; nodeId: NodeId }[] {
  const seen = new Set<string>();
  const out: { contourId: ContourId; nodeId: NodeId }[] = [];
  for (const item of state.selection) {
    const key = `${item.contourId}:${item.nodeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ contourId: item.contourId, nodeId: item.nodeId });
  }
  return out;
}

/** How many nodes a menu item would act on, for it to say so. */
export function selectedNodeCount(state: EditorState): number {
  return selectedNodes(state).length;
}

/**
 * Lock or free the handles of every node in the selection.
 *
 * The same edit the single-node version makes, made to each of them in one
 * step, so that one undo takes back what one press did. Which nodes those are
 * is settled by the canvas: a right-click on something outside the selection
 * selects it first, so a menu acting on the selection acts on what was clicked
 * when nothing else was picked, and on the lot when something was.
 */
export function setSelectedHvLock(
  state: EditorState,
  which: "in" | "out" | "both",
  locked: boolean,
): ToolResult {
  const targets = selectedNodes(state);
  if (targets.length === 0) return result(state);

  let editor = state;
  for (const target of targets) {
    const document = editCurrentGlyph(editor, (g) =>
      updateContour(g, target.contourId, (c) => setHvLock(c, target.nodeId, which, locked)),
    );
    if (document !== null) editor = { ...editor, document };
  }

  const side =
    which === "both" ? "handles" : which === "in" ? "incoming handle" : "outgoing handle";
  return done(state, editor === state ? null : editor, `${locked ? "Lock" : "Free"} ${side}`);
}

/** Whether every node in the selection is already locked that way, for the tick. */
export function selectionHvLocked(state: EditorState, which: "in" | "out" | "both"): boolean {
  const targets = selectedNodes(state);
  if (targets.length === 0) return false;
  return targets.every((target) => {
    const lock = nodeHvLocked(state, target.contourId, target.nodeId);
    return which === "both" ? lock.in && lock.out : lock[which];
  });
}

/**
 * Remove the selected on-curve points.
 *
 * Handles in the selection are ignored: Backspace on a handle should not delete
 * the point it belongs to, which is a much larger edit than the one asked for.
 *
 * What is left is fitted to the shape that was there — see `removeNodeFitted`.
 * A point taken off a curve is usually one somebody decided was surplus, and a
 * deletion that dents the outline means redrawing by hand what the arithmetic
 * can work out.
 */
export function deleteSelectedPoints(state: EditorState): ToolResult {
  const points = state.selection.filter((item) => item.part === "point");
  if (points.length === 0) return result(state);

  let editor = state;
  for (const item of points) {
    const document = editCurrentGlyph(editor, (g) =>
      updateContour(g, item.contourId, (c) => removeNodeFitted(c, item.nodeId)),
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

/**
 * Pull out the handles a node has not got.
 *
 * The inverse of retracting. Both sides at once, because asking for them
 * separately would mean knowing which one is missing, and the missing one is
 * exactly the one that cannot be seen or clicked.
 */
export function extractHandles(
  state: EditorState,
  contourId: ContourId,
  nodeId: NodeId,
): ToolResult {
  const document = editCurrentGlyph(state, (g) =>
    updateContour(g, contourId, (c) => {
      const withIn = extendHandle(c, nodeId, "in") ?? c;
      return extendHandle(withIn, nodeId, "out") ?? withIn;
    }),
  );
  if (document === null) return result(state);
  if (document === state.document) return result(state);
  return done(state, { ...state, document }, "Extract handles");
}

/** Complete a curve that is missing one of its two control points. */
export function extractSegmentHandles(state: EditorState, segment: SegmentRef): ToolResult {
  const document = editCurrentGlyph(state, (g) =>
    updateContour(g, segment.contourId, (c) => extendSegmentHandles(c, segment.segmentIndex)),
  );
  if (document === null || document === state.document) return result(state);
  return done(state, { ...state, document }, "Extract handles");
}

/**
 * Pull out the handles every selected node is missing.
 *
 * One step for the lot, like the rest of these: a person who selected a run of
 * points and asked for their handles wants one thing to undo, not eleven.
 */
export function extractSelectedHandles(state: EditorState): ToolResult {
  const targets = selectedNodes(state);
  if (targets.length === 0) return result(state);

  let editor = state;
  for (const target of targets) {
    const document = editCurrentGlyph(editor, (g) =>
      updateContour(g, target.contourId, (c) => {
        const withIn = extendHandle(c, target.nodeId, "in") ?? c;
        return extendHandle(withIn, target.nodeId, "out") ?? withIn;
      }),
    );
    if (document !== null) editor = { ...editor, document };
  }
  return done(state, editor === state ? null : editor, "Extract handles");
}

/** Whether anything in the selection has a handle worth pulling out. */
export function selectionHasMissingHandle(state: EditorState): boolean {
  return selectedNodes(state).some((target) =>
    nodeHasMissingHandle(state, target.contourId, target.nodeId),
  );
}

/** Whether a node has a handle missing that could be pulled out. */
export function nodeHasMissingHandle(
  state: EditorState,
  contourId: ContourId,
  nodeId: NodeId,
): boolean {
  const glyph = currentGlyph(state);
  const c = glyph === null ? null : contourById(glyph, contourId);
  if (c === null) return false;
  const n = nodeById(c, nodeId);
  if (n === null) return false;
  // An open contour's ends genuinely have no segment on the far side, so a
  // missing handle there is not something to offer to create.
  if (!c.closed && (c.nodes[0]?.id === nodeId || c.nodes[c.nodes.length - 1]?.id === nodeId)) {
    return n.in === null && n.out === null;
  }
  return n.in === null || n.out === null;
}

/** Whether a segment is drawn as a curve but has a control point out of reach. */
export function segmentHasMissingHandle(state: EditorState, segment: SegmentRef): boolean {
  const glyph = currentGlyph(state);
  const c = glyph === null ? null : contourById(glyph, segment.contourId);
  return c !== null && isHalfHandled(c, segment.segmentIndex);
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
