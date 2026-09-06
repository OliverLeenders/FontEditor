import {
  type Affine,
  type Rect,
  type Vec2,
  applyAffine,
  composeAffine,
  rotation,
  scaling,
} from "@fonteditor/geometry";

/**
 * The box drawn round a selection, and what its handles do.
 *
 * Geometry only: where the handles are, which one the pointer is over, and what
 * transform a drag from it describes. Nothing here knows about a document, a
 * gesture or a pointer event — the tool layer drives it, and this stays a set of
 * functions over a rectangle so it can be tested as arithmetic.
 *
 * The box has an angle. A rectangle fitted round a turned selection would have
 * to be axis-aligned, so it would stand away from the shape on every side and
 * grow as the shape turned — which is why a box that only ever draws upright
 * looks wrong the moment anything is rotated. Instead the rectangle is measured
 * in a frame turned by the same angle, and everything here converts between that
 * frame and the design plane.
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

/**
 * A rectangle and the angle it is held at.
 *
 * `rect` is in the frame's own coordinates — the design plane turned by `angle`
 * about its origin — so a box at rest is the plain bounding box it always was
 * and every existing rule about it still reads.
 */
export type BoxFrame = {
  readonly rect: Rect;
  /** Anticlockwise, in radians. Zero for a box that has not been turned. */
  readonly angle: number;
};

/** A grab: which handle, and whether it was taken to scale or to turn. */
export type BoxHandle = {
  readonly at: BoxAnchor;
  readonly action: "scale" | "rotate";
};

/**
 * How far the turn knob stands off the top of the box, in screen pixels.
 *
 * Lives here rather than beside the other pixel sizes in the tools because two
 * packages have to agree about it exactly: the renderer draws the knob and the
 * tool picks it, and a knob drawn where it cannot be grabbed is worse than no
 * knob at all.
 */
export const BOX_STEM_PIXELS = 22;

const isCorner = (at: BoxAnchor): boolean =>
  at === "topLeft" || at === "topRight" || at === "bottomLeft" || at === "bottomRight";

/** A point of the frame's own coordinates, in the design plane. */
export function boxToWorld(frame: BoxFrame, p: Vec2): Vec2 {
  return frame.angle === 0 ? p : applyAffine(rotation(frame.angle), p);
}

/** A point of the design plane, in the frame's own coordinates. */
export function boxToLocal(frame: BoxFrame, p: Vec2): Vec2 {
  return frame.angle === 0 ? p : applyAffine(rotation(-frame.angle), p);
}

