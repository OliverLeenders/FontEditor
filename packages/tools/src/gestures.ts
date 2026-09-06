import { type Vec2, about, add, keepsAxes, rotation, sub } from "@fonteditor/geometry";
import {
  type AnchorId,
  type ComponentId,
  type ContourId,
  type Glyph,
  type NodeId,
  contourById,
  metricLines,
  movedComponent,
  moveAnchorTo,
  moveSegmentTunniLine,
  nodeById,
  segmentAt,
  segmentIndexForHandle,
  setHandle,
  setLeftSidebearing,
  setSegmentTunniPoint,
  sidebearings,
  translateNodes,
  updateContour,
  updateGlyph,
  updateGlyphComponent,
} from "@fonteditor/font-model";
import {
  type BoxFrame,
  type BoxHandle,
  type HitTarget,
  type SegmentRef,
  type Selection,
  type SelectionItem,
  type Snapping,
  NO_HOLD,
  NO_SNAPPING,
  SNAP_PIXELS,
  SNAP_STAY_PIXELS,
  SNAP_STICKINESS,
  addItems,
  alignmentLines,
  hasItem,
  itemForTarget,
  itemsInRect,
  metricLine,
  screenTolerance,
  selectionPoints,
  snapDelta,
  snapPoint,
  toGrid,
  toggleItem,
  boxPivot,
  boxScale,
  boxScaleTransform,
  boxTurn,
} from "@fonteditor/view";

import { type ToolResult, begin, result } from "./effects.js";
import type { PointerInput } from "./input.js";
import { type EditorState, type Gesture, currentGlyph } from "./state.js";
import { transformedDocument } from "./transform.js";

/**
 * Beginning and continuing a drag.
 *
 * Split from the tool's entry points because a gesture used to be described in
 * two places — where it started, and a branch of a switch far below that carried
 * it on — and the two drifted. Here each kind is one entry in one table, and the
 * table's type makes a missing half a compile error rather than a gesture that
 * begins and then does nothing.
 */

/** Stands in when the current glyph name does not resolve, so reads stay total. */
export const EMPTY_GLYPH: Glyph = {
  name: "",
  unicodes: [],
  advance: 0,
  contours: [],
  components: [],
  anchors: [],
};

// ---------------------------------------------------------------------------
// starting
// ---------------------------------------------------------------------------

/**
 * Shift extends or removes; a plain click replaces — unless the thing clicked is
 * already selected, in which case the selection is left alone so a multi-item
 * drag is not destroyed by grabbing one of its members.
 */
function nextSelection(selection: Selection, item: SelectionItem, extend: boolean): Selection {
  if (extend) return toggleItem(selection, item);
  if (hasItem(selection, item)) return selection;
  return [item];
}

function handleSegment(state: EditorState, item: SelectionItem): SegmentRef | null {
  if (item.part === "point") return null;
  const c = contourById(currentGlyph(state) ?? EMPTY_GLYPH, item.contourId);
  if (c === null) return null;
  const segmentIndex = segmentIndexForHandle(c, item.nodeId, item.part);
  return segmentIndex === null ? null : { contourId: item.contourId, segmentIndex };
}

export function startMarquee(state: EditorState, input: PointerInput): ToolResult {
  const additive = input.modifiers.shift;
  // Clicking empty canvas means "nothing in particular", so it drops focus as
  // well as selection — otherwise a focused segment's controls would linger with
  // no way to dismiss them.
  return result({
    ...state,
    selection: additive ? state.selection : [],
    focusedSegment: additive ? state.focusedSegment : null,
    gesture: {
      kind: "marquee",
      origin: input.point,
      current: input.point,
      additive,
      before: state.selection,
      moved: false,
    },
  });
}

/**
 * Begin dragging everything that is selected, from inside the box round it.
 *
 * The box is how a selection says where it is, so taking hold of it there is
 * what anyone would try — and until now the inside of it belonged to the
 * marquee, which meant a drag begun on the shape you had just selected threw
 * the selection away and started a new one.
 *
 * Nothing is selected or deselected by it: what moves is exactly what was
 * already chosen, which is the difference between this and dragging a node.
 */
