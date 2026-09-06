import {
  type Affine,
  type Vec2,
  about,
  applyAffine,
  isTranslation,
  keepsAxes,
  rotation,
} from "@fonteditor/geometry";
import { selectionBounds } from "@fonteditor/view";
import { type ToolResult, result } from "../effects.js";
import { transformedDocument } from "../transform.js";
import { type EditorState, boxAngle, currentGlyph, turnedFrame } from "../state.js";
import { done } from "./shared.js";

/**
 * Moving, scaling, turning and leaning what is selected, by a number rather
 * than by a drag.
 *
 * The arithmetic is `../transform.js`, which the box gesture calls too: the
 * transform is the same either way, and only where the numbers come from
 * differs.
 */

/**
 * What a transform turns about.
 *
 * The nine points of the selection's own box, which is what every drawing
 * program offers, and two that only a font needs. `origin` is the glyph's own
 * origin at (0, 0): slanting an italic has to turn about it, or every glyph
 * shifts sideways by a different amount and the spacing is gone. `baseline` is
 * the baseline under the middle of the selection, for growing a shape upward
 * without moving it along.
 */
export type TransformOrigin =
  | {
      readonly kind: "box";
      readonly x: "left" | "centre" | "right";
      readonly y: "top" | "middle" | "bottom";
    }
  | { readonly kind: "origin" }
  | { readonly kind: "baseline" };

export const BOX_CENTRE: TransformOrigin = { kind: "box", x: "centre", y: "middle" };

/** Where a transform will turn, in design units, or `null` with nothing to turn. */
export function transformOriginPoint(state: EditorState, origin: TransformOrigin): Vec2 | null {
  if (origin.kind === "origin") return { x: 0, y: 0 };

  const glyph = currentGlyph(state);
  // In the frame the box is drawn in, so that "the top left of the selection"
  // names the corner the user can see rather than the corner of an upright
  // rectangle nothing is being held in.
  const angle = boxAngle(state);
  const frame = angle === 0 ? undefined : rotation(-angle);
  const box = glyph === null ? null : selectionBounds(glyph, state.selection, frame);
  if (box === null) return null;

  const middleX = (box.minX + box.maxX) / 2;
  const back = (p: Vec2): Vec2 => (angle === 0 ? p : applyAffine(rotation(angle), p));

  // The baseline is the plane's, not the frame's: y = 0 is where the font sits,
  // whatever angle the selection is being held at.
  if (origin.kind === "baseline") return { x: back({ x: middleX, y: 0 }).x, y: 0 };

  return back({
    x: origin.x === "left" ? box.minX : origin.x === "right" ? box.maxX : middleX,
    // Design units are y-up, so the top of the box is its maximum.
    y: origin.y === "bottom" ? box.minY : origin.y === "top" ? box.maxY : (box.minY + box.maxY) / 2,
  });
}

/**
 * Move, scale, turn or lean the selected points.
 *
 * The points, and the handles they own — a handle selected by itself is not a
 * thing to transform, it is a thing to drag. Which is the same rule the arrow
 * keys already follow.
 *
 * Point types survive untouched, and that is not luck: an affine map takes a
 * straight line to a straight line, so handles that were collinear through a
 * node still are, and a smooth or tangent node is still smooth or tangent
 * afterwards. The HV-lock is the one thing that cannot survive — a handle held
 * level is not level after a lean — so a transform that does not send each axis
 * to an axis lets those flags go rather than leaving a lock that does not hold.
 *
 * The results are left fractional. This model carries fractional coordinates
 * and the formats write them; rounding here would compound the error across a
 * run of transforms, and rounding is already a deliberate act of its own.
 */
export function transformSelection(
  state: EditorState,
  transform: Affine,
  origin: TransformOrigin,
  label: string,
  turn = 0,
): ToolResult {
  // A transform that changes nothing should not cost an undo entry, and every
  // point would otherwise be rewritten to an equal but distinct value.
  if (isTranslation(transform) && transform.xOffset === 0 && transform.yOffset === 0) {
    return result(state);
  }

  const chosen = state.selection.filter((item) => item.part === "point");
  if (chosen.length === 0) return result(state);

  const centre = transformOriginPoint(state, origin);
  if (centre === null) return result(state);

  const document = transformedDocument(
    state.document,
    state.currentGlyph,
    chosen,
    about(transform, centre),
    !keepsAxes(transform),
  );

  // A turn moves the box as well as the points. The caller says how far, because
  // an angle cannot be read back out of a matrix without deciding first whether
  // a flip is a turn — and here the caller knows, since it built the transform.
  const boxFrame = turn === 0 ? state.boxFrame : turnedFrame(state, turn);
  return done(state, document === null ? null : { ...state, document, boxFrame }, label);
}
