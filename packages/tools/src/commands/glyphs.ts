import {
  type GlyphName,
  type RenameProblem,
  deleteProblem,
  glyph,
  putGlyph,
  removeGlyph,
  renameGlyph as renameInDocument,
  renameProblem,
} from "@fonteditor/font-model";
import { type ToolResult, begin, commit, result } from "../effects.js";
import type { EditorState } from "../state.js";
import { done } from "./shared.js";

/**
 * Commands that add, remove, rename or compose whole glyphs.
 */

export type NewGlyph = {
  readonly name: GlyphName;
  readonly unicodes?: readonly number[];
};

/**
 * Add glyphs that are not there yet.
 *
 * Takes a list and commits once, because the useful case is "give me ASCII" and
 * ninety-five separate undo entries would make that impossible to take back.
 * A name already in the document is skipped rather than replacing what is
 * there: creating a glyph must never overwrite one.
 */
export function createGlyphs(
  state: EditorState,
  wanted: readonly NewGlyph[],
  advance: number,
): ToolResult {
  const fresh = wanted.filter((g) => g.name !== "" && state.document.glyphs[g.name] === undefined);
  if (fresh.length === 0) return result(state);

  let document = state.document;
  for (const g of fresh) {
    document = putGlyph(document, glyph(g.name, { unicodes: g.unicodes ?? [], advance }));
  }

  const label = fresh.length === 1 ? `Add ${fresh[0]!.name}` : `Add ${String(fresh.length)} glyphs`;
  const first = fresh[0]!.name;
  return result({ ...state, document, currentGlyph: first, selection: [] }, [
    begin(label, false),
    commit,
  ]);
}

/**
 * Remove a glyph.
 *
 * Components referring to it are left alone rather than hunted down. Resolution
 * already treats a missing base as drawing nothing, so the font stays openable,
 * and undo is one keystroke away — whereas rewriting other glyphs as a side
 * effect of a delete is the kind of help nobody asks for.
 */
export function deleteGlyph(state: EditorState, name: GlyphName): ToolResult {
  const document = removeGlyph(state.document, name);
  if (document === null) return result(state);

  const currentGlyph =
    state.currentGlyph === name ? (document.glyphOrder[0] ?? "") : state.currentGlyph;

  return result(
    { ...state, document, currentGlyph, selection: [], focusedSegment: null, hoveredSegment: null },
    [begin(`Delete ${name}`, false), commit],
  );
}

/**
 * Rename a glyph, carrying every reference to it along.
 *
 * A name is a reference, not a label — components place a glyph by name, and
 * kerning names it on both sides of a pair and again inside any group it belongs
 * to. `renameGlyph` in the model moves all of them together; this is the part
 * that keeps the editor pointing at the right glyph afterwards.
 *
 * Not undoable in the ordinary way is *not* the choice here: it is one step like
 * any other edit, because it is one, and taking it back should put the old name
 * and every reference to it back exactly.
 */
export function renameCurrentGlyph(state: EditorState, to: GlyphName): ToolResult {
  const from = state.currentGlyph;
  const document = renameInDocument(state.document, from, to.trim());
  if (document === null) return result(state);

  return done(state, { ...state, document, currentGlyph: to.trim() }, "Rename glyph");
}

/** Why deleting a glyph would be refused, or `null` if it would not be. */
export function deleteRefusal(state: EditorState, name: GlyphName): "missing" | "reserved" | null {
  return deleteProblem(state.document, name);
}

/** Why renaming the open glyph would be refused, or `null` if it would not be. */
export function renameRefusal(state: EditorState, to: string): RenameProblem | null {
  return renameProblem(state.document, state.currentGlyph, to.trim());
}
