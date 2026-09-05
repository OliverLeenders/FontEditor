import type { Rect, Vec2 } from "@fonteditor/geometry";
import {
  type ContourId,
  type Glyph,
  type NodeId,
  contourById,
  nodeById,
} from "@fonteditor/font-model";

import type { HitTarget } from "./hit.js";

/**
 * Which part of a node is selected.
 *
 * Handles are selectable in their own right rather than riding along with their
 * node, so a handle can be nudged with the arrow keys, included in a marquee, and
 * drawn as active — the RoboFont behaviour. The cost is that selection is a pair
 * rather than an id, and everything downstream has to understand that.
 */
export type SelectionPart = "point" | "in" | "out";

export type SelectionItem = {
  readonly contourId: ContourId;
  readonly nodeId: NodeId;
  readonly part: SelectionPart;
};

/**
 * An ordered list rather than a Set, so a selection is plain serializable data.
 * History entries record the selection either side of an edit, and undo that
 * does not restore selection feels wrong even when the geometry is right.
 */
export type Selection = readonly SelectionItem[];

export function selectionKey(item: SelectionItem): string {
  // Built rather than written literally: a raw NUL byte in the source makes the
  // file binary to grep, diff and review tools, which is a poor price for a
  // separator. The byte itself is still the right choice, since no id or part
  // can contain one.
  const sep = String.fromCharCode(0);
  return `${item.contourId}${sep}${item.nodeId}${sep}${item.part}`;
}

export function sameItem(a: SelectionItem, b: SelectionItem): boolean {
  return a.contourId === b.contourId && a.nodeId === b.nodeId && a.part === b.part;
}

export function hasItem(selection: Selection, item: SelectionItem): boolean {
  return selection.some((candidate) => sameItem(candidate, item));
}

export function addItems(selection: Selection, items: Selection): Selection {
  const seen = new Set(selection.map(selectionKey));
  const merged = [...selection];
  for (const item of items) {
    const key = selectionKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

export function removeItems(selection: Selection, items: Selection): Selection {
  const drop = new Set(items.map(selectionKey));
  return selection.filter((item) => !drop.has(selectionKey(item)));
}

export function toggleItem(selection: Selection, item: SelectionItem): Selection {
  return hasItem(selection, item) ? removeItems(selection, [item]) : addItems(selection, [item]);
}

/**
 * The selectable thing a hit target stands for, or `null` for targets that are
 * gestures rather than selections — a Tunni control is something you drag, not
 * something you own.
 */
export function itemForTarget(target: HitTarget): SelectionItem | null {
  switch (target.kind) {
    case "node":
      return { contourId: target.contourId, nodeId: target.nodeId, part: "point" };
    case "handleIn":
      return { contourId: target.contourId, nodeId: target.nodeId, part: "in" };
    case "handleOut":
      return { contourId: target.contourId, nodeId: target.nodeId, part: "out" };
    default:
      return null;
  }
}

/**
 * Everything inside a marquee: on-curve points and handles alike.
 *
 * A handle inside the rectangle is caught whether or not its node is, which is
 * what makes a marquee useful for grabbing a row of handles across several
 * nodes.
 */
export function itemsInRect(g: Glyph, rect: Rect): SelectionItem[] {
  const found: SelectionItem[] = [];
  const inside = (p: Vec2): boolean =>
    p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY;

  for (const c of g.contours) {
    for (const n of c.nodes) {
      if (inside(n.pt)) found.push({ contourId: c.id, nodeId: n.id, part: "point" });
      if (n.in !== null && inside(n.in)) {
        found.push({ contourId: c.id, nodeId: n.id, part: "in" });
      }
      if (n.out !== null && inside(n.out)) {
        found.push({ contourId: c.id, nodeId: n.id, part: "out" });
      }
    }
  }
  return found;
}

/**
 * Where a selected item currently sits, or `null` when it no longer exists.
 *
 * `null` rather than a zero vector: a selection can outlive the thing it names —
 * a handle retracted, a node deleted by an undo — and a point at the origin is a
 * real position that a caller would have no way to tell apart from an absence.
 */
export function itemPoint(g: Glyph, item: SelectionItem): Vec2 | null {
  const c = contourById(g, item.contourId);
  const n = c === null ? null : nodeById(c, item.nodeId);
  if (n === null) return null;

  if (item.part === "point") return n.pt;
  return (item.part === "in" ? n.in : n.out) ?? null;
}

/** Where every item of a selection sits, skipping any that have gone. */
export function selectionPoints(g: Glyph, selection: Selection): Vec2[] {
  const points: Vec2[] = [];
  for (const item of selection) {
    const p = itemPoint(g, item);
    if (p !== null) points.push(p);
  }
  return points;
}

/**
 * The box round the selected on-curve points.
 *
 * The points and not their handles. A handle moves with the point that owns it,
 * so the box would grow to enclose control points that are not themselves being
 * positioned — and a single selected point would then have a box whose centre is
 * not the point, which is exactly where rotating a handle pair wants to pivot.
 *
 * `null` when nothing is selected, or when what is selected is only handles.
 */
export function selectionBounds(g: Glyph, selection: Selection): Rect | null {
  let box: Rect | null = null;

  for (const item of selection) {
    if (item.part !== "point") continue;
    const c = contourById(g, item.contourId);
    const n = c === null ? null : nodeById(c, item.nodeId);
    if (n === null) continue;

    box =
      box === null
        ? { minX: n.pt.x, minY: n.pt.y, maxX: n.pt.x, maxY: n.pt.y }
        : {
            minX: Math.min(box.minX, n.pt.x),
            minY: Math.min(box.minY, n.pt.y),
            maxX: Math.max(box.maxX, n.pt.x),
            maxY: Math.max(box.maxY, n.pt.y),
          };
  }

  return box;
}
