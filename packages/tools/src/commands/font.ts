import {
  type FontInfo,
  type Grid,
  type SerifStyle,
  addedSerifStyle,
  changedSerifStyle,
  fitToFixedWidth,
  freeSerifStyleName,
  removedSerifStyle,
  fixedWidthOf,
  grid as soundGrid,
  scaledFont,
  setFixedPitch,
  setFontInfo,
} from "@typewright/font-model";
import { type ToolResult, result } from "../effects.js";
import type { EditorState } from "../state.js";
import { done } from "./shared.js";

/**
 * Commands about the font as a whole: the metrics and names every glyph is
 * drawn against.
 */

/**
 * Change the font's own facts: its name, its em, its vertical metrics.
 *
 * Given a patch rather than a whole `FontInfo`, because a form edits one field
 * at a time and a caller that had to reassemble the rest would be a caller that
 * can drop one.
 *
 * The em is *not* applied to the drawings. Changing it after a glyph is drawn
 * changes what the numbers mean rather than where the outlines are, which is
 * one honest reading of an editable field; the other is {@link scaleFontTo},
 * and the field asks which was meant.
 */
export function setInfo(state: EditorState, patch: Partial<FontInfo>): ToolResult {
  const info = { ...state.document.info, ...patch };
  const problem = infoProblem(info);
  if (problem !== null) return result(state);

  const document = setFontInfo(state.document, info);
  if (sameInfo(document.info, state.document.info)) return result(state);

  return done(state, { ...state, document }, "Font info");
}

/**
 * What is wrong with a set of font facts, or `null` when nothing is.
 *
 * Exported so the field can say so before the value is committed: a form that
 * silently declines a number looks broken, and one that accepts a zero em makes
 * every scale in the editor a division by zero.
 */
export function infoProblem(info: FontInfo): string | null {
  if (!(info.unitsPerEm > 0)) return "The em must be more than zero.";
  if (info.unitsPerEm > 16384) return "The em must be 16384 or less.";
  if (!Number.isFinite(info.ascender) || !Number.isFinite(info.descender)) {
    return "The vertical metrics must be numbers.";
  }
  if (info.ascender <= info.descender) return "The ascender must be above the descender.";
  if (info.familyName.trim() === "") return "The font needs a family name.";

  // The identity fields. Each of these has a range the format gives it, and a
  // value outside it is not a font that behaves oddly — it is a font a
  // validator refuses and an operating system groups wrongly.
  if (!Number.isInteger(info.versionMajor) || info.versionMajor < 0) {
    return "The major version must be a whole number, zero or more.";
  }
  if (!Number.isInteger(info.versionMinor) || info.versionMinor < 0 || info.versionMinor > 999) {
    return "The minor version must be a whole number from 0 to 999.";
  }
  if (!Number.isFinite(info.italicAngle) || Math.abs(info.italicAngle) >= 90) {
    return "The italic angle must be between -90 and 90 degrees.";
  }
  if (info.openTypeOS2WeightClass < 1 || info.openTypeOS2WeightClass > 1000) {
    return "The weight class must be between 1 and 1000. Regular is 400, bold is 700.";
  }
  if (!Number.isInteger(info.openTypeOS2WidthClass)) {
    return "The width class must be a whole number from 1 to 9.";
  }
  if (info.openTypeOS2WidthClass < 1 || info.openTypeOS2WidthClass > 9) {
    return "The width class must be between 1 and 9. Normal is 5.";
  }
  if (info.openTypeOS2VendorID !== "" && info.openTypeOS2VendorID.length > 4) {
    return "A vendor id is four characters.";
  }

  // The vertical metrics, where they are set. Whole units in the range the
  // tables hold, and signs as the format has them: a descender is below the
  // baseline, and the Windows values are distances. A line gap's sign is left
  // alone — a negative one is legal, and refusing it would refuse every other
  // edit to a font that came in with one.
  for (const value of [
    info.openTypeHheaAscender,
    info.openTypeHheaDescender,
    info.openTypeHheaLineGap,
    info.openTypeOS2TypoAscender,
    info.openTypeOS2TypoDescender,
    info.openTypeOS2TypoLineGap,
    info.openTypeOS2WinAscent,
    info.openTypeOS2WinDescent,
  ]) {
    if (value === null) continue;
    if (!Number.isInteger(value)) return "Vertical metrics are whole numbers.";
    if (Math.abs(value) > 32767) return "Vertical metrics must be between -32767 and 32767.";
  }
  if ((info.openTypeHheaDescender ?? 0) > 0 || (info.openTypeOS2TypoDescender ?? 0) > 0) {
    return "A descender is below the baseline, so it is zero or negative.";
  }
  if ((info.openTypeOS2WinAscent ?? 0) < 0 || (info.openTypeOS2WinDescent ?? 0) < 0) {
    return "The Windows ascent and descent are distances, so they are zero or more.";
  }
  if (info.openTypeOS2Selection.some((bit) => !Number.isInteger(bit) || bit < 0 || bit > 15)) {
    return "The selection flags are bit numbers from 0 to 15.";
  }
  if (info.openTypeOS2Type.some((bit) => ![1, 2, 3, 8, 9].includes(bit))) {
    return "The embedding flags are bits 1, 2, 3, 8 and 9.";
  }
  if (info.openTypeOS2Type.filter((bit) => bit <= 3).length > 1) {
    return "A font has one embedding level: editable, preview and print, or restricted.";
  }
  return null;
}

