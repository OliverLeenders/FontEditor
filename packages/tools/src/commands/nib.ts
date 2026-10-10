import {
  type Contour,
  type ContourId,
  type EndSerif,
  type IdFactory,
  type Nib,
  type SerifNumber,
  type StrokeEnd,
  DEFAULT_SERIF,
  contour,
  inkOf,
  samePen as sameNib,
  serifNumbers,
  serifStyleNamed,
  updateContour,
  withNib,
  withSerifNumber,
} from "@typewright/font-model";
import type { PenBlend } from "@typewright/geometry";

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
 * One number of the pen at the selected points of strokes: the one they share,
 * `"mixed"` where they differ in it, `null` where no selected point is a stroke's.
 *
 * One number at a time because that is how a field shows it. Points whose pens
 * differ in width but agree on the angle show the angle; and a field showing the
 * whole pen as mixed would empty itself the moment a number typed into it had
 * gone in, since the pens would still differ in the others — which ate every
 * keystroke after the first.
 */
export function selectedPenValue(
  state: EditorState,
  field: "angle" | "width" | "thickness" | "squareness",
): number | "mixed" | null {
  const glyph = currentGlyph(state);
  if (glyph === null) return null;

  let found: number | null = null;
  for (const item of state.selection) {
    if (item.part !== "point") continue;
    const c = glyph.contours.find((each) => each.id === item.contourId);
    if (c === undefined || c.nib === undefined) continue;
    const n = c.nodes.find((each) => each.id === item.nodeId);
    if (n === undefined) continue;
    const pen = n.pen ?? c.nib;
    const value =
      field === "thickness"
        ? (pen.thickness ?? 0)
        : field === "squareness"
          ? (pen.squareness ?? 0)
          : pen[field];
    if (found === null) found = value;
    else if (found !== value) return "mixed";
  }
  return found;
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
  if (change.squareness !== undefined && !(change.squareness >= 0 && change.squareness <= 1)) {
    return result(state);
  }
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
      const pen = withoutNoSquareness({ ...(n.pen ?? stroke), ...change });
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
        : change.squareness !== undefined
          ? "Pen squareness"
          : "Pen width";
  return done(state, after, label);
}

/**
 * The strokes a conversion to outlines would take: the one named, and every other
 * stroke the selection claims when that one is among them. Only the one named
 * when it is not selected, so a right-click on a stroke outside the selection
 * does not reach into it.
 */
export function strokesToOutline(state: EditorState, contourId: string): Set<ContourId> {
  const glyph = currentGlyph(state);
  if (glyph === null) return new Set();
  const named = glyph.contours.find((c) => c.id === contourId);
  if (named?.nib === undefined) return new Set();
  const claimed = state.selection.some((item) => item.contourId === contourId);
  const strokes = claimed ? selected(state).filter((c) => c.nib !== undefined) : [named];
  return new Set(strokes.map((c) => c.id));
}

/**
 * Turn strokes into the outlines they draw.
 *
 * Each stroke is replaced, where it sat in the glyph's order, by its ink joined
 * into outlines — the same outlines the exporter writes — with ids of their own,
 * since the ink a stroke is drawn with on screen is shared and a glyph must not
 * hold two contours of one id. The selection is cleared: the points it named are
 * gone.
 */
export function convertStrokesToOutlines(
  state: EditorState,
  contourId: string,
  ids: IdFactory,
): ToolResult {
  const chosen = strokesToOutline(state, contourId);
  if (chosen.size === 0) return result(state);

  const document = editCurrentGlyph(state, (g) => ({
    ...g,
    contours: g.contours.flatMap((c) =>
      chosen.has(c.id)
        ? inkOf(c, ids).map((ink) =>
            contour(
              ids.contour(),
              ink.nodes.map((n) => ({ ...n, id: ids.node() })),
              ink.closed,
            ),
          )
        : [c],
    ),
  }));
  const after = document === null ? null : { ...state, document, selection: [] };
  return done(
    state,
    after,
    chosen.size > 1 ? "Convert strokes to outlines" : "Convert stroke to outlines",
  );
}

