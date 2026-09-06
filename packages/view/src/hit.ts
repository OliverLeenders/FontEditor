import {
  type Cubic,
  type TunniStatus,
  type Vec2,
  controlBounds,
  distance,
  distanceToRect,
  distanceToSegment,
  flatten,
  project,
} from "@fonteditor/geometry";
import {
  type AnchorId,
  type ComponentId,
  type Contour,
  type ContourId,
  type Glyph,
  type NodeId,
  segmentCount,
  segmentCubic,
  segmentTunniStatus,
  segments,
  segmentTunniPoint,
} from "@fonteditor/font-model";

import { type SegmentRef, sameSegment } from "./proximity.js";
import { type Selection, selectedNodeKeys } from "./selection.js";

export type HitKind =
  | "node"
  | "handleIn"
  | "handleOut"
  | "anchor"
  | "component"
  | "tunniPoint"
  | "tunniLine"
  | "segment"
  | "originLine"
  | "advanceLine";

export type HitTarget =
  | {
      readonly kind: "node" | "handleIn" | "handleOut";
      readonly contourId: ContourId;
      readonly nodeId: NodeId;
      readonly point: Vec2;
    }
  | { readonly kind: "anchor"; readonly anchorId: AnchorId; readonly point: Vec2 }
  /**
   * A glyph placed inside this one, as the outlines it draws.
   *
   * Flattened at index time rather than measured as curves: a component is
   * picked by its whole area, not by a particular segment of it — there is
   * nothing inside it to address, since the way to change those shapes is to
   * open the glyph they come from.
   */
  | {
      readonly kind: "component";
      readonly componentId: ComponentId;
      readonly outlines: readonly (readonly Vec2[])[];
    }
  | {
      readonly kind: "tunniPoint";
      readonly contourId: ContourId;
      readonly segmentIndex: number;
      readonly point: Vec2;
    }
  | {
      readonly kind: "tunniLine";
      readonly contourId: ContourId;
      readonly segmentIndex: number;
      readonly from: Vec2;
      readonly to: Vec2;
    }
  | {
      readonly kind: "segment";
      readonly contourId: ContourId;
      readonly segmentIndex: number;
      readonly cubic: Cubic;
      readonly status: TunniStatus;
    }
  /** The vertical lines bounding the advance width. Full height, so only x matters. */
  | { readonly kind: "originLine" | "advanceLine"; readonly x: number };

/**
 * Pick order when several targets sit under the cursor at once. Lower wins.
 *
 * The Tunni point comes first because it is small, deliberate, and usually
 * floating in open space — if it is under the cursor at all, it was aimed at. A
 * node outranks its own handles so that a handle retracted onto its anchor
 * cannot shadow the node: a zero-length handle has no direction and dragging it
 * would do nothing.
 */
export const PICK_PRIORITY: Readonly<Record<HitKind, number>> = {
  tunniPoint: 0,
  node: 1,
  // Level with a node rather than above it, so distance decides between the
  // two. An anchor usually floats clear of the outline, but a `bottom` sitting
  // on the baseline lands near real points, and neither should be able to
  // shadow the other from further away.
  anchor: 1,
  handleIn: 2,
  handleOut: 2,
  tunniLine: 3,
  segment: 4,
  // Under everything the outline offers. A component is a large target — the
  // whole area of a letter — and anything of your own drawing that falls inside
  // it is what a click there means.
  component: 5,
  // Last, and deliberately so. They run the full height of the canvas, so they
  // are under the cursor far more often than anything else; letting them
  // outrank a node would make points near the origin unpickable.
  originLine: 6,
  advanceLine: 6,
};

export type HitIndex = {
  readonly targets: readonly HitTarget[];
};

/**
 * Flatten a glyph into everything the pointer can address.
 *
 * Rebuilt whenever the glyph changes rather than maintained incrementally: a
 * glyph is a few hundred targets at most, rebuilding is microseconds, and an
 * index that cannot drift out of sync with the model is worth more than the
 * saved work.
 *
 * `tunniSegments` lists the segments currently showing their Tunni controls —
 * the hovered one, the focused one, or both. Only those contribute Tunni
 * targets, because **only a visible control may be grabbed**: offering a target
 * for something the user cannot see means clicking empty canvas silently does
 * something. This is the same rule from the other side that `segmentProximity`
 * enforces, and getting either half wrong makes the control disappear exactly
 * when it is reached for.
 */
/**
 * When a handle is on screen, and therefore when it may be grabbed.
 *
 * The rule lives here rather than in the renderer because this package owns the
 * question "what can the pointer address", and the renderer asks it too. One
 * definition means the drawn handles and the grabbable ones cannot drift apart —
 * the same reason `tunniSegments` is shared rather than recomputed.
 */
export type HandleVisibility = {
  readonly autoHide: boolean;
  /** Hovered and focused segments; handles of these are shown. */
  readonly awake: readonly SegmentRef[];
  readonly selection: Selection;
};

export const ALL_HANDLES: HandleVisibility = { autoHide: false, awake: [], selection: [] };

