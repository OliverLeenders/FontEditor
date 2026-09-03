import { type Vec2, project } from "@fonteditor/geometry";
import {
  type ComponentId,
  type ComponentSource,
  type KernMatch,
  type ContourId,
  type GlyphName,
  type IdFactory,
  type NodeId,
  type HandleLock,
  type Node,
  type NodeType,
  type RenameProblem,
  NO_LOCK,
  addGlyphComponent,
  balanceSegment,
  centreGlyph,
  component,
  contourById,
  deleteProblem,
  extendHandle,
  extendSegmentHandles,
  insertNodeOnSegment,
  isHalfHandled,
  kernIndex,
  kernMatch,
  makeSegmentCurve,
  makeSegmentLine,
  glyph,
  nodeById,
  putGlyph,
  removeGlyph,
  removeGlyphComponent,
  removeNode,
  renameGlyph as renameInDocument,
  renameProblem,
  reverseContour,
  roundFont,
  segmentAt,
  segmentCubic,
  setKern,
  setKerning,
  setLeftSidebearing,
  setRightSidebearing,
  sidebearings,
  setHandle,
  setHvLock,
  setNodeType,
  updateContour,
  roundGlyph,
  unroundedGlyphs,
  updateGlyph,
  wouldRecurse,
} from "@fonteditor/font-model";
import { type SegmentRef, type Selection, type SelectionItem, itemPoint } from "@fonteditor/view";

import { type ToolResult, begin, commit, result } from "./effects.js";
import { translateSelection } from "./gestures.js";
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

  const side = which === "both" ? "handles" : which === "in" ? "incoming handle" : "outgoing handle";
  return done(
    state,
    document === null ? null : { ...state, document },
    locked ? `Lock ${side} to axis` : `Unlock ${side} from axis`,
  );
}