/** Which part of the pen a blend is about: its angle, or its width and thickness. */
export type BlendChannel = "angle" | "shape";

/**
 * The selected points of strokes that start a segment, by contour: every point of a
 * closed stroke, and all but the last of an open one, which has no segment after it.
 */
function blendPoints(state: EditorState): { contour: Contour; index: number }[] {
  const glyph = currentGlyph(state);
  if (glyph === null) return [];
  const out: { contour: Contour; index: number }[] = [];
  for (const item of state.selection) {
    if (item.part !== "point") continue;
    const c = glyph.contours.find((each) => each.id === item.contourId);
    if (c === undefined || c.nib === undefined) continue;
    const index = c.nodes.findIndex((n) => n.id === item.nodeId);
    if (index < 0 || (!c.closed && index === c.nodes.length - 1)) continue;
    out.push({ contour: c, index });
  }
  return out;
}

/**
 * How the pen changes along the segments leaving the selected points, for one
 * part of the pen: the blend they share, `"mixed"` where they differ, `null`
 * where no selected point starts a segment of a stroke.
 */
export function selectedPenBlend(
  state: EditorState,
  channel: BlendChannel,
): PenBlend | "mixed" | null {
  let found: PenBlend | null = null;
  for (const { contour: c, index } of blendPoints(state)) {
    const blend = c.nodes[index]!.blend?.[channel] ?? "linear";
    if (found === null) found = blend;
    else if (found !== blend) return "mixed";
  }
  return found;
}

/**
 * Set how the pen changes along the segments leaving the selected points, for its
 * angle or for its shape. A point whose two blends are both linear again stores
 * nothing, as one never changed does.
 */
export function setPenBlend(
  state: EditorState,
  channel: BlendChannel,
  blend: PenBlend,
): ToolResult {
  const chosen = new Map<string, Set<number>>();
  for (const { contour: c, index } of blendPoints(state)) {
    const set = chosen.get(c.id) ?? new Set<number>();
    set.add(index);
    chosen.set(c.id, set);
  }

  const after = edit(state, selected(state), (c) => {
    const indices = chosen.get(c.id);
    if (indices === undefined) return c;
    const nodes = c.nodes.map((n, i) => {
      if (!indices.has(i)) return n;
      const current = n.blend ?? { angle: "linear" as const, shape: "linear" as const };
      if (current[channel] === blend) return n;
      const next = { ...current, [channel]: blend };
      if (next.angle === "linear" && next.shape === "linear") {
        const { blend: _dropped, ...rest } = n;
        return rest;
      }
      return { ...n, blend: next };
    });
    return nodes.some((n, i) => n !== c.nodes[i]) ? { ...c, nodes } : c;
  });
  return done(state, after, channel === "angle" ? "Pen angle blend" : "Pen shape blend");
}

/**
 * How an end of a stroke ends: as the pen leaves it, or cut straight — square to
 * the path, or at an angle in degrees anticlockwise from level.
 */
export type EndChoice = "pen" | "square" | number;

/** The selected points that are an end of an open stroke, by contour. */
function endPoints(state: EditorState): { contour: Contour; index: number }[] {
  const glyph = currentGlyph(state);
  if (glyph === null) return [];
  const out: { contour: Contour; index: number }[] = [];
  for (const item of state.selection) {
    if (item.part !== "point") continue;
    const c = glyph.contours.find((each) => each.id === item.contourId);
    if (c === undefined || c.nib === undefined || c.closed) continue;
    const index = c.nodes.findIndex((n) => n.id === item.nodeId);
    if (index !== 0 && index !== c.nodes.length - 1) continue;
    out.push({ contour: c, index });
  }
  return out;
}