/**
 * Whether one handle is visible.
 *
 * A handle shapes exactly one segment — a node's `out` shapes the segment
 * leaving it, its `in` the one arriving, which on a closed contour wraps round.
 * So "is this handle relevant" is really "is that segment awake".
 *
 * Selection overrides it: picking a point says you mean to work on it, and
 * having its handles disappear because the cursor drifted would be perverse.
 */
export function handleIsVisible(
  c: Contour,
  nodeIndex: number,
  part: "in" | "out",
  v: HandleVisibility,
): boolean {
  if (!v.autoHide) return true;

  const n = c.nodes[nodeIndex];
  if (n === undefined) return false;

  if (selectedNodeKeys(v.selection).has(`${c.id}${String.fromCharCode(0)}${n.id}`)) return true;

  const count = segmentCount(c);
  if (count === 0) return false;
  const index = part === "out" ? nodeIndex : (nodeIndex - 1 + c.nodes.length) % c.nodes.length;
  if (index < 0 || index >= count) return false;

  return v.awake.some((ref) => ref.contourId === c.id && ref.segmentIndex === index);
}

export type HitOptions = {
  /** Whether the margin lines are drawn, and so grabbable. */
  readonly margins?: boolean;
  /** Whether anchors are drawn, and so grabbable. Off by default, as margins are. */
  readonly anchors?: boolean;
  /**
   * The outlines each component draws, already resolved.
   *
   * Passed in rather than resolved here: resolving needs every other glyph in
   * the font, and this package knows about one glyph at a time. The host has
   * them anyway — they are what it draws.
   */
  readonly components?: readonly {
    readonly id: ComponentId;
    readonly contours: readonly Contour[];
  }[];
  readonly handles?: HandleVisibility;
};

export function buildHitIndex(
  g: Glyph,
  tunniSegments: readonly SegmentRef[] = [],
  options: HitOptions = {},
): HitIndex {
  const targets: HitTarget[] = [];
  const handles = options.handles ?? ALL_HANDLES;

  // Off by default: the same rule as the Tunni controls, that only something
  // drawn may be grabbed. A surface not showing margins must not have invisible
  // ones to catch drags.
  if (options.margins === true) {
    targets.push({ kind: "originLine", x: 0 });
    targets.push({ kind: "advanceLine", x: g.advance });
  }

  for (const placed of options.components ?? []) {
    const outlines = placed.contours.map(outlineOf).filter((poly) => poly.length >= 3);
    if (outlines.length > 0) {
      targets.push({ kind: "component", componentId: placed.id, outlines });
    }
  }

  if (options.anchors === true) {
    for (const a of g.anchors) {
      targets.push({ kind: "anchor", anchorId: a.id, point: a.pt });
    }
  }

  for (const c of g.contours) {
    for (const [nodeIndex, n] of c.nodes.entries()) {
      targets.push({ kind: "node", contourId: c.id, nodeId: n.id, point: n.pt });
      if (n.in !== null && handleIsVisible(c, nodeIndex, "in", handles)) {
        targets.push({ kind: "handleIn", contourId: c.id, nodeId: n.id, point: n.in });
      }
      if (n.out !== null && handleIsVisible(c, nodeIndex, "out", handles)) {
        targets.push({ kind: "handleOut", contourId: c.id, nodeId: n.id, point: n.out });
      }
    }

    for (const segment of segments(c)) {
      const cubic = segmentCubic(segment);
      const status = segmentTunniStatus(c, segment.index) ?? "degenerate";
      targets.push({
        kind: "segment",
        contourId: c.id,
        segmentIndex: segment.index,
        cubic,
        status,
      });

      if (segment.kind === "line") continue;
      const ref: SegmentRef = { contourId: c.id, segmentIndex: segment.index };
      if (!tunniSegments.some((candidate) => sameSegment(candidate, ref))) continue;

      // The line is addressable whenever dragging it means something — which is
      // everything but flat and degenerate, including a crossed segment. Making
      // it vanish mid-gesture is worse than letting the drag be refused.
      if (
        status !== "flat" &&
        status !== "degenerate" &&
        segment.out !== null &&
        segment.in !== null
      ) {
        targets.push({
          kind: "tunniLine",
          contourId: c.id,
          segmentIndex: segment.index,
          from: segment.out,
          to: segment.in,
        });
      }

      // The point, by contrast, is only offered where it is well defined.
      if (status === "ok") {
        const point = segmentTunniPoint(c, segment.index);
        if (point !== null) {
          targets.push({
            kind: "tunniPoint",
            contourId: c.id,
            segmentIndex: segment.index,
            point,
          });
        }
      }
    }
  }

  return { targets };
}

/** A contour as a closed polygon, fine enough to pick by. */
function outlineOf(c: Contour): Vec2[] {
  const points: Vec2[] = [];
  for (const segment of segments(c)) {
    points.push(...flatten(segmentCubic(segment), 0.5).slice(0, -1));
  }
  return points;
}

/** Whether a point is inside a closed polygon, by the non-zero rule. */
function insidePolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let winding = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const side = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
    if (a.y <= p.y) {
      if (b.y > p.y && side > 0) winding += 1;
    } else if (b.y <= p.y && side < 0) {
      winding -= 1;
    }
  }
  return winding !== 0;
}

