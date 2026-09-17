import { type Cubic, type Vec2, distance, sub } from "@typewright/geometry";
import {
  type Contour,
  type IdFactory,
  addContour,
  appendNode,
  contour,
  contourById,
  nodeById,
  node,
  randomIds,
  removeContour,
  removeNode,
  setClosed,
  updateContour,
  updateGlyphInLayer,
} from "@typewright/font-model";
import { screenTolerance } from "@typewright/view";

import { type ToolResult, abort, begin, commit, result } from "./effects.js";
import type { KeyInput, PointerInput } from "./input.js";
import {
  type EditorState,
  type PenState,
  currentGlyph,
  editCurrentGlyph,
  glyphIn,
} from "./state.js";

export type PenOptions = {
  /**
   * Ids for new nodes and contours. The application owns the factory so ids stay
   * predictable in tests; when none is given a module-level random one is used,
   * which is unique but not reproducible.
   */
  readonly ids?: IdFactory;
  /** How near the first point counts as closing the contour, in screen pixels. */
  readonly closePixels?: number;
  /** How far the pointer must move before a click counts as a handle pull. */
  readonly dragThresholdPixels?: number;
};

const fallbackIds = randomIds();
const DEFAULT_CLOSE_PIXELS = 12;
const DEFAULT_DRAG_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// pointer
// ---------------------------------------------------------------------------

/**
 * Place a point.
 *
 * Three cases: the first point of a new contour, a click on the first point to
 * close, and every other point. All three then behave identically while the
 * button is held — dragging pulls the new point's handles out — which is what
 * makes "click for a corner, drag for a smooth point" one rule rather than two.
 */
export function pointerDown(
  state: EditorState,
  input: PointerInput,
  options: PenOptions = {},
): ToolResult {
  const ids = options.ids ?? fallbackIds;
  const base: EditorState = { ...state, cursor: input.point };

  if (state.pen === null) return startContour(base, input, ids);

  const glyph = currentGlyph(state);
  if (glyph === null) return result(base);
  const open = contourById(glyph, state.pen.contourId);
  if (open === null) return startContour({ ...base, pen: null }, input, ids);

  const first = open.nodes[0];
  const closing =
    first !== undefined &&
    open.nodes.length >= 2 &&
    distance(input.point, first.pt) <=
      screenTolerance(state.view, options.closePixels ?? DEFAULT_CLOSE_PIXELS);

  if (closing) {
    const document = editCurrentGlyph(state, (g) =>
      updateContour(g, open.id, (c) => setClosed(c, true)),
    );
    if (document === null) return result(base);
    return result(
      {
        ...base,
        document,
        pen: { contourId: open.id, lastNodeId: first.id, pullingHandles: true, pulled: false },
      },
      [begin("Close contour", false)],
    );
  }

  const placed = node(ids.node(), input.point);
  const document = editCurrentGlyph(state, (g) =>
    updateContour(g, open.id, (c) => appendNode(c, placed)),
  );
  if (document === null) return result(base);

  return result(
    {
      ...base,
      document,
      pen: { contourId: open.id, lastNodeId: placed.id, pullingHandles: true, pulled: false },
    },
    [begin("Add point", false)],
  );
}

function startContour(state: EditorState, input: PointerInput, ids: IdFactory): ToolResult {
  const first = node(ids.node(), input.point);
  const created: Contour = contour(ids.contour(), [first], false);
  const document = editCurrentGlyph(state, (g) => addContour(g, created));
  if (document === null) return result(state);

  return result(
    {
      ...state,
      document,
      selection: [],
      pen: { contourId: created.id, lastNodeId: first.id, pullingHandles: true, pulled: false },
    },
    [begin("Start contour", false)],
  );
}

/**
 * While the button is held, pull the new point's handles out symmetrically —
 * `out` follows the cursor and `in` mirrors it, which is what makes the point
 * smooth and pre-shapes the segment that will follow.
 *
 * Alt suppresses the mirror, so the point keeps only an outgoing handle and
 * stays a corner. That is the same meaning Alt has in the select tool: break the
 * link between a node's two sides.
 */
export function pointerMove(
  state: EditorState,
  input: PointerInput,
  options: PenOptions = {},
): ToolResult {
  const pen = state.pen;
  if (pen === null || !pen.pullingHandles) return result({ ...state, cursor: input.point });

  const glyph = currentGlyph(state);
  const c = glyph === null ? null : contourById(glyph, pen.contourId);
  const anchor = c === null ? null : nodeById(c, pen.lastNodeId);
  if (anchor === null) return result({ ...state, cursor: input.point });

  const threshold = screenTolerance(
    state.view,
    options.dragThresholdPixels ?? DEFAULT_DRAG_THRESHOLD,
  );
  const pulled = pen.pulled || distance(input.point, anchor.pt) > threshold;
  if (!pulled) return result({ ...state, cursor: input.point });

  const away = sub(input.point, anchor.pt);
  const mirrored: Vec2 = { x: anchor.pt.x - away.x, y: anchor.pt.y - away.y };

  const document = updateGlyphInLayer(state.document, state.currentGlyph, state.layer, (g) =>
    updateContour(g, pen.contourId, (contourValue) => {
      const index = contourValue.nodes.findIndex((n) => n.id === pen.lastNodeId);
      if (index < 0) return null;
      const existing = contourValue.nodes[index]!;
      const nodes = contourValue.nodes.slice();
      nodes[index] = input.modifiers.alt
        ? { ...existing, type: "corner", out: input.point }
        : { ...existing, type: "smooth", out: input.point, in: mirrored };
      return { ...contourValue, nodes };
    }),
  );
  if (document === null) return result({ ...state, cursor: input.point });

  return result({
    ...state,
    cursor: input.point,
    document,
    pen: { ...pen, pulled: true },
  });
}

