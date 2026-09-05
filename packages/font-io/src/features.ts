import { type FeaProblem, parseFea } from "./fea.js";
import {
  type FeatureEntry,
  type Lookup,
  chainContextSubst,
  gsubTable,
  ligatureSubst,
  singleSubst,
} from "./gsub.js";

/**
 * Turning feature source into a GSUB table.
 *
 * The step between the reader and the writer, and the only one that knows about
 * the font: a rule names glyphs, and a table holds glyph ids, so this is where
 * a rule about a glyph the font has not got is caught and reported rather than
 * compiled into a lookup that points at nothing.
 */

export type CompiledFeatures = {
  /** Empty when nothing compiled, so a caller writes no table rather than an empty one. */
  readonly table: Uint8Array;
  /** Tags that produced at least one working rule, in the order they appeared. */
  readonly tags: readonly string[];
  readonly rules: number;
  readonly problems: readonly FeaProblem[];
};

export const NO_FEATURES: CompiledFeatures = {
  table: new Uint8Array(0),
  tags: [],
  rules: 0,
  problems: [],
};

/**
 * Compile feature source against a font's glyph names.
 *
 * `glyphId` returns `undefined` for a name the font does not have. A rule
 * mentioning one is dropped and reported: the alternative is a lookup that
 * substitutes something for nothing, which a shaper is entitled to render as a
 * missing glyph box in the middle of a word.
 *
 * Each feature becomes at most three lookups — its single substitutions, its
 * ligatures, and its contextual rules — rather than one per rule. Fewer lookups
 * is not an optimisation here so much as a correctness matter for ligatures,
 * which have to be sorted against each other by length and cannot be if they are
 * in separate lookups.
 *
 * Contextual rules are the exception, and have to stay one subtable each: they
 * are tried in the order they were written and the first to match wins, which is
 * what makes `ignore` mean anything. Each carries its own nested lookup holding
 * the substitution to run — the table has no way to write the replacement into
 * the rule, so a contextual rule is always a condition plus a pointer at an
 * ordinary lookup somewhere else in the list.
 */
export function compileFeatures(
  source: string,
  glyphId: (name: string) => number | undefined,
): CompiledFeatures {
  if (source.trim() === "") return NO_FEATURES;

  const parsed = parseFea(source);
  const problems: FeaProblem[] = [...parsed.problems];

  const lookups: Lookup[] = [];
  const entries: FeatureEntry[] = [];
  const tags: string[] = [];
  let rules = 0;

  for (const feature of parsed.features) {
    const singleFrom: number[] = [];
    const singleTo: number[] = [];
    const ligatures: { from: number[]; to: number }[] = [];
    const chains: Uint8Array[] = [];

    for (const rule of feature.rules) {
      const missing = (name: string): boolean => {
        if (glyphId(name) !== undefined) return false;
        problems.push({ line: rule.line, message: `there is no glyph called ${name}` });
        return true;
      };

      if (rule.kind === "single") {
        for (const [i, from] of rule.from.entries()) {
          const to = rule.to[i]!;
          if (missing(from) || missing(to)) continue;

          const id = glyphId(from)!;
          // A glyph substituted twice in one feature is a rule that contradicts
          // an earlier one, and the table can hold only one answer.
          if (singleFrom.includes(id)) {
            problems.push({
              line: rule.line,
              message: `${from} is already substituted in ${feature.tag}`,
            });
            continue;
          }
          singleFrom.push(id);
          singleTo.push(glyphId(to)!);
          rules += 1;
        }
        continue;
      }

      if (rule.kind === "chain") {
        const positions = [...rule.backtrack, ...rule.input, ...rule.lookahead];
        // Every name, including the ones that are only conditions: a context
        // naming a glyph that is not there can never match, and a rule that can
        // never match is a rule the file claims and the font does not have.
        if (positions.some((set) => set.some(missing))) continue;
        if (rule.to !== null && rule.to.some(missing)) continue;

        const ids = (sets: readonly (readonly string[])[]) =>
          sets.map((set) => set.map((name) => glyphId(name)!));

        const input = ids(rule.input);
        const actions: { at: number; lookup: number }[] = [];

        if (rule.to !== null) {
          const nested = nestedLookup(
            input,
            rule.to.map((name) => glyphId(name)!),
          );
          if (nested === null) {
            problems.push({ line: rule.line, message: "this rule replaces nothing" });
            continue;
          }
          // Appended before the lookup that points at it, so its index is fixed
          // by the time the pointer is written.
          actions.push({ at: 0, lookup: lookups.length });
          lookups.push(nested);
        }

        chains.push(
          chainContextSubst({
            backtrack: ids(rule.backtrack),
            input,
            lookahead: ids(rule.lookahead),
            actions,
          }),
        );
        rules += 1;
        continue;
      }

      if (rule.from.some(missing) || missing(rule.to)) continue;
      ligatures.push({ from: rule.from.map((name) => glyphId(name)!), to: glyphId(rule.to)! });
      rules += 1;
    }

    const used: number[] = [];
    if (singleFrom.length > 0) {
      used.push(lookups.length);
      lookups.push({ type: 1, subtables: [singleSubst({ from: singleFrom, to: singleTo })] });
    }
    if (ligatures.length > 0) {
      const subtable = ligatureSubst(ligatures);
      if (subtable.length > 0) {
        used.push(lookups.length);
        lookups.push({ type: 4, subtables: [subtable] });
      }
    }
    if (chains.length > 0) {
      used.push(lookups.length);
      lookups.push({ type: 6, subtables: chains });
    }

    if (used.length === 0) continue;
    // A tag written twice adds to the feature that is already there rather than
    // making a second one, which is what a shaper would ignore.
    const existing = entries.find((e) => e.tag === feature.tag);
    if (existing === undefined) {
      entries.push({ tag: feature.tag, lookups: used });
      tags.push(feature.tag);
    } else {
      entries[entries.indexOf(existing)] = {
        tag: existing.tag,
        lookups: [...existing.lookups, ...used],
      };
    }
  }

  return { table: gsubTable(entries, lookups), tags, rules, problems };
}

/**
 * The ordinary lookup a contextual rule points at.
 *
 * One marked position is a swap of each of its glyphs; several are a ligature of
 * the run. The same two shapes a plain rule has, which is the whole idea: the
 * context is a condition on a rule, not a different kind of rule.
 */
function nestedLookup(input: readonly (readonly number[])[], to: readonly number[]): Lookup | null {
  if (input.length === 0 || to.length === 0) return null;

  if (input.length === 1) {
    const from = input[0]!;
    if (from.length === 0) return null;
    // One name replaces every glyph of the position; a list pairs off with it,
    // which the reader has already checked the lengths of.
    const replacements = to.length === 1 ? from.map(() => to[0]!) : [...to];
    if (replacements.length !== from.length) return null;
    return { type: 1, subtables: [singleSubst({ from, to: replacements })] };
  }

  if (to.length !== 1 || input.some((set) => set.length !== 1)) return null;
  const subtable = ligatureSubst([{ from: input.map((set) => set[0]!), to: to[0]! }]);
  return subtable.length === 0 ? null : { type: 4, subtables: [subtable] };
}
