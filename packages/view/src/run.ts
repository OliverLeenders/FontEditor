import type { FontDocument, Glyph, GlyphName } from "@fonteditor/font-model";
import { glyphsForString } from "@fonteditor/font-model";

/**
 * One glyph placed in a line of text.
 *
 * `x` is the pen position — the glyph's own origin — so it is exactly the
 * coordinate the glyph's outline and its margin lines are drawn relative to.
 * Nothing here is a copy of the glyph's geometry; the outline is left where it
 * is and the placement travels alongside it.
 */
export type PlacedGlyph = {
  readonly glyph: Glyph;
  readonly name: GlyphName;
  /** Position in the run, which is not the position in the text: see below. */
  readonly index: number;
  readonly x: number;
};

export type GlyphRun = {
  readonly glyphs: readonly PlacedGlyph[];
  /** Sum of the advances: where the pen finishes. */
  readonly width: number;
};

export const EMPTY_RUN: GlyphRun = { glyphs: [], width: 0 };

/**
 * Lay a string out as a run of glyphs, advance by advance.
 *
 * No kerning, because there is none in the model yet. When there is, it applies
 * here and nowhere else — which is the reason this is a function over a document
 * rather than something the spacing view works out as it draws.
 *
 * Characters the font has no glyph for are skipped rather than substituted.
 * Reserving a notdef box would be the typographically correct thing for a proof,
 * but this is a spacing tool: an invented width between two real glyphs is a
 * measurement you cannot trust, and silence is the lesser harm. It does mean the
 * run index and the character index part company, which is why placements carry
 * their own.
 */
export function layoutRun(document: FontDocument, text: string): GlyphRun {
  const glyphs: PlacedGlyph[] = [];
  let x = 0;

  for (const glyph of glyphsForString(document, text)) {
    if (glyph === null) continue;
    glyphs.push({ glyph, name: glyph.name, index: glyphs.length, x });
    x += glyph.advance;
  }

  return { glyphs, width: x };
}

/**
 * The glyph whose advance contains `x`.
 *
 * Advance width, not outline bounds. In a spacing view the space either side of
 * a letter belongs to that letter — it is the thing being edited — so clicking
 * the gap must select the glyph that owns it rather than miss.
 */
export function glyphAtX(run: GlyphRun, x: number): PlacedGlyph | null {
  for (const placed of run.glyphs) {
    if (x >= placed.x && x < placed.x + placed.glyph.advance) return placed;
  }
  return null;
}

/** The placement at a run index, or `null`. */
export function placedAt(run: GlyphRun, index: number): PlacedGlyph | null {
  return run.glyphs[index] ?? null;
}

/**
 * Every position in the run showing a given glyph.
 *
 * Editing a sidebearing changes the glyph, so every occurrence in the line moves
 * at once. The view needs to know which ones to mark, or an edit appears to
 * affect a letter the user did not touch.
 */
export function occurrencesOf(run: GlyphRun, name: GlyphName): number[] {
  return run.glyphs.filter((p) => p.name === name).map((p) => p.index);
}
