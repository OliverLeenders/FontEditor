import {
  type GlyphLookup,
  type IdFactory,
  attachComponents,
  buildComposite,
  compositePlan,
  putGlyph,
} from "@typewright/font-model";

import { type ToolResult, result } from "../effects.js";
import type { EditorState } from "../state.js";
import { done } from "./shared.js";

/**
 * Commands about accented glyphs made of other glyphs.
 *
 * Both are sweeps over the font, each one undo step: building the composites a
 * set of characters needs, and putting every composite's accents back where the
 * anchors now say. See `composites.ts` in the model for how either is decided.
 */

/**
 * Build accented glyphs from their letters and marks.
 *
 * Only the ones the font can build and place now — see `compositePlan` — so a
 * character with no letter drawn yet, or an accent with nothing to land on, is
 * left for later rather than made badly.
 */
export function buildComposites(
  state: EditorState,
  codePoints: readonly number[],
  ids: IdFactory,
): ToolResult {
  const { buildable } = compositePlan(state.document, codePoints);
  if (buildable.length === 0) return result(state);

  let document = state.document;
  for (const build of buildable) document = buildComposite(document, build, ids);
  if (document === state.document) return result(state);

  const label =
    buildable.length === 1
      ? `Build ${buildable[0]!.name}`
      : `Build ${String(buildable.length)} accented glyphs`;
  return done(state, { ...state, document }, label);
}

/**
 * The glyphs whose components are not where their anchors now put them.
 *
 * Asked before re-attaching, so the answer can be given as a number: a sweep
 * that rewrites glyphs should say how many it would touch, and one that would
 * touch none should say that instead of recording an empty step.
 */
export function detachedComposites(state: EditorState): string[] {
  const glyphOf: GlyphLookup = (name) => state.document.glyphs[name] ?? null;
  const out: string[] = [];
  for (const name of state.document.glyphOrder) {
    const g = state.document.glyphs[name];
    if (g === undefined || g.components.length === 0) continue;
    if (attachComponents(g, glyphOf).components !== g.components) out.push(name);
  }
  return out;
}

/**
 * Put every composite's accents back on its anchors.
 *
 * On demand rather than as anchors move. Moving the `e`'s `top` could otherwise
 * rewrite a few hundred glyphs in one drag, and would overwrite every accent
 * somebody had nudged by hand on purpose — so it waits to be asked, and then
 * does the whole font at once.
 */
export function reattachComposites(state: EditorState): ToolResult {
  const glyphOf: GlyphLookup = (name) => state.document.glyphs[name] ?? null;

  let document = state.document;
  for (const name of detachedComposites(state)) {
    const g = state.document.glyphs[name];
    if (g === undefined) continue;
    document = putGlyph(document, { ...g, components: attachComponents(g, glyphOf).components });
  }
  if (document === state.document) return result(state);

  return done(state, { ...state, document }, "Re-attach accents");
}
