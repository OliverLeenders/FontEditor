import { type Vec2, rotation } from "@typewright/geometry";
import {
  type ComponentId,
  type ComponentSource,
  type Contour,
  balanceSegment,
  counterIds,
  resolveComponent,
  setNodeType,
  updateContour,
} from "@typewright/font-model";
import {
  type BoxFrame,
  type HandleVisibility,
  type HitTarget,
  BOX_STEM_PIXELS,
  boxContains,
  buildHitIndex,
  hoveredSegment,
  pick,
  pickBoxHandle,
  screenTolerance,
  selectionBounds,
} from "@typewright/view";

import {
  deleteSelectedAnchor,
  deleteSelectedComponent,
  deleteSelectedPoints,
  reverseSelectedContour,
  selectContour,
} from "./commands/index.js";
import { deleteSelectedGuide, moveGuideBy, pickGuide } from "./commands/guides.js";
import { type ToolResult, abort, begin, commit, result } from "./effects.js";
import {
  startGuideDrag,
  EMPTY_GLYPH,
  type GestureOptions,
  continueGesture,
  selectSegmentEnds,
  startAnchorDrag,
  startComponentDrag,
  startItemDrag,
  startMarginDrag,
  startBoxTransform,
  startMarquee,
  startSelectionDrag,
  startTunniDrag,
  translateSelection,
} from "./gestures.js";
import type { KeyInput, PointerInput } from "./input.js";
import {
  type EditorState,
  boxAngle,
  currentGlyph,
  editCurrentGlyph,
  tunniSegments,
} from "./state.js";

/**
 * The select tool: what a pointer or a key does to the editor.
 *
 * Only the entry points live here. How each drag begins and how it follows the
 * pointer are in `gestures`, together, because they used to be apart — a start
 * here and a branch of a switch far below — and drifted.
 */

/**
 * What the pointer may address among the handles.
 *
 * Built here rather than passed in so every caller of the select tool gets the
 * same answer the renderer draws — the two read one rule, in `view`.
 */
export function handleVisibility(
  state: EditorState,
  options: SelectOptions = {},
): HandleVisibility {
  return {
    autoHide: options.autoHideHandles ?? false,
    awake: tunniSegments(state),
    selection: state.selection,
  };
}

export type SelectOptions = GestureOptions & {
  /** Pick radius in screen pixels. */
  readonly hitPixels?: number;
  /** Arrow-key step in design units. */
  readonly nudge?: number;
  /** Arrow-key step with shift held. */
  readonly largeNudge?: number;
  /**
   * Whether the margin lines are grabbable.
   *
   * Must match whether the surface actually draws them — same contract as the
   * Tunni controls, and for the same reason: a target you cannot see is a click
   * on empty canvas that silently does something. Defaults to true because the
   * renderer draws them by default.
   */
  readonly margins?: boolean;
  /** Whether anchors are drawn, and so pickable. On by default, as they are drawn. */
  readonly anchors?: boolean;
  /**
   * Hide handles away from the work, matching `autoHideHandles` in the renderer.
   *
   * Off here by default so a caller that has not thought about it keeps every
   * handle grabbable; the editor turns it on together with the drawing option.
   */
  readonly autoHideHandles?: boolean;
};

const DEFAULT_HIT_PIXELS = 11;
const DEFAULT_NUDGE = 1;
const DEFAULT_LARGE_NUDGE = 10;

export { translateSelection };

// ---------------------------------------------------------------------------
// pointer
// ---------------------------------------------------------------------------

/** How near a box handle counts as on it, in screen pixels. */
export const BOX_HANDLE_PIXELS = 6;

/** How far outside the selection the box is drawn — defined where it is undone. */
export { BOX_OUTSET_PIXELS } from "./gestures.js";
import { BOX_OUTSET_PIXELS } from "./gestures.js";

/**
 * The box round the selection, or `null` when there is nothing to draw one on.
 *
 * Two points at least. One point has no box worth the name — every handle would
 * be the same distance from it, and there is no shape there to scale.
 */
export function selectionBox(state: EditorState): BoxFrame | null {
  const points = state.selection.filter((item) => item.part === "point");
  if (points.length < 2) return null;

  const angle = boxAngle(state);
  const box = selectionBounds(
    currentGlyph(state) ?? EMPTY_GLYPH,
    state.selection,
    angle === 0 ? undefined : rotation(-angle),
  );
  if (box === null) return null;

  const out = screenTolerance(state.view, BOX_OUTSET_PIXELS);
  return {
    rect: {
      minX: box.minX - out,
      minY: box.minY - out,
      maxX: box.maxX + out,
      maxY: box.maxY + out,
    },
    angle,
  };
}

