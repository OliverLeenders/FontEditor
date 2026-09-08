/**
 * Axes, and the masters placed along them.
 *
 * A typeface with more than one weight is not several fonts that happen to look
 * alike: it is one design with a dimension, drawn at a few points along it and
 * worked out in between. The dimension is an *axis*, the drawings are
 * *masters*, and where each master sits on the axes is its *location*.
 *
 * This module is only the arrangement — what the axes are and where the masters
 * are on them. What a master actually contains is a `FontDocument`, unchanged
 * and complete: one master is one font. See `project.ts` for the two together.
 */

export type MasterId = string;

/**
 * A dimension of the design.
 *
 * The tag is four characters and is the name the format knows it by: `wght`,
 * `wdth`, `opsz`, `ital`, `slnt`, or a private one in capitals. The name is
 * what a person calls it.
 *
 * Three numbers rather than two, because the default is not always the middle:
 * a family drawn from Regular out to Black and back to Thin has its default at
 * 400 on a 100–900 axis, and everything that reads a location has to know which
 * end is home.
 */
export type Axis = {
  readonly tag: string;
  readonly name: string;
  readonly min: number;
  readonly default: number;
  readonly max: number;
};

/** Where something sits on the axes, by tag. */
export type Location = Readonly<Record<string, number>>;

/**
 * One drawing of the whole typeface, and where it belongs.
 *
 * The id rather than the name is what everything else refers to, so that
 * renaming a master — which people do, often, late — does not detach every
 * glyph drawn in it.
 */
export type Master = {
  readonly id: MasterId;
  readonly name: string;
  readonly location: Location;
};

export function axis(tag: string, name: string, min: number, value: number, max: number): Axis {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return { tag, name, min: low, max: high, default: clamp(value, low, high) };
}

export function master(id: MasterId, name: string, location: Location = {}): Master {
  return { id, name, location };
}

/** The weight axis, which is the one nearly every family has. */
export const WEIGHT: Axis = axis("wght", "Weight", 100, 400, 900);

/** Home: every axis at its default. Where a font with one master sits. */
export function defaultLocation(axes: readonly Axis[]): Location {
  const at: Record<string, number> = {};
  for (const a of axes) at[a.tag] = a.default;
  return at;
}

/**
 * A location with every axis accounted for, and nothing outside its range.
 *
 * A location that omits an axis means "at the default there", which is how
 * designspace files are usually written; a location naming an axis the font
 * does not have is somebody's leftover and is dropped rather than kept.
 */
export function settledLocation(axes: readonly Axis[], location: Location): Location {
  const at: Record<string, number> = {};
  for (const a of axes) at[a.tag] = clamp(location[a.tag] ?? a.default, a.min, a.max);
  return at;
}

/**
 * A location on the scale interpolation works in: −1 at the minimum, 0 at the
 * default, 1 at the maximum.
 *
 * The two halves are scaled separately, because the default need not be in the
 * middle: on a 100–400–900 axis, 250 is halfway to the minimum and 650 is
 * halfway to the maximum, and a single linear map would say neither.
 */
export function normalised(axes: readonly Axis[], location: Location): Location {
  const at: Record<string, number> = {};
  for (const a of axes) {
    const value = clamp(location[a.tag] ?? a.default, a.min, a.max);
    if (value === a.default) at[a.tag] = 0;
    else if (value < a.default)
      at[a.tag] = a.min === a.default ? 0 : -(a.default - value) / (a.default - a.min);
    else at[a.tag] = a.max === a.default ? 0 : (value - a.default) / (a.max - a.default);
  }
  return at;
}

/** Whether two masters are in the same place, which no two of them may be. */
export function sameLocation(axes: readonly Axis[], one: Location, two: Location): boolean {
  return axes.every((a) => (one[a.tag] ?? a.default) === (two[a.tag] ?? a.default));
}

/**
 * The masters in the order a person thinks of them: lightest first.
 *
 * By the first axis, then the second, and so on. A designspace has no order of
 * its own — it is a set of points in a space — so any list of masters shown to
 * somebody has to invent one, and "along the axes" is the only one that is
 * about the design rather than about when they were made.
 */
export function inAxisOrder(axes: readonly Axis[], masters: readonly Master[]): Master[] {
  return [...masters].sort((one, two) => {
    for (const a of axes) {
      const difference = (one.location[a.tag] ?? a.default) - (two.location[a.tag] ?? a.default);
      if (difference !== 0) return difference;
    }
    return one.name.localeCompare(two.name);
  });
}

/** How a location reads: `Weight 700`, or `Weight 700 · Width 75`. */
export function describeLocation(axes: readonly Axis[], location: Location): string {
  return axes.map((a) => `${a.name} ${String(location[a.tag] ?? a.default)}`).join(" · ");
}

/**
 * Declared rather than assigned, because `WEIGHT` above is built at module load
 * and would otherwise reach for this before it exists.
 */
function clamp(value: number, low: number, high: number): number {
  return Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : low;
}
