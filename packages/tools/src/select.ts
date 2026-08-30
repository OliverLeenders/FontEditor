import { type Vec2, add, sub } from "@fonteditor/geometry";
import {
  type Glyph,
  balanceSegment,
  contourById,
  moveSegmentTunniLine,
  nodeById,
  segmentAt,
  segmentIndexForHandle,
  setHandle,
  setNodeType,
  setSegmentTunniPoint,
  translateNodeBy,
  updateContour,
  updateGlyph,
} from "@fonteditor/font-model";
import {
  type HitTarget,
  type SegmentRef,
  type Selection,
  type SelectionItem,
  addItems,
  buildHitIndex,
  hasItem,
  hoveredSegment,
  itemForTarget,
  itemsInRect,
  pick,
  screenTolerance,
  toggleItem,
} from "@fonteditor/view";

import { type ToolResult, abort, begin, commit, result } from "./effects.js";
import type { KeyInput, PointerInput } from "./input.js";
import {
  type EditorState,
  type Gesture,
  currentGlyph,
  editCurrentGlyph,
  tunniSegments,
} from "./state.js";

/** Stands in when the current glyph name does not resolve, so reads stay total. */
const EMPTY_GLYPH: Glyph = { name: "", unicodes: [], advance: 0, contours: [] };

export type SelectOptions = {
  /** Pick radius in screen pixels. */
  readonly hitPixels?: number;
  /** Arrow-key step in design units. */
  readonly nudge?: number;
  /** Arrow-key step with shift held. */
  readonly largeNudge?: number;
};

const DEFAULT_HIT_PIXELS = 11;
const DEFAULT_NUDGE = 1;
const DEFAULT_LARGE_NUDGE = 10;

// ---------------------------------------------------------------------------
// pointer
// ---------------------------------------------------------------------------

export function pointerDown(
  state: EditorState,
  input: PointerInput,
  options: SelectOptions = {},
): ToolResult {
  const target = pickAt(state, input.point, options);
  const base: EditorState = { ...state, cursor: input.point };

  if (target === null) return startMarquee(base, input);

  switch (target.kind) {
    case "node":
    case "handleIn":
    case "handleOut":
      return startItemDrag(base, input, target);
    case "tunniPoint":
      return startTunniDrag(base, input, "dragTunniPoint", target.segmentIndex, target.contourId);
    case "tunniLine":
      return startTunniDrag(base, input, "dragTunniLine", target.segmentIndex, target.contourId);
    case "segment":
      return selectSegmentEnds(base, input, target);
  }
}

export function pointerMove(state: EditorState, input: PointerInput): ToolResult {
  const gesture = state.gesture;

  if (gesture === null) {
    // No drag: all that changes is where the cursor is and, from that, which
    // segment is showing its Tunni controls.
    return result({
      ...state,
      cursor: input.point,
      hoveredSegment: hoveredSegment(currentGlyph(state) ?? EMPTY_GLYPH, input.point, state.view, state.hoveredSegment),
    });
  }

  const withCursor: EditorState = { ...state, cursor: input.point };
  const delta = sub(input.point, gesture.origin);
  const budged = delta.x !== 0 || delta.y !== 0;

  switch (gesture.kind) {
    case "dragSelection": {
      const document = updateGlyph(gesture.before, state.currentGlyph, (g) =>
        translateSelection(g, gesture.items, delta),
      );
      return result({
        ...withCursor,
        document: document ?? gesture.before,
        gesture: { ...gesture, moved: gesture.moved || budged },
      });
    }

    case "dragHandle": {
      const document = updateGlyph(gesture.before, state.currentGlyph, (g) =>
        updateContour(g, gesture.contourId, (c) =>
          setHandle(c, gesture.nodeId, gesture.part, input.point, gesture.breakSmooth),
        ),
      );
      return result({
        ...withCursor,
        document: document ?? gesture.before,
        gesture: { ...gesture, moved: gesture.moved || budged },
      });
    }

    case "dragTunniPoint":
    case "dragTunniLine": {
      const apply = gesture.kind === "dragTunniPoint" ? setSegmentTunniPoint : moveSegmentTunniLine;
      const next = updateGlyph(gesture.before, state.currentGlyph, (g) =>
        updateContour(g, gesture.segment.contourId, (c) =>
          apply(c, gesture.segment.segmentIndex, input.point),
        ),
      );
      // The kernel refuses a move that would pull a handle through its anchor.
      // Holding the last good geometry is the right answer: the drag continues,
      // and the curve simply stops following until the cursor comes back.
      return result({
        ...withCursor,
        document: next ?? state.document,
        gesture: { ...gesture, moved: gesture.moved || (next !== null && budged) },
      });
    }

    case "marquee": {
      const next: Gesture = { ...gesture, current: input.point, moved: true };
      const inside = itemsInRect(currentGlyph(state) ?? EMPTY_GLYPH, rectOf(gesture.origin, input.point));
      return result({
        ...withCursor,
        selection: gesture.additive ? addItems(gesture.before, inside) : inside,
        gesture: next,
      });
    }
  }
}

