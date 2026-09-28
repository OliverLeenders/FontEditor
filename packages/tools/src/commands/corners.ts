import {
  type ContinuousCorner,
  type Contour,
  segmentAt,
  segmentCubic,
  updateContour,
} from "@typewright/font-model";
import { arcLength } from "@typewright/geometry";

import { type ToolResult, result } from "../effects.js";
import { type EditorState, currentGlyph, editCurrentGlyph } from "../state.js";
import { done } from "./shared.js";

/**
 * Continuous corners: the commands behind the Point section's Continuous switch
 * and its Size and Smoothness, and the menu item beside Corner and Smooth.
 *
 * A corner is rounded in the drawing, not in the points; see `corneredContour`.
 * These act on the selected points that can be rounded — corner and tangent
 * nodes with a segment on each side, on an outline — and pass over the rest.
 */

/** The smoothness a newly rounded corner starts with: most of the way to all ramp. */
const DEFAULT_SMOOTHNESS = 0.6;

/** A newly rounded corner spends this share of its shorter side. */
const DEFAULT_SHARE = 0.25;

/** Whether the node at `index` could be drawn as a continuous corner. */
export function canBeContinuous(c: Contour, index: number): boolean {
  const n = c.nodes[index];
  if (n === undefined || c.nib !== undefined) return false;
  if (n.type !== "corner" && n.type !== "tangent") return false;
  return c.closed ? c.nodes.length >= 2 : index > 0 && index < c.nodes.length - 1;
}

/** The selected points that could be rounded, with their contours and places. */
function roundable(state: EditorState): { contour: Contour; index: number }[] {
  const glyph = currentGlyph(state);
  if (glyph === null) return [];
  const out: { contour: Contour; index: number }[] = [];
  for (const item of state.selection) {
    if (item.part !== "point") continue;
    const c = glyph.contours.find((each) => each.id === item.contourId);
    if (c === undefined) continue;
    const index = c.nodes.findIndex((n) => n.id === item.nodeId);
    if (index >= 0 && canBeContinuous(c, index)) out.push({ contour: c, index });
  }
  return out;
}

/** What the Point section shows of the selected points' continuous corners. */
export type ContinuousState = {
  /** Whether they are rounded: all, none, or some. */
  readonly on: boolean | "mixed";
  /** The size they share, `"mixed"` where they differ; `null` where none is rounded. */
  readonly size: number | "mixed" | null;
  readonly smoothness: number | "mixed" | null;
};

/**
 * The continuous corners of the selected points, or `null` where no selected point
 * could be one.
 */
export function selectedContinuous(state: EditorState): ContinuousState | null {
  const points = roundable(state);
  if (points.length === 0) return null;
  const corners = points.map(({ contour: c, index }) => c.nodes[index]!.continuous);
  const rounded = corners.filter((k): k is ContinuousCorner => k !== undefined);
  const on = rounded.length === 0 ? false : rounded.length === corners.length ? true : "mixed";
  const shared = (field: keyof ContinuousCorner): number | "mixed" | null => {
    if (rounded.length === 0) return null;
    const first = rounded[0]![field];
    return rounded.every((k) => k[field] === first) ? first : "mixed";
  };
  return { on, size: shared("size"), smoothness: shared("smoothness") };
}

/**
 * Round the selected corners continuously, or make them sharp again.
 *
 * A corner rounded afresh spends a quarter of its shorter side — enough to see, and
 * little enough to leave the side mostly straight — in whole units. One already
 * rounded keeps what it has.
 */
export function setContinuous(state: EditorState, on: boolean): ToolResult {
  const points = roundable(state);
  const byContour = new Map<string, Set<number>>();
  for (const { contour: c, index } of points) {
    const set = byContour.get(c.id) ?? new Set<number>();
    set.add(index);
    byContour.set(c.id, set);
  }

  let editor = state;
  for (const [contourId, indices] of byContour) {
    const document = editCurrentGlyph(editor, (g) =>
      updateContour(g, contourId, (c) => {
        const nodes = c.nodes.map((n, i) => {
          if (!indices.has(i)) return n;
          if (on === (n.continuous !== undefined)) return n;
          if (!on) {
            const { continuous: _dropped, ...rest } = n;
            return rest;
          }
          return { ...n, continuous: { size: defaultSize(c, i), smoothness: DEFAULT_SMOOTHNESS } };
        });
        return nodes.some((n, i) => n !== c.nodes[i]) ? { ...c, nodes } : null;
      }),
    );
    if (document !== null) editor = { ...editor, document };
  }
  return done(
    state,
    editor === state ? null : editor,
    on ? "Make corner continuous" : "Make corner sharp",
  );
}

/**
 * Change the size or the smoothness of the selected continuous corners, leaving the
 * other. A size that is not above nothing, or a smoothness outside nought to one,
 * is a field being typed into, and nothing changes until it is a number that fits.
 */
export function changeContinuous(
  state: EditorState,
  change: { readonly size?: number; readonly smoothness?: number },
): ToolResult {
  if (change.size !== undefined && !(change.size > 0)) return result(state);
  if (change.smoothness !== undefined && !(change.smoothness >= 0 && change.smoothness <= 1)) {
    return result(state);
  }

  let editor = state;
  for (const { contour: c, index } of roundable(state)) {
    const node = c.nodes[index]!;
    if (node.continuous === undefined) continue;
    const next = { ...node.continuous, ...change };
    if (next.size === node.continuous.size && next.smoothness === node.continuous.smoothness)
      continue;
    const document = editCurrentGlyph(editor, (g) =>
      updateContour(g, c.id, (current) => ({
        ...current,
        nodes: current.nodes.map((n) => (n.id === node.id ? { ...n, continuous: next } : n)),
      })),
    );
    if (document !== null) editor = { ...editor, document };
  }
  return done(
    state,
    editor === state ? null : editor,
    change.size !== undefined ? "Corner size" : "Corner smoothness",
  );
}

/** A quarter of the shorter side next to a node, in whole units, and at least one. */
function defaultSize(c: Contour, index: number): number {
  const n = c.nodes.length;
  const side = (segment: number): number => {
    const s = segmentAt(c, segment);
    return s === null ? Infinity : arcLength(segmentCubic(s));
  };
  const shorter = Math.min(side((index - 1 + n) % n), side(index));
  return Math.max(1, Math.round(shorter * DEFAULT_SHARE));
}
