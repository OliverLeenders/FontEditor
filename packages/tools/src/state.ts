import type { Rect, Vec2 } from "@typewright/geometry";
import {
  type AnchorId,
  type GuideId,
  type ComponentId,
  type ContourId,
  type FontDocument,
  type Glyph,
  type GlyphName,
  type Measurement,
  type NodeId,
  glyphNamed,
  inLayer,
  updateGlyphInLayer,
} from "@typewright/font-model";

export type ToolId = "select" | "pen" | "rect" | "ellipse" | "knife" | "measure" | "section";
import {
  type BoxFrame,
  type BoxHandle,
  type Selection,
  type SegmentRef,
  type SnapHold,
  type ViewTransform,
  NO_HOLD,
  sameSegment,
  sameSelection,
} from "@typewright/view";

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
      /**
       * Dragging one handle of the box round the selection.
       *
       * The box is remembered from when the drag began rather than recomputed
       * as it goes: the box follows the points, the points follow the box, and
       * measuring against a box that is itself moving would compound.
       */
      readonly kind: "transformBox";
      readonly origin: Vec2;
      readonly handle: BoxHandle;
      readonly box: BoxFrame;
      readonly items: Selection;
      readonly before: FontDocument;
      readonly moved: boolean;
    }
  | {
      /**
       * Dragging one component: the whole glyph it places, by its offset.
       *
       * What moves is the transform, never the shapes — those belong to the
       * glyph being referred to, and an editor that let them be nudged here
       * would have given up the reference without saying so.
       */
      readonly kind: "dragComponent";
      readonly origin: Vec2;
      readonly componentId: ComponentId;
      readonly before: FontDocument;
      readonly moved: boolean;
      readonly snapped: SnapHold;
    }
  | {
      /**
       * Dragging one anchor.
       *
       * Its own gesture rather than a selection of one, because an anchor is not
       * in the selection: it has no contour and no node, and every consumer of
       * `Selection` would have to learn about a member that has neither.
       */
      readonly kind: "dragAnchor";
      readonly origin: Vec2;
      readonly anchorId: AnchorId;
      readonly before: FontDocument;
      readonly moved: boolean;
      readonly snapped: SnapHold;
    }
  | {
      /**
       * Dragging one guide.
       *
       * Its own gesture for the reason an anchor's is: a guide is not in the
       * selection and has no contour or node for `Selection` to name. The whole
       * document is kept rather than the glyph, because the guide may belong to
       * the font rather than to the letter in front of you.
       */
      readonly kind: "dragGuide";
      readonly origin: Vec2;
      readonly guideId: GuideId;
      readonly before: FontDocument;
      readonly moved: boolean;
      readonly snapped: SnapHold;
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
  /**
   * Which of its drawings: a layer's name, or `null` for the main drawing.
   * Every tool reads and writes the glyph through this, so drawing in the
   * background is the same tools drawing somewhere else.
   */
  readonly layer: string | null;
  /** The contour the pen is partway through, if any. */
  readonly pen: PenState | null;
  /** The shape being dragged out, if any. */
  readonly shape: ShapeDrag | null;
  /** The stroke the knife is drawing, if any. */
  readonly knife: { readonly from: Vec2; readonly to: Vec2 } | null;
  /**
   * A measurement pinned in place, if one is.
   *
   * Only the pinned one is held. The reading that follows the cursor is derived
   * from the cursor and what it is over, and storing a copy of it would be a
   * second answer that could disagree with the first.
   */
  readonly measure: Measurement | null;
  /**
   * The ruler laid across the glyph, if one is.
   *
   * The line only: what it crosses and how wide each stretch is are derived from
   * it and the outline, and a copy kept here could disagree with the drawing the
   * moment a point moved.
   *
   * `drawing` is true between pointer-down and pointer-up. A ruler that kept
   * following the cursor afterwards could never be read, since reading it means
   * moving the pointer to the numbers.
   */
  readonly section: {
    readonly from: Vec2;
    readonly to: Vec2;
    readonly drawing: boolean;
  } | null;
  /**
   * The tool to go back to when a held tool key is let go.
   *
   * Measuring is a thing you do *while* drawing, not instead of it — so holding
   * its key borrows the tool and releasing it hands the drawing tool back. Null
   * whenever the current tool was chosen rather than borrowed.
   */
  readonly heldFrom: ToolId | null;
  readonly view: ViewTransform;
  readonly selection: Selection;
  /**
   * The anchor being worked on, and the one under the pointer.
   *
   * Apart from `selection` deliberately. An anchor is not part of the outline,
   * so scaling a letter must not scale where its accents attach — which is
   * exactly what would happen if anchors joined the box round the selection.
   */
  readonly selectedAnchor: AnchorId | null;
  /**
   * The guide being worked on, if one is.
   *
   * Beside the point selection rather than in it, as the anchor is, and for the
   * same reason: a guide is not part of the shape, so a command that transforms
   * a selection must never see one.
   */
  readonly selectedGuide: GuideId | null;
  /** The guide under the pointer, for the highlight that says it can be grabbed. */
  readonly hoveredGuide: GuideId | null;
  readonly hoveredAnchor: AnchorId | null;
  /**
   * The component being worked on.
   *
   * Apart from `selection` for the reason the anchor is: it is not points, and
   * the operations that apply to it — move it, take it away, decompose it — are
   * about the reference rather than about anything inside it.
   */
  readonly selectedComponent: ComponentId | null;
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
  /**
   * The angle the selection’s box is held at, and what it was measured round.
   *
   * A box fitted round turned points has to be turned itself, or it stands off
   * the shape on every side and grows as the shape turns — so a rotation leaves
   * its angle here and the box is fitted in that frame from then on.
   *
   * `of` is the selection the angle was earned by. It is compared rather than
   * cleared: an angle belongs to the points that were turned, and asking whether
   * those are still the ones selected answers every "when should this be
   * forgotten" case at once, without a reset in every place a selection is made.
   */
  readonly boxFrame: { readonly angle: number; readonly of: Selection } | null;
};

