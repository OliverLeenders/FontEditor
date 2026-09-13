import { type FontInfo, setFontInfo } from "@typewright/font-model";
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
 * the honest reading of an editable field — rescaling a font is a different
 * operation, and one nobody would expect from typing in a box.
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
  return null;
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
