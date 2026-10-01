import { type FontDocument, glyphNamed, putGlyph, setFontInfo } from "./document.js";
import type { Glyph } from "./glyph.js";
import {
  outlineBounds,
  setLeftSidebearing,
  setRightSidebearing,
  sidebearings,
  translateGlyph,
} from "./metrics.js";

/**
 * A font whose glyphs are all one width.
 *
 * A terminal's font, a code font, an icon font: every glyph takes the same
 * room, so a column of text lines up and an icon can be swapped for another
 * without the line moving. The font says so with a flag a terminal checks
 * (`postscriptIsFixedPitch`, compiled into `post` and the PANOSE proportion),
 * and the width itself is kept beside the flag in the document.
 *
 * Two widths are allowed besides the one: none, which is what a combining mark
 * has, and twice it, which is what a wide character in a CJK terminal font has.
 */

/** The width every glyph should be, where the font says it is fixed, or `null`. */
export function fixedWidthOf(document: FontDocument): number | null {
  if (!document.info.postscriptIsFixedPitch) return null;
  return document.fixedWidth ?? commonAdvance(document);
}

/**
 * The advance most glyphs have, leaving out those with none, or `null` for a
 * font where no glyph has one. What a fixed width starts at when a font is
 * first said to be fixed: it is the width the font already mostly is.
 */
export function commonAdvance(document: FontDocument): number | null {
  const counts = new Map<number, number>();
  for (const name of document.glyphOrder) {
    const g = document.glyphs[name];
    if (g === undefined || g.advance === 0) continue;
    counts.set(g.advance, (counts.get(g.advance) ?? 0) + 1);
  }
  let best: number | null = null;
  let most = 0;
  for (const [advance, count] of counts) {
    // The narrower of two that tie, so the answer does not depend on map order.
    if (count > most || (count === most && best !== null && advance < best)) {
      best = advance;
      most = count;
    }
  }
  return best;
}

/**
 * Say the font is fixed or proportional, and at what width.
 *
 * Turning it on without a width takes the one the font mostly has; the glyphs
 * are left as they are, since making them fit is a separate decision with its
 * own undo — see {@link fitToFixedWidth}.
 */
export function setFixedPitch(
  document: FontDocument,
  fixed: boolean,
  width: number | null = document.fixedWidth,
): FontDocument {
  const chosen = fixed ? (width ?? commonAdvance(document) ?? document.info.unitsPerEm / 2) : width;
  const fixedWidth = chosen === null ? null : Math.max(1, Math.round(chosen));
  if (document.info.postscriptIsFixedPitch === fixed && document.fixedWidth === fixedWidth) {
    return document;
  }
  return {
    ...setFontInfo(document, { ...document.info, postscriptIsFixedPitch: fixed }),
    fixedWidth,
  };
}

/**
 * One sidebearing set, the way the font is spaced.
 *
 * In a proportional font that is what it always was: the left side moves the
 * drawing and the advance with it, the right side changes the advance. In a
 * fixed-width font the advance is the font's rather than the glyph's, so the
 * drawing slides inside it instead and the other side gives what this one
 * takes — which is what spacing a monospaced letter is, placing it in its cell.
 * A glyph with no advance is a mark, and is spaced as it always was.
 */
export function withSidebearing(
  g: Glyph,
  side: "left" | "right",
  value: number,
  document?: FontDocument,
): Glyph | null {
  const fixed = document !== undefined && fixedWidthOf(document) !== null && g.advance !== 0;
  if (!fixed) {
    return side === "left"
      ? setLeftSidebearing(g, value, document)
      : setRightSidebearing(g, value, document);
  }
  const current = sidebearings(g, document);
  if (current === null) return null;
  const shift = side === "left" ? value - current.left : current.right - value;
  return shift === 0 ? g : translateGlyph(g, { x: shift, y: 0 });
}

/**
 * The advance a glyph starts with: the fixed width in a font that has one, and
 * half the em otherwise, which is roughly what a letter is.
 */
export function newGlyphAdvance(document: FontDocument): number {
  return fixedWidthOf(document) ?? Math.round(document.info.unitsPerEm / 2);
}

/** Whether an advance is one a glyph of a font this wide may have. */
export function fitsFixedWidth(advance: number, width: number): boolean {
  return advance === 0 || advance === width || advance === width * 2;
}

/** The glyphs whose advance a font of this width does not allow, in font order. */
export function offWidthGlyphs(document: FontDocument, width: number): Glyph[] {
  const out: Glyph[] = [];
  for (const name of document.glyphOrder) {
    const g = glyphNamed(document, name);
    if (g !== null && !fitsFixedWidth(g.advance, width)) out.push(g);
  }
  return out;
}

/**
 * One glyph made the fixed width, its drawing centred in it on whole units.
 *
 * Centred because that is where a glyph sits in a monospaced font — an `i` and
 * an `m` take the same cell and sit in the middle of it — and because a glyph
 * that was spaced proportionally has no other position that is more right.
 * A glyph with no drawing is only given the width.
 */
export function fittedToWidth(g: Glyph, width: number, document?: FontDocument): Glyph {
  const box = outlineBounds(g, document);
  const sized = g.advance === width ? g : { ...g, advance: width };
  if (box === null) return sized;
  const left = Math.round((width - (box.maxX - box.minX)) / 2);
  const shift = left - box.minX;
  return shift === 0 ? sized : translateGlyph(sized, { x: shift, y: 0 });
}

/**
 * Every glyph the width does not allow, made that width.
 *
 * Those with no advance are marks, and are left alone, as are those already at
 * twice the width, which were made wide on purpose.
 *
 * The glyphs a composite is built from are fitted before it, and it is measured
 * where they now are. Its ink is theirs: an `aacute` centred against the `a` as
 * it was would be off-centre by however far the `a` then moved, since the `a`
 * takes the `aacute`'s copy of it along.
 */
export function fitToFixedWidth(document: FontDocument, width: number): FontDocument {
  const wanted = new Set(offWidthGlyphs(document, width).map((g) => g.name));
  const done = new Set<string>();
  let out = document;

  const fit = (name: string): void => {
    if (done.has(name)) return;
    done.add(name);
    const before = glyphNamed(out, name);
    if (before === null) return;
    for (const c of before.components) if (wanted.has(c.base)) fit(c.base);
    const g = glyphNamed(out, name)!;
    const fitted = fittedToWidth(g, width, out);
    if (fitted !== g) out = putGlyph(out, fitted);
  };

  for (const name of wanted) fit(name);
  return out;
}
