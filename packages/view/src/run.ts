import type { FontDocument, Glyph, GlyphName } from "@fonteditor/font-model";
import { glyphsForString, kernIndex, kernValue } from "@fonteditor/font-model";

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
  /** The kern applied before this glyph. Zero for the first, and for no pair. */
  readonly kern: number;
};

export type GlyphRun = {
  readonly glyphs: readonly PlacedGlyph[];
  /** Sum of the advances: where the pen finishes. */
  readonly width: number;
};

export const EMPTY_RUN: GlyphRun = { glyphs: [], width: 0 };

/**
 * Lay a string out as a run of glyphs, advance by advance, kerning included.
 *
 * Kerning applies here and nowhere else, which is why this takes a document
 * rather than a list of glyphs: a pair is a fact about the font, and the view
 * that draws the line has no business working it out.
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
  const index = kernIndex(document.kerning);
  let x = 0;
  let previous: string | null = null;

  for (const glyph of glyphsForString(document, text)) {
    if (glyph === null) continue;

    // The kern goes before the glyph it precedes, so a pair moves the second
    // letter rather than stretching the first one's advance.
    const kern = previous === null ? 0 : kernValue(index, previous, glyph.name);
    x += kern;

    glyphs.push({ glyph, name: glyph.name, index: glyphs.length, x, kern });
    x += glyph.advance;
    previous = glyph.name;
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

/**
 * A line of a paragraph, and where its baseline sits relative to the first.
 *
 * `y` is in design units and grows downward from zero, which is the one place in
 * this codebase that direction is used — because a paragraph reads downward and
 * a line's position is naturally "how far below the first line". Whoever draws
 * it subtracts, as it would for any other design-unit y.
 */
export type ProofLine = {
  readonly run: GlyphRun;
  readonly y: number;
};

/**
 * Break text into lines that fit a width, and stack them.
 *
 * Broken at spaces, and at the newlines the text already has — an explicit break
 * is a decision someone made and is never undone by rewrapping. A word wider
 * than the measure is left to overhang rather than split: hyphenation is a whole
 * subject, and a proof that silently cut a word in half would be lying about how
 * the font sets.
 *
 * The width and the leading are in design units, so nothing here knows what size
 * the proof is being shown at. That is the caller's transform.
 */
export function layoutParagraph(
  document: FontDocument,
  text: string,
  measure: number,
  leading: number,
): ProofLine[] {
  const lines: ProofLine[] = [];
  let y = 0;

  for (const paragraph of text.split("\n")) {
    // A blank line is a blank line: it still takes its leading.
    if (paragraph.trim() === "") {
      lines.push({ run: EMPTY_RUN, y });
      y += leading;
      continue;
    }

    let current = "";
    for (const word of paragraph.split(" ").filter((w) => w !== "")) {
      const candidate = current === "" ? word : `${current} ${word}`;
      if (current !== "" && layoutRun(document, candidate).width > measure) {
        lines.push({ run: layoutRun(document, current), y });
        y += leading;
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push({ run: layoutRun(document, current), y });
    y += leading;
  }

  return lines;
}

/** The width of the widest line, for a caller that wants to centre the block. */
export function paragraphWidth(lines: readonly ProofLine[]): number {
  return lines.reduce((widest, line) => Math.max(widest, line.run.width), 0);
}
