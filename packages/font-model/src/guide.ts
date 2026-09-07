import type { Vec2 } from "@fonteditor/geometry";

import type { GuideId } from "./ids.js";

/**
 * A line to draw against.
 *
 * Not part of any shape and never exported into one: a guide is where the
 * designer decided something goes — the overshoot on the round letters, the
 * angle of an italic, the height a diacritic sits at — written down so the next
 * fifty glyphs agree with the first one. Half of drawing a typeface is making
 * separate letters agree, and a guide is the agreement made visible.
 *
 * Two kinds, and the difference is scope rather than behaviour. A font's guides
 * are drawn in every glyph, because they are decisions about the typeface. A
 * glyph's guides are drawn in that one, because they are about that letter.
 *
 * A point and an angle rather than a slope, because a slope cannot express a
 * vertical and because an angle is what a designer says out loud: the italic is
 * twelve degrees, not a gradient of 4.7.
 */
export type Guide = {
  readonly id: GuideId;
  /** Shown beside the line. Empty is ordinary — most guides are just a line. */
  readonly name: string;
  /** A point the line passes through. */
  readonly pt: Vec2;
  /** Degrees counter-clockwise from the x axis: 0 is horizontal, 90 vertical. */
  readonly angle: number;
  /** UFO's colour string, carried through untouched, or `null`. */
  readonly color: string | null;
};

export function guide(
  id: GuideId,
  pt: Vec2,
  angle = 0,
  name = "",
  color: string | null = null,
): Guide {
  return { id, name, pt, angle: normalAngle(angle), color };
}

/** A horizontal guide at a height — an x-height, a cap height, an overshoot. */
export const horizontalGuide = (id: GuideId, y: number, name = ""): Guide =>
  guide(id, { x: 0, y }, 0, name);

/** A vertical guide at a position — a stem, a sidebearing, a centre. */
export const verticalGuide = (id: GuideId, x: number, name = ""): Guide =>
  guide(id, { x, y: 0 }, 90, name);

export const movedGuide = (g: Guide, dx: number, dy: number): Guide => ({
  ...g,
  pt: { x: g.pt.x + dx, y: g.pt.y + dy },
});

export const turnedGuide = (g: Guide, angle: number): Guide => ({
  ...g,
  angle: normalAngle(angle),
});

export const renamedGuide = (g: Guide, name: string): Guide => ({ ...g, name });

/** Whether the line runs level, which is the common case and worth asking. */
export const isHorizontal = (g: Guide): boolean => g.angle === 0 || g.angle === 180;

/** Whether it runs upright. */
export const isVertical = (g: Guide): boolean => g.angle === 90 || g.angle === 270;

/**
 * The direction the line runs, as a unit vector.
 *
 * Everything geometric about a guide comes from this: where it crosses the
 * view, how far a point is from it, where a drag along it lands.
 */
export function guideDirection(g: Guide): Vec2 {
  const radians = (g.angle * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

/**
 * How far a point lies from the line, signed.
 *
 * Signed because which side is which is what a snap needs to know to stop
 * oscillating across the line.
 */
export function distanceToGuide(g: Guide, pt: Vec2): number {
  const d = guideDirection(g);
  // The perpendicular component of the offset, which is the cross product with
  // the direction when the direction is a unit vector.
  return (pt.x - g.pt.x) * d.y - (pt.y - g.pt.y) * d.x;
}

/** The point on the line nearest a given one. */
export function nearestOnGuide(g: Guide, pt: Vec2): Vec2 {
  const d = guideDirection(g);
  const along = (pt.x - g.pt.x) * d.x + (pt.y - g.pt.y) * d.y;
  return { x: g.pt.x + d.x * along, y: g.pt.y + d.y * along };
}

/**
 * An angle brought into 0 to 360.
 *
 * A line has no direction — 12 degrees and 192 degrees are the same line — but
 * keeping the angle as it was given means a guide dragged round twice reads as
 * 732 degrees in the inspector, which is nobody's idea of a number.
 */
export function normalAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  const turned = angle % 360;
  return turned < 0 ? turned + 360 : turned;
}
