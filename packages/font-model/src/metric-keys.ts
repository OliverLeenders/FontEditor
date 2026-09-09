import type { FontDocument, GlyphName } from "./document.js";
import { glyphNamed, updateGlyph } from "./document.js";
import { type Glyph, type MetricKeys, hasMetricKeys } from "./glyph.js";
import { setLeftSidebearing, setRightSidebearing, sidebearings } from "./metrics.js";

/**
 * Spacing taken from another glyph.
 *
 * Spacing a family by hand means spacing it again after every change: `n` is
 * drawn, then `m` is fitted to it, then the stem gets a hair wider and both are
 * wrong. A metric key says the relationship instead of the number — "my left
 * side is `n`'s" — and the number is worked out from whatever `n` is now.
 *
 * Three of them, because there are three things to say. `left` and `right` take
 * a sidebearing from another glyph, which is what spacing a lower case is made
 * of: `o` from `c`, `d` from `b` reversed, `ü` from `u`. `width` takes the whole
 * advance, which is what a tabular figure or a fixed-width family wants.
 *
 * Empty means "this glyph's own", which is what nearly every glyph says. The
 * key is a glyph *name*, so renaming a glyph breaks the keys that pointed at
 * it — the same as everywhere else in a font source, where names are the only
 * thing components and kerning groups have to refer to each other by.
 *
 * The format has no field for these. UFO does not define them and neither does
 * OpenType, so they are written into the font's `lib` under this editor's own
 * name, and resolved into ordinary numbers when a font is compiled. What comes
 * out is a font like any other; what stays in the source is the rule.
 *
 * The type itself is in `glyph.ts`, where the field is. This is what follows
 * them, which takes the whole document.
 */

export type { MetricKeys };

/** The spacing a glyph ends up with, once its keys are followed. */
export type ResolvedMetrics = {
  readonly advance: number;
  /** `null` for a glyph with no outline, which has no side to measure from. */
  readonly left: number | null;
  readonly right: number | null;
};

/** Why a key could not be followed. */
export type MetricKeyProblem = {
  readonly glyph: GlyphName;
  readonly says: string;
};

/**
 * How deep a chain of keys may go.
 *
 * `ü` from `u` from `n` is ordinary and three is nowhere near the limit. What
 * this is really for is the case a cycle guard cannot see: a chain so long that
 * following it is the slow part of an export, which is a mistake rather than a
 * design.
 */
const MAX_DEPTH = 16;

/**
 * What a glyph's spacing works out to.
 *
 * `null` where the chain cannot be followed — a key naming a glyph that is not
 * there, a glyph that reaches itself, a chain past the limit. Refusing is the
 * only honest answer: a key that resolved to "whatever this glyph already said"
 * would look like it worked and quietly stop tracking the glyph it names.
 *
 * The order the three are applied in is left, then right, then width, and it
 * matters because each changes the advance. Setting the left side moves the
 * outline and takes the advance with it; setting the right side changes the
 * advance alone; setting the width says what the advance is regardless. So the
 * coarsest goes last and wins, which is what somebody who set both a width key
 * and a side key meant by setting the width key.
 */
export function resolvedMetrics(
  document: FontDocument,
  name: GlyphName,
  depth = 0,
  seen: readonly GlyphName[] = [],
): ResolvedMetrics | null {
  const g = glyphNamed(document, name);
  if (g === null || depth > MAX_DEPTH || seen.includes(name)) return null;

  const own = sidebearings(g);
  let advance = g.advance;
  let left = own?.left ?? null;
  let right = own?.right ?? null;

  const trail = [...seen, name];

  if (g.metricKeys.left !== "") {
    const from = resolvedMetrics(document, g.metricKeys.left, depth + 1, trail);
    if (from === null || from.left === null || left === null) return null;
    // The outline moves, and the advance moves with it: adding space on the
    // left adds space on the left rather than taking it off the right.
    advance += from.left - left;
    left = from.left;
  }

  if (g.metricKeys.right !== "") {
    const from = resolvedMetrics(document, g.metricKeys.right, depth + 1, trail);
    if (from === null || from.right === null || right === null) return null;
    advance += from.right - right;
    right = from.right;
  }

  if (g.metricKeys.width !== "") {
    const from = resolvedMetrics(document, g.metricKeys.width, depth + 1, trail);
    if (from === null) return null;
    // The right side absorbs it, the left being where the outline sits.
    if (right !== null) right += from.advance - advance;
    advance = from.advance;
  }

  return { advance, left, right };
}

/**
 * The font with every key followed and turned into a number.
 *
 * What a compiler is handed. A font file has no way to say "this glyph is
 * spaced like that one" — it records an advance and an outline position, and
 * that is all a rasteriser ever sees — so the rule is resolved here and the
 * file that comes out is an ordinary one.
 *
 * A key that cannot be followed leaves the glyph exactly as it was drawn and is
 * reported. Silence would be worse than either alternative: the glyph is
 * spaced, so nothing looks broken, and it is spaced by a rule that stopped
 * working some edits ago.
 */
export function withResolvedMetrics(document: FontDocument): {
  readonly document: FontDocument;
  readonly problems: readonly MetricKeyProblem[];
} {
  const problems: MetricKeyProblem[] = [];
  let out = document;

  for (const name of document.glyphOrder) {
    const g = glyphNamed(document, name);
    if (g === null || !hasMetricKeys(g.metricKeys)) continue;

    const wanted = resolvedMetrics(document, name);
    if (wanted === null) {
      problems.push({ glyph: name, says: saysWhy(document, g) });
      continue;
    }

    const spaced = spacedTo(g, wanted);
    if (spaced !== g) out = updateGlyph(out, name, () => spaced) ?? out;
  }

  return { document: out, problems };
}

/** One glyph, moved and widened to the spacing its keys asked for. */
function spacedTo(g: Glyph, wanted: ResolvedMetrics): Glyph {
  let out = g;

  if (wanted.left !== null && g.metricKeys.left !== "") {
    out = setLeftSidebearing(out, wanted.left) ?? out;
  }
  if (wanted.right !== null && g.metricKeys.right !== "") {
    out = setRightSidebearing(out, wanted.right) ?? out;
  }
  if (g.metricKeys.width !== "") {
    out = out.advance === wanted.advance ? out : { ...out, advance: wanted.advance };
  }

  return out;
}

/** Which of the three keys is the broken one, said in a few words. */
function saysWhy(document: FontDocument, g: Glyph): string {
  const named = [g.metricKeys.left, g.metricKeys.right, g.metricKeys.width].filter((n) => n !== "");
  const missing = named.filter((n) => glyphNamed(document, n) === null);

  if (missing.length > 0) {
    return `is spaced from ${missing.join(", ")}, which ${missing.length === 1 ? "is" : "are"} not in this font`;
  }
  if (sidebearings(g) === null) {
    return "is spaced from another glyph but has no outline to move";
  }
  return "is spaced from a glyph that is spaced from it, round a loop";
}
