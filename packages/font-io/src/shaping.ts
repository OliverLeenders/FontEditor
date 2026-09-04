import { type FeaRule, type FeaSource, parseFea } from "./fea.js";

/**
 * Applying a font's own substitutions to a run of glyphs, for previewing.
 *
 * The editor could already compile `liga` into a GSUB table that a browser would
 * honour, and could not show you the result anywhere: the proof laid out the
 * glyphs the characters mapped to, one for one, so the ligature you had just
 * written was invisible until the font was exported and installed. Judging a
 * ligature is exactly what a proof is for.
 *
 * This is not a shaping engine. It applies what this editor's `.fea` subset can
 * express — ligatures and single substitutions — in the order the file lists
 * them, over a run that is already in visual order because the editor is
 * left-to-right only. There is no contextual matching, no mark attachment and no
 * bidi, and nothing here pretends otherwise. What it buys is that the thing you
 * wrote is the thing you see.
 */

/**
 * The features a shaper applies when nobody says otherwise.
 *
 * The ones a text renderer turns on by itself: composition, required and common
 * ligatures, and contextual alternates. Everything else — `smcp`, `ss01`, `onum`
 * — is something a document asks for, and a proof that applied them unasked
 * would be showing a face nobody would get by typing.
 */
export const DEFAULT_FEATURES: readonly string[] = ["ccmp", "rlig", "liga", "clig", "calt"];

/** Turns a run of glyph names into the run the font's features ask for. */
export type Shaper = (names: readonly string[]) => string[];

/** A shaper that changes nothing, for a font with no features and for tests. */
export const NO_SHAPING: Shaper = (names) => [...names];

/**
 * Build a shaper from feature source.
 *
 * `tags` selects which features run, defaulting to {@link DEFAULT_FEATURES}. A
 * tag the font does not define is not an error — a proof set with `smcp` on in a
 * font that has no small capitals shows what it has, which is the truthful
 * answer.
 *
 * Problems in the source are ignored rather than thrown. The Features workspace
 * is where a feature file is written and where its errors are reported; a proof
 * that refused to draw because of a half-typed rule would be reporting the same
 * problem in the least useful place.
 */
export function shaperFor(source: string, tags: readonly string[] = DEFAULT_FEATURES): Shaper {
  return shaperForParsed(parseFea(source), tags);
}

export function shaperForParsed(
  parsed: FeaSource,
  tags: readonly string[] = DEFAULT_FEATURES,
): Shaper {
  const wanted = new Set(tags);
  const active = parsed.features.filter((feature) => wanted.has(feature.tag));
  if (active.length === 0) return NO_SHAPING;

  // Flattened in file order. A feature is a group of rules for the purpose of
  // switching it on, and once it is on its rules are just more rules.
  const rules = active.flatMap((feature) => feature.rules);
  return (names) => applyRules(names, rules);
}

/** Every feature tag the source defines, in the order it defines them. */
export function featureTags(source: string): string[] {
  const seen = new Set<string>();
  for (const feature of parseFea(source).features) seen.add(feature.tag);
  return [...seen];
}

function applyRules(names: readonly string[], rules: readonly FeaRule[]): string[] {
  let run = [...names];
  for (const rule of rules) {
    run =
      rule.kind === "ligature" ? applyLigature(run, rule.from, rule.to) : applySingle(run, rule);
  }
  return run;
}

/**
 * Replace every run of `from` with `to`.
 *
 * Left to right, and non-overlapping: once three glyphs have become one
 * ligature, the glyphs behind it are gone and cannot start another match. That
 * is what a shaper does, and it is also the only reading that terminates.
 */
function applyLigature(names: readonly string[], from: readonly string[], to: string): string[] {
  if (from.length === 0) return [...names];

  const out: string[] = [];
  let at = 0;
  while (at < names.length) {
    if (matchesAt(names, at, from)) {
      out.push(to);
      at += from.length;
    } else {
      out.push(names[at]!);
      at += 1;
    }
  }
  return out;
}

function matchesAt(names: readonly string[], at: number, from: readonly string[]): boolean {
  if (at + from.length > names.length) return false;
  for (const [offset, name] of from.entries()) {
    if (names[at + offset] !== name) return false;
  }
  return true;
}

/**
 * Swap each glyph for the one the rule pairs it with.
 *
 * One pass over the run rather than one per pair, so a rule that maps `a` to `b`
 * and `b` to `c` does not turn every `a` into a `c` on its way through.
 */
function applySingle(
  names: readonly string[],
  rule: Extract<FeaRule, { kind: "single" }>,
): string[] {
  const map = new Map<string, string>();
  for (const [index, from] of rule.from.entries()) {
    const to = rule.to[index] ?? rule.to[0];
    if (to !== undefined) map.set(from, to);
  }
  return names.map((name) => map.get(name) ?? name);
}