export function startSelectionDrag(state: EditorState, input: PointerInput): ToolResult {
  return result(
    {
      ...state,
      gesture: {
        kind: "dragSelection",
        origin: input.point,
        items: state.selection,
        before: state.document,
        moved: false,
        snapped: NO_HOLD,
      },
    },
    [begin("Move selection")],
  );
}

export function startItemDrag(
  state: EditorState,
  input: PointerInput,
  target: HitTarget,
): ToolResult {
  const item = itemForTarget(target);
  if (item === null) return result(state);

  const selection = nextSelection(state.selection, item, input.modifiers.shift);

  // Shift-clicking to deselect should not then drag the thing just removed.
  if (!hasItem(selection, item)) return result({ ...state, selection });

  const isHandle = item.part !== "point";
  const label = isHandle ? "Move handle" : "Move node";

  // A handle shapes exactly one segment, so touching it says unambiguously which
  // segment is being worked on. A node sits between two and names neither, so
  // dragging one leaves focus where it was rather than guessing.
  const focusedSegment = isHandle
    ? (handleSegment(state, item) ?? state.focusedSegment)
    : state.focusedSegment;

  const gesture: Gesture =
    isHandle && selection.length === 1
      ? {
          kind: "dragHandle",
          origin: input.point,
          contourId: item.contourId,
          nodeId: item.nodeId,
          part: item.part === "in" ? "in" : "out",
          breakSmooth: input.modifiers.alt,
          before: state.document,
          moved: false,
          snapped: NO_HOLD,
        }
      : {
          kind: "dragSelection",
          origin: input.point,
          items: selection,
          before: state.document,
          moved: false,
          snapped: NO_HOLD,
        };

  return result({ ...state, selection, focusedSegment, gesture }, [begin(label)]);
}

/**
 * Begin dragging one handle of the box round the selection.
 *
 * The selection is left exactly as it is: the box is a way of moving what is
 * already chosen, and a grab that changed the choice would move something other
 * than what the box was drawn around.
 */
export function startBoxTransform(
  state: EditorState,
  input: PointerInput,
  handle: BoxHandle,
  box: BoxFrame,
): ToolResult {
  return result(
    {
      ...state,
      gesture: {
        kind: "transformBox",
        origin: input.point,
        handle,
        box,
        items: state.selection,
        before: state.document,
        moved: false,
      },
    },
    [begin(handle.action === "rotate" ? "Rotate" : "Scale", false)],
  );
}

/**
 * Begin dragging a component.
 *
 * The point selection goes, as it does for an anchor: what is being moved is a
 * placed glyph, and a box round points that are staying put would say otherwise.
 */
export function startComponentDrag(
  state: EditorState,
  input: PointerInput,
  componentId: ComponentId,
): ToolResult {
  return result(
    {
      ...state,
      selection: [],
      selectedAnchor: null,
      selectedComponent: componentId,
      gesture: {
        kind: "dragComponent",
        origin: input.point,
        componentId,
        before: state.document,
        moved: false,
        snapped: NO_HOLD,
      },
    },
    [begin("Move component")],
  );
}

/**
 * Begin dragging an anchor.
 *
 * Selecting it as well, so the panel shows what is being moved — and clearing
 * the point selection, because a box round points that are not moving while an
 * anchor is would say something untrue about what the drag does.
 */
export function startAnchorDrag(
  state: EditorState,
  input: PointerInput,
  anchorId: AnchorId,
): ToolResult {
  return result(
    {
      ...state,
      selection: [],
      selectedAnchor: anchorId,
      gesture: {
        kind: "dragAnchor",
        origin: input.point,
        anchorId,
        before: state.document,
        moved: false,
        snapped: NO_HOLD,
      },
    },
    [begin("Move anchor")],
  );
}

export function startTunniDrag(
  state: EditorState,
  input: PointerInput,
  kind: "dragTunniPoint" | "dragTunniLine",
  segmentIndex: number,
  contourId: string,
): ToolResult {
  const label = kind === "dragTunniPoint" ? "Move Tunni point" : "Move Tunni line";
  const segment = { contourId, segmentIndex };
  return result(
    {
      ...state,
      focusedSegment: segment,
      gesture: { kind, origin: input.point, segment, before: state.document, moved: false },
    },
    [begin(label)],
  );
}

/**
 * Begin dragging a margin line.
 *
 * The selection is cleared first. These lines belong to the glyph as a whole, and
 * leaving points selected would make the next arrow-key nudge move them rather
 * than doing what the spacing gesture just implied.
 */
