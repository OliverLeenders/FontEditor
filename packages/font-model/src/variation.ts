import type { Axis, Location } from "./designspace.js";
import { normalised } from "./designspace.js";

/**
 * How much each master counts, anywhere in the designspace.
 *
 * The obvious answer — take the two masters either side and mix them — is right
 * for one axis and says nothing for two. With a weight axis and a width axis
 * and four masters at the corners, a point in the middle is not between any
 * pair of them.
 *
 * So this is the model a variable font itself uses. Each master is given a
 * *region* of the space it has any say in: it counts fully at its own location,
 * fades to nothing by the time it reaches its neighbours, and counts for
 * nothing outside. Everywhere in the space, the regions add up to one, and the
 * masters reproduce themselves exactly at their own locations.
 *
 * Doing it this way rather than the easy way costs a page of arithmetic and
 * buys the thing that matters: what the preview shows is what the exported
 * font will draw, because it is worked out the same way.
 */

/** One master's say along one axis: full at the peak, nothing at the ends. */
export type Region = { readonly min: number; readonly peak: number; readonly max: number };

/** Where a master has any say, by axis tag. Axes it does not name are ignored. */
export type Support = Readonly<Record<string, Region>>;

/**
 * How much a master counts at a location: 1 at its peak, 0 outside its region.
 *
 * Multiplied across the axes, which is what makes a master at a corner of a
 * two-axis space fade out along both edges rather than along one.
 */
export function supportScalar(support: Support, at: Location): number {
  let scalar = 1;

  for (const [tag, region] of Object.entries(support)) {
    const { min, peak, max } = region;
    // A peak of zero means this master says nothing about this axis — it sits
    // at the default there, and moving along it does not diminish the master.
    if (peak === 0) continue;

    const value = at[tag] ?? 0;
    if (value === peak) continue;
    if (value <= min || value >= max) return 0;

    scalar *= value < peak ? (value - min) / (peak - min) : (max - value) / (max - peak);
  }

  return scalar;
}

/**
 * The region each master has a say in, given where all of them are.
 *
 * A master's region along an axis runs from the nearest other peak below it to
 * the nearest above, and to the default where there is none — so masters divide
 * the axis between them and nobody reaches past a neighbour. Masters at the
 * default itself get a region of nothing, since they are the base everything
 * else is measured from.
 */
export function supportsFor(axes: readonly Axis[], locations: readonly Location[]): Support[] {
  const at = locations.map((location) => normalised(axes, location));

  return at.map((here, i) => {
    const support: Record<string, Region> = {};

    for (const a of axes) {
      const peak = here[a.tag] ?? 0;
      if (peak === 0) continue;

      // The whole half of the axis the master is in, before its neighbours
      // take their share of it.
      let min = peak < 0 ? -1 : 0;
      let max = peak > 0 ? 1 : 0;

      for (const [j, other] of at.entries()) {
        if (j === i) continue;

        // Only masters that agree with this one everywhere else can crowd it:
        // a master somewhere off the axis is describing a different part of the
        // space and has no say in where this one's region ends.
        if (!agreesElsewhere(axes, here, other, a.tag)) continue;

        // Narrowed from both sides: a master between this one and the default
        // ends its reach just as surely as one beyond it. Leaving the near side
        // alone was the bug that let a black at 900 still count for something
        // at 400 with a semibold sitting in between.
        const there = other[a.tag] ?? 0;
        if (peak > 0) {
          if (there > peak && there < max) max = there;
          if (there >= 0 && there < peak && there > min) min = there;
        } else {
          if (there < peak && there > min) min = there;
          if (there <= 0 && there > peak && there < max) max = there;
        }
      }

      support[a.tag] = { min, peak, max };
    }

    return support;
  });
}

/**
 * How much each master counts at a location, in the order they were given.
 *
 * The weights add up to one, and at a master's own location that master gets
 * one and everything else gets nothing — which is the property the whole model
 * exists for: a designspace has to reproduce the drawings it was made from.
 *
 * Worked out by the same iteration a variable font's deltas are: each master in
 * turn contributes what the ones before it have not already accounted for. Done
 * on the masters themselves rather than on a glyph, so the answer is a handful
 * of numbers that can then be applied to anything — an outline, an advance, a
 * kerning pair.
 */
export function masterWeights(
  axes: readonly Axis[],
  locations: readonly Location[],
  at: Location,
): number[] {
  const count = locations.length;
  if (count === 0) return [];
  if (count === 1) return [1];

  const supports = supportsFor(axes, locations);
  const here = normalised(axes, at);
  const there = locations.map((location) => normalised(axes, location));

  // Masters nearest the default first: a master's delta is what is left after
  // the ones that already cover its location have had their say, so they have
  // to be worked out first.
  const order = supports
    .map((support, i) => ({ i, reach: Object.keys(support).length, support }))
    .sort((one, two) => one.reach - two.reach || one.i - two.i);

  // One delta per master, as a vector of weights on the masters themselves.
  const deltas = locations.map(() => new Array<number>(count).fill(0));

  for (const { i } of order) {
    const delta = deltas[i];
    if (delta === undefined) continue;

    // What this master is, minus what the model already says at its location.
    delta[i] = 1;
    const own = there[i] ?? {};
    for (const { i: j } of order) {
      if (j === i) continue;
      const otherSupport = supports[j];
      const otherDelta = deltas[j];
      if (otherSupport === undefined || otherDelta === undefined) continue;

      const scalar = supportScalar(otherSupport, own);
      if (scalar === 0) continue;
      for (let k = 0; k < count; k++) delta[k] = (delta[k] ?? 0) - (otherDelta[k] ?? 0) * scalar;
    }
  }

  // And the instance: every delta, as far as it reaches here.
  const weights = new Array<number>(count).fill(0);
  for (const [i, support] of supports.entries()) {
    const scalar = supportScalar(support, here);
    if (scalar === 0) continue;

    const delta = deltas[i];
    if (delta === undefined) continue;
    for (let k = 0; k < count; k++) weights[k] = (weights[k] ?? 0) + (delta[k] ?? 0) * scalar;
  }

  return weights;
}

/** Whether two locations agree on every axis but one. */
function agreesElsewhere(
  axes: readonly Axis[],
  one: Location,
  two: Location,
  except: string,
): boolean {
  return axes.every((a) => a.tag === except || (one[a.tag] ?? 0) === (two[a.tag] ?? 0));
}
