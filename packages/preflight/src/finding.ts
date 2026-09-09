import type { GlyphName } from "@fonteditor/font-model";
import type { ContourId, NodeId } from "@fonteditor/font-model";

/**
 * What a check found, and what a check is.
 *
 * Preflight reports and never repairs. That is the whole design: the things
 * worth finding in a font are things where the fix is a decision — an open
 * contour might be a shape half drawn or a shape drawn on purpose, a duplicate
 * code point means one of two glyphs is wrong and only the designer knows
 * which. A tool that closed the contour would be guessing with somebody's
 * drawing, so this one points.
 */

/**
 * How much a finding matters.
 *
 * Three levels rather than two, because "this will come out wrong" and "this is
 * probably not what you meant" are different conversations, and mixing them
 * makes a list nobody reads twice.
 */
export type Severity = "error" | "warning" | "note";

/** The order they are shown in, worst first. */
export const SEVERITIES: readonly Severity[] = ["error", "warning", "note"];

export type CheckId =
  | "open-contour"
  | "broken-metric-key"
  | "stray-point"
  | "empty-contour"
  | "duplicate-point"
  | "off-grid"
  | "missing-base"
  | "recursive-component"
  | "duplicate-unicode"
  | "glyph-name"
  | "no-notdef"
  | "negative-advance"
  | "kern-missing-glyph"
  | "empty-kern-group"
  | "unnamed-anchor"
  | "duplicate-anchor"
  | "two-mark-anchors"
  | "mark-without-base"
  | "missing-image";

/** One thing wrong, or possibly wrong, in one place. */
export type Finding = {
  readonly check: CheckId;
  readonly severity: Severity;
  /** The glyph it is in, or `null` when it is about the font as a whole. */
  readonly glyph: GlyphName | null;
  /** What is wrong, said in one line to somebody who has to fix it. */
  readonly message: string;
  /**
   * Where in the glyph, when there is a where.
   *
   * Ids rather than positions, so the editor can select what the finding is
   * about rather than move the camera near it.
   */
  readonly where: { readonly contourId: ContourId; readonly nodeId: NodeId | null } | null;
};

/** What a check is for, for a reader deciding whether to care. */
export type Check = {
  readonly id: CheckId;
  readonly severity: Severity;
  /** A few words, for a heading. */
  readonly title: string;
  /** Why it matters — the sentence that saves someone looking it up. */
  readonly why: string;
};

/**
 * Every check, with the reason it exists.
 *
 * The severity lives here rather than at the site so that a list of what this
 * tool looks for can be read in one place, and so that the difference between
 * an error and a note is decided once rather than argued per call.
 */
export const CHECKS: readonly Check[] = [
  {
    id: "glyph-name",
    severity: "error",
    title: "Glyph name a font cannot carry",
    why: "A name in a compiled font is up to 63 characters of A–Z, a–z, 0–9, full stop and underscore, and may not begin with a digit. A name outside that is refused by the format rather than by this editor.",
  },
  {
    id: "missing-base",
    severity: "error",
    title: "Component with nothing to place",
    why: "The glyph refers to another that is not in the font, so nothing is drawn where the reference is.",
  },
  {
    id: "recursive-component",
    severity: "error",
    title: "Component that contains itself",
    why: "A glyph that refers to itself, directly or through others, has no outline a compiler can arrive at.",
  },
  {
    id: "duplicate-unicode",
    severity: "error",
    title: "Two glyphs claiming one character",
    why: "A character map has one glyph per code point, so one of the two is silently unreachable in the font.",
  },
  {
    id: "negative-advance",
    severity: "error",
    title: "Advance width below zero",
    why: "A negative advance moves the pen backwards. Some rasterisers refuse the font and others draw the next letter on top of this one.",
  },
  {
    id: "open-contour",
    severity: "warning",
    title: "Contour left open",
    why: "Both outline formats fill closed paths only. A compiler closes it with a straight line from the last point to the first, which is rarely the shape that was drawn.",
  },
  {
    id: "duplicate-point",
    severity: "warning",
    title: "Two points in the same place",
    why: "A segment with no length. It draws nothing, it cannot be given a direction, and it makes overlap removal and interpolation behave oddly.",
  },
  {
    id: "stray-point",
    severity: "warning",
    title: "A contour of one point",
    why: "Nothing is drawn, and a single point is what an anchor looked like in the older format — so it may be an attachment that arrived as an outline.",
  },
  {
    id: "empty-contour",
    severity: "warning",
    title: "A contour of no points",
    why: "Nothing is drawn and nothing can be. Usually what is left after deleting the points of a shape rather than the shape.",
  },
  {
    id: "kern-missing-glyph",
    severity: "warning",
    title: "Kerning about a glyph that is not here",
    why: "A pair or a group naming a glyph the font does not have. The pair never applies, and it survives every rename that was meant to catch it.",
  },
  {
    id: "unnamed-anchor",
    severity: "warning",
    title: "Anchor with no name",
    why: "The name is the whole of what an anchor is for: it is what an accent looks for. A nameless one attaches nothing to nothing and is not written out.",
  },
  {
    id: "duplicate-anchor",
    severity: "warning",
    title: "Two anchors with one name",
    why: "An accent looking for that name finds whichever comes first, which is an accident of the order they were placed in.",
  },
  {
    id: "two-mark-anchors",
    severity: "warning",
    title: "A mark that attaches two ways",
    why: "Mark attachment gives a glyph one class, so only one of its attaching anchors reaches the compiled font.",
  },
  {
    id: "missing-image",
    severity: "warning",
    title: "Tracing from a picture that is not here",
    why: "The glyph names an image the font does not contain, so there is nothing behind it to draw against — usually a picture removed after the letter was set up to trace from it.",
  },
  {
    id: "off-grid",
    severity: "note",
    title: "Coordinates between units",
    why: "The drawing is kept in fractions and the compiler rounds. Where a design is meant to sit on the grid, a fraction is usually the residue of a scale or a rotation.",
  },
  {
    id: "no-notdef",
    severity: "note",
    title: "No .notdef",
    why: "The glyph shown for a character the font does not have. One is invented at export, which is better than nothing and worse than drawing one.",
  },
  {
    id: "empty-kern-group",
    severity: "note",
    title: "Kerning group with no glyphs",
    why: "It kerns nothing. Harmless, and usually the last trace of glyphs that were removed.",
  },
  {
    id: "broken-metric-key",
    severity: "warning",
    title: "Spacing taken from nowhere",
    why: "The glyph says its spacing comes from another one, and that rule cannot be followed — so the font is compiled with whatever spacing the glyph happens to have.",
  },
  {
    id: "mark-without-base",
    severity: "note",
    title: "A mark with nowhere to land",
    why: "The accent attaches by a name no glyph in the font offers, so it is never positioned by the font on anything.",
  },
];

const BY_ID = new Map(CHECKS.map((c) => [c.id, c]));

/** The check behind a finding. Every id here is one of the table's own. */
export function checkNamed(id: CheckId): Check {
  const found = BY_ID.get(id);
  // Not reachable through the type, and cheaper to say than to prove.
  if (found === undefined) throw new Error(`no such check: ${id}`);
  return found;
}

/** Make a finding, taking its severity from the table so the two cannot drift. */
export function finding(
  check: CheckId,
  glyph: GlyphName | null,
  message: string,
  where: Finding["where"] = null,
): Finding {
  return { check, severity: checkNamed(check).severity, glyph, message, where };
}
