import type { Vec2 } from "@fonteditor/geometry";

import type { Component } from "./component.js";
import type { Contour } from "./contour.js";
import { type FontDocument, putGlyph } from "./document.js";
import type { Glyph } from "./glyph.js";
import type { Node } from "./node.js";

/**
 * Put every coordinate on whole units.
 *
 * Fonts are drawn in whole units. Fractional coordinates arrive anyway — from a
 * font imported at a different em size, from a curve built by arithmetic, from a
 * drag made before snapping existed — and they are invisible until something
 * downstream quantises them and moves a point you thought you had placed.
 *
 * So this does the quantising up front, where it can be seen and undone, rather
 * than leaving it to a compiler at the far end.
 *
 * Every function here returns the value it was given when nothing moved. That is
 * not an optimisation: the store decides what to save by comparing references,
 * so rounding an already-round font must not mark every glyph in it as changed.
 */

/** The grid a coordinate is put on when none is named. */
export const UNIT_GRID = 1;

function roundTo(v: number, grid: number): number {
  return grid > 0 ? Math.round(v / grid) * grid : v;
}

function roundPoint(p: Vec2, grid: number): Vec2 {
  const x = roundTo(p.x, grid);
  const y = roundTo(p.y, grid);
  return x === p.x && y === p.y ? p : { x, y };
}

/**
 * Round a node's anchor and both its handles.
 *
 * A smooth node can come out of this a fraction off collinear, and it keeps its
 * type regardless. The type is a statement of intent — it is what makes the next
 * handle drag swing the other side — and demoting hundreds of nodes to corners
 * would destroy that to record an error too small to see. The next edit to
 * either handle restores the geometry exactly.
 *
 * The same goes for a tangent node, whose handle can land a fraction off the
 * line it is meant to leave along. Rounding is the one place in the model where
 * the geometry is not settled afterwards, and deliberately so: the point of the
 * command is that coordinates come out whole, and a settling pass would put some
 * of them back on fractions to keep a constraint nobody can see at this scale.
 */
function roundNode(n: Node, grid: number): Node {
  const pt = roundPoint(n.pt, grid);
  const inHandle = n.in === null ? null : roundPoint(n.in, grid);
  const outHandle = n.out === null ? null : roundPoint(n.out, grid);
  if (pt === n.pt && inHandle === n.in && outHandle === n.out) return n;
  return { ...n, pt, in: inHandle, out: outHandle };
}

function roundContour(c: Contour, grid: number): Contour {
  const nodes = c.nodes.map((n) => roundNode(n, grid));
  return nodes.every((n, i) => n === c.nodes[i]) ? c : { ...c, nodes };
}

/**
 * Round a component's placement, and nothing else.
 *
 * The offsets are positions and belong on the grid. The four scale terms are
 * ratios: rounding them would turn a component at 92% into one at 100%, which is
 * not a correction but a different glyph.
 */
function roundComponent(c: Component, grid: number): Component {
  const xOffset = roundTo(c.transform.xOffset, grid);
  const yOffset = roundTo(c.transform.yOffset, grid);
  if (xOffset === c.transform.xOffset && yOffset === c.transform.yOffset) return c;
  return { ...c, transform: { ...c.transform, xOffset, yOffset } };
}

/** Round every coordinate of one glyph, its advance included. */
export function roundGlyph(g: Glyph, grid: number = UNIT_GRID): Glyph {
  const contours = g.contours.map((c) => roundContour(c, grid));
  const components = g.components.map((c) => roundComponent(c, grid));
  const advance = roundTo(g.advance, grid);

  const same =
    advance === g.advance &&
    contours.every((c, i) => c === g.contours[i]) &&
    components.every((c, i) => c === g.components[i]);

  return same ? g : { ...g, contours, components, advance };
}

/** How many of a font's glyphs {@link roundFont} would change. */
export function unroundedGlyphs(d: FontDocument, grid: number = UNIT_GRID): number {
  let count = 0;
  for (const name of d.glyphOrder) {
    const g = d.glyphs[name];
    if (g !== undefined && roundGlyph(g, grid) !== g) count += 1;
  }
  return count;
}

/**
 * Round every glyph in a font.
 *
 * The font's own metrics are left alone. An x-height of 512.4 is a decision
 * someone made about the design, not an accident of arithmetic, and a command
 * called "round coordinates" has no business overruling it — the drawing is what
 * was asked about.
 */
export function roundFont(d: FontDocument, grid: number = UNIT_GRID): FontDocument {
  let next = d;
  for (const name of d.glyphOrder) {
    const g = next.glyphs[name];
    if (g === undefined) continue;
    const rounded = roundGlyph(g, grid);
    if (rounded !== g) next = putGlyph(next, rounded);
  }
  return next;
}
