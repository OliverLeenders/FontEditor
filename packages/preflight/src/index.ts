import type { FontDocument, Glyph } from "@typewright/font-model";
import { orderedGlyphs } from "@typewright/font-model";

import { type CheckId, type Finding, type Severity, SEVERITIES } from "./finding.js";
import { fontFindings, imageFindings } from "./font.js";
import { glyphFindings } from "./glyphs.js";

/**
 * @typewright/preflight
 *
 * Everything findable about a font before it is exported, and nothing that
 * fixes it.
 *
 * The list of things that go wrong in a font is not a list of bugs; it is a
 * list of things that are invisible while you are drawing. A contour left open
 * looks closed on a canvas that fills it. A duplicate code point looks like two
 * good glyphs. A kerning pair naming a glyph that was renamed last week looks
 * like nothing at all — right up until somebody asks why the kerning stopped
 * working.
 *
 * Reporting and not repairing is the design rather than a stage of it. Every
 * one of these has a fix that is a decision: whether the open contour was meant
 * to close, which of the two glyphs should keep the character, whether the
 * fractional coordinates are a scale that wants redoing or a curve drawn where
 * it belongs. A tool that decided would be guessing with somebody's drawing.
 */

export type { Check, CheckId, Finding, Severity } from "./finding.js";
export { CHECKS, SEVERITIES, checkNamed } from "./finding.js";

export type PreflightOptions = {
  /** Checks not to run. What somebody has decided they do not want told about. */
  readonly skip?: readonly CheckId[];
  /**
   * The pictures the font actually holds, by name.
   *
   * Passed in because they are not in the document: a glyph names an image and
   * the bytes live beside the font, so only the caller knows which names are
   * really there. Left out, the check is skipped rather than guessing.
   */
  readonly images?: ReadonlySet<string>;
};

/**
 * Everything wrong with a font, worst first.
 *
 * Sorted by severity and then by the order the glyphs are in, because that is
 * how the list is worked through: the errors are what stop the font being a
 * font, and within them, going front to back is how a designer walks a font
 * anyway.
 */
export function preflight(document: FontDocument, options: PreflightOptions = {}): Finding[] {
  const skip = new Set(options.skip ?? []);
  const found: Finding[] = [];

  for (const g of orderedGlyphs(document)) found.push(...glyphFindings(document, g));
  found.push(...fontFindings(document));
  if (options.images !== undefined) found.push(...imageFindings(document, options.images));

  const place = placesOf(document);
  return found
    .filter((f) => !skip.has(f.check))
    .sort((a, b) => rank(a.severity) - rank(b.severity) || place(a.glyph) - place(b.glyph));
}

/** The findings for one glyph, for an editor that wants to say so as it is drawn. */
export function preflightGlyph(
  document: FontDocument,
  glyph: Glyph,
  options: PreflightOptions = {},
): Finding[] {
  const skip = new Set(options.skip ?? []);
  return glyphFindings(document, glyph).filter((f) => !skip.has(f.check));
}

/** How many of each severity, for saying "3 errors, 12 warnings" without counting twice. */
export function countBySeverity(findings: readonly Finding[]): Record<Severity, number> {
  const out: Record<Severity, number> = { error: 0, warning: 0, note: 0 };
  for (const f of findings) out[f.severity]++;
  return out;
}

const rank = (severity: Severity): number => SEVERITIES.indexOf(severity);

/**
 * Where a glyph sits in the font, for ordering findings within a severity.
 *
 * Findings about the font rather than a glyph sort last within their severity:
 * they are read once, where the per-glyph ones are worked through.
 */
function placesOf(document: FontDocument): (name: string | null) => number {
  const places = new Map(document.glyphOrder.map((name, i) => [name, i]));
  return (name) => (name === null ? Number.MAX_SAFE_INTEGER : (places.get(name) ?? places.size));
}