const choiceOf = (end: StrokeEnd | undefined): EndChoice => (end === undefined ? "pen" : end.cut);

/**
 * How the selected ends of strokes end: the way they share, `"mixed"` where they
 * differ, `null` where no selected point is an end of an open stroke.
 */
export function selectedStrokeEnd(state: EditorState): EndChoice | "mixed" | null {
  let found: EndChoice | null = null;
  for (const { contour: c, index } of endPoints(state)) {
    const choice = choiceOf(c.nodes[index]!.end);
    if (found === null) found = choice;
    else if (found !== choice) return "mixed";
  }
  return found;
}

/**
 * Set how the selected ends of strokes end. An end left as the pen leaves it
 * stores nothing, as one never cut does.
 */
export function setStrokeEnd(state: EditorState, choice: EndChoice): ToolResult {
  const chosen = new Map<string, Set<number>>();
  for (const { contour: c, index } of endPoints(state)) {
    const set = chosen.get(c.id) ?? new Set<number>();
    set.add(index);
    chosen.set(c.id, set);
  }

  const after = edit(state, selected(state), (c) => {
    const indices = chosen.get(c.id);
    if (indices === undefined) return c;
    const nodes = c.nodes.map((n, i) => {
      if (!indices.has(i) || choiceOf(n.end) === choice) return n;
      if (choice === "pen") {
        const { end: _dropped, ...rest } = n;
        return rest;
      }
      // What the end is closed with is kept: it is the cut that is being set.
      return { ...n, end: { ...n.end, cut: choice } };
    });
    return nodes.some((n, i) => n !== c.nodes[i]) ? { ...c, nodes } : c;
  });
  return done(state, after, "Stroke end");
}

/**
 * What a cut end is closed with: the cut itself, half the pen's outline, or a
 * serif standing on the cut.
 */
export type EndShape = "straight" | "nib" | "serif";

const shapeOf = (end: StrokeEnd): EndShape =>
  end.serif !== undefined ? "serif" : end.shape === "nib" ? "nib" : "straight";

/**
 * What the selected cut ends are closed with: what they share, `"mixed"` where
 * they differ, `null` where no selected end is cut.
 */
export function selectedStrokeEndShape(state: EditorState): EndShape | "mixed" | null {
  let found: EndShape | null = null;
  for (const { contour: c, index } of endPoints(state)) {
    const end = c.nodes[index]!.end;
    if (end === undefined) continue;
    const shape = shapeOf(end);
    if (found === null) found = shape;
    else if (found !== shape) return "mixed";
  }
  return found;
}

/**
 * Set what the selected cut ends are closed with. An end that is not cut is left alone.
 *
 * A serif starts as the font's first style, where it has one, and as a plain
 * slab where it has none.
 */
export function setStrokeEndShape(state: EditorState, shape: EndShape): ToolResult {
  const first = state.document.serifs[0];
  const serif: EndSerif =
    first === undefined ? DEFAULT_SERIF : { ...serifNumbers(first), style: first.name };
  const chosen = new Map<string, Set<number>>();
  for (const { contour: c, index } of endPoints(state)) {
    const set = chosen.get(c.id) ?? new Set<number>();
    set.add(index);
    chosen.set(c.id, set);
  }

  const after = edit(state, selected(state), (c) => {
    const indices = chosen.get(c.id);
    if (indices === undefined) return c;
    const nodes = c.nodes.map((n, i) => {
      if (!indices.has(i) || n.end === undefined) return n;
      if (shapeOf(n.end) === shape) return n;
      if (shape === "serif") return { ...n, end: { cut: n.end.cut, serif } };
      return { ...n, end: shape === "nib" ? { cut: n.end.cut, shape } : { cut: n.end.cut } };
    });
    return nodes.some((n, i) => n !== c.nodes[i]) ? { ...c, nodes } : c;
  });
  return done(state, after, "Stroke end shape");
}

