import type { FontDocument, Glyph, GlyphName, TextToken } from "@typewright/font-model";
import { glyphsForString, kernIndex, kernValue, textTokens } from "@typewright/font-model";

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
  /**
   * Where the glyph is drawn relative to the pen, from a positioning rule.
   *
   * Separate from `x` because the two are different facts: the pen is where the
   * line has got to, and this is a rule saying draw it somewhere else. Only the
   * pen decides where the next glyph starts.
   */
  readonly dx: number;
  readonly dy: number;
  /**
   * The advance this glyph actually took, which a positioning rule can change.
   *
   * Kept here rather than read off the glyph, so that everything measuring the
   * line — hit testing, margins, the width — agrees with what was drawn.
   */
  readonly advance: number;
};

export type GlyphRun = {
  readonly glyphs: readonly PlacedGlyph[];
  /** Sum of the advances: where the pen finishes. */
  readonly width: number;
};

export const EMPTY_RUN: GlyphRun = { glyphs: [], width: 0 };

/**
 * Turns the glyph names a string maps to into the names to set.
 *
 * The font's substitutions, as a function, so that laying text out does not
 * depend on where those rules were written down.
 */
export type Shaper = (names: readonly string[]) => readonly string[];

/** What a positioning rule does to one glyph, in design units. */
export type Adjustment = {
  readonly x: number;
  readonly y: number;
  readonly xAdvance: number;
  readonly yAdvance: number;
};

/**
 * The font's positioning rules, as a function over the glyphs being set.
 *
 * One entry per glyph of the run, `null` where no rule applies. Passed in for
 * the same reason the shaper is: the rules are written in a file format, and
 * this package knows nothing about files.
 */
export type Positioner = (names: readonly string[]) => readonly (Adjustment | null)[];

/**
 * The glyphs to set, after the font's own substitutions have had their say.
 *
 * A name the shaper produces that the font has no glyph for is dropped, the way
 * a character with no glyph is: a rule naming a glyph that was since deleted
 * should cost that glyph, not the line it was in.
 */
function shapedGlyphs(
  document: FontDocument,
  text: string | readonly TextToken[],
  shape: Shaper | undefined,
): Array<Glyph | null> {
  const direct = glyphsForString(document, text);
  if (shape === undefined) return direct;

  const named = direct.filter((glyph): glyph is Glyph => glyph !== null).map((g) => g.name);
  return shape(named).map((name) => document.glyphs[name] ?? null);
}

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
 *
 * `shape` is given the glyph names the characters mapped to and returns the
 * names to set — which is how a ligature reaches the line. It is passed in
 * rather than worked out here because the rules are written in `.fea`, which is
 * a file format, and this package knows nothing about files. Kerning is looked
 * up *after* it runs, on the glyphs that survived: an "fi" ligature kerns as an
 * "fi", not as the f and i it was made from.
 *
 * `position` runs later still, on the same surviving glyphs, because a rule
 * about a glyph is a rule about the glyph that is there — not about the ones a
 * ligature was made from.
 *
 * `text` may name glyphs with a slash — see `textTokens` — and may be handed in
 * already read, which is how a paragraph lays out the words it has split.
 */
export function layoutRun(
  document: FontDocument,
  text: string | readonly TextToken[],
  shape?: Shaper,
  position?: Positioner,
): GlyphRun {
  const shaped = shapedGlyphs(document, text, shape).filter((g): g is Glyph => g !== null);
  const values = position === undefined ? [] : position(shaped.map((g) => g.name));

  const glyphs: PlacedGlyph[] = [];
  const index = kernIndex(document.kerning);
  let x = 0;
  let previous: string | null = null;

  for (const [at, glyph] of shaped.entries()) {
    // The kern goes before the glyph it precedes, so a pair moves the second
    // letter rather than stretching the first one's advance.
    const kern = previous === null ? 0 : kernValue(index, previous, glyph.name);
    x += kern;

    const value = values[at] ?? null;
    // The vertical advance is read and not used: this lays out a line that runs
    // across the page, and a font that moved the pen downward between letters
    // would be describing a different kind of writing.
    const advance = glyph.advance + (value?.xAdvance ?? 0);

    glyphs.push({
      glyph,
      name: glyph.name,
      index: glyphs.length,
      x,
      kern,
      dx: value?.x ?? 0,
      dy: value?.y ?? 0,
      advance,
    });
    x += advance;
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
    if (x >= placed.x && x < placed.x + placed.advance) return placed;
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
 *
 * Words are split after the text is read rather than before, because the space
 * that ends a glyph name — `/a.001 b` — belongs to the name. Split as a string,
 * that space was a gap between two words, and joined back it was a space in the
 * line.
 */
export function layoutParagraph(
  document: FontDocument,
  text: string,
  measure: number,
  leading: number,
  shape?: Shaper,
  position?: Positioner,
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

    let current: readonly TextToken[] = [];
    for (const word of wordsOf(textTokens(paragraph))) {
      const candidate = current.length === 0 ? word : [...current, SPACE, ...word];
      if (current.length > 0 && layoutRun(document, candidate, shape, position).width > measure) {
        lines.push({ run: layoutRun(document, current, shape, position), y });
        y += leading;
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push({ run: layoutRun(document, current, shape, position), y });
    y += leading;
  }

  return lines;
}

const SPACE: TextToken = { kind: "character", text: " ", codePoint: 0x20 };

/** Read text split into its words at the spaces, with the spaces themselves dropped. */
function wordsOf(tokens: readonly TextToken[]): TextToken[][] {
  const words: TextToken[][] = [];
  let word: TextToken[] = [];
  for (const token of tokens) {
    if (token.kind === "character" && token.text === " ") {
      if (word.length > 0) words.push(word);
      word = [];
    } else {
      word.push(token);
    }
  }
  if (word.length > 0) words.push(word);
  return words;
}

/** The width of the widest line, for a caller that wants to centre the block. */
export function paragraphWidth(lines: readonly ProofLine[]): number {
  return lines.reduce((widest, line) => Math.max(widest, line.run.width), 0);
}
