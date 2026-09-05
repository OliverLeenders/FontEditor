import type { Rect, Vec2 } from "@fonteditor/geometry";

/**
 * The box drawn round a selection, and what its eight handles do.
 *
 * Geometry only: where the handles are, which one the pointer is over, and what
 * transform a drag from it describes. Nothing here knows about a document, a
 * gesture or a pointer event — the tool layer drives it, and this stays a set of
 * functions over a rectangle so it can be tested as arithmetic.
 */

export type BoxAnchor =
  "topLeft" | "top" | "topRight" | "left" | "right" | "bottomLeft" | "bottom" | "bottomRight";

export const BOX_ANCHORS: readonly BoxAnchor[] = [
  "topLeft",
  "top",
  "topRight",
  "left",
  "right",
  "bottomLeft",
  "bottom",
  "bottomRight",
];

/** A grab: which handle, and whether it was taken on the box or just outside it. */
export type BoxHandle = {
  readonly at: BoxAnchor;
  readonly action: "scale" | "rotate";
};

const isCorner = (at: BoxAnchor): boolean =>
  at === "topLeft" || at === "topRight" || at === "bottomLeft" || at === "bottomRight";

/** Where a handle sits. Design units, so y grows upward and `top` is the maximum. */
export function boxHandlePoint(box: Rect, at: BoxAnchor): Vec2 {
  const midX = (box.minX + box.maxX) / 2;
  const midY = (box.minY + box.maxY) / 2;

  switch (at) {
    case "topLeft":
      return { x: box.minX, y: box.maxY };
    case "top":
      return { x: midX, y: box.maxY };
    case "topRight":
      return { x: box.maxX, y: box.maxY };
    case "left":
      return { x: box.minX, y: midY };
    case "right":
      return { x: box.maxX, y: midY };
    case "bottomLeft":
      return { x: box.minX, y: box.minY };
    case "bottom":
      return { x: midX, y: box.minY };
    case "bottomRight":
      return { x: box.maxX, y: box.minY };
  }
}

/**
 * The point a drag from this handle turns about, unless the centre is asked for.
 *
 * The opposite corner for a corner, the opposite edge for an edge — so dragging
 * the right edge holds the left one still, which is what makes a handle feel
 * attached to the thing it is moving.
 */
export function boxPivot(box: Rect, handle: BoxHandle, aboutCentre: boolean): Vec2 {
  const centre = {
    x: (box.minX + box.maxX) / 2,
    y: (box.minY + box.maxY) / 2,
  };
  if (aboutCentre || handle.action === "rotate") return centre;
  return boxHandlePoint(box, opposite(handle.at));
}

function opposite(at: BoxAnchor): BoxAnchor {
  switch (at) {
    case "topLeft":
      return "bottomRight";
    case "top":
      return "bottom";
    case "topRight":
      return "bottomLeft";
    case "left":
      return "right";
    case "right":
      return "left";
    case "bottomLeft":
      return "topRight";
    case "bottom":
      return "top";
    case "bottomRight":
      return "topLeft";
  }
}

/**
 * Which handle the pointer is on, if any.
 *
 * A handle is taken when the pointer is within `reach` of it. Just outside a
 * corner — within `reach` again, and outward on both axes — is the turn: the
 * ring convention every drawing program uses, and the only place to put it,
 * since the inside of the box belongs to the outline being edited.
 *
 * Corners are tried before edges, so the two that overlap at a corner resolve to
 * the corner, which is the one carrying two axes.
 */
export function pickBoxHandle(box: Rect, p: Vec2, reach: number): BoxHandle | null {
  const corners = BOX_ANCHORS.filter(isCorner);
  const edges = BOX_ANCHORS.filter((at) => !isCorner(at));

  for (const at of [...corners, ...edges]) {
    const point = boxHandlePoint(box, at);
    if (Math.abs(p.x - point.x) <= reach && Math.abs(p.y - point.y) <= reach) {
      return { at, action: "scale" };
    }
  }

  const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  for (const at of corners) {
    const point = boxHandlePoint(box, at);
    // Outward of the corner on both axes, which is what keeps the ring outside
    // the box rather than wrapping round into it.
    const outX = point.x >= centre.x ? p.x - point.x : point.x - p.x;
    const outY = point.y >= centre.y ? p.y - point.y : point.y - p.y;
    if (outX > 0 && outY > 0 && outX <= reach * 2 && outY <= reach * 2) {
      return { at, action: "rotate" };
    }
  }

  return null;
}

/** How far a drag has to move before it counts, and how the angle snaps. */
export const TURN_STEP = Math.PI / 12;

/**
 * What a drag from `handle` to `to` scales by, as a pair of factors.
 *
 * Measured from the pivot: how far the pointer is now, over how far the handle
 * was. An axis the box has no extent along cannot be scaled — there is no
 * distance to compare against — and is left alone rather than divided by zero.
 *
 * `uniform` takes the larger of the two and gives it to both, keeping each one's
 * sign so that a drag through the pivot still flips the axis it flipped.
 */
export function boxScale(
  box: Rect,
  handle: BoxHandle,
  pivot: Vec2,
  to: Vec2,
  uniform: boolean,
): { x: number; y: number } {
  const from = boxHandlePoint(box, handle.at);
  const wideX = handle.at !== "top" && handle.at !== "bottom";
  const wideY = handle.at !== "left" && handle.at !== "right";

  const spanX = from.x - pivot.x;
  const spanY = from.y - pivot.y;

  let x = wideX && spanX !== 0 ? (to.x - pivot.x) / spanX : 1;
  let y = wideY && spanY !== 0 ? (to.y - pivot.y) / spanY : 1;

  if (uniform) {
    // An edge handle moves one axis by definition, so there is nothing for the
    // other to be held equal to.
    const both = Math.max(Math.abs(x), Math.abs(y));
    if (wideX && wideY) {
      x = both * Math.sign(x || 1);
      y = both * Math.sign(y || 1);
    }
  }

  return { x, y };
}

/** The angle a turn has swept, from where the handle was to where the pointer is. */
export function boxTurn(
  box: Rect,
  handle: BoxHandle,
  pivot: Vec2,
  to: Vec2,
  step: boolean,
): number {
  const from = boxHandlePoint(box, handle.at);
  const was = Math.atan2(from.y - pivot.y, from.x - pivot.x);
  const now = Math.atan2(to.y - pivot.y, to.x - pivot.x);
  const turned = now - was;
  return step ? Math.round(turned / TURN_STEP) * TURN_STEP : turned;
}