/** Where a handle sits within the frame. Design units, so y grows upward. */
function localHandlePoint(box: Rect, at: BoxAnchor): Vec2 {
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

/** Where a handle sits in the design plane. */
export function boxHandlePoint(frame: BoxFrame, at: BoxAnchor): Vec2 {
  return boxToWorld(frame, localHandlePoint(frame.rect, at));
}

/**
 * The turn knob: straight out of the top edge, `stem` design units clear of it.
 *
 * Up means the frame's own up, so the knob leans over with the box and goes on
 * saying which way up the selection is being held.
 */
export function boxRotatePoint(frame: BoxFrame, stem: number): Vec2 {
  const top = localHandlePoint(frame.rect, "top");
  return boxToWorld(frame, { x: top.x, y: top.y + stem });
}

/** The middle of the box, in the design plane. */
export function boxCentre(frame: BoxFrame): Vec2 {
  return boxToWorld(frame, {
    x: (frame.rect.minX + frame.rect.maxX) / 2,
    y: (frame.rect.minY + frame.rect.maxY) / 2,
  });
}

/**
 * The point a drag from this handle turns about, unless the centre is asked for.
 *
 * The opposite corner for a corner, the opposite edge for an edge — so dragging
 * the right edge holds the left one still, which is what makes a handle feel
 * attached to the thing it is moving.
 */
export function boxPivot(frame: BoxFrame, handle: BoxHandle, aboutCentre: boolean): Vec2 {
  if (aboutCentre || handle.action === "rotate") return boxCentre(frame);
  return boxHandlePoint(frame, opposite(handle.at));
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
 * The knob above the top edge first, then the eight on the box: a handle is
 * taken when the pointer is within `reach` of it. Just outside a corner — within
 * `reach` again, and outward on both axes — turns as well. That ring was the
 * only way to turn before the knob existed, and it stays: it is what every
 * drawing program does, and it is still the nearer way round when the selection
 * fills the window and the knob is off the top of it.
 *
 * Corners are tried before edges, so the two that overlap at a corner resolve to
 * the corner, which is the one carrying two axes.
 *
 * Everything is judged in the frame's own coordinates: the pointer is turned
 * back by the box's angle once, and then the arithmetic is the upright case.
 */
export function pickBoxHandle(
  frame: BoxFrame,
  world: Vec2,
  reach: number,
  stem = 0,
): BoxHandle | null {
  const box = frame.rect;
  const p = boxToLocal(frame, world);

  if (stem > 0) {
    const top = localHandlePoint(box, "top");
    const knob = { x: top.x, y: top.y + stem };
    if (Math.abs(p.x - knob.x) <= reach && Math.abs(p.y - knob.y) <= reach) {
      return { at: "top", action: "rotate" };
    }
  }

  const corners = BOX_ANCHORS.filter(isCorner);
  const edges = BOX_ANCHORS.filter((at) => !isCorner(at));

  for (const at of [...corners, ...edges]) {
    const point = localHandlePoint(box, at);
    if (Math.abs(p.x - point.x) <= reach && Math.abs(p.y - point.y) <= reach) {
      return { at, action: "scale" };
    }
  }

  const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  for (const at of corners) {
    const point = localHandlePoint(box, at);
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
 * Measured from the pivot in the frame's own coordinates: how far the pointer is
 * now, over how far the handle was. An axis the box has no extent along cannot
 * be scaled — there is no distance to compare against — and is left alone rather
 * than divided by zero.
 *
 * `uniform` takes the larger of the two and gives it to both, keeping each one's
 * sign so that a drag through the pivot still flips the axis it flipped.
 */
export function boxScale(
  frame: BoxFrame,
  handle: BoxHandle,
  worldPivot: Vec2,
  worldTo: Vec2,
  uniform: boolean,
): { x: number; y: number } {
  const from = localHandlePoint(frame.rect, handle.at);
  const pivot = boxToLocal(frame, worldPivot);
  const to = boxToLocal(frame, worldTo);
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

/**
 * The factors from `boxScale` as a transform of the design plane.
 *
 * A scale along the frame's axes is not a scale along the plane's once the box
 * is turned, so the frame is unwound, the scale applied, and the frame put back.
 * At rest the angle is zero and this is the bare scale, to the last bit.
 */
export function boxScaleTransform(frame: BoxFrame, by: { x: number; y: number }): Affine {
  const scale = scaling(by.x, by.y);
  if (frame.angle === 0) return scale;
  return composeAffine(composeAffine(rotation(frame.angle), scale), rotation(-frame.angle));
}

/** The angle a turn has swept, from where the handle was to where the pointer is. */
export function boxTurn(
  frame: BoxFrame,
  handle: BoxHandle,
  pivot: Vec2,
  to: Vec2,
  step: boolean,
): number {
  // The knob stands straight out of the top edge, so it lies along the ray the
  // top handle already names and needs no case of its own here.
  const from = boxHandlePoint(frame, handle.at);
  const was = Math.atan2(from.y - pivot.y, from.x - pivot.x);
  const now = Math.atan2(to.y - pivot.y, to.x - pivot.x);
  const turned = now - was;
  return step ? Math.round(turned / TURN_STEP) * TURN_STEP : turned;
}
