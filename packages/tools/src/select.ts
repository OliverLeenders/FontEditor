import type { Vec2 } from "@fonteditor/geometry";
import { balanceSegment, setNodeType, updateContour } from "@fonteditor/font-model";
import {
  type HandleVisibility,
  type HitTarget,
  buildHitIndex,
  hoveredSegment,
  pick,
  screenTolerance,
} from "@fonteditor/view";

import { deleteSelectedPoints, reverseSelectedContour } from "./commands.js";
import { type ToolResult, abort, begin, commit, result } from "./effects.js";
import {
  EMPTY_GLYPH,
  type GestureOptions,
  continueGesture,
  selectSegmentEnds,
  startItemDrag,
  startMarginDrag,
  startMarquee,
  startTunniDrag,
  translateSelection,
} from "./gestures.js";
import type { KeyInput, PointerInput } from "./input.js";
import { type EditorState, currentGlyph, editCurrentGlyph, tunniSegments } from "./state.js";

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
    return result({
      ...state,
      cursor: input.point,
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

  // Only while nothing is being dragged: a gesture owns the keyboard until it
  // ends, and Escape is how it ends.
  if (state.gesture === null && !input.modifiers.ctrl && !input.modifiers.meta) {
    if (input.key === "Backspace" || input.key === "Delete") {
      return deleteSelectedPoints(state);
    }
    if (input.key.toLowerCase() === "r") {
      return reverseSelectedContour(state);
    }
  }

  const step = NUDGES[input.key];
  if (step === undefined) return result(state);
  if (state.selection.length === 0) return result(state);
  if (state.gesture !== null) return result(state);

  const size = input.modifiers.shift
    ? (options.largeNudge ?? DEFAULT_LARGE_NUDGE)
    : (options.nudge ?? DEFAULT_NUDGE);

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
// internals
// ---------------------------------------------------------------------------

function pickAt(state: EditorState, p: Vec2, options: SelectOptions): HitTarget | null {
  const index = buildHitIndex(currentGlyph(state) ?? EMPTY_GLYPH, tunniSegments(state), {
    margins: options.margins ?? true,
    handles: handleVisibility(state, options),
  });
  const tolerance = screenTolerance(state.view, options.hitPixels ?? DEFAULT_HIT_PIXELS);
  return pick(index, p, tolerance);
}
