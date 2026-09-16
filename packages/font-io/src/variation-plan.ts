import type { Axis, Location, Support } from "@typewright/font-model";
import { variationModel } from "@typewright/font-model";

/**
 * Which regions each glyph of a variable font varies over, and by how much.
 *
 * In a family where every master draws every glyph this is one answer for the
 * whole font: the regions of the designspace, and for each a delta that is a
 * fixed sum over the masters. A master that draws only some glyphs changes that
 * glyph by glyph — the `$` that has a third drawing halfway along varies over
 * three regions, and the `a` beside it over two, and not over the same two,
 * because the black's region reaches back to the regular where there is no
 * middle master to stop it.
 *
 * So the model is worked out once for each set of masters that draws a glyph,
 * and the regions of all of them are gathered into the one list a font has.
 * A glyph refers to the ones that are its own.
 */

export type GlyphVariationPlan = {
  /** Indices into the plan's regions, in the order this glyph's deltas are written. */
  readonly regions: readonly number[];
  /**
   * For each of those regions, what its delta is: one coefficient per master, so
   * that a delta is `Σ coefficients[k] × value in master k`. Zero for a master
   * that does not draw the glyph.
   */
  readonly coefficients: readonly (readonly number[])[];
  /** Which of the plan's region sets this glyph's regions are, for a format that shares them. */
  readonly set: number;
};

export type VariationPlan = {
  readonly regions: readonly Support[];
  /** The distinct lists of regions the glyphs vary over. The first is the full set's. */
  readonly sets: readonly (readonly number[])[];
  readonly glyphs: readonly GlyphVariationPlan[];
};

/**
 * Plan the variations of a font.
 *
 * `presence[g][m]` says whether master *m* takes part in glyph *g*. The first
 * master is the default: it takes part in every glyph, and every delta is
 * measured from it. A glyph only the default takes part in does not vary.
 */
export function planVariations(
  axes: readonly Axis[],
  locations: readonly Location[],
  presence: readonly (readonly boolean[])[],
): VariationPlan {
  const regions: Support[] = [];
  const regionKeys = new Map<string, number>();
  const sets: (readonly number[])[] = [];
  const setKeys = new Map<string, number>();
  const known = new Map<string, Omit<GlyphVariationPlan, "set"> & { set: number }>();

  const regionIndex = (support: Support): number => {
    const key = JSON.stringify(
      Object.keys(support)
        .sort()
        .map((tag) => [tag, support[tag]!.min, support[tag]!.peak, support[tag]!.max]),
    );
    let index = regionKeys.get(key);
    if (index === undefined) {
      index = regions.length;
      regions.push(support);
      regionKeys.set(key, index);
    }
    return index;
  };

  const setIndex = (list: readonly number[]): number => {
    const key = list.join(",");
    let index = setKeys.get(key);
    if (index === undefined) {
      index = sets.length;
      sets.push(list);
      setKeys.set(key, index);
    }
    return index;
  };

  const planFor = (present: readonly boolean[]): GlyphVariationPlan => {
    const key = present.map((p) => (p ? "1" : "0")).join("");
    const found = known.get(key);
    if (found !== undefined) return found;

    const chosen = locations.flatMap((_, m) => (m === 0 || present[m] === true ? [m] : []));
    const plan = { regions: [] as number[], coefficients: [] as number[][] };

    if (chosen.length > 1) {
      const { supports, deltas } = variationModel(
        axes,
        chosen.map((m) => locations[m] ?? {}),
      );
      for (const [n, support] of supports.entries()) {
        if (Object.keys(support).length === 0) continue;
        plan.regions.push(regionIndex(support));
        const row = new Array<number>(locations.length).fill(0);
        for (const [k, m] of chosen.entries()) row[m] = deltas[n]?.[k] ?? 0;
        plan.coefficients.push(row);
      }
    }

    const done = { ...plan, set: setIndex(plan.regions) };
    known.set(key, done);
    return done;
  };

  // The full set first, so that it is set 0 — the one a CFF2 charstring uses
  // without having to say so — and its regions are the first in the list.
  planFor(locations.map(() => true));
  const glyphs = presence.map(planFor);

  return { regions, sets, glyphs };
}

/** A value's deltas under a glyph's plan, given the value in every master. */
export function deltasOf(plan: GlyphVariationPlan, values: readonly number[]): number[] {
  return plan.coefficients.map((row) => row.reduce((sum, c, m) => sum + c * (values[m] ?? 0), 0));
}
