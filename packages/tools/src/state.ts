import type { Rect, Vec2 } from "@fonteditor/geometry";
import {
  type ContourId,
  type FontDocument,
  type Glyph,
  type GlyphName,
  type NodeId,
  glyphNamed,
  updateGlyph,
} from "@fonteditor/font-model";

export type ToolId = "select" | "pen" | "rect" | "ellipse";
import {
  type Selection,
  type SegmentRef,
  type SnapHold,
  type ViewTransform,
  NO_HOLD,
  sameSegment,
} from "@fonteditor/view";

/**
 * What is happening between pointer down and pointer up.
 *
 * Every gesture carries the document as it was when the gesture began. Each move
 * recomputes from that snapshot plus the *total* offset rather than nudging the
 * previous frame's result — so a drag cannot accumulate rounding error over four
 * hundred pointer events, and Escape can put things back exactly.
 *
 * A snapshot here is one reference, not a copy: the model is immutable and
 * structurally shared, so holding the previous glyph costs nothing. This is not
 * the prototype's mistake of cloning the whole document on every mouse-up — that
 * was a *history* of snapshots; this is one live gesture.
 */
export type Gesture =
  | {
      readonly kind: "dragSelection";
      readonly origin: Vec2;
      readonly items: Selection;
      readonly before: FontDocument;
      readonly moved: boolean;
      /**
       * The lines this drag is currently caught on.
       *
       * Carried on the gesture rather than beside it so its lifetime is the
       * gesture's: there is no way to leave a stale hold behind, because when
       * the gesture goes the hold goes with it.
       */
      readonly snapped: SnapHold;
    }
  | {
      readonly kind: "dragHandle";
      readonly origin: Vec2;
      readonly contourId: ContourId;
      readonly nodeId: NodeId;
      readonly part: "in" | "out";
      readonly breakSmooth: boolean;
      readonly before: FontDocument;
      readonly moved: boolean;
      readonly snapped: SnapHold;
    }
  | {
      readonly kind: "dragTunniPoint";
      readonly origin: Vec2;
      readonly segment: SegmentRef;
      readonly before: FontDocument;
      readonly moved: boolean;
    }
  | {
      readonly kind: "dragTunniLine";
      readonly origin: Vec2;
      readonly segment: SegmentRef;
      readonly before: FontDocument;
      readonly moved: boolean;
    }
  | {
      /**
       * Dragging one of the lines that bound the advance width.
       *
       * `startAdvance` and `startLeft` are captured at the press so every move
       * is computed from where the drag began. Applying each move to the *current*
       * value instead would compound rounding across a drag and let the glyph
       * creep away from the cursor.
       */
      readonly kind: "dragMargin";
      readonly origin: Vec2;
      readonly side: "origin" | "advance";
      readonly startAdvance: number;
      readonly startLeft: number | null;
      readonly before: FontDocument;
      readonly moved: boolean;
    }
  | {
      readonly kind: "marquee";
      readonly origin: Vec2;
      readonly current: Vec2;
      readonly additive: boolean;
      readonly before: Selection;
      readonly moved: boolean;
    };

/**
 * Everything a tool reads and writes.
 *
 * A plain value. The tools are reducers over it — `(state, event) => state` —
 * which is what lets a whole drag be replayed in a test as a list of synthetic
 * events, and what will let `edit-core` wrap the same tools in transactions
 * without touching them.
 *
 * `cursor` is in design units. Converting from screen coordinates is the host's
 * job, so nothing below the view transform ever sees a pixel.
 */
/**
 * A contour being drawn.
 *
 * Unlike a gesture, this outlives a single press: drawing a contour is a
 * sequence of clicks with the tool waiting in between, so the pen's place in the
 * work has to survive pointer-up.
 */
export type PenState = {
  readonly contourId: ContourId;
  /** The point most recently placed; a drag shapes its handles. */
  readonly lastNodeId: NodeId;
  /** True between pointer-down and pointer-up, while handles are being pulled out. */
  readonly pullingHandles: boolean;
  /** True when the placing drag moved far enough to count as a drag at all. */
  readonly pulled: boolean;
};

/**
 * A shape being dragged out.
 *
 * Only alive between pointer-down and pointer-up — unlike the pen, a rectangle
 * is one gesture from start to finish, so there is nothing to survive the
 * release. The modifiers are kept rather than the resulting box so that letting
 * go of shift redraws the shape it would now make.
 */
export type ShapeDrag = {
  readonly kind: "rect" | "ellipse";
  readonly from: Vec2;
  readonly to: Vec2;
  /** Shift: as wide as it is tall. */
  readonly even: boolean;
  /** Alt: the press was the centre rather than a corner. */
  readonly fromCentre: boolean;
};

