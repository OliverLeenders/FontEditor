import type { Rect, Vec2 } from "@typewright/geometry";
import {
  type Contour,
  type IdFactory,
  addContour,
  ellipseContour,
  randomIds,
  rectContour,
} from "@typewright/font-model";
import { snapPoint } from "@typewright/view";

import { type ToolResult, abort, begin, commit, result } from "./effects.js";
import { type GestureOptions, snappingFor } from "./gestures.js";
import type { PointerInput } from "./input.js";
import { type EditorState, type ShapeDrag, currentGlyph, editCurrentGlyph } from "./state.js";

/**
 * The rectangle and ellipse tools, which are one tool with two endings.
 *
 * Both are a single drag from one corner to the other: press, move, release, and
 * a contour exists. Nothing survives the release, which is what makes them
 * unlike the pen — a pen contour is a conversation and a rectangle is a
 * sentence.
 *
 * Shift makes the shape as wide as it is tall; alt makes the press the centre
 * rather than a corner. Both are read on every move rather than at the press, so
 * letting go of shift redraws the shape it would now make instead of leaving you
 * with one you have stopped asking for.
 */

export type ShapeOptions = GestureOptions & {
  /**
   * Ids for the new contour and its nodes. As with the pen, the application owns
   * the factory so ids stay predictable in tests, and a module-level random one
   * stands in when none is given — a shape that silently refused to appear
   * because a caller forgot an option would be a miserable thing to diagnose.
   */
  readonly ids?: IdFactory;
};

const fallbackIds = randomIds();

export function pointerDown(
  state: EditorState,
  input: PointerInput,
  options: ShapeOptions = {},
): ToolResult {
  const kind = state.activeTool === "ellipse" ? "ellipse" : "rect";
  const at = snapped(state, input, options, input.point);

  return result({
    ...state,
    cursor: input.point,
    // The selection is cleared because what is about to exist is the thing you
    // will want selected, and leaving the old one would make the next nudge move
    // something you have stopped looking at.
    selection: [],
    shape: {
      kind,
      from: at,
      to: at,
      even: input.modifiers.shift,
      fromCentre: input.modifiers.alt,
    },
  });
}

export function pointerMove(
  state: EditorState,
  input: PointerInput,
  options: ShapeOptions = {},
): ToolResult {
  const shape = state.shape;
  if (shape === null) return result({ ...state, cursor: input.point });

  return result({
    ...state,
    cursor: input.point,
    shape: {
      ...shape,
      to: snapped(state, input, options, input.point),
      even: input.modifiers.shift,
      fromCentre: input.modifiers.alt,
    },
  });
}

export function pointerUp(
  state: EditorState,
  _input?: PointerInput,
  options: ShapeOptions = {},
): ToolResult {
  const shape = state.shape;
  if (shape === null) return result(state);

  const settled: EditorState = { ...state, shape: null };
  const box = shapeRect(shape);

  // A shape with no width or no height is not a shape. Usually it is a click
  // that was never meant to be a drag, and committing it would leave four points
  // on top of each other for someone to find later.
  if (box === null) return result(settled, [abort]);

  const ids = options.ids ?? fallbackIds;
  const drawn = shape.kind === "ellipse" ? ellipseContour(ids, box) : rectContour(ids, box);
  const document = editCurrentGlyph(settled, (g) => addContour(g, drawn));
  if (document === null) return result(settled, [abort]);

  return result(
    {
      ...settled,
      document,
      // Selected on arrival: the thing just drawn is the thing about to be
      // moved, resized or nudged, and hunting for it first is a step nobody
      // asked for.
      selection: drawn.nodes.map((n) => ({
        contourId: drawn.id,
        nodeId: n.id,
        part: "point" as const,
      })),
    },
    [begin(shape.kind === "ellipse" ? "Draw ellipse" : "Draw rectangle", false), commit],
  );
}

/** Leaving the canvas abandons the drag; there is no half-drawn shape to keep. */
export function pointerLeave(state: EditorState): ToolResult {
  if (state.shape === null) return result({ ...state, cursor: null });
  return result({ ...state, cursor: null, shape: null }, [abort]);
}

export function cancel(state: EditorState): ToolResult {
  if (state.shape === null) return result(state);
  return result({ ...state, shape: null }, [abort]);
}

/**
 * The box a drag describes, or `null` when it describes nothing.
 *
 * Pure, and exported, because it is what the preview draws and what the commit
 * builds from — and those two disagreeing is exactly the bug where the shape you
 * let go of is not the shape you were shown.
 */
export function shapeRect(shape: ShapeDrag): Rect | null {
  const dx = shape.to.x - shape.from.x;
  const dy = shape.to.y - shape.from.y;

  // Shift squares it off the longer side, so the shape follows the pointer on
  // the axis it has travelled furthest along rather than jumping to the shorter.
  const reach = Math.max(Math.abs(dx), Math.abs(dy));
  const width = shape.even ? Math.sign(dx || 1) * reach : dx;
  const height = shape.even ? Math.sign(dy || 1) * reach : dy;

  const box = shape.fromCentre
    ? {
        minX: shape.from.x - Math.abs(width),
        maxX: shape.from.x + Math.abs(width),
        minY: shape.from.y - Math.abs(height),
        maxY: shape.from.y + Math.abs(height),
      }
    : {
        minX: Math.min(shape.from.x, shape.from.x + width),
        maxX: Math.max(shape.from.x, shape.from.x + width),
        minY: Math.min(shape.from.y, shape.from.y + height),
        maxY: Math.max(shape.from.y, shape.from.y + height),
      };

  if (box.maxX - box.minX === 0 || box.maxY - box.minY === 0) return null;
  return box;
}

/** The contour a drag would produce, for the canvas to show before it exists. */
export function shapePreview(state: EditorState, ids: IdFactory): Contour | null {
  const shape = state.shape;
  if (shape === null) return null;

  const box = shapeRect(shape);
  if (box === null) return null;
  return shape.kind === "ellipse" ? ellipseContour(ids, box) : rectContour(ids, box);
}

/**
 * Land a corner where a dragged point would land.
 *
 * The same rule the select tool follows, so a rectangle drawn against the
 * baseline sits on it exactly, and one drawn anywhere else still lands on whole
 * units. Ctrl overrides it, as everywhere else.
 */
function snapped(
  state: EditorState,
  input: PointerInput,
  options: ShapeOptions,
  point: Vec2,
): Vec2 {
  const glyph = currentGlyph(state);
  if (glyph === null) return point;
  return snapPoint(point, snappingFor(state, input, options, glyph, [])).point;
}