/**
 * The serif on the selected ends, as a panel shows it: the first one's, the
 * very object the end has, so it is the same until that serif changes. `null`
 * where no selected end has a serif.
 */
export function selectedEndSerif(state: EditorState): EndSerif | null {
  for (const { contour: c, index } of endPoints(state)) {
    const serif = c.nodes[index]!.end?.serif;
    if (serif !== undefined) return serif;
  }
  return null;
}

/** Whether the selected ends that have serifs have different ones. */
export function selectedEndSerifsDiffer(state: EditorState): boolean {
  let found: string | null = null;
  for (const { contour: c, index } of endPoints(state)) {
    const serif = c.nodes[index]!.end?.serif;
    if (serif === undefined) continue;
    const said = JSON.stringify(serif);
    if (found === null) found = said;
    else if (found !== said) return true;
  }
  return false;
}

/** The selected ends that have a serif, each put through `change`. */
function editEndSerifs(
  state: EditorState,
  label: string,
  change: (serif: EndSerif) => EndSerif,
): ToolResult {
  const chosen = new Map<string, Set<number>>();
  for (const { contour: c, index } of endPoints(state)) {
    const set = chosen.get(c.id) ?? new Set<number>();
    set.add(index);
    chosen.set(c.id, set);
  }
  const after = edit(state, selected(state), (c) => {
    const indices = chosen.get(c.id);
    if (indices === undefined) return c;
    const nodes = c.nodes.map((n, i) => {
      if (!indices.has(i) || n.end?.serif === undefined) return n;
      const next = change(n.end.serif);
      return next === n.end.serif ? n : { ...n, end: { ...n.end, serif: next } };
    });
    return nodes.some((n, i) => n !== c.nodes[i]) ? { ...c, nodes } : c;
  });
  return done(state, after, label);
}

/**
 * Set one number of the serif on the selected ends. On an end that has a style
 * the number is the end's own from then on, and stays when the style changes.
 */
export function setEndSerifNumber(state: EditorState, key: SerifNumber, value: number): ToolResult {
  if (!Number.isFinite(value)) return result(state);
  return editEndSerifs(state, "Serif", (serif) => {
    const next = withSerifNumber(serif, key, value);
    return next[key] === serif[key] ? serif : next;
  });
}

/**
 * Give the serif on the selected ends one of the font's styles, with all of
 * that style's numbers, or with `null` take the style off and leave the
 * numbers as the end's own. Giving an end the style it has takes back the
 * numbers that were set on it.
 */
export function setEndSerifStyle(state: EditorState, name: string | null): ToolResult {
  if (name === null) {
    return editEndSerifs(state, "Serif style", (serif) =>
      serif.style === undefined ? serif : serifNumbers(serif),
    );
  }
  const style = serifStyleNamed(state.document, name);
  if (style === null) return result(state);
  return editEndSerifs(state, "Serif style", (serif) =>
    serif.style === name && (serif.own ?? []).length === 0
      ? serif
      : { ...serifNumbers(style), style: name },
  );
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

/**
 * A point with no pen of its own, so its stroke's pen decides it again.
 *
 * Only the pen goes. Everything else the point says of the stroke — how the pen
 * blends along the segment leaving it, how the stroke ends there — is not the
 * pen's, and used to go with it: a width typed for a whole stroke took the cut
 * off both its ends.
 */
function withoutOwnPen(n: Contour["nodes"][number]): Contour["nodes"][number] {
  if (n.pen === undefined) return n;
  const { pen: _dropped, ...rest } = n;
  return rest;
}

/**
 * A pen that says nothing of squareness where it has none: an oval is kept as
 * it always was, and a broad edge, which has no corners to square, likewise.
 */
function withoutNoSquareness(pen: Nib): Nib {
  if (pen.squareness === undefined) return pen;
  if (pen.squareness > 0 && (pen.thickness ?? 0) > 0) return pen;
  const { squareness: _dropped, ...rest } = pen;
  return rest;
}