export function startMarginDrag(
  state: EditorState,
  input: PointerInput,
  side: "origin" | "advance",
): ToolResult {
  const glyph = currentGlyph(state);
  if (glyph === null) return result(state);

  return result(
    {
      ...state,
      selection: [],
      gesture: {
        kind: "dragMargin",
        origin: input.point,
        side,
        startAdvance: glyph.advance,
        startLeft: sidebearings(glyph)?.left ?? null,
        before: state.document,
        moved: false,
      },
    },
    [begin(side === "origin" ? "Move glyph" : "Set advance", false)],
  );
}

/**
 * Clicking a segment selects the on-curve points at each end, so the whole span
 * can then be nudged or dragged as a unit.
 */
export function selectSegmentEnds(
  state: EditorState,
  input: PointerInput,
  target: Extract<HitTarget, { kind: "segment" }>,
): ToolResult {
  const c = contourById(currentGlyph(state) ?? EMPTY_GLYPH, target.contourId);
  const segment = c === null ? null : segmentAt(c, target.segmentIndex);
  if (segment === null) return result(state);

  const ends: Selection = [
    { contourId: target.contourId, nodeId: segment.fromId, part: "point" },
    { contourId: target.contourId, nodeId: segment.toId, part: "point" },
  ];
  const selection = input.modifiers.shift ? addItems(state.selection, ends) : ends;

  return result(
    {
      ...state,
      selection,
      focusedSegment: { contourId: target.contourId, segmentIndex: target.segmentIndex },
      gesture: {
        kind: "dragSelection",
        origin: input.point,
        items: selection,
        before: state.document,
        moved: false,
        snapped: NO_HOLD,
      },
    },
    [begin("Move segment")],
  );
}

// ---------------------------------------------------------------------------
// continuing
// ---------------------------------------------------------------------------

/**
 * Offset every selected item, resolving the overlaps a mixed selection creates.
 *
 * Three cases, and the order matters:
 *
 *  - A selected on-curve point moves with both its handles, so any handle of
 *    that node is skipped — moving it again would double its offset.
 *  - Exactly one handle of a node selected: move it through `setHandle`, which
 *    keeps a smooth node smooth by swinging the other side.
 *  - Both handles selected and not the point: move each without enforcing
 *    smoothness, because enforcing it twice makes each handle fight the other
 *    and the result depends on which was processed first.
 */
export function translateSelection(g: Glyph, selection: Selection, delta: Vec2): Glyph {
  if (delta.x === 0 && delta.y === 0) return g;

  const pointsMoved = new Set<string>();
  const handleCount = new Map<string, number>();
  for (const item of selection) {
    const key = `${item.contourId} ${item.nodeId}`;
    if (item.part === "point") pointsMoved.add(key);
    else handleCount.set(key, (handleCount.get(key) ?? 0) + 1);
  }

  // Grouped by contour, so each is rewritten once however many of its points
  // are selected. One `updateContour` per point copies the node list and settles
  // the tangents every time, which is quadratic in a selection that can now be a
  // whole contour in one gesture.
  const byContour = new Map<ContourId, Set<NodeId>>();
  for (const item of selection) {
    if (item.part !== "point") continue;
    const ids = byContour.get(item.contourId) ?? new Set<NodeId>();
    ids.add(item.nodeId);
    byContour.set(item.contourId, ids);
  }

  let next = g;

  for (const [contourId, ids] of byContour) {
    next = updateContour(next, contourId, (c) => translateNodes(c, ids, delta)) ?? next;
  }

  for (const item of selection) {
    // Bound to a const so the narrowing survives into the closure below —
    // TypeScript discards a narrowing on `item.part` there, since the object
    // could in principle be mutated in between.
    const part = item.part;
    if (part === "point") continue;

    const key = `${item.contourId} ${item.nodeId}`;
    if (pointsMoved.has(key)) continue;

    // Read from the original glyph: a sibling handle's move must not shift the
    // origin this one is offset from.
    const source = contourById(g, item.contourId);
    const original = source === null ? null : nodeById(source, item.nodeId);
    if (original === null) continue;
    const handle = part === "in" ? original.in : original.out;
    if (handle === null) continue;

    const breakSmooth = (handleCount.get(key) ?? 0) > 1;
    next =
      updateContour(next, item.contourId, (c) =>
        setHandle(c, item.nodeId, part, add(handle, delta), breakSmooth),
      ) ?? next;
  }

  return next;
}