export function pointerUp(state: EditorState, _input?: PointerInput): ToolResult {
  const gesture = state.gesture;
  if (gesture === null) return result(state);

  const settled: EditorState = { ...state, gesture: null };

  // A gesture that moved nothing is not an edit. Committing it would put an
  // entry in the undo stack that undoes nothing.
  if (!gesture.moved) return result(settled, [abort]);

  if (gesture.kind === "marquee") return result(settled);

  if (gesture.kind === "dragHandle" && gesture.breakSmooth) {
    // The handles are no longer collinear, so calling the node smooth would be a
    // lie the geometry contradicts. Record what is actually true.
    const document = editCurrentGlyph(settled, (g) =>
      updateContour(g, gesture.contourId, (c) => setNodeType(c, gesture.nodeId, "corner")),
    );
    return result({ ...settled, document: document ?? settled.document }, [commit]);
  }

  return result(settled, [commit]);
}

/**
 * The pointer left the canvas. Hover is forgotten, focus is not — leaving the
 * window should not abandon whatever is being worked on.
 */
export function pointerLeave(state: EditorState): ToolResult {
  if (state.gesture !== null) return result({ ...state, cursor: null });
  return result({ ...state, cursor: null, hoveredSegment: null });
}

export function doubleClick(
  state: EditorState,
  input: PointerInput,
  options: SelectOptions = {},
): ToolResult {
  const target = pickAt(state, input.point, options);
  if (target === null || target.kind !== "tunniPoint") return result(state);

  const document = editCurrentGlyph(state, (g) =>
    updateContour(g, target.contourId, (c) => balanceSegment(c, target.segmentIndex)),
  );
  if (document === null) return result(state);

  return result(
    {
      ...state,
      document,
      focusedSegment: { contourId: target.contourId, segmentIndex: target.segmentIndex },
    },
    [begin("Balance segment"), commit],
  );
}

// ---------------------------------------------------------------------------
// keyboard
// ---------------------------------------------------------------------------

export function keyDown(
  state: EditorState,
  input: KeyInput,
  options: SelectOptions = {},
): ToolResult {
  if (input.key === "Escape") return cancel(state);

  const step = NUDGES[input.key];
  if (step === undefined) return result(state);
  if (state.selection.length === 0) return result(state);
  if (state.gesture !== null) return result(state);

  const size = input.modifiers.shift
    ? options.largeNudge ?? DEFAULT_LARGE_NUDGE
    : options.nudge ?? DEFAULT_NUDGE;

  const document = editCurrentGlyph(state, (g) =>
    translateSelection(g, state.selection, { x: step.x * size, y: step.y * size }),
  );
  if (document === null) return result(state);

  return result({ ...state, document }, [begin("Nudge"), commit]);
}