export type EditorState = {
  /** The versioned slice. Everything else here is ephemeral and never undone. */
  readonly document: FontDocument;
  readonly activeTool: ToolId;
  /** Which glyph the canvas is editing. */
  readonly currentGlyph: GlyphName;
  /** The contour the pen is partway through, if any. */
  readonly pen: PenState | null;
  /** The shape being dragged out, if any. */
  readonly shape: ShapeDrag | null;
  readonly view: ViewTransform;
  readonly selection: Selection;
  /** The segment nearest the cursor. Follows the pointer; forgotten when it leaves. */
  readonly hoveredSegment: SegmentRef | null;
  /**
   * The segment being worked on. Set by touching a Tunni control or clicking a
   * segment, and it persists until the user clicks somewhere else entirely.
   *
   * Hover alone is not enough. Drag a counter's Tunni point out across the outer
   * contour and, on release, the outer segment is nearer — so a hover-only rule
   * hands the controls to the outer segment and the point you were just holding
   * becomes unreachable. Focus is what keeps it in play.
   */
  readonly focusedSegment: SegmentRef | null;
  readonly cursor: Vec2 | null;
  readonly gesture: Gesture | null;
};

export type EditorStateInit = {
  readonly document: FontDocument;
  readonly view: ViewTransform;
  readonly activeTool?: ToolId;
  readonly currentGlyph?: GlyphName;
  readonly selection?: Selection;
  readonly hoveredSegment?: SegmentRef | null;
  readonly focusedSegment?: SegmentRef | null;
  readonly cursor?: Vec2 | null;
};

export function editorState(init: EditorStateInit): EditorState {
  return {
    document: init.document,
    activeTool: init.activeTool ?? "select",
    currentGlyph: init.currentGlyph ?? init.document.glyphOrder[0] ?? "",
    pen: null,
    shape: null,
    view: init.view,
    selection: init.selection ?? [],
    hoveredSegment: init.hoveredSegment ?? null,
    focusedSegment: init.focusedSegment ?? null,
    cursor: init.cursor ?? null,
    gesture: null,
  };
}

/**
 * The segments that should be showing their Tunni controls: the hovered one and
 * the focused one, deduplicated.
 *
 * Both the renderer and the hit index take this same list, which is what keeps
 * "what is drawn" and "what can be grabbed" from ever disagreeing.
 */
export function tunniSegments(state: EditorState): SegmentRef[] {
  const refs: SegmentRef[] = [];
  for (const ref of [state.focusedSegment, state.hoveredSegment]) {
    if (ref === null) continue;
    if (refs.some((already) => sameSegment(already, ref))) continue;
    refs.push(ref);
  }
  return refs;
}

/**
 * The glyph being edited, or `null` if the name does not resolve.
 *
 * Every tool reads through this rather than reaching into the document, so
 * "which glyph" lives in exactly one place and switching glyphs is a change to
 * one field.
 */
export function currentGlyph(state: EditorState): Glyph | null {
  return glyphNamed(state.document, state.currentGlyph);
}

/**
 * Apply a pure edit to the glyph being edited, returning the new document or
 * `null` when the glyph is missing or the operation declined.
 */
export function editCurrentGlyph(
  state: EditorState,
  operation: (glyph: Glyph) => Glyph | null,
): FontDocument | null {
  return updateGlyph(state.document, state.currentGlyph, operation);
}

/** The marquee rectangle for the renderer, or `null` when none is in progress. */
export function marqueeRect(state: EditorState): Rect | null {
  const gesture = state.gesture;
  if (gesture === null || gesture.kind !== "marquee") return null;
  return {
    minX: Math.min(gesture.origin.x, gesture.current.x),
    minY: Math.min(gesture.origin.y, gesture.current.y),
    maxX: Math.max(gesture.origin.x, gesture.current.x),
    maxY: Math.max(gesture.origin.y, gesture.current.y),
  };
}

/**
 * The lines the drag in progress is caught on, for the renderer to draw.
 *
 * Here rather than read off the gesture by the interface, for the same reason
 * `marqueeRect` is: which gestures snap and where they keep the answer is the
 * tool's business, and an app that reached in for it would have to be changed
 * every time a gesture was added.
 */
export function snapHold(state: EditorState): SnapHold {
  const gesture = state.gesture;
  if (gesture === null) return NO_HOLD;
  return gesture.kind === "dragSelection" || gesture.kind === "dragHandle"
    ? gesture.snapped
    : NO_HOLD;
}
