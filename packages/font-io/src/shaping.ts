import { type FeaRule, type FeaSource, type ValueRecord, parseFea } from "./fea.js";

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
 * express — single substitutions, ligatures, and either of those conditioned on
 * what surrounds them — in the order the file lists them, over a run that is
 * already in visual order because the editor is left-to-right only. There is no
 * mark attachment and no bidi, and nothing here pretends otherwise. What it buys
 * is that the thing you wrote is the thing you see.
 *
 * Substitution only. A run is a list of names, so a positioning rule passes
 * through untouched: it reaches the exported font and not the preview. Kerning
 * is the exception, and only because the line that draws the run looks it up
 * itself rather than asking for it here.
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

type Chain = Extract<FeaRule, { kind: "chain" }>;

function applyRules(names: readonly string[], rules: readonly FeaRule[]): string[] {
  let run = [...names];
  let at = 0;

  while (at < rules.length) {
    const rule = rules[at]!;

    // Contextual rules go in batches rather than one at a time. Consecutive
    // ones are a single lookup, and within a lookup the first rule to match a
    // position wins — which is the whole of what `ignore` does.
    if (rule.kind === "chain") {
      const batch: Chain[] = [];
      while (at < rules.length && rules[at]!.kind === "chain") {
        batch.push(rules[at] as Chain);
        at += 1;
      }
      run = applyChains(run, batch);
      continue;
    }

    // Positioning moves a glyph without changing which glyph it is, and this
    // returns names. Such a rule reaches the exported font and not the preview,
    // which is a gap worth knowing about rather than one worth pretending away.
    if (rule.kind === "position") {
      at += 1;
      continue;
    }

    run =
      rule.kind === "ligature" ? applyLigature(run, rule.from, rule.to) : applySingle(run, rule);
    at += 1;
  }
  return run;
}

/**
 * One pass over the run, trying each rule at each position.
 *
 * Left to right, taking the first rule that matches and stepping past what it
 * matched — including when it matched in order to do nothing. A rule cannot see
 * a glyph it has already passed except as it now stands, which is why the
 * backtrack is checked against what has been produced rather than against the
 * text that was there before.
 */
function applyChains(names: readonly string[], rules: readonly Chain[]): string[] {
  const out: string[] = [];
  let at = 0;

  while (at < names.length) {
    const hit = rules.find((rule) => chainMatches(names, out, at, rule));
    if (hit === undefined) {
      out.push(names[at]!);
      at += 1;
      continue;
    }

    const width = hit.input.length;
    if (hit.to === null) {
      // An ignore rule leaves the glyphs it matched exactly as they were; what
      // it accomplishes is that the rules after it never see them.
      for (let i = 0; i < width; i++) out.push(names[at + i]!);
    } else {
      out.push(...replacement(names[at]!, hit));
    }
    at += width;
  }
  return out;
}

function chainMatches(
  names: readonly string[],
  out: readonly string[],
  at: number,
  rule: Chain,
): boolean {
  // Written in reading order, so the last of the backtrack is the glyph just
  // before the match.
  if (rule.backtrack.length > out.length) return false;
  const start = out.length - rule.backtrack.length;
  for (const [i, set] of rule.backtrack.entries()) {
    const glyph = out[start + i];
    if (glyph === undefined || !set.includes(glyph)) return false;
  }

  for (const [i, set] of rule.input.entries()) {
    const glyph = names[at + i];
    if (glyph === undefined || !set.includes(glyph)) return false;
  }

  const after = at + rule.input.length;
  for (const [i, set] of rule.lookahead.entries()) {
    const glyph = names[after + i];
    if (glyph === undefined || !set.includes(glyph)) return false;
  }
  return true;
}

/** What the matched run becomes: one glyph, whichever way the rule was written. */
function replacement(first: string, rule: Chain): string[] {
  const to = rule.to ?? [];
  if (to.length === 0) return [first];
  if (rule.input.length > 1 || to.length === 1) return [to[0]!];

  // A class paired off with another: each glyph of the marked position becomes
  // the one written opposite it.
  const index = rule.input[0]!.indexOf(first);
  return [to[index] ?? to[0]!];
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

/**
 * The font's positioning rules, as a function over the glyphs being set.
 *
 * One entry per glyph, `null` where nothing applies. Built the way the table is:
 * within a feature the first rule naming a glyph is the one that applies, and
 * across features the adjustments add up — which is what separate lookups do.
 */
export type Positioner = (names: readonly string[]) => (ValueRecord | null)[];

/** A positioner that moves nothing, for a font with no rules and for tests. */
export const NO_POSITIONING: Positioner = (names) => names.map(() => null);

export function positionerFor(
  source: string,
  tags: readonly string[] = DEFAULT_FEATURES,
): Positioner {
  return positionerForParsed(parseFea(source), tags);
}

export function positionerForParsed(
  parsed: FeaSource,
  tags: readonly string[] = DEFAULT_FEATURES,
): Positioner {
  const wanted = new Set(tags);
  // Grouped by feature and kept that way, unlike the substitutions: two
  // features adjusting the same glyph both apply, and two rules within one
  // feature do not.
  const byFeature = parsed.features
    .filter((feature) => wanted.has(feature.tag))
    .map((feature) => feature.rules.filter(isPosition))
    .filter((rules) => rules.length > 0);

  if (byFeature.length === 0) return NO_POSITIONING;

  return (names) =>
    names.map((name) => {
      let total: ValueRecord | null = null;
      for (const rules of byFeature) {
        const hit = rules.find((rule) => rule.glyphs.includes(name));
        if (hit === undefined) continue;
        total =
          total === null
            ? hit.value
            : {
                x: total.x + hit.value.x,
                y: total.y + hit.value.y,
                xAdvance: total.xAdvance + hit.value.xAdvance,
                yAdvance: total.yAdvance + hit.value.yAdvance,
              };
      }
      return total;
    });
}

const isPosition = (rule: FeaRule): rule is Extract<FeaRule, { kind: "position" }> =>
  rule.kind === "position";