/**
 * How far a point is from the shape a component draws: nothing at all when it is
 * inside one, and the distance to the nearest edge otherwise.
 *
 * Inside counts because a component has no interior of its own to click on —
 * unlike the glyph's own contours, whose points and segments are what a press
 * there is aiming at.
 */
function distanceToOutlines(outlines: readonly (readonly Vec2[])[], p: Vec2): number {
  let inside = false;
  let best = Number.POSITIVE_INFINITY;

  for (const poly of outlines) {
    if (insidePolygon(p, poly)) inside = !inside;
    for (let i = 0; i < poly.length; i++) {
      const gap = distanceToSegment(poly[i]!, poly[(i + 1) % poly.length]!, p);
      if (gap < best) best = gap;
    }
  }

  return inside ? 0 : best;
}

/**
 * Distance from a design-space point to a target, in design units.
 *
 * `limit` is how near the caller cares about. It changes nothing about the
 * answer inside that distance and lets a segment be dismissed by its bounding
 * box when the point is plainly nowhere near it — which matters because
 * projecting a point onto a cubic costs a hundred-odd evaluations, and a pick
 * asks every segment of the glyph on every pointer move. Beyond the limit the
 * result is only guaranteed to be *at least* the true distance, which is all a
 * caller comparing against the limit can use it for.
 */
export function distanceToTarget(
  target: HitTarget,
  p: Vec2,
  limit = Number.POSITIVE_INFINITY,
): number {
  switch (target.kind) {
    case "node":
    case "handleIn":
    case "handleOut":
    case "anchor":
    case "tunniPoint":
      return distance(p, target.point);
    case "component":
      return distanceToOutlines(target.outlines, p);
    case "tunniLine":
      return distanceToSegment(target.from, target.to, p);
    case "segment": {
      const floor = distanceToRect(controlBounds(target.cubic), p);
      return floor > limit ? floor : project(target.cubic, p).distance;
    }
    case "originLine":
    case "advanceLine":
      // Vertical and unbounded, so only the horizontal gap counts.
      return Math.abs(p.x - target.x);
  }
}

/**
 * Per-kind adjustment to the pick radius, as a fraction of the usual tolerance.
 *
 * The margin lines run the full height of the canvas, which makes them vastly
 * larger targets than anything else on it. At the ordinary radius a drag begun
 * anywhere near the origin would grab the line instead of starting a marquee, so
 * they ask to be aimed at rather than merely approached.
 *
 * Nothing else appears here: every other target is small enough that the plain
 * tolerance is the right one.
 */
export const PICK_TOLERANCE_SCALE: Readonly<Partial<Record<HitKind, number>>> = {
  originLine: 0.4,
  advanceLine: 0.4,
};

export type Hit = {
  readonly target: HitTarget;
  readonly distance: number;
};

/**
 * Everything within `tolerance` of `p`, best first.
 *
 * Ordered by pick priority and then by distance — not by distance alone. A
 * handle a few units further away than the curve beneath it is still the thing
 * the user meant to grab, and sorting purely by proximity makes small controls
 * nearly impossible to hit at low zoom.
 *
 * `tolerance` is in design units; get it from `screenTolerance`.
 */
export function pickAll(index: HitIndex, p: Vec2, tolerance: number): Hit[] {
  const hits: Hit[] = [];
  for (const target of index.targets) {
    const reach = tolerance * (PICK_TOLERANCE_SCALE[target.kind] ?? 1);
    const d = distanceToTarget(target, p, reach);
    if (d <= reach) hits.push({ target, distance: d });
  }
  hits.sort((l, r) => {
    const byPriority = PICK_PRIORITY[l.target.kind] - PICK_PRIORITY[r.target.kind];
    return byPriority !== 0 ? byPriority : l.distance - r.distance;
  });
  return hits;
}

/** The single best target within `tolerance`, or `null` if nothing is close. */
export function pick(index: HitIndex, p: Vec2, tolerance: number): HitTarget | null {
  return pickAll(index, p, tolerance)[0]?.target ?? null;
}

/**
 * The best target whose kind is allowed, for tools that only care about some of
 * them — a knife wanting segments, say, and never a handle.
 */
export function pickOf(
  index: HitIndex,
  p: Vec2,
  tolerance: number,
  kinds: readonly HitKind[],
): HitTarget | null {
  const allowed = new Set<HitKind>(kinds);
  return pickAll(index, p, tolerance).find((h) => allowed.has(h.target.kind))?.target ?? null;
}

/** Every node inside a design-space rectangle, for marquee selection. */
export function nodesInRect(
  g: Glyph,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Array<{ contourId: ContourId; nodeId: NodeId }> {
  const found: Array<{ contourId: ContourId; nodeId: NodeId }> = [];
  for (const c of g.contours) {
    for (const n of c.nodes) {
      if (n.pt.x >= minX && n.pt.x <= maxX && n.pt.y >= minY && n.pt.y <= maxY) {
        found.push({ contourId: c.id, nodeId: n.id });
      }
    }
  }
  return found;
}
