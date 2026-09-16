import type { Axis, Rule, RulesProcessing } from "@typewright/font-model";
import { isDiscrete, normalised } from "@typewright/font-model";

import { singleSubst } from "./gsub.js";
import {
  type FeatureEntry,
  type FeatureVariation,
  type LanguageSystem,
  type Lookup,
  layoutTable,
  mergeFeatures,
} from "./layout.js";

/**
 * A designspace's rules, as a variable font carries them.
 *
 * Each rule becomes one lookup of single substitutions, and each place the rule
 * applies becomes a record in GSUB's feature variations: in that region, the
 * feature `rvrn` — or `rclt`, for rules processed last — uses that lookup. The
 * shaper works out which record holds at the location being drawn and applies
 * the first that does.
 *
 * First that does is the difficulty. Two rules whose regions overlap both apply
 * where they overlap, and a table that tries one record and stops cannot say so
 * with a record each. So where regions overlap a record is written for the
 * overlap too, with both rules' lookups, and put ahead of the records it came
 * from — which is what fontTools does, and so what a font built anywhere else
 * does.
 */

/** A range on each of some axes, on the normalised scale, by index into the font's axes. */
export type SwapRegion = readonly {
  readonly axis: number;
  readonly min: number;
  readonly max: number;
}[];

export type SwapVariations = {
  /** The feature the swaps are made in. */
  readonly tag: string;
  /** In rule order: the swaps, and every region where the rule applies. */
  readonly rules: readonly {
    readonly swaps: readonly (readonly [string, string])[];
    readonly regions: readonly SwapRegion[];
  }[];
};

/**
 * The rules, placed on the axes a variable font has.
 *
 * `axes` are the font's — the ones it can vary along — and `all` is every axis
 * of the designspace. An axis with stops is not one a variable font can vary
 * along, so a condition on it is settled here: the font is the designspace at
 * that axis's default, and a range that holds there says nothing more, while
 * one that does not means the condition set can never hold in this font.
 *
 * `null` where there is nothing to write.
 */
export function swapVariationsFor(
  axes: readonly Axis[],
  all: readonly Axis[],
  rules: readonly Rule[],
  processing: RulesProcessing,
): SwapVariations | null {
  const placed = rules.flatMap((r) => {
    if (r.swaps.length === 0) return [];
    const regions: SwapRegion[] = [];

    for (const set of r.conditionSets) {
      const region: { axis: number; min: number; max: number }[] = [];
      let possible = true;

      for (const c of set) {
        const axis = all.find((a) => a.tag === c.tag);
        if (axis === undefined) continue;
        if (isDiscrete(axis)) {
          const at = axis.default;
          if ((c.min !== null && at < c.min) || (c.max !== null && at > c.max)) possible = false;
          continue;
        }
        const index = axes.findIndex((a) => a.tag === c.tag);
        if (index < 0) continue;
        const scale = (value: number): number =>
          normalised([axis], { [axis.tag]: value })[axis.tag] ?? 0;
        region.push({
          axis: index,
          min: c.min === null ? -1 : scale(c.min),
          max: c.max === null ? 1 : scale(c.max),
        });
      }

      if (possible) regions.push(region);
    }

    return regions.length === 0 ? [] : [{ swaps: r.swaps, regions }];
  });

  if (placed.length === 0) return null;
  return { tag: processing === "last" ? "rclt" : "rvrn", rules: placed };
}

/**
 * GSUB with the rules added: the feature file's own lookups first, then one
 * lookup per rule, then the feature variations that switch them on.
 *
 * A swap naming a glyph the font does not have is left out and said, rather
 * than substituting something for nothing.
 */
export function gsubWithSwaps(
  substitution: { readonly entries: readonly FeatureEntry[]; readonly lookups: readonly Lookup[] },
  systems: readonly LanguageSystem[],
  swaps: SwapVariations,
  glyphIdOf: (name: string) => number | undefined,
  warn: (message: string) => void,
): Uint8Array {
  const lookups: Lookup[] = [...substitution.lookups];
  const ruleLookup: (number | null)[] = [];

  for (const r of swaps.rules) {
    const from: number[] = [];
    const to: number[] = [];
    for (const [a, b] of r.swaps) {
      const one = glyphIdOf(a);
      const two = glyphIdOf(b);
      if (one === undefined || two === undefined) {
        warn(`a rule swaps ${a} for ${b}, and the font has no ${one === undefined ? a : b}`);
        continue;
      }
      if (from.includes(one)) continue;
      from.push(one);
      to.push(two);
    }
    if (from.length === 0) {
      ruleLookup.push(null);
      continue;
    }
    ruleLookup.push(lookups.length);
    lookups.push({ type: 1, subtables: [singleSubst({ from, to })] });
  }

  const variations = overlay(
    swaps.rules.flatMap((r, i) => {
      const lookup = ruleLookup[i];
      return lookup === null || lookup === undefined
        ? []
        : r.regions.map((region) => ({ region, lookups: [lookup] }));
    }),
  ).map(({ region, lookups: used }) => ({ conditions: region, tag: swaps.tag, lookups: used }));

  return layoutTable(
    mergeFeatures(substitution.entries, []),
    lookups,
    systems,
    variations satisfies readonly FeatureVariation[],
  );
}

type Placed = { readonly region: SwapRegion; readonly lookups: readonly number[] };

/**
 * Every region a record is needed for, the overlaps ahead of what they overlap.
 *
 * Built up one region at a time: each new region meets every region already
 * listed, and each meeting that is not empty is a region where both sets of
 * lookups apply.
 */
export function overlay(regions: readonly Placed[]): Placed[] {
  let out: { region: SwapRegion; lookups: number[]; depth: number }[] = [];
  const keyOf = (p: { region: SwapRegion; lookups: readonly number[] }): string =>
    JSON.stringify([
      [...p.region].sort((a, b) => a.axis - b.axis),
      [...p.lookups].sort((a, b) => a - b),
    ]);

  for (const next of regions) {
    const met = out.flatMap((e) => {
      const region = intersect(e.region, next.region);
      if (region === null) return [];
      const lookups = [...new Set([...e.lookups, ...next.lookups])].sort((a, b) => a - b);
      return [{ region, lookups, depth: e.depth + 1 }];
    });
    out = [...out, ...met, { region: next.region, lookups: [...next.lookups], depth: 1 }];
  }

  const seen = new Set<string>();
  return out
    .map((p, i) => ({ ...p, i }))
    .sort((one, two) => two.depth - one.depth || one.i - two.i)
    .filter((p) => {
      const key = keyOf(p);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ region, lookups }) => ({ region, lookups }));
}

function intersect(one: SwapRegion, two: SwapRegion): SwapRegion | null {
  const axes = new Set([...one.map((c) => c.axis), ...two.map((c) => c.axis)]);
  const out: { axis: number; min: number; max: number }[] = [];
  for (const axis of [...axes].sort((a, b) => a - b)) {
    const a = one.find((c) => c.axis === axis) ?? { min: -1, max: 1 };
    const b = two.find((c) => c.axis === axis) ?? { min: -1, max: 1 };
    const min = Math.max(a.min, b.min);
    const max = Math.min(a.max, b.max);
    if (min > max) return null;
    out.push({ axis, min, max });
  }
  return out;
}