export type EditorStateInit = {
  readonly document: FontDocument;
  readonly view: ViewTransform;
  readonly activeTool?: ToolId;
  readonly currentGlyph?: GlyphName;
  readonly layer?: string | null;
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
    layer: init.layer ?? null,
    pen: null,
    shape: null,
    knife: null,
    measure: null,
    section: null,
    heldFrom: null,
    view: init.view,
    selection: init.selection ?? [],
    selectedAnchor: null,
    selectedGuide: null,
    hoveredGuide: null,
    hoveredAnchor: null,
    selectedComponent: null,
    hoveredSegment: init.hoveredSegment ?? null,
    focusedSegment: init.focusedSegment ?? null,
    cursor: init.cursor ?? null,
    gesture: null,
    boxFrame: null,
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
  return glyphIn(state.document, state);
}

/**
 * The glyph being edited as it is in some document — a document as it was when
 * a drag began, say — in the layer being drawn.
 */
export function glyphIn(document: FontDocument, state: EditorState): Glyph | null {
  const found = glyphNamed(document, state.currentGlyph);
  return found === null ? null : inLayer(found, state.layer);
}

/**
 * Apply a pure edit to the glyph being edited, returning the new document or
 * `null` when the glyph is missing or the operation declined.
 */
export function editCurrentGlyph(
  state: EditorState,
  operation: (glyph: Glyph) => Glyph | null,
): FontDocument | null {
  return updateGlyphInLayer(state.document, state.currentGlyph, state.layer, operation);
}

/** The marquee rectangle for the renderer, or `null` when none is in progress. */
/**
 * The angle the selection's box is held at: what a rotation left behind, if it
 * was these points that were rotated.
 *
 * Selecting something else puts the box upright again, which is what anyone
 * would expect — an angle is a fact about a set of points, not about the editor.
 */
export function boxAngle(state: EditorState): number {
  const frame = state.boxFrame;
  if (frame === null) return 0;
  return sameSelection(frame.of, state.selection) ? frame.angle : 0;
}

/** The angle after turning by `by`, as this state would then remember it. */
export function turnedFrame(
  state: EditorState,
  by: number,
): { readonly angle: number; readonly of: Selection } | null {
  const angle = boxAngle(state) + by;
  return angle === 0 ? null : { angle, of: state.selection };
}

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