function rectOf(a: Vec2, b: Vec2) {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

/**
 * Where drags are allowed to land, for the glyph being edited.
 *
 * The metric lines are exactly the ones the canvas already draws — the five of
 * them, the origin and the advance — and that is the rule this follows: a drag
 * may only catch on something visible. A pull towards an invisible line is
 * indistinguishable from a bug.
 *
 * Which is why the alignment lines are off unless a caller asks for them, and
 * why the line a drag is caught on is drawn while it holds: a stem edge is not
 * on the canvas the way the baseline is, so the guide is what makes the catch
 * visible. See `drawSnapGuides` in the renderer.
 *
 * The tolerances are converted from screen pixels, so the catch feels the same
 * at every zoom instead of covering half the em at a distance. Holding ctrl
 * turns the whole thing off, including the rounding, for the times when a
 * coordinate has to be exactly what the cursor says.
 */
export function snappingFor(
  state: EditorState,
  input: PointerInput,
  options: GestureOptions,
  started: Glyph,
  moving: Selection,
): Snapping {
  if (options.snap === false || input.modifiers.ctrl) return NO_SNAPPING;

  const glyph = currentGlyph(state);
  const alignment = alignmentLines(started, moving, {
    extremes: options.snapExtremes ?? false,
    neighbours: options.snapNeighbours ?? false,
  });

  const pixels = options.snapPixels ?? SNAP_PIXELS;
  return {
    // Font lines first: where a stem edge happens to sit exactly on the cap
    // height, catching "the cap height" is the more useful account of what
    // happened, and `catchLine` breaks a tie by the order it was given.
    xs: [
      metricLine(0, "origin"),
      ...(glyph === null ? [] : [metricLine(glyph.advance, "advance")]),
      ...alignment.xs,
    ],
    ys: [...metricLines(state.document.info).map((line) => metricLine(line.y)), ...alignment.ys],
    enter: screenTolerance(state.view, pixels),
    stay: screenTolerance(state.view, options.snapStayPixels ?? SNAP_STAY_PIXELS),
    stickiness: options.snapStickiness ?? SNAP_STICKINESS,
    grid: 1,
  };
}

export type GestureOptions = {
  /**
   * Land drags on the drawn lines, and on whole units otherwise. On by default:
   * a font is written in whole units, and an editor that quietly produced
   * fractional ones would be lying about what it is making.
   */
  readonly snap?: boolean;
  /** Catch radius in screen pixels. */
  readonly snapPixels?: number;
  /** How far a caught line may stray before it lets go, in screen pixels. */
  readonly snapStayPixels?: number;
  /** How much nearer a rival line must be to take a caught one's place. */
  readonly snapStickiness?: number;
  /**
   * Also catch on the points where the outline turns — stem edges, overshoot
   * tops, the point across a counter.
   *
   * Off until these lines are drawn. See {@link snappingFor}.
   */
  readonly snapExtremes?: boolean;
  /**
   * Also catch on the nodes either side of what is being dragged, which is how a
   * segment is made exactly upright or exactly level.
   *
   * Off until these lines are drawn, for the same reason.
   */
  readonly snapNeighbours?: boolean;
};

/**
 * How each gesture follows the pointer.
 *
 * A mapped type over the gesture union, so a new kind cannot be added without
 * one — which is exactly the drift this replaces. Each is handed the state with
 * the cursor already updated and the offset from where the drag began.
 */
type Continuations = {
  [K in Gesture["kind"]]: (
    state: EditorState,
    gesture: Extract<Gesture, { kind: K }>,
    input: PointerInput,
    delta: Vec2,
    options: GestureOptions,
  ) => EditorState;
};

/** Whether the pointer has actually gone anywhere since the press. */
const budged = (delta: Vec2): boolean => delta.x !== 0 || delta.y !== 0;

const CONTINUE: Continuations = {
  dragSelection: (state, gesture, input, delta, options) => {
    // Measured against the glyph as it was when the drag began: the offsets are
    // from those positions, so snapping has to ask where they started rather
    // than where the last frame left them — and the lines to catch on have to be
    // where they started too, or the drag would tow its own candidates along.
    const started = gesture.before.glyphs[state.currentGlyph] ?? EMPTY_GLYPH;
    const snapping = snappingFor(state, input, options, started, gesture.items);
    const snapped = snapDelta(
      selectionPoints(started, gesture.items),
      delta,
      snapping,
      gesture.snapped,
    );

    const document = updateGlyph(gesture.before, state.currentGlyph, (g) =>
      translateSelection(g, gesture.items, snapped.delta),
    );
    return {
      ...state,
      document: document ?? gesture.before,
      gesture: { ...gesture, moved: gesture.moved || budged(delta), snapped: snapped.hold },
    };
  },

  dragHandle: (state, gesture, input, delta, options) => {
    const started = gesture.before.glyphs[state.currentGlyph] ?? EMPTY_GLYPH;
    const moving: Selection = [
      { contourId: gesture.contourId, nodeId: gesture.nodeId, part: gesture.part },
    ];
    const snapping = snappingFor(state, input, options, started, moving);

    // A handle is placed at the cursor rather than offset from where it was, so
    // it is the position that snaps. A smooth node then swings its other handle
    // to match, which is the point: the snapped side is the one being aimed.
    const snapped = snapPoint(input.point, snapping, gesture.snapped);
    const document = updateGlyph(gesture.before, state.currentGlyph, (g) =>
      updateContour(g, gesture.contourId, (c) =>
        setHandle(c, gesture.nodeId, gesture.part, snapped.point, gesture.breakSmooth),
      ),
    );
    return {
      ...state,
      document: document ?? gesture.before,
      gesture: { ...gesture, moved: gesture.moved || budged(delta), snapped: snapped.hold },
    };
  },

  dragComponent: (state, gesture, input, delta, options) => {
    // Only the grid and the font's own lines: the outlines a component draws
    // belong to another glyph, so there is nothing of *this* drawing for them
    // to line up with except the metrics — and an accent lining itself up with
    // the letter under it is what anchors are for.
    const started = gesture.before.glyphs[state.currentGlyph] ?? EMPTY_GLYPH;
    const snapping = snappingFor(state, input, options, started, []);
    const snapped = snapDelta([gesture.origin], delta, snapping, gesture.snapped);

    const document = updateGlyph(gesture.before, state.currentGlyph, (g) =>
      updateGlyphComponent(g, gesture.componentId, (c) =>
        movedComponent(c, snapped.delta.x, snapped.delta.y),
      ),
    );
    return {
      ...state,
      document: document ?? gesture.before,
      gesture: { ...gesture, moved: gesture.moved || budged(delta), snapped: snapped.hold },
    };
  },

  dragAnchor: (state, gesture, input, delta, options) => {
    // Snapped like a node, and against the same lines: an anchor is placed
    // relative to the drawing — the middle of a letter, the height its accents
    // sit at — so the stem edges and metric lines are exactly what it wants.
    const started = gesture.before.glyphs[state.currentGlyph] ?? EMPTY_GLYPH;
    const snapping = snappingFor(state, input, options, started, []);
    const snapped = snapPoint(input.point, snapping, gesture.snapped);

    const document = updateGlyph(gesture.before, state.currentGlyph, (g) =>
      moveAnchorTo(g, gesture.anchorId, snapped.point),
    );
    return {
      ...state,
      document: document ?? gesture.before,
      gesture: { ...gesture, moved: gesture.moved || budged(delta), snapped: snapped.hold },
    };
  },

  dragTunniPoint: (state, gesture, input, delta) =>
    continueTunni(state, gesture, input, delta, setSegmentTunniPoint),

  dragTunniLine: (state, gesture, input, delta) =>
    continueTunni(state, gesture, input, delta, moveSegmentTunniLine),

  dragMargin: (state, gesture, input, delta, options) => {
    // Only the grid applies: an advance is a measurement, not a position, and
    // there is nothing on that axis for it to line up with yet.
    const snapping = snappingFor(state, input, options, EMPTY_GLYPH, []);

    // The origin line cannot itself move — it *is* x = 0. Dragging it means
    // "put this much space before the glyph", so the outline follows the cursor
    // and the advance grows with it, holding the right sidebearing. The advance
    // line does move, and changes the advance alone.
    const document =
      gesture.side === "advance"
        ? updateGlyph(gesture.before, state.currentGlyph, (g) => ({
            ...g,
            // The measurement itself is rounded, not the offset: an advance is a
            // number someone will read in a field, and it should be whole even
            // when the one it started from was not.
            advance: Math.max(0, toGrid(gesture.startAdvance + delta.x, snapping)),
          }))
        : gesture.startLeft === null
          ? null
          : updateGlyph(gesture.before, state.currentGlyph, (g) =>
              setLeftSidebearing(g, toGrid((gesture.startLeft ?? 0) + delta.x, snapping)),
            );

    return {
      ...state,
      document: document ?? gesture.before,
      gesture: { ...gesture, moved: gesture.moved || budged(delta) },
    };
  },

  transformBox: (state, gesture, input, delta) => {
    const { shift, alt } = input.modifiers;
    const pivot = boxPivot(gesture.box, gesture.handle, alt);

    // Shift means "hold the shape" on a scale and "hold the angle" on a turn,
    // which are the same instruction read against what is being changed.
    let transform;
    let boxFrame = state.boxFrame;
    if (gesture.handle.action === "rotate") {
      const turned = boxTurn(gesture.box, gesture.handle, pivot, input.point, shift);
      transform = rotation(turned);
      // Measured from the angle the box was at when the drag began, for the same
      // reason the points are: a running total would drift over a long turn.
      boxFrame = { angle: gesture.box.angle + turned, of: gesture.items };
    } else {
      const by = boxScale(gesture.box, gesture.handle, pivot, input.point, shift);
      if (!Number.isFinite(by.x) || !Number.isFinite(by.y)) return state;
      // Along the box's own axes rather than the plane's, so a handle on a
      // turned box pulls the way it points.
      transform = boxScaleTransform(gesture.box, by);
    }

    // From the document as it was when the drag began, so the answer depends on
    // where the pointer is rather than on the path it took to get there.
    const document = transformedDocument(
      gesture.before,
      state.currentGlyph,
      gesture.items,
      about(transform, pivot),
      !keepsAxes(transform),
    );

    return {
      ...state,
      document: document ?? gesture.before,
      boxFrame,
      gesture: { ...gesture, moved: gesture.moved || budged(delta) },
    };
  },

  marquee: (state, gesture, input) => {
    const inside = itemsInRect(
      currentGlyph(state) ?? EMPTY_GLYPH,
      rectOf(gesture.origin, input.point),
    );
    return {
      ...state,
      selection: gesture.additive ? addItems(gesture.before, inside) : inside,
      gesture: { ...gesture, current: input.point, moved: true },
    };
  },
};

/**
 * The two Tunni drags, which differ only in which kernel function they call.
 *
 * The kernel refuses a move that would pull a handle through its anchor. Holding
 * the last good geometry is the right answer: the drag continues, and the curve
 * simply stops following until the cursor comes back.
 */
function continueTunni(
  state: EditorState,
  gesture: Extract<Gesture, { kind: "dragTunniPoint" | "dragTunniLine" }>,
  input: PointerInput,
  delta: Vec2,
  apply: (c: Parameters<typeof setSegmentTunniPoint>[0], index: number, p: Vec2) => unknown,
): EditorState {
  const next = updateGlyph(gesture.before, state.currentGlyph, (g) =>
    updateContour(
      g,
      gesture.segment.contourId,
      (c) =>
        apply(c, gesture.segment.segmentIndex, input.point) as ReturnType<
          typeof setSegmentTunniPoint
        >,
    ),
  );
  return {
    ...state,
    document: next ?? state.document,
    gesture: { ...gesture, moved: gesture.moved || (next !== null && budged(delta)) },
  };
}

/** Carry a gesture on, whichever it is. */
export function continueGesture(
  state: EditorState,
  gesture: Gesture,
  input: PointerInput,
  options: GestureOptions = {},
): EditorState {
  const delta = sub(input.point, gesture.origin);
  // One cast, in one place: TypeScript cannot see that the key and the gesture
  // narrow together, though the table's type guarantees they do.
  const carry = CONTINUE[gesture.kind] as (
    s: EditorState,
    g: Gesture,
    i: PointerInput,
    d: Vec2,
    o: GestureOptions,
  ) => EditorState;
  return carry({ ...state, cursor: input.point }, gesture, input, delta, options);
}
