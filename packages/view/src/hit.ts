import {
  type Cubic,
  type TunniStatus,
  type Vec2,
  distance,
  distanceToSegment,
  project,
} from "@fonteditor/geometry";
import {
  type ContourId,
  type Glyph,
  type NodeId,
  segmentCubic,
  segmentTunniStatus,
  segments,
  segmentTunniPoint,
} from "@fonteditor/font-model";

import { type SegmentRef, sameSegment } from "./proximity.js";

export type HitKind =
  | "node"
  | "handleIn"
  | "handleOut"
  | "tunniPoint"
  | "tunniLine"
  | "segment"
  | "originLine"
  | "advanceLine";

export type HitTarget =
  | { readonly kind: "node" | "handleIn" | "handleOut"; readonly contourId: ContourId; readonly nodeId: NodeId; readonly point: Vec2 }
  | { readonly kind: "tunniPoint"; readonly contourId: ContourId; readonly segmentIndex: number; readonly point: Vec2 }
  | { readonly kind: "tunniLine"; readonly contourId: ContourId; readonly segmentIndex: number; readonly from: Vec2; readonly to: Vec2 }
  | { readonly kind: "segment"; readonly contourId: ContourId; readonly segmentIndex: number; readonly cubic: Cubic; readonly status: TunniStatus }
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
  handleIn: 2,
  handleOut: 2,
  tunniLine: 3,
  segment: 4,
  // Last, and deliberately so. They run the full height of the canvas, so they
  // are under the cursor far more often than anything else; letting them
  // outrank a node would make points near the origin unpickable.
  originLine: 5,
  advanceLine: 5,
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
export function buildHitIndex(
  g: Glyph,
  tunniSegments: readonly SegmentRef[] = [],
  margins = false,
): HitIndex {
  const targets: HitTarget[] = [];

  // Off by default: the same rule as the Tunni controls, that only something
  // drawn may be grabbed. A surface not showing margins must not have invisible
  // ones to catch drags.
  if (margins) {
    targets.push({ kind: "originLine", x: 0 });
    targets.push({ kind: "advanceLine", x: g.advance });
  }

  for (const c of g.contours) {
    for (const n of c.nodes) {
      targets.push({ kind: "node", contourId: c.id, nodeId: n.id, point: n.pt });
      if (n.in !== null) {
        targets.push({ kind: "handleIn", contourId: c.id, nodeId: n.id, point: n.in });
      }
      if (n.out !== null) {
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
      if (status !== "flat" && status !== "degenerate" && segment.out !== null && segment.in !== null) {
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

/** Distance from a design-space point to a target, in design units. */
export function distanceToTarget(target: HitTarget, p: Vec2): number {
  switch (target.kind) {
    case "node":
    case "handleIn":
    case "handleOut":
    case "tunniPoint":
      return distance(p, target.point);
    case "tunniLine":
      return distanceToSegment(target.from, target.to, p);
    case "segment":
      return project(target.cubic, p).distance;
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
    const d = distanceToTarget(target, p);
    if (d <= tolerance * (PICK_TOLERANCE_SCALE[target.kind] ?? 1)) {
      hits.push({ target, distance: d });
    }
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
