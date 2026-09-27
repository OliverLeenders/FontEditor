import type { Cubic, Vec2 } from "@typewright/geometry";

import { type Contour, contour } from "./contour.js";
import type { IdFactory } from "./ids.js";
import { type Node, node } from "./node.js";

/**
 * A curve, and whether it was drawn as a straight line: what an operation that
 * builds an outline out of pieces of others hands over to be made into a contour.
 */
export type CurvePiece = { readonly curve: Cubic; readonly line: boolean };

/**
 * A closed contour out of a chain of curves.
 *
 * The same job the union does after walking a boundary, and the same rule: the
 * node types are read back from the geometry, because a piece cut out of a curve
 * does not remember what kind of node it started at. A piece that was drawn as a
 * line keeps its handles retracted, so a straight edge stays straight through a
 * save and a load.
 */
export function contourOfCurves(chain: readonly CurvePiece[], ids: IdFactory): Contour {
  const nodes: Node[] = chain.map((piece, i) => {
    const before = chain[(i - 1 + chain.length) % chain.length]!;
    const incoming = before.line ? null : before.curve.c2;
    const outgoing = piece.line ? null : piece.curve.c1;
    return node(ids.node(), piece.curve.a, {
      type: smooth(piece.curve.a, incoming, outgoing) ? "smooth" : "corner",
      in: incoming,
      out: outgoing,
    });
  });
  return contour(ids.contour(), nodes, true);
}

/** Whether two handles leave a point in one straight line, and opposite ways. */
function smooth(pt: Vec2, incoming: Vec2 | null, outgoing: Vec2 | null): boolean {
  if (incoming === null || outgoing === null) return false;

  const before = { x: pt.x - incoming.x, y: pt.y - incoming.y };
  const after = { x: outgoing.x - pt.x, y: outgoing.y - pt.y };
  const lb = Math.hypot(before.x, before.y);
  const la = Math.hypot(after.x, after.y);
  if (lb === 0 || la === 0) return false;

  const cross = (before.x * after.y - before.y * after.x) / (lb * la);
  const dot = (before.x * after.x + before.y * after.y) / (lb * la);
  return dot > 0 && Math.abs(cross) < 0.01;
}
