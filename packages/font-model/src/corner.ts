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

/** A contour's segments as curves, whether each is straight, and how long. */
type Sides = {
  readonly curves: readonly Cubic[];
  readonly straight: readonly boolean[];
  readonly lengths: readonly number[];
};

const sidesOf = new WeakMap<Contour, Sides>();

function sides(c: Contour): Sides {
  const known = sidesOf.get(c);
  if (known !== undefined) return known;
  const curves: Cubic[] = [];
  const straight: boolean[] = [];
  for (let i = 0; i < segmentCount(c); i++) {
    const s = segmentAt(c, i)!;
    curves.push(segmentCubic(s));
    straight.push(s.kind === "line");
  }
  const found = { curves, straight, lengths: curves.map((s) => arcLength(s)) };
  sidesOf.set(c, found);
  return found;
}

/**
 * The most of each side a corner may spend: not more than a side has, nor more
 * than half of one whose other end is rounded too, so two rounds on one side meet
 * at most in its middle.
 */
function mostSize(c: Contour, k: number): number {
  const { lengths } = sides(c);
  const n = c.nodes.length;
  const incoming = (k - 1 + n) % n;
  const outgoing = k % lengths.length;
  const share = (segment: number, otherEnd: number): number =>
    lengths[segment]! * (continuousAt(c, otherEnd) ? 0.5 : 0.98);
  return Math.min(share(incoming, incoming), share(outgoing, (k + 1) % n));
}

/** The join at node `k` spending `size`, or `null` where none can be drawn. */
function joinAt(c: Contour, k: number, size: number): ContinuousJoin | null {
  const { curves, straight } = sides(c);
  const n = c.nodes.length;
  const incoming = (k - 1 + n) % n;
  const outgoing = k % curves.length;
  return continuousJoin(
    curves[incoming]!,
    curves[outgoing]!,
    straight[incoming]!,
    straight[outgoing]!,
    { size, smoothness: c.nodes[k]!.continuous!.smoothness },
  );
}

/** How far along one of its sides from the node a join's end lies. */
function spentAlong(c: Contour, k: number, join: ContinuousJoin, side: "in" | "out"): number {
  const { curves } = sides(c);
  const n = c.nodes.length;
  return side === "in"
    ? arcLength(subcurve(curves[(k - 1 + n) % n]!, join.before, 1))
    : arcLength(subcurve(curves[k % curves.length]!, 0, join.after));
}

/** A contour's segments as curves, and the joins at its continuous corners by node. */
type Rounding = Sides & { readonly joins: ReadonlyMap<number, ContinuousJoin> };

const roundings = new WeakMap<Contour, Rounding>();

/**
 * The joins of a contour's continuous corners, worked out once per contour.
 *
 * Where a join cannot be drawn at its size — a tangent join's ramp needing more
 * of its line than the line has — it is tried smaller, halving, before being let
 * go: a round a little smaller than asked is better than a corner that is not
 * rounded at all.
 */
function roundingOf(c: Contour): Rounding {
  const known = roundings.get(c);
  if (known !== undefined) return known;

  const joins = new Map<number, ContinuousJoin>();
  for (let k = 0; k < c.nodes.length; k++) {
    if (!continuousAt(c, k)) continue;
    let size = Math.min(c.nodes[k]!.continuous!.size, mostSize(c, k));
    for (let attempt = 0; attempt < 6 && size > 0.5; attempt++) {
      const join = joinAt(c, k, size);
      if (join !== null) {
        joins.set(k, join);
        break;
      }
      size /= 2;
    }
  }

  const rounding = { ...sides(c), joins };
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
 *
 * At a tangent join the end on the straight side is worked out from the size
 * rather than being it, so there the size is the one whose round ends where the
 * pointer is, found by halving.
 */
export function continuousSizeAt(c: Contour, index: number, side: "in" | "out", p: Vec2): number {
  const n = c.nodes.length;
  const segment = segmentAt(c, side === "in" ? (index - 1 + n) % n : index);
  if (segment === null) return 0;
  const curve = segmentCubic(segment);
  const { t } = project(curve, p);
  const wanted = arcLength(side === "in" ? subcurve(curve, t, 1) : subcurve(curve, 0, t));

  const join = continuousAt(c, index) ? roundingOf(c).joins.get(index) : undefined;
  const derived = join?.derived === "before" ? "in" : join?.derived === "after" ? "out" : null;
  if (derived !== side) return wanted;

  let lo = 0.5;
  let hi = mostSize(c, index);
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const trial = joinAt(c, index, mid);
    if (trial === null || spentAlong(c, index, trial, side) > wanted) hi = mid;
    else lo = mid;
  }
  return lo;
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