export function pointerUp(state: EditorState, _input?: PointerInput): ToolResult {
  const pen = state.pen;
  if (pen === null || !pen.pullingHandles) return result(state);

  const glyph = currentGlyph(state);
  const c = glyph === null ? null : contourById(glyph, pen.contourId);
  const finished: PenState = { ...pen, pullingHandles: false, pulled: false };

  // Closing ends the contour, so the pen has nothing left to continue.
  if (c !== null && c.closed) {
    return result({ ...state, pen: null }, [commit]);
  }
  return result({ ...state, pen: finished }, [commit]);
}

/** Leaving the canvas mid-draw abandons nothing; the contour is still there. */
export function pointerLeave(state: EditorState): ToolResult {
  return result({ ...state, cursor: null });
}

/** The pen has no use for a double click; the second press is just another point. */
export function doubleClick(state: EditorState): ToolResult {
  return result(state);
}

// ---------------------------------------------------------------------------
// keyboard
// ---------------------------------------------------------------------------

export function keyDown(state: EditorState, input: KeyInput): ToolResult {
  if (state.pen === null) return result(state);

  if (input.key === "Escape" || input.key === "Enter") return finish(state);
  if (input.key === "Backspace" || input.key === "Delete") return takeBackPoint(state);
  return result(state);
}

/**
 * Stop drawing, leaving the contour open.
 *
 * A contour of one point is removed rather than left behind: a single point is
 * not a shape, and leaving it would put an invisible, unselectable node in the
 * glyph.
 */
export function finish(state: EditorState): ToolResult {
  const pen = state.pen;
  if (pen === null) return result(state);

  const glyph = currentGlyph(state);
  const c = glyph === null ? null : contourById(glyph, pen.contourId);
  if (c !== null && c.nodes.length < 2) {
    const document = editCurrentGlyph(state, (g) => removeContour(g, pen.contourId));
    return result({ ...state, document: document ?? state.document, pen: null }, [abort]);
  }
  return result({ ...state, pen: null });
}

/** Take back the point just placed, and the contour with it if it was the last. */
function takeBackPoint(state: EditorState): ToolResult {
  const pen = state.pen;
  if (pen === null) return result(state);

  const current = currentGlyph(state);
  const c = current === null ? null : contourById(current, pen.contourId);
  if (c === null) return result({ ...state, pen: null });

  if (c.nodes.length <= 1) {
    const document = editCurrentGlyph(state, (g) => removeContour(g, pen.contourId));
    return result({ ...state, document: document ?? state.document, pen: null }, [
      begin("Remove point", false),
      commit,
    ]);
  }

  const last = c.nodes[c.nodes.length - 1]!;
  const document = editCurrentGlyph(state, (g) =>
    updateContour(g, pen.contourId, (value) => removeNode(value, last.id)),
  );
  if (document === null) return result(state);

  const nextGlyph = glyphIn(document, state);
  const remaining = nextGlyph?.contours.find((candidate) => candidate.id === pen.contourId);
  const newLast = remaining?.nodes[remaining.nodes.length - 1];

  return result(
    {
      ...state,
      document,
      pen:
        newLast === undefined
          ? null
          : { ...pen, lastNodeId: newLast.id, pullingHandles: false, pulled: false },
    },
    [begin("Remove point", false), commit],
  );
}

// ---------------------------------------------------------------------------
// preview
// ---------------------------------------------------------------------------

/**
 * The rubber band from the last placed point to the cursor.
 *
 * Uses the last point's outgoing handle and no incoming one, which is exactly
 * the segment that would exist if the next click landed where the cursor is —
 * so the preview is a promise the tool keeps rather than a decorative line.
 *
 * Absent while handles are being pulled: the point being shaped is under the
 * cursor, and a rubber band to itself would be noise.
 */
export function penPreview(state: EditorState): Cubic | null {
  const pen = state.pen;
  if (pen === null || state.cursor === null || pen.pullingHandles) return null;

  const glyph = currentGlyph(state);
  const c = glyph === null ? null : contourById(glyph, pen.contourId);
  const last = c === null ? null : nodeById(c, pen.lastNodeId);
  if (last === null) return null;

  return { a: last.pt, c1: last.out ?? last.pt, c2: state.cursor, b: state.cursor };
}