export function pointerDown(
  state: EditorState,
  input: PointerInput,
  options: SelectOptions = {},
): ToolResult {
  const base: EditorState = { ...state, cursor: input.point };

  // The box first. Its handles sit on top of whatever the outline is doing
  // underneath them, and a grab that fell through to a node would move one
  // point where the whole selection was meant to move.
  const box = selectionBox(state);
  if (box !== null) {
    const handle = pickBoxHandle(
      box,
      input.point,
      screenTolerance(state.view, BOX_HANDLE_PIXELS),
      screenTolerance(state.view, BOX_STEM_PIXELS),
    );
    if (handle !== null) return startBoxTransform(base, input, handle, box);
  }

  const target = pickAt(state, input.point, options);
  if (target === null) {
    // A guide first, but only where nothing on the outline is: a guide runs the
    // width of the canvas and would otherwise steal every click that crossed
    // it. Asked before anything is let go, so that clicking one guide while
    // another is held picks up the new one.
    const guide = pickGuide(state, input.point);
    if (guide !== null) {
      return startGuideDrag(
        { ...base, selectedAnchor: null, selectedComponent: null },
        input,
        guide,
      );
    }

    // Nothing under the pointer, so nothing is being worked on — including the
    // anchor, the component and the guide that were. The guide is let go here
    // rather than only when the next point is picked: it used to have no way
    // out but picking something else, since the arrow keys and Backspace go on
    // meaning it for as long as it is held.
    const letGo: EditorState = {
      ...base,
      selectedAnchor: null,
      selectedComponent: null,
      selectedGuide: null,
    };
    if (state.selectedAnchor !== null || state.selectedComponent !== null) {
      return startMarquee(letGo, input);
    }
    // Inside the box, with nothing of the outline under the pointer: take hold
    // of the selection and move it. Anything pickable still wins — a point you
    // can see is a point you meant to grab — so this takes over only the case
    // that used to start a marquee on top of your own selection and throw it
    // away.
    //
    // Shift is the exception, and keeps its meaning: it adds to a selection, so
    // it still starts a marquee. Otherwise the box would make the points inside
    // it the only ones that could not be gathered.
    if (box !== null && !input.modifiers.shift && boxContains(box, input.point)) {
      return startSelectionDrag(letGo, input);
    }

    return startMarquee(letGo, input);
  }

  switch (target.kind) {
    case "node":
    case "handleIn":
    case "handleOut":
      // An outline grab puts the anchor down: the two are separate things and
      // only one of them can be what the next arrow key or Backspace means.
      return startItemDrag(
        { ...base, selectedAnchor: null, selectedComponent: null, selectedGuide: null },
        input,
        target,
      );
    case "anchor":
      return startAnchorDrag(
        { ...base, selectedComponent: null, selectedGuide: null },
        input,
        target.anchorId,
      );
    case "component":
      return startComponentDrag({ ...base, selectedGuide: null }, input, target.componentId);
    case "tunniPoint":
      return startTunniDrag(base, input, "dragTunniPoint", target.segmentIndex, target.contourId);
    case "tunniLine":
      return startTunniDrag(base, input, "dragTunniLine", target.segmentIndex, target.contourId);
    case "segment":
      return selectSegmentEnds(base, input, target);
    case "originLine":
    case "advanceLine":
      return startMarginDrag(base, input, target.kind === "originLine" ? "origin" : "advance");
  }
}

