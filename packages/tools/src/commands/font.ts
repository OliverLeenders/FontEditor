import { type FontInfo, setFontInfo } from "@fonteditor/font-model";
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
  return null;
}

const sameInfo = (a: FontInfo, b: FontInfo): boolean =>
  a.familyName === b.familyName &&
  a.styleName === b.styleName &&
  a.unitsPerEm === b.unitsPerEm &&
  a.ascender === b.ascender &&
  a.descender === b.descender &&
  a.xHeight === b.xHeight &&
  a.capHeight === b.capHeight;