/** Which of a node's handles are held to an axis. */
export function nodeHvLocked(
  state: EditorState,
  contourId: ContourId,
  nodeId: NodeId,
): HandleLock {
  const glyph = currentGlyph(state);
  const c = glyph === null ? null : contourById(glyph, contourId);
  return (c === null ? null : nodeById(c, nodeId))?.hvLock ?? NO_LOCK;
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

// ---------------------------------------------------------------------------
// glyphs
// ---------------------------------------------------------------------------

export type NewGlyph = {
  readonly name: GlyphName;
  readonly unicodes?: readonly number[];
};

/**
 * Add glyphs that are not there yet.
 *
 * Takes a list and commits once, because the useful case is "give me ASCII" and
 * ninety-five separate undo entries would make that impossible to take back.
 * A name already in the document is skipped rather than replacing what is
 * there: creating a glyph must never overwrite one.
 */
export function createGlyphs(
  state: EditorState,
  wanted: readonly NewGlyph[],
  advance: number,
): ToolResult {
  const fresh = wanted.filter((g) => g.name !== "" && state.document.glyphs[g.name] === undefined);
  if (fresh.length === 0) return result(state);

  let document = state.document;
  for (const g of fresh) {
    document = putGlyph(
      document,
      glyph(g.name, { unicodes: g.unicodes ?? [], advance }),
    );
  }

  const label =
    fresh.length === 1 ? `Add ${fresh[0]!.name}` : `Add ${String(fresh.length)} glyphs`;
  const first = fresh[0]!.name;
  return result({ ...state, document, currentGlyph: first, selection: [] }, [
    begin(label, false),
    commit,
  ]);
}

/**
 * Remove a glyph.
 *
 * Components referring to it are left alone rather than hunted down. Resolution
 * already treats a missing base as drawing nothing, so the font stays openable,
 * and undo is one keystroke away — whereas rewriting other glyphs as a side
 * effect of a delete is the kind of help nobody asks for.
 */
export function deleteGlyph(state: EditorState, name: GlyphName): ToolResult {
  const document = removeGlyph(state.document, name);
  if (document === null) return result(state);

  const currentGlyph =
    state.currentGlyph === name ? document.glyphOrder[0] ?? "" : state.currentGlyph;

  return result(
    { ...state, document, currentGlyph, selection: [], focusedSegment: null, hoveredSegment: null },
    [begin(`Delete ${name}`, false), commit],
  );
}

// ---------------------------------------------------------------------------
// components
// ---------------------------------------------------------------------------

/**
 * Place another glyph inside the current one.
 *
 * Refuses a placement that would close a loop, rather than accepting it and
 * drawing nothing: "that would make a refer to itself" is a far better answer
 * than a glyph that silently stops appearing.
 */
export function addComponent(
  state: EditorState,
  base: GlyphName,
  ids: IdFactory,
): ToolResult {
  const owner = state.currentGlyph;
  if (base === "" || state.document.glyphs[base] === undefined) return result(state);

  const source: ComponentSource = { glyphOf: (name) => state.document.glyphs[name] ?? null };
  if (wouldRecurse(source, owner, base)) return result(state);

  const document = editCurrentGlyph(state, (g) =>
    addGlyphComponent(g, component(ids.component(), base)),
  );
  return done(state, document === null ? null : { ...state, document }, `Add ${base}`);
}

export function removeComponent(state: EditorState, id: ComponentId): ToolResult {
  const document = editCurrentGlyph(state, (g) => removeGlyphComponent(g, id));
  return done(state, document === null ? null : { ...state, document }, "Remove component");
}

// ---------------------------------------------------------------------------
// kerning
// ---------------------------------------------------------------------------

/**
 * Change the kerning between two glyphs by a step.
 *
 * Written to whichever pair already governs them, so nudging a pair that is
 * kerned by a class adjusts the class — which is what a designer means by
 * "these are too far apart" when the two letters are examples of a category.
 * Making it an exception instead is a deliberate act, and a separate one.
 */
export function nudgeKern(
  state: EditorState,
  left: GlyphName,
  right: GlyphName,
  delta: number,
): ToolResult {
  if (delta === 0) return result(state);

  const index = kernIndex(state.document.kerning);
  const existing = kernMatch(index, left, right);
  const first = existing?.first ?? left;
  const second = existing?.second ?? right;
  const value = (existing?.value ?? 0) + delta;

  const kerning = setKern(state.document.kerning, first, second, value);
  if (kerning === state.document.kerning) return result(state);

  return result({ ...state, document: setKerning(state.document, kerning) }, [
    begin(`Kern ${first} ${second}`),
    commit,
  ]);
}

/**
 * Pin a pair at its current value, breaking it out of the class governing it.
 *
 * The way to correct one pair without disturbing the category it belongs to.
 * Does nothing when the pair is already its own, since there is nothing to
 * break out of.
 */
export function breakOutKern(
  state: EditorState,
  left: GlyphName,
  right: GlyphName,
): ToolResult {
  const index = kernIndex(state.document.kerning);
  const existing = kernMatch(index, left, right);
  if (existing === null || !existing.grouped) return result(state);

  const kerning = setKern(state.document.kerning, left, right, existing.value);
  return done(
    state,
    { ...state, document: setKerning(state.document, kerning) },
    `Kern ${left} ${right} separately`,
  );
}

/** What governs a pair right now, for an interface that has to explain itself. */
export function kerningFor(
  state: EditorState,
  left: GlyphName,
  right: GlyphName,
): KernMatch | null {
  return kernMatch(kernIndex(state.document.kerning), left, right);
}

// ---------------------------------------------------------------------------
// spacing
// ---------------------------------------------------------------------------

/**
 * Move one sidebearing of a named glyph by a step.
 *
 * Named rather than current, because the spacing view edits whichever letter is
 * selected in a line of text, which is usually not the glyph open for drawing.
 *
 * Coalescing is left on: holding an arrow key is one adjustment being made, and
 * a hundred undo entries for it would be useless. Nudging a *different* glyph or
 * a different side starts a new entry, because the label differs.
 */
export function nudgeSidebearing(
  state: EditorState,
  glyphName: GlyphName,
  side: "left" | "right",
  delta: number,
): ToolResult {
  if (delta === 0) return result(state);

  const document = updateGlyph(state.document, glyphName, (g) => {
    const current = sidebearings(g);
    if (current === null) return null;
    return side === "left"
      ? setLeftSidebearing(g, current.left + delta)
      : setRightSidebearing(g, current.right + delta);
  });
  if (document === null) return result(state);

  const label = side === "left" ? "Left sidebearing" : "Right sidebearing";
  return result({ ...state, document }, [begin(`${label} of ${glyphName}`), commit]);
}

/** Equal space either side, within the advance the glyph already has. */
export function centreCurrentGlyph(state: EditorState): ToolResult {
  const document = editCurrentGlyph(state, (g) => centreGlyph(g));
  return done(state, document === null ? null : { ...state, document }, "Centre glyph");
}

/**
 * Put every coordinate in the font on whole units.
 *
 * The whole font rather than the open glyph, because the problem it answers is
 * a font-wide one: an import from a different em size, or a drawing made before
 * anything rounded. Doing it a glyph at a time would leave a font in two states
 * and no way to tell which glyphs had been done.
 *
 * One undo step for all of it, which is the only sane arrangement — a partial
 * undo of this would be worse than not undoing it.
 */
export function roundCoordinates(state: EditorState): ToolResult {
  const document = roundFont(state.document);
  if (document === state.document) return result(state);
  return done(state, { ...state, document }, "Round coordinates");
}

/** How many glyphs {@link roundCoordinates} would change, for a caller to say so. */
export function unroundedCount(state: EditorState): number {
  return unroundedGlyphs(state.document);
}

/**
 * Put one glyph's coordinates on whole units.
 *
 * The same operation as the font-wide one, aimed. Worth having separately
 * because a font-wide round is a decision about the whole file and this is a
 * decision about the glyph in front of you — and because undoing the wrong one
 * takes back a great deal more than was meant.
 */
export function roundGlyphAt(state: EditorState, name: GlyphName): ToolResult {
  const glyph = state.document.glyphs[name];
  if (glyph === undefined) return result(state);

  const rounded = roundGlyph(glyph);
  if (rounded === glyph) return result(state);

  return done(state, { ...state, document: putGlyph(state.document, rounded) }, "Round glyph");
}

/**
 * Put the selected points and handles on whole units, and nothing else.
 *
 * Literally what is selected: a selected on-curve point rounds its own
 * coordinate and a selected handle rounds its own. A point does *not* drag its
 * handles onto the grid with it — they are positions in their own right, they
 * can be selected in their own right, and rounding things nobody picked is how a
 * command like this stops being predictable.
 */
export function roundSelection(state: EditorState): ToolResult {
  if (state.selection.length === 0) return result(state);

  const wanted = new Map<ContourId, Set<string>>();
  for (const item of state.selection) {
    const parts = wanted.get(item.contourId) ?? new Set<string>();
    parts.add(`${item.nodeId} ${item.part}`);
    wanted.set(item.contourId, parts);
  }

  let editor = state;
  for (const [contourId, parts] of wanted) {
    const document = editCurrentGlyph(editor, (g) =>
      updateContour(g, contourId, (c) => ({
        ...c,
        nodes: c.nodes.map((n) => roundParts(n, parts)),
      })),
    );
    if (document !== null) editor = { ...editor, document };
  }

  return done(state, editor === state ? null : editor, "Round selection");
}

const whole = (p: Vec2): Vec2 => ({ x: Math.round(p.x), y: Math.round(p.y) });

/** A node with just the selected parts of it rounded, or the node unchanged. */
function roundParts(n: Node, parts: ReadonlySet<string>): Node {
  const pt = parts.has(`${n.id} point`) ? whole(n.pt) : n.pt;
  const incoming = n.in !== null && parts.has(`${n.id} in`) ? whole(n.in) : n.in;
  const outgoing = n.out !== null && parts.has(`${n.id} out`) ? whole(n.out) : n.out;

  const same =
    pt.x === n.pt.x &&
    pt.y === n.pt.y &&
    incoming === n.in &&
    outgoing === n.out;

  return same ? n : { ...n, pt, in: incoming, out: outgoing };
}

/** How many selected coordinates {@link roundSelection} would move. */
export function unroundedSelected(state: EditorState): number {
  const glyph = currentGlyph(state);
  if (glyph === null) return 0;

  let count = 0;
  for (const item of state.selection) {
    const p = itemPoint(glyph, item);
    if (p !== null && (p.x !== Math.round(p.x) || p.y !== Math.round(p.y))) count += 1;
  }
  return count;
}

/**
 * Rename a glyph, carrying every reference to it along.
 *
 * A name is a reference, not a label — components place a glyph by name, and
 * kerning names it on both sides of a pair and again inside any group it belongs
 * to. `renameGlyph` in the model moves all of them together; this is the part
 * that keeps the editor pointing at the right glyph afterwards.
 *
 * Not undoable in the ordinary way is *not* the choice here: it is one step like
 * any other edit, because it is one, and taking it back should put the old name
 * and every reference to it back exactly.
 */
export function renameCurrentGlyph(state: EditorState, to: GlyphName): ToolResult {
  const from = state.currentGlyph;
  const document = renameInDocument(state.document, from, to.trim());
  if (document === null) return result(state);

  return done(state, { ...state, document, currentGlyph: to.trim() }, "Rename glyph");
}

/** Why deleting a glyph would be refused, or `null` if it would not be. */
export function deleteRefusal(state: EditorState, name: GlyphName): "missing" | "reserved" | null {
  return deleteProblem(state.document, name);
}

/** Why renaming the open glyph would be refused, or `null` if it would not be. */
export function renameRefusal(state: EditorState, to: string): RenameProblem | null {
  return renameProblem(state.document, state.currentGlyph, to.trim());
}

// ---------------------------------------------------------------------------
// coordinates
// ---------------------------------------------------------------------------

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
export function moveCoordinateTo(
  state: EditorState,
  item: SelectionItem,
  point: Vec2,
): ToolResult {
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
