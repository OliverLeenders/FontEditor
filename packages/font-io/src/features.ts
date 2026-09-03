import { type FeaProblem, parseFea } from "./fea.js";
import { type FeatureEntry, type Lookup, gsubTable, ligatureSubst, singleSubst } from "./gsub.js";

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
 * Each feature becomes at most two lookups — its single substitutions and its
 * ligatures — rather than one per rule. Fewer lookups is not an optimisation
 * here so much as a correctness matter for ligatures, which have to be sorted
 * against each other by length and cannot be if they are in separate lookups.
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
            problems.push({ line: rule.line, message: `${from} is already substituted in ${feature.tag}` });
            continue;
          }
          singleFrom.push(id);
          singleTo.push(glyphId(to)!);
          rules += 1;
        }
        continue;
      }

      if (rule.from.some(missing) || missing(rule.to)) continue;
      ligatures.push({ from: rule.from.map((name) => glyphId(name)!), to: glyphId(rule.to)! });
      rules += 1;
    }

    const used: number[] = [];
    if (singleFrom.length > 0) {
      used.push(lookups.length);
      lookups.push({ type: 1, subtable: singleSubst({ from: singleFrom, to: singleTo }) });
    }
    if (ligatures.length > 0) {
      const subtable = ligatureSubst(ligatures);
      if (subtable.length > 0) {
        used.push(lookups.length);
        lookups.push({ type: 4, subtable });
      }
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