/**
 * Move the font to another em, and the drawing with it, so every glyph stays
 * the size it was. One undo step, however many glyphs it touches. See
 * `scaledFont` for what is scaled and what is not.
 */
export function scaleFontTo(state: EditorState, unitsPerEm: number): ToolResult {
  const wanted = Math.round(unitsPerEm);
  const problem = infoProblem({ ...state.document.info, unitsPerEm: wanted });
  if (problem !== null || wanted === state.document.info.unitsPerEm) return result(state);
  const document = scaledFont(state.document, wanted);
  return done(state, { ...state, document }, `Scale to ${String(wanted)} units`);
}

/**
 * The grid the font is drawn on. Refused for one that cannot be a grid; see
 * `grid` in the model for what that is.
 */
export function setGrid(state: EditorState, step: number, major: number): ToolResult {
  const next: Grid | null = soundGrid(step, major);
  if (next === null) return result(state);
  const now = state.document.grid;
  if (now.step === next.step && now.major === next.major) return result(state);
  return done(state, { ...state, document: { ...state.document, grid: next } }, "Grid");
}

/**
 * A new serif style for the font, under the name asked for or, where that is
 * taken, the name with a number after it.
 */
export function addSerifStyle(state: EditorState, style: SerifStyle): ToolResult {
  const name = freeSerifStyleName(state.document, style.name);
  const document = addedSerifStyle(state.document, { ...style, name });
  if (document === null) return result(state);
  return done(state, { ...state, document }, "Add serif style");
}

/**
 * Change a serif style, and with it every end of a stroke that has it, in every
 * glyph: one undo step. Refused for a name that is nothing or another style's.
 */
export function changeSerifStyle(state: EditorState, name: string, next: SerifStyle): ToolResult {
  const document = changedSerifStyle(state.document, name, next);
  if (document === null || document === state.document) return result(state);
  return done(state, { ...state, document }, "Serif style");
}

/** Take a serif style out of the font. The ends that had it keep their serifs. */
export function removeSerifStyle(state: EditorState, name: string): ToolResult {
  const document = removedSerifStyle(state.document, name);
  if (document === state.document) return result(state);
  return done(state, { ...state, document }, "Remove serif style");
}

/**
 * Say whether the font is fixed-width, and at what width.
 *
 * Only says so: the glyphs are left as they are, so that a font can be made
 * fixed and then looked over before anything is moved — {@link fitToWidth}
 * moves them. A width is a whole number of units above nothing.
 */
export function setFixedWidth(state: EditorState, fixed: boolean, width?: number): ToolResult {
  const wanted = width === undefined ? state.document.fixedWidth : Math.round(width);
  // Also what refuses a width that is not a number at all.
  if (wanted !== null && !(wanted > 0)) return result(state);
  const document = setFixedPitch(state.document, fixed, wanted);
  if (document === state.document) return result(state);
  return done(state, { ...state, document }, fixed ? "Fixed width" : "Proportional width");
}

/**
 * Give every glyph the fixed width that does not have it, its drawing centred.
 * Marks keep no width and wide glyphs twice it; see `fitToFixedWidth`.
 */
export function fitToWidth(state: EditorState): ToolResult {
  const width = fixedWidthOf(state.document);
  if (width === null) return result(state);
  const document = fitToFixedWidth(state.document, width);
  if (document === state.document) return result(state);
  return done(state, { ...state, document }, "Fit to the fixed width");
}

/**
 * Whether the compiled font spells each icon's name as a ligature. Only the
 * switch: the rules are made when the font is compiled, from the names as they
 * then are.
 */
export function setNameLigatures(state: EditorState, on: boolean): ToolResult {
  if (state.document.nameLigatures === on) return result(state);
  const document = { ...state.document, nameLigatures: on };
  return done(state, { ...state, document }, on ? "Names as ligatures" : "No name ligatures");
}

/**
 * Whether two sets of facts say the same thing.
 *
 * Over every key rather than the seven it used to be. The list grew to two
 * dozen, and one written out by hand is one that silently stops noticing a
 * field somebody added — which shows up as an edit that does nothing.
 */
const sameInfo = (a: FontInfo, b: FontInfo): boolean =>
  (Object.keys(a) as (keyof FontInfo)[]).every((key) => a[key] === b[key]);
