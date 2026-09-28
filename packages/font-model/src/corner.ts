import {
  type ContinuousJoin,
  type Cubic,
  type Vec2,
  arcLength,
  continuousJoin,
  evaluate,
  project,
  subcurve,
} from "@typewright/geometry";

import { type Contour, segmentAt, segmentCount, segmentCubic } from "./contour.js";
import { type CurvePiece, contourOfCurves } from "./curves.js";
import { counterIds } from "./ids.js";
import type { ContinuousCorner } from "./node.js";

/**
 * Continuous corners: a node the drawn outline rounds with a curvature that ramps.
 *
 * The contour keeps the node where it was put, sharp; the outline that is filled,
 * exported and measured replaces the stretch of each side next to it with the
 * join the geometry works out — see `continuousJoin`. The points a designer edits
 * stay few, and moving the node moves the round.
 */

/**
 * Whether the node at `index` is drawn as a continuous corner: it asks to be, it
 * is a corner or a tangent node, and it has a segment on each side — every node of
 * a closed contour, the ones between the ends of an open one. A stroke's skeleton
 * is left to its pen.
 */
export function continuousAt(c: Contour, index: number): boolean {
  const n = c.nodes[index];
  if (n?.continuous === undefined || c.nib !== undefined) return false;
  if (n.type !== "corner" && n.type !== "tangent") return false;
  return c.closed ? c.nodes.length >= 2 : index > 0 && index < c.nodes.length - 1;
}

/** Whether any node of a contour is drawn as a continuous corner. */
export function hasContinuousCorners(c: Contour): boolean {
  return c.nodes.some((_, i) => continuousAt(c, i));
}

/** A contour's segments as curves, and the joins at its continuous corners by node. */
type Rounding = {
  readonly curves: readonly Cubic[];
  readonly straight: readonly boolean[];
  readonly joins: ReadonlyMap<number, ContinuousJoin>;
};

const roundings = new WeakMap<Contour, Rounding>();

/**
 * The joins of a contour's continuous corners, worked out once per contour.
 *
 * A corner cannot spend more of a side than the side has, nor more than half of
 * one whose other end is rounded too, so two rounds on one side meet at most in
 * its middle.
 */
function roundingOf(c: Contour): Rounding {
  const known = roundings.get(c);
  if (known !== undefined) return known;

  const count = segmentCount(c);
  const curves: Cubic[] = [];
  const straight: boolean[] = [];
  for (let i = 0; i < count; i++) {
    const s = segmentAt(c, i)!;
    curves.push(segmentCubic(s));
    straight.push(s.kind === "line");
  }
  const lengths = curves.map((s) => arcLength(s));
  const n = c.nodes.length;

  const joins = new Map<number, ContinuousJoin>();
  for (let k = 0; k < n; k++) {
    if (!continuousAt(c, k)) continue;
    const incoming = (k - 1 + n) % n;
    const outgoing = k % count;
    const share = (segment: number, otherEnd: number): number =>
      lengths[segment]! * (continuousAt(c, otherEnd) ? 0.5 : 0.98);
    const size = Math.min(
      c.nodes[k]!.continuous!.size,
      share(incoming, incoming),
      share(outgoing, (k + 1) % n),
    );
    const join = continuousJoin(
      curves[incoming]!,
      curves[outgoing]!,
      straight[incoming]!,
      straight[outgoing]!,
      { size, smoothness: c.nodes[k]!.continuous!.smoothness },
    );
    if (join !== null) joins.set(k, join);
  }

  const rounding = { curves, straight, joins };
  roundings.set(c, rounding);
  return rounding;
}

const cornered = new WeakMap<Contour, Contour>();
const cornerIds = counterIds("corner-");

/**
 * The contour as it is drawn: every continuous corner rounded.
 *
 * The same contour back where there is none, and the same object for the same
 * contour every time, so a caller remembering answers by contour keeps them. The
 * drawn contour keeps the contour's id, so a reader that finds a contour by id
 * finds its drawing; its nodes are its own.
 */
export function corneredContour(c: Contour): Contour {
  if (!hasContinuousCorners(c)) return c;
  const known = cornered.get(c);
  if (known !== undefined) return known;

  const { curves, straight, joins } = roundingOf(c);
  if (joins.size === 0) {
    cornered.set(c, c);
    return c;
  }

  const n = c.nodes.length;
  const chain: CurvePiece[] = [];
  for (let i = 0; i < curves.length; i++) {
    const here = joins.get(i);
    if (here !== undefined) chain.push(...here.pieces);
    const from = here?.after ?? 0;
    const to = joins.get((i + 1) % n)?.before ?? 1;
    if (to - from > 1e-9) chain.push({ curve: subcurve(curves[i]!, from, to), line: straight[i]! });
  }

  const drawn = { ...contourOfCurves(chain, cornerIds, c.closed), id: c.id };
  cornered.set(c, drawn);
  return drawn;
}

/**
 * Where each continuous corner of a contour begins and ends on its two sides, by
 * node index: the points a corner's size is dragged by.
 */
export function continuousCuts(c: Contour): ReadonlyMap<number, { before: Vec2; after: Vec2 }> {
  const out = new Map<number, { before: Vec2; after: Vec2 }>();
  if (!hasContinuousCorners(c)) return out;
  const { curves, joins } = roundingOf(c);
  const n = c.nodes.length;
  for (const [k, join] of joins) {
    out.set(k, {
      before: evaluate(curves[(k - 1 + n) % n]!, join.before),
      after: evaluate(curves[k % curves.length]!, join.after),
    });
  }
  return out;
}

/**
 * The size a corner would have for its round to begin at the point on one of its
 * sides nearest `p`: the distance along that side from the node. What dragging a
 * corner's end along its side sets.
 */
export function continuousSizeAt(c: Contour, index: number, side: "in" | "out", p: Vec2): number {
  const n = c.nodes.length;
  const segment = segmentAt(c, side === "in" ? (index - 1 + n) % n : index);
  if (segment === null) return 0;
  const curve = segmentCubic(segment);
  const { t } = project(curve, p);
  return arcLength(side === "in" ? subcurve(curve, t, 1) : subcurve(curve, 0, t));
}

/**
 * A stored continuous corner, read back, or nothing where it cannot be: a size
 * that is a positive number, and a smoothness held to between nought and one.
 */
export function readContinuous(raw: unknown): ContinuousCorner | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const size = r["size"];
  const smoothness = r["smoothness"];
  if (typeof size !== "number" || !Number.isFinite(size) || !(size > 0)) return undefined;
  const smooth = typeof smoothness === "number" && Number.isFinite(smoothness) ? smoothness : 0;
  return { size, smoothness: Math.min(1, Math.max(0, smooth)) };
}
