import {
  type Contour,
  type Nib,
  samePen as sameNib,
  updateContour,
  withNib,
} from "@typewright/font-model";

import { type ToolResult, result } from "../effects.js";
import { type EditorState, currentGlyph, editCurrentGlyph } from "../state.js";
import { done } from "./shared.js";

/**
 * Putting a pen on the selected contours, and changing it.
 *
 * A contour with a pen is a skeleton: the path a broad-edged pen is drawn along,
 * its ink worked out from it. These are the commands the inspector's Pen section
 * runs. They act on whole contours, as every contour-level operation does: a
 * contour is claimed by any of its points being selected.
 */

/**
 * The pen the selection is drawn with, as a panel needs to show it.
 *
 * `null` when no contour is selected, and nothing to show. `"none"` when the
 * selected contours are outlines. `"mixed"` when they disagree — some with a pen
 * and some without, or pens that differ — which a panel shows as neither rather
 * than as whichever it happened to read first. Otherwise the one pen they share.
 */
export function selectionNib(state: EditorState): Nib | "none" | "mixed" | null {
  const contours = selected(state);
  if (contours.length === 0) return null;

  const first = contours[0]!.nib;
  for (const c of contours) {
    if (!samePen(c.nib, first)) return "mixed";
  }
  return first ?? "none";
}

/**
 * Give every selected contour a pen, or take it away from every one.
 *
 * On a selection that is already partly drawn with a pen, switching it on gives
 * the others the pen the first of them has, so a stem and a bar selected together
 * end up drawn with one pen — which is the reason to select them together.
 */
export function drawWithPen(state: EditorState, on: boolean): ToolResult {
  const contours = selected(state);
  // The pen some of them already have, or the last one set — the one the stroke
  // tool would start with — so switching a contour to a stroke draws it the way
  // the strokes around it are drawn.
  const existing = contours.find((c) => c.nib !== undefined)?.nib ?? state.strokePen;
  const pen = on ? existing : null;

  const after = edit(state, contours, (c) => withNib(c, pen));
  return done(state, after, on ? "Draw with a pen" : "Stop drawing with a pen");
}

/**
 * The pen at the selected points of strokes, as the Pen section's numbers show it.
 *
 * The pen is set point by point, and blends along each segment from one point's
 * pen to the next, so the numbers describe the points selected: their own pen, or
 * their stroke's where they have none. `"mixed"` where the points disagree, and
 * `null` where none of the selected points belongs to a stroke.
 *
 * The object handed back is the one the model holds, not a copy, so a panel asking
 * for it on every change is only re-drawn when a pen actually changes.
 */
export function selectedPointPen(state: EditorState): Nib | "mixed" | null {
  const glyph = currentGlyph(state);
  if (glyph === null) return null;

  let found: Nib | null = null;
  for (const item of state.selection) {
    if (item.part !== "point") continue;
    const c = glyph.contours.find((each) => each.id === item.contourId);
    if (c === undefined || c.nib === undefined) continue;
    const n = c.nodes.find((each) => each.id === item.nodeId);
    if (n === undefined) continue;
    const pen = n.pen ?? c.nib;
    if (found === null) found = pen;
    else if (!sameNib(found, pen)) return "mixed";
  }
  return found;
}

/**
 * Change one thing about the pen at every selected point of a stroke.
 *
 * One field at a time, because that is how a panel asks: typing an angle into a
 * selection whose points have different widths gives them all that angle and
 * leaves each its own width. Points of outlines are passed over — the angle of a
 * pen that is not there is not a thing to set.
 *
 * A point whose new pen is its stroke's own pen gives up its own, so a point set
 * back to where it started stores nothing, and the stroke's pen goes on deciding it.
 * The pen set is remembered as the one a new stroke starts with.
 */
export function changePen(state: EditorState, change: Partial<Nib>): ToolResult {
  // A width below nothing and an angle that is not a number are a field being
  // typed into, not a pen: nothing changes until they are.
  if (change.width !== undefined && !(change.width >= 0)) return result(state);
  if (change.thickness !== undefined && !(change.thickness >= 0)) return result(state);
  if (change.angle !== undefined && !Number.isFinite(change.angle)) return result(state);

  const points = new Map<string, Set<string>>();
  for (const item of state.selection) {
    if (item.part !== "point") continue;
    const set = points.get(item.contourId) ?? new Set<string>();
    set.add(item.nodeId);
    points.set(item.contourId, set);
  }

  // On an object rather than in a plain `let`, because it is assigned inside the
  // callback below, and narrowing does not follow an assignment made in a closure.
  const remembered: { pen: Nib | null } = { pen: null };
  const edited = edit(state, selected(state), (c) => {
    const stroke = c.nib;
    if (stroke === undefined) return c;
    const chosen = points.get(c.id);
    if (chosen === undefined) return c;

    const nodes = c.nodes.map((n) => {
      if (!chosen.has(n.id)) return n;
      const pen = { ...(n.pen ?? stroke), ...change };
      remembered.pen = pen;
      if (sameNib(pen, n.pen ?? stroke)) return n;
      if (sameNib(pen, stroke)) return withoutOwnPen(n);
      return { ...n, pen };
    });
    if (!nodes.some((n, i) => n !== c.nodes[i])) return c;

    // Every point given the same pen — the whole stroke selected, most often — is
    // the stroke's pen changed, and is kept as that rather than as the same pen
    // written at every point: a point put in later then has it too, and the Stroke
    // button's pen is the one the stroke is drawn with.
    const first = nodes[0]?.pen;
    const one =
      first !== undefined && nodes.every((n) => n.pen !== undefined && sameNib(n.pen, first));
    return one ? { ...c, nib: first, nodes: nodes.map(withoutOwnPen) } : { ...c, nodes };
  });
  const last = remembered.pen;
  const after = edited === null || last === null ? edited : { ...edited, strokePen: last };
  const label =
    change.angle !== undefined
      ? "Pen angle"
      : change.thickness !== undefined
        ? "Pen thickness"
        : "Pen width";
  return done(state, after, label);
}

/** The whole contours the selection claims, in the order the glyph has them. */
function selected(state: EditorState): Contour[] {
  const glyph = currentGlyph(state);
  if (glyph === null) return [];
  const wanted = new Set(state.selection.map((item) => item.contourId));
  return glyph.contours.filter((c) => wanted.has(c.id));
}

/** Every contour edited, or `null` where nothing changed. */
function edit(
  state: EditorState,
  contours: readonly Contour[],
  operation: (c: Contour) => Contour,
): EditorState | null {
  let editor = state;
  for (const c of contours) {
    const document = editCurrentGlyph(editor, (g) =>
      updateContour(g, c.id, (existing) => {
        const next = operation(existing);
        // The same contour back is no edit, and an edit that changes nothing
        // should not put a step in the history.
        return next === existing ? null : next;
      }),
    );
    if (document !== null) editor = { ...editor, document };
  }
  return editor === state ? null : editor;
}

function samePen(a: Nib | undefined, b: Nib | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return sameNib(a, b);
}

/** A point with no pen of its own, so its stroke's pen decides it again. */
function withoutOwnPen(n: Contour["nodes"][number]): Contour["nodes"][number] {
  return {
    id: n.id,
    pt: n.pt,
    type: n.type,
    in: n.in,
    out: n.out,
    hvLock: n.hvLock,
    harmonised: n.harmonised,
  };
}