export function pointerMove(
  state: EditorState,
  input: PointerInput,
  options: SelectOptions = {},
): ToolResult {
  const gesture = state.gesture;

  if (gesture === null) {
    // No drag: all that changes is where the cursor is and, from that, which
    // segment is showing its Tunni controls.
    const over = pickAt(state, input.point, options);
    return result({
      ...state,
      cursor: input.point,
      // Only what the pointer is actually on: an anchor names itself on hover,
      // and a name that appeared because the cursor was vaguely nearby would
      // be one more label over the drawing.
      hoveredAnchor: over?.kind === "anchor" ? over.anchorId : null,
      // Same rule as picking one up: a guide lights up only where nothing on
      // the outline is under the pointer.
      hoveredGuide: over === null ? pickGuide(state, input.point) : null,
      hoveredSegment: hoveredSegment(
        currentGlyph(state) ?? EMPTY_GLYPH,
        input.point,
        state.view,
        state.hoveredSegment,
      ),
    });
  }

  return result(continueGesture(state, gesture, input, options));
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

/**
 * The second click.
 *
 * On a Tunni point it balances the segment, which is the one thing here that
 * changes the drawing. Anywhere else on a contour it takes the whole contour:
 * one click on a segment already gives you its two ends, so this is the next
 * step out and the same gesture every drawing program uses for it. Shift
 * gathers a shape made of several contours one at a time.
 */
export function doubleClick(
  state: EditorState,
  input: PointerInput,
  options: SelectOptions = {},
): ToolResult {
  const target = pickAt(state, input.point, options);
  if (target === null) return result(state);

  // Everything that names a contour widens to it. The margins name the glyph
  // rather than a contour, so a second click on one has nothing to widen to.
  if (
    target.kind === "node" ||
    target.kind === "handleIn" ||
    target.kind === "handleOut" ||
    target.kind === "segment" ||
    target.kind === "tunniLine"
  ) {
    return selectContour(state, target.contourId, input.modifiers.shift);
  }
  if (target.kind !== "tunniPoint") return result(state);

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

  // Only while nothing is being dragged: a gesture owns the keyboard until it
  // ends, and Escape is how it ends.
  if (state.gesture === null && !input.modifiers.ctrl && !input.modifiers.meta) {
    if (input.key === "Backspace" || input.key === "Delete") {
      // An anchor is selected on its own, so it is what Backspace means while
      // one is — and the point selection is empty then anyway.
      if (state.selectedAnchor !== null) return deleteSelectedAnchor(state);
      if (state.selectedGuide !== null) return deleteSelectedGuide(state);
      if (state.selectedComponent !== null) return deleteSelectedComponent(state);
      return deleteSelectedPoints(state);
    }
    if (input.key.toLowerCase() === "r") {
      return reverseSelectedContour(state);
    }
  }

  const step = NUDGES[input.key];
  if (step === undefined) return result(state);
  if (state.gesture !== null) return result(state);

  const size = input.modifiers.shift
    ? (options.largeNudge ?? DEFAULT_LARGE_NUDGE)
    : (options.nudge ?? DEFAULT_NUDGE);

  // A selected guide is what the arrows move, for the reason Backspace means
  // it: the point selection is empty while one is selected.
  if (state.selectedGuide !== null) {
    return moveGuideBy(state, state.selectedGuide, step.x * size, step.y * size);
  }
  if (state.selection.length === 0) return result(state);

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
  if (gesture.kind === "transformBox") {
    // A turn abandoned halfway leaves the box where it was standing when the
    // drag began, along with the points.
    const frame = gesture.box.angle === 0 ? null : { angle: gesture.box.angle, of: gesture.items };
    return result({ ...state, document: gesture.before, gesture: null, boxFrame: frame }, [abort]);
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
// internals
// ---------------------------------------------------------------------------

/**
 * What each of the current glyph's components draws, for the hit index.
 *
 * Resolved here rather than in `view`, which knows about one glyph at a time and
 * would have to be handed the whole font to follow a reference.
 */
function placedComponents(state: EditorState): { id: ComponentId; contours: readonly Contour[] }[] {
  const glyph = currentGlyph(state);
  if (glyph === null || glyph.components.length === 0) return [];

  const source: ComponentSource = { glyphOf: (name) => state.document.glyphs[name] ?? null };
  return glyph.components.map((c) => ({
    id: c.id,
    contours: resolveComponent(source, c.base, c.transform, pickIds, [glyph.name]),
  }));
}

/** Resolved outlines are thrown away after the pick; their ids never escape. */
const pickIds = counterIds("pick");

/**
 * What the pointer is over, by the same rules the tool itself uses.
 *
 * Exported because the interface asks the question too — for the cursor, for the
 * context menu, for deciding whether a double-click landed on empty canvas — and
 * two answers to "what is under the pointer" is exactly how a menu comes to
 * offer something the tool will not do.
 */
export function pickTarget(
  state: EditorState,
  p: Vec2,
  options: SelectOptions = {},
): HitTarget | null {
  return pickAt(state, p, options);
}

function pickAt(state: EditorState, p: Vec2, options: SelectOptions): HitTarget | null {
  const index = buildHitIndex(currentGlyph(state) ?? EMPTY_GLYPH, tunniSegments(state), {
    margins: options.margins ?? true,
    anchors: options.anchors ?? true,
    components: placedComponents(state),
    handles: handleVisibility(state, options),
  });
  const tolerance = screenTolerance(state.view, options.hitPixels ?? DEFAULT_HIT_PIXELS);
  return pick(index, p, tolerance);
}
