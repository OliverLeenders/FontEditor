import { type Vec2, refittedJoin, tangent } from "@typewright/geometry";

import { type Contour, segmentAt, segmentCount, segmentCubic } from "./contour.js";
import type { Node } from "./node.js";

/**
 * Taking out the points an outline does not need.
 *
 * Drawings collect points. A knife cut leaves two, a union leaves one at every
 * crossing it resolved, an offset leaves one per piece it took to approximate a
 * curve, and a traced outline arrives with a point every few units. None of them
 * is wrong and all of them are in the way: every extra point is one more thing to
 * keep compatible between masters, to nudge by mistake, and to interpolate.
 *
 * A point can go when the curve through what is left is the curve that was there.
 * That is what {@link refittedJoin} answers — one cubic fitted through the pair of
 * segments a point joined, with how far it strays — so this is a policy rather
 * than a piece of arithmetic: which points may be considered, and how far is too
 * far.
 *
 * Two kinds are never considered, whatever the tolerance says.
 *
 * A point at an extreme stays. The topmost point of a bowl is where the outline
 * turns from rising to falling, and a font wants one there for reasons that have
 * nothing to do with the shape: it is what hinting rounds to the grid, what an
 * interpolation between masters needs on both sides to have anything to pair, and
 * what several renderers look for to decide a glyph's extent. Fitting a curve
 * through the place it used to be draws the same shape and loses all of that.
 *
 * A corner stays. The fit keeps the directions the curve leaves and arrives by,
 * so taking a corner out would round it off — and a corner is rarely an accident.
 */

/** How near to an axis a tangent must run to count as an extreme, in degrees. */
const EXTREME_DEGREES = 0.5;

/** How far two tangents may differ and still count as one direction, in degrees. */
const SMOOTH_DEGREES = 1;

/**
 * The contour with every point taken out that can be, or `null` if none can.
 *
 * `tolerance` is the furthest the outline may move at each step, in design units.
 * Points are taken out one at a time, the least damaging first, and each removal is
 * measured against the contour as it stands rather than as it arrived — so several
 * removals along one stretch can drift further from the original than any one of
 * them was allowed to. That is the usual trade and it is the right way round: the
 * alternative is to hold every fit against the drawing as it came in, which stops
 * at the first point that cannot go and leaves the rest of the litter behind.
 *
 * `null` rather than the same contour, so a caller can tell "tidied" from
 * "already tidy" without comparing.
 */
export function simplifyContour(c: Contour, tolerance: number): Contour | null {
  let current = c;
  let removed = 0;

  for (;;) {
    const candidate = leastDamaging(current, tolerance);
    if (candidate === null) break;
    current = candidate;
    removed += 1;
    // A contour of two nodes is two curves, which is as far as this can go.
    if (current.nodes.length <= 2) break;
  }

  return removed === 0 ? null : current;
}

/**
 * The contour with its most removable point removed, or `null` when none is.
 *
 * Least damaging first, because the order changes the answer: taking out the point
 * that barely matters leaves its neighbours' fits nearly as good as they were,
 * where starting with the one that just scrapes past the tolerance moves the
 * outline under the others and spends the budget where it buys least.
 */
function leastDamaging(c: Contour, tolerance: number): Contour | null {
  let best: { readonly at: number; readonly error: number; readonly curve: Contour } | null = null;

  for (let i = 0; i < c.nodes.length; i++) {
    const tried = withoutNode(c, i, tolerance);
    if (tried === null) continue;
    if (best === null || tried.error < best.error)
      best = { at: i, error: tried.error, curve: tried.contour };
  }

  return best === null ? null : best.curve;
}

/**
 * What the contour would be without node `i`, and how far that moves the outline.
 *
 * `null` where the point may not go at all — an end of an open contour, an
 * extreme, a corner — or where the fit strays further than allowed.
 */
function withoutNode(
  c: Contour,
  i: number,
  tolerance: number,
): { readonly contour: Contour; readonly error: number } | null {
  if (c.nodes.length <= 2) return null;

  const count = segmentCount(c);
  // The segment arriving at this node, and the one leaving it. On an open contour
  // the first and last nodes have only one, and a point with one segment either
  // side is not a point being taken out of a curve.
  const arriving = i === 0 ? (c.closed ? count - 1 : -1) : i - 1;
  const leaving = i < count ? i : -1;
  if (arriving < 0 || leaving < 0) return null;

  const before = segmentAt(c, arriving);
  const after = segmentAt(c, leaving);
  if (before === null || after === null) return null;

  const first = segmentCubic(before);
  const second = segmentCubic(after);

  const incoming = tangent(first, 1);
  const outgoing = tangent(second, 0);
  if (incoming === null || outgoing === null) return null;
  if (isCorner(incoming, outgoing)) return null;
  if (isExtreme(incoming) || isExtreme(outgoing)) return null;

  const fitted = refittedJoin(first, second);
  if (fitted === null || fitted.error > tolerance) return null;

  // The fitted curve becomes the segment between the two neighbours: its first
  // handle is the outgoing handle of the node before, its second the incoming
  // handle of the node after, and the node itself goes.
  const nodes = [...c.nodes];
  const previous = (i - 1 + nodes.length) % nodes.length;
  const next = (i + 1) % nodes.length;

  const line = before.kind === "line" && after.kind === "line";
  nodes[previous] = { ...nodes[previous]!, out: line ? null : fitted.curve.c1 };
  nodes[next] = { ...nodes[next]!, in: line ? null : fitted.curve.c2 };
  nodes.splice(i, 1);

  return { contour: { ...c, nodes }, error: fitted.error };
}

/** Whether the curve turns a corner here rather than carrying on. */
function isCorner(incoming: Vec2, outgoing: Vec2): boolean {
  const one = Math.hypot(incoming.x, incoming.y);
  const two = Math.hypot(outgoing.x, outgoing.y);
  if (one === 0 || two === 0) return true;

  const dot = (incoming.x * outgoing.x + incoming.y * outgoing.y) / (one * two);
  const angle = Math.acos(Math.min(1, Math.max(-1, dot)));
  return angle > (SMOOTH_DEGREES * Math.PI) / 180;
}

/** Whether a tangent runs along an axis, which is what an extreme is. */
function isExtreme(along: Vec2): boolean {
  const length = Math.hypot(along.x, along.y);
  if (length === 0) return false;

  const limit = Math.sin((EXTREME_DEGREES * Math.PI) / 180);
  return Math.abs(along.y) / length < limit || Math.abs(along.x) / length < limit;
}

/** Whether a node is one this would never take out, for a caller that wants to say so. */
export function keptByPolicy(c: Contour, i: number): boolean {
  const node: Node | undefined = c.nodes[i];
  if (node === undefined) return true;
  return withoutNode(c, i, Infinity) === null;
}