/** Abandon whatever is in progress, restoring what it started from. */
export function cancel(state: EditorState): ToolResult {
  const gesture = state.gesture;
  if (gesture === null) return result(state);

  if (gesture.kind === "marquee") {
    return result({ ...state, selection: gesture.before, gesture: null }, [abort]);
  }
  return result({ ...state, document: gesture.before, gesture: null }, [abort]);
}

// design y is up, so ArrowUp is +y
const NUDGES: Record<string, Vec2 | undefined> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: 1 },
  ArrowDown: { x: 0, y: -1 },
};

// ---------------------------------------------------------------------------
// moving a selection
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

  let next = g;

  for (const item of selection) {
    if (item.part !== "point") continue;
    next = updateContour(next, item.contourId, (c) => translateNodeBy(c, item.nodeId, delta)) ?? next;
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

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function pickAt(state: EditorState, p: Vec2, options: SelectOptions): HitTarget | null {
  const index = buildHitIndex(currentGlyph(state) ?? EMPTY_GLYPH, tunniSegments(state));
  const tolerance = screenTolerance(state.view, options.hitPixels ?? DEFAULT_HIT_PIXELS);
  return pick(index, p, tolerance);
}

function startMarquee(state: EditorState, input: PointerInput): ToolResult {
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

function startItemDrag(
  state: EditorState,
  input: PointerInput,
  target: HitTarget,
): ToolResult {
  const item = itemForTarget(target);
  if (item === null) return result(state);

  const selection = nextSelection(state.selection, item, input.modifiers.shift);

  // Shift-clicking to deselect should not then drag the thing just removed.
  if (!hasItem(selection, item)) {
    return result({ ...state, selection });
  }

  const isHandle = item.part !== "point";
  const label = isHandle ? "Move handle" : "Move node";

  // A handle shapes exactly one segment, so touching it says unambiguously which
  // segment is being worked on. A node sits between two and names neither, so
  // dragging one leaves focus where it was rather than guessing.
  const focusedSegment = isHandle
    ? handleSegment(state, item) ?? state.focusedSegment
    : state.focusedSegment;

  const gesture: Gesture = isHandle && selection.length === 1
    ? {
        kind: "dragHandle",
        origin: input.point,
        contourId: item.contourId,
        nodeId: item.nodeId,
        part: item.part === "in" ? "in" : "out",
        breakSmooth: input.modifiers.alt,
        before: state.document,
        moved: false,
      }
    : {
        kind: "dragSelection",
        origin: input.point,
        items: selection,
        before: state.document,
        moved: false,
      };

  return result({ ...state, selection, focusedSegment, gesture }, [begin(label)]);
}

function handleSegment(state: EditorState, item: SelectionItem): SegmentRef | null {
  if (item.part === "point") return null;
  const c = contourById(currentGlyph(state) ?? EMPTY_GLYPH, item.contourId);
  if (c === null) return null;
  const segmentIndex = segmentIndexForHandle(c, item.nodeId, item.part);
  return segmentIndex === null ? null : { contourId: item.contourId, segmentIndex };
}

function startTunniDrag(
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
      gesture: {
        kind,
        origin: input.point,
        segment,
        before: state.document,
        moved: false,
      },
    },
    [begin(label)],
  );
}

/**
 * Clicking a segment selects the on-curve points at each end, so the whole span
 * can then be nudged or dragged as a unit.
 */
function selectSegmentEnds(
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

  return result({
    ...state,
    selection,
    focusedSegment: { contourId: target.contourId, segmentIndex: target.segmentIndex },
    gesture: {
      kind: "dragSelection",
      origin: input.point,
      items: selection,
      before: state.document,
      moved: false,
    },
  }, [begin("Move segment")]);
}

/**
 * Shift extends or removes; a plain click replaces — unless the thing clicked is
 * already selected, in which case the selection is left alone so a multi-item
 * drag is not destroyed by grabbing one of its members.
 */
function nextSelection(
  selection: Selection,
  item: SelectionItem,
  extend: boolean,
): Selection {
  if (extend) return toggleItem(selection, item);
  if (hasItem(selection, item)) return selection;
  return [item];
}

function rectOf(a: Vec2, b: Vec2) {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}
