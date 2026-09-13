import type { Rect } from "@typewright/geometry";

import { resolveGlyphComponents } from "./component.js";
import { contourBounds, unionRect } from "./contour.js";
import type { FontDocument } from "./document.js";
import { counterIds } from "./ids.js";

/**
 * The three sets of vertical metrics a font carries, as they will be written.
 *
 * A font says how tall its lines are three times over. `hhea` is what macOS and
 * most browsers read; the `OS/2` typographic values are what the specification
 * says everybody should read, and what Windows reads when a bit asks it to; the
 * `OS/2` Windows values are the clipping box GDI draws inside, so a glyph that
 * reaches past them is cut off. Left alone they disagree in ways that only show
 * when the same font sets different line heights in two programs.
 *
 * Each is the font's own override where it has one, and otherwise what the
 * exporter derives — which is exactly what it wrote before any of these could
 * be set, so a font that sets none of them exports as it always did.
 */
export type VerticalMetrics = {
  readonly hheaAscender: number;
  readonly hheaDescender: number;
  readonly hheaLineGap: number;
  readonly typoAscender: number;
  readonly typoDescender: number;
  readonly typoLineGap: number;
  readonly winAscent: number;
  readonly winDescent: number;
  /** `OS/2 fsSelection` bit 7: read the typographic values, not the Windows ones. */
  readonly useTypoMetrics: boolean;
};

/** The `fsSelection` bit that tells Windows to believe the typographic metrics. */
export const USE_TYPO_METRICS_BIT = 7;

/**
 * What the exporter writes where the font sets nothing.
 *
 * The line metrics follow the ascender and descender with no gap, and the
 * Windows box is the tallest and deepest any glyph actually reaches — the
 * glyphs as compiled, components and all, since an accent on a capital is
 * usually what reaches highest and it is drawn by reference.
 */
export function derivedVerticalMetrics(document: FontDocument): VerticalMetrics {
  const { info } = document;
  const reach = fontReach(document);

  return {
    hheaAscender: Math.round(info.ascender),
    hheaDescender: Math.round(info.descender),
    hheaLineGap: 0,
    typoAscender: Math.round(info.ascender),
    typoDescender: Math.round(info.descender),
    typoLineGap: 0,
    // With nothing drawn there is no box to measure, and the line is as good an
    // answer as any.
    winAscent: Math.round(reach === null ? info.ascender : reach.maxY),
    winDescent: Math.round(Math.abs(reach === null ? info.descender : reach.minY)),
    useTypoMetrics: false,
  };
}

/** The metrics as they will be written: each override, or what is derived. */
export function verticalMetrics(document: FontDocument): VerticalMetrics {
  const { info } = document;
  const derived = derivedVerticalMetrics(document);

  return {
    hheaAscender: info.openTypeHheaAscender ?? derived.hheaAscender,
    hheaDescender: info.openTypeHheaDescender ?? derived.hheaDescender,
    hheaLineGap: info.openTypeHheaLineGap ?? derived.hheaLineGap,
    typoAscender: info.openTypeOS2TypoAscender ?? derived.typoAscender,
    typoDescender: info.openTypeOS2TypoDescender ?? derived.typoDescender,
    typoLineGap: info.openTypeOS2TypoLineGap ?? derived.typoLineGap,
    winAscent: info.openTypeOS2WinAscent ?? derived.winAscent,
    winDescent: info.openTypeOS2WinDescent ?? derived.winDescent,
    useTypoMetrics: info.openTypeOS2Selection.includes(USE_TYPO_METRICS_BIT),
  };
}

/** The box every glyph's outline fits inside, components included. */
function fontReach(document: FontDocument): Rect | null {
  const source = { glyphOf: (name: string) => document.glyphs[name] ?? null };
  // Ids for contours nothing will select: they are measured and thrown away.
  const ids = counterIds("reach-");

  let box: Rect | null = null;
  for (const name of document.glyphOrder) {
    const g = document.glyphs[name];
    if (g === undefined) continue;

    const drawn =
      g.components.length === 0
        ? g.contours
        : [...g.contours, ...resolveGlyphComponents(source, g.name, g.components, ids)];
    for (const c of drawn) {
      const of = contourBounds(c);
      if (of !== null) box = unionRect(box, of);
    }
  }
  return box;
}
