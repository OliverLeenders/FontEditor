import type { Vec2 } from "@fonteditor/geometry";

import { type Contour } from "./contour.js";
import { type Glyph, glyphBounds } from "./glyph.js";
import { translateNode } from "./node.js";

/**
 * Horizontal spacing, as the space either side of the outline.
 *
 * Derived rather than stored, and that is the whole design. A font file records
 * an advance width and an outline position; the sidebearings are what you get by
 * measuring. Storing them too would mean two representations of one fact, and a
 * third piece of code to keep them agreeing after every edit that moves a point.
 *
 * So this module reads them out and writes them back by adjusting the things
 * that *are* stored. Nothing here is a new field.
 */
export type Sidebearings = {
  /** From the origin to the leftmost point of the outline. */
  readonly left: number;
  /** From the rightmost point of the outline to the advance. */
  readonly right: number;
};

/**
 * The sidebearings of a glyph, or `null` when it has no outline.
 *
 * `null` rather than zero, because a space has no left edge to measure from and
 * reporting `0` would invite an interface to show a number that means nothing
 * and to let someone drag it. A blank glyph has an advance and nothing else.
 */
export function sidebearings(g: Glyph): Sidebearings | null {
  const box = glyphBounds(g);
  if (box === null) return null;
  return { left: box.minX, right: g.advance - box.maxX };
}

function translateContour(c: Contour, delta: Vec2): Contour {
  return { ...c, nodes: c.nodes.map((n) => translateNode(n, delta)) };
}

/** Move every contour of a glyph, leaving the advance alone. */
export function translateGlyph(g: Glyph, delta: Vec2): Glyph {
  if (delta.x === 0 && delta.y === 0) return g;
  return { ...g, contours: g.contours.map((c) => translateContour(c, delta)) };
}

/**
 * Set the left sidebearing, moving the outline.
 *
 * The advance moves with it, which is what keeps the *right* sidebearing where
 * it was. Adding space on the left should add space on the left — not silently
 * take the same amount off the right, which is what leaving the advance fixed
 * would do. This is what every other editor does, and the reason is that the two
 * sides are judged against different neighbours.
 *
 * `null` for a glyph with no outline: there is nothing to move.
 */
export function setLeftSidebearing(g: Glyph, value: number): Glyph | null {
  const current = sidebearings(g);
  if (current === null) return null;

  const delta = value - current.left;
  if (delta === 0) return g;
  return { ...translateGlyph(g, { x: delta, y: 0 }), advance: g.advance + delta };
}

/**
 * Set the right sidebearing by changing the advance alone.
 *
 * The outline does not move, so the left sidebearing is untouched.
 */
export function setRightSidebearing(g: Glyph, value: number): Glyph | null {
  const box = glyphBounds(g);
  if (box === null) return null;

  const advance = box.maxX + value;
  if (advance === g.advance) return g;
  return { ...g, advance };
}

/**
 * Give a glyph the same space on both sides, within the advance it already has.
 *
 * What a symbol or an accent usually wants, and tedious to do by hand with two
 * fields.
 *
 * Note that this translates the outline directly rather than going through
 * {@link setLeftSidebearing}, which would move the advance along with it and so
 * leave the glyph exactly as off-centre as it started.
 */
export function centreGlyph(g: Glyph): Glyph | null {
  const box = glyphBounds(g);
  if (box === null) return null;

  const margin = (g.advance - (box.maxX - box.minX)) / 2;
  return translateGlyph(g, { x: margin - box.minX, y: 0 });
}
