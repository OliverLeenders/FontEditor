import type { Rect, Vec2 } from "@fonteditor/geometry";
import type { ContourId, FontDocument, NodeId } from "@fonteditor/font-model";
import { type Selection, type SegmentRef, type ViewTransform, sameSegment } from "@fonteditor/view";

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
export type EditorState = {
  /** The versioned slice. Everything else here is ephemeral and never undone. */
  readonly document: FontDocument;
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
  readonly selection?: Selection;
  readonly hoveredSegment?: SegmentRef | null;
  readonly focusedSegment?: SegmentRef | null;
  readonly cursor?: Vec2 | null;
};

export function editorState(init: EditorStateInit): EditorState {
  return {
    document: init.document,
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

export function isDragging(state: EditorState): boolean {
  return state.gesture !== null;
}
