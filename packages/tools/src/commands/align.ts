import { type Rect, translation } from "@typewright/geometry";
import { type Glyph, contourBounds } from "@typewright/font-model";
import type { Selection, SelectionItem } from "@typewright/view";

import type { ToolResult } from "../effects.js";
import { result } from "../effects.js";
import { type EditorState, currentGlyph } from "../state.js";
import { transformedDocument } from "../transform.js";
import { done } from "./shared.js";

/**
 * Lining things up, and spacing them evenly.
 *
 * What is lined up depends on what is selected, because the two things somebody
 * selects mean two different requests. Whole contours selected are shapes — the
 * bar and the dot of an icon, two counters — and each moves as one thing, kept
 * as it is. Anything less is points, and each point moves alone: four points
 * put on one line, the way a stem's two ends are squared up.
 *
 * What they are lined up *to* is the box round all of them, so nothing but the
 * selection decides where things end up — except where there is only one
 * shape, which has nothing to line up with but the glyph itself: the box a line
 * of text gives it, its advance wide and from the descender to the ascender.
 * That is how an icon is centred.
 */

/** A side to line up on, or the middle between two of them. */
export type Alignment = "left" | "centre" | "right" | "top" | "middle" | "bottom";

/** A direction to space things evenly in. */
export type Distribution = "across" | "down";

/** One thing that moves as a whole: a contour, or a single point. */
type Unit = { readonly items: Selection; readonly box: Rect };

/** What the selection is made of: its whole contours, or else its points. */
function unitsOf(g: Glyph, selection: Selection): { units: Unit[]; shapes: boolean } {
  const chosen = selection.filter((item) => item.part === "point");
  const byContour = new Map<string, SelectionItem[]>();
  for (const item of chosen) {
    const list = byContour.get(item.contourId) ?? [];
    list.push(item);
    byContour.set(item.contourId, list);
  }

  const touched = g.contours.filter((c) => byContour.has(c.id));
  const whole = touched.every((c) => byContour.get(c.id)!.length === c.nodes.length);
  if (whole && touched.length > 0) {
    const units: Unit[] = [];
    for (const c of touched) {
      const box = contourBounds(c);
      if (box !== null) units.push({ items: byContour.get(c.id)!, box });
    }
    return { units, shapes: true };
  }

  const units: Unit[] = [];
  for (const c of touched) {
    for (const item of byContour.get(c.id)!) {
      const node = c.nodes.find((n) => n.id === item.nodeId);
      if (node === undefined) continue;
      const { x, y } = node.pt;
      units.push({ items: [item], box: { minX: x, minY: y, maxX: x, maxY: y } });
    }
  }
  return { units, shapes: false };
}

function around(units: readonly Unit[]): Rect {
  return {
    minX: Math.min(...units.map((u) => u.box.minX)),
    minY: Math.min(...units.map((u) => u.box.minY)),
    maxX: Math.max(...units.map((u) => u.box.maxX)),
    maxY: Math.max(...units.map((u) => u.box.maxY)),
  };
}

/** Move each unit by its own amount, as one step. Whole units, as everything drawn is. */
function moved(
  state: EditorState,
  units: readonly Unit[],
  by: (unit: Unit) => { x: number; y: number },
  label: string,
): ToolResult {
  let document = state.document;
  for (const unit of units) {
    const delta = by(unit);
    const x = Math.round(delta.x);
    const y = Math.round(delta.y);
    if (x === 0 && y === 0) continue;
    document =
      transformedDocument(
        document,
        state.currentGlyph,
        unit.items,
        translation(x, y),
        false,
        state.layer,
      ) ?? document;
  }
  if (document === state.document) return result(state);
  return done(state, { ...state, document }, label);
}

const LABELS: Readonly<Record<Alignment, string>> = {
  left: "Align left",
  centre: "Align centres",
  right: "Align right",
  top: "Align top",
  middle: "Align middles",
  bottom: "Align bottom",
};

/**
 * Whether there is anything for an alignment to do: two things, or one whole
 * contour, which is lined up with the glyph's own box.
 */
export function canAlign(state: EditorState): boolean {
  const g = currentGlyph(state);
  if (g === null) return false;
  const { units, shapes } = unitsOf(g, state.selection);
  return units.length > 1 || (shapes && units.length === 1);
}

/** Whether there are the three things it takes for spacing them evenly to mean anything. */
export function canDistribute(state: EditorState): boolean {
  const g = currentGlyph(state);
  return g !== null && unitsOf(g, state.selection).units.length > 2;
}

/** Line the selection up on one side, or on the middle. */
export function alignSelection(state: EditorState, how: Alignment): ToolResult {
  const g = currentGlyph(state);
  if (g === null) return result(state);
  const { units, shapes } = unitsOf(g, state.selection);
  if (units.length === 0 || (units.length === 1 && !shapes)) return result(state);

  const { ascender, descender } = state.document.info;
  const to: Rect =
    units.length === 1
      ? { minX: 0, minY: descender, maxX: g.advance, maxY: ascender }
      : around(units);

  return moved(
    state,
    units,
    ({ box }) => {
      switch (how) {
        case "left":
          return { x: to.minX - box.minX, y: 0 };
        case "right":
          return { x: to.maxX - box.maxX, y: 0 };
        case "centre":
          return { x: (to.minX + to.maxX) / 2 - (box.minX + box.maxX) / 2, y: 0 };
        case "top":
          return { x: 0, y: to.maxY - box.maxY };
        case "bottom":
          return { x: 0, y: to.minY - box.minY };
        case "middle":
          return { x: 0, y: (to.minY + to.maxY) / 2 - (box.minY + box.maxY) / 2 };
      }
    },
    LABELS[how],
  );
}

/**
 * Space the selection evenly: the first and the last stay where they are, and
 * the gaps between every two neighbours are made the same. For points, which
 * have no size, that is the points themselves at even steps.
 */
export function distributeSelection(state: EditorState, along: Distribution): ToolResult {
  const g = currentGlyph(state);
  if (g === null) return result(state);
  const { units } = unitsOf(g, state.selection);
  if (units.length < 3) return result(state);

  const low = (u: Unit): number => (along === "across" ? u.box.minX : u.box.minY);
  const high = (u: Unit): number => (along === "across" ? u.box.maxX : u.box.maxY);
  const ordered = [...units].sort(
    (a, b) => low(a) + high(a) - (low(b) + high(b)) || low(a) - low(b),
  );
  const span = Math.max(...units.map(high)) - Math.min(...units.map(low));
  const filled = ordered.reduce((sum, u) => sum + (high(u) - low(u)), 0);
  const gap = (span - filled) / (ordered.length - 1);

  const wanted = new Map<Unit, number>();
  let at = Math.min(...units.map(low));
  for (const unit of ordered) {
    wanted.set(unit, at);
    at += high(unit) - low(unit) + gap;
  }

  return moved(
    state,
    ordered,
    (unit) => {
      const shift = (wanted.get(unit) ?? low(unit)) - low(unit);
      return along === "across" ? { x: shift, y: 0 } : { x: 0, y: shift };
    },
    along === "across" ? "Distribute across" : "Distribute down",
  );
}
