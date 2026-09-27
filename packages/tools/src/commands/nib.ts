import {
  type Contour,
  type Nib,
  DEFAULT_NIB,
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
  const existing = contours.find((c) => c.nib !== undefined)?.nib ?? DEFAULT_NIB;
  const pen = on ? existing : null;

  const after = edit(state, contours, (c) => withNib(c, pen));
  return done(state, after, on ? "Draw with a pen" : "Stop drawing with a pen");
}

/**
 * Change one thing about the pen of every selected stroke, leaving the rest.
 *
 * One field at a time, because that is how a panel asks: typing an angle into a
 * selection whose strokes have different widths gives them all that angle and
 * leaves each its own width. Contours without a pen are passed over — the angle
 * of a pen that is not there is not a thing to set.
 */
export function changePen(state: EditorState, change: Partial<Nib>): ToolResult {
  // A width below nothing and an angle that is not a number are a field being
  // typed into, not a pen: nothing changes until they are.
  if (change.width !== undefined && !(change.width >= 0)) return result(state);
  if (change.thickness !== undefined && !(change.thickness >= 0)) return result(state);
  if (change.angle !== undefined && !Number.isFinite(change.angle)) return result(state);

  const after = edit(state, selected(state), (c) =>
    c.nib === undefined ? c : withNib(c, { ...c.nib, ...change }),
  );
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
