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
 *
 * The three numbers are where the drawings are — the *design* coordinates a
 * master's location is given in. What somebody choosing a weight from a menu
 * sees is the *user* scale, and the two are not always the same: a family drawn
 * with stems of 20, 80 and 220 units says Thin, Regular and Black are at those
 * stems, and its map says they are 100, 400 and 900 to anyone asking for a
 * weight. Kept in design coordinates here because everything that interpolates
 * works in them, so a map changes what the font tells the world and nothing
 * about how a letter is worked out. Without a map the two scales are the same.
 */
export type Axis = {
  readonly tag: string;
  readonly name: string;
  readonly min: number;
  readonly default: number;
  readonly max: number;
  /**
   * The user scale against the design scale, as pairs, when they differ.
   *
   * Absent for the ordinary axis, where a weight of 700 is drawn at 700.
   * Between the pairs the scales are straight lines, which is what a
   * designspace's `<map>` and a font's `avar` both mean.
   */
  readonly map?: AxisMap;
  /**
   * The stops of an axis with nothing between them, in design coordinates.
   *
   * An italic that is drawn upright and italic and never halfway: a designspace
   * says so, and a variable font cannot vary along it. Absent for an axis that
   * is continuous, which nearly all of them are.
   */
  readonly values?: readonly number[];
  /** What the file said about this axis that the model does not read. */
  readonly kept?: KeptXml;
};

/** `[user, design]` pairs, in the order the file gave them. */
export type AxisMap = readonly (readonly [user: number, design: number])[];

/**
 * Part of a designspace nobody here reads, kept to be written back.
 *
 * The attributes on the element and its child elements, as XML. Labels, a
 * `lib`, PostScript names for an instance, the variable fonts a version 5 file
 * describes: somebody's data, carried the way a `.glif`'s unread elements are.
 */
export type KeptXml = {
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly string[];
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
  /**
   * Where a master that draws only some glyphs keeps them.
   *
   * A family whose bold `$` needs a third drawing halfway along does not need a
   * third whole font for it: the extra drawing is a layer of an existing
   * master's UFO, with the few glyphs that need it and nothing else. Every other
   * glyph is worked out as if this master were not there.
   */
  readonly sparse?: SparseSource;
  readonly kept?: KeptXml;
};

/** A master drawn as a layer of another master's source. */
export type SparseSource = {
  /** The master whose UFO the layer is in. */
  readonly of: MasterId;
  /** The layer's name in that UFO. */
  readonly layer: string;
  /** The directory the layer was read from, so it is written back to the same one. */
  readonly directory?: string;
  /** The layer's `layerinfo.plist`, when it had one: a colour, a lib. Carried unread. */
  readonly layerInfo?: string;
};

export type InstanceId = string;

/**
 * A style the family is meant to have, at a place between the masters.
 *
 * A designspace is masters *and* the instances drawn between them, and the two
 * are different in kind. A master is a drawing somebody made and every glyph in
 * it is theirs. An instance is a name and a location — Light at 300, Semibold
 * at 600 — and what it looks like is worked out. There is nothing to draw in
 * one, which is why it has no source.
 *
 * They are what the menu in a word processor lists, and until they exist a
 * variable font can only offer its own corners: the four extremes a two-axis
 * family is drawn at, which is not what anybody calls a style.
 *
 * `familyName` is empty for the ordinary case, where the instance belongs to
 * the family it was designed in. A family that splits — a Condensed sold under
 * its own name — says so here.
 */
export type Instance = {
  readonly id: InstanceId;
  /** The style name: Light, Bold Italic, Condensed Medium. */
  readonly name: string;
  readonly location: Location;
  readonly familyName: string;
  readonly kept?: KeptXml;
};

export function instance(
  id: InstanceId,
  name: string,
  location: Location = {},
  familyName = "",
): Instance {
  return { id, name, location, familyName };
}

export function axis(tag: string, name: string, min: number, value: number, max: number): Axis {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return { tag, name, min: low, max: high, default: clamp(value, low, high) };
}

export function master(id: MasterId, name: string, location: Location = {}): Master {
  return { id, name, location };
}

/** Whether a master draws only some of the glyphs. */
export const isSparse = (m: Master): boolean => m.sparse !== undefined;

/** Whether an axis has stops rather than a range. */
export const isDiscrete = (a: Axis): boolean => a.values !== undefined;

/**
 * A value on the user scale, on the design scale.
 *
 * Straight between the pairs, and past the ends carried on at the offset of the
 * nearest one — which is what fontTools does, and so what every build does with
 * a value somebody put outside the map.
 */
export function toDesign(a: Axis, user: number): number {
  return piecewise(a.map ?? [], user);
}

/** A value on the design scale, on the user scale. The same map, read backwards. */
export function toUser(a: Axis, design: number): number {
  return piecewise(
    (a.map ?? []).map(([user, at]) => [at, user] as const),
    design,
  );
}

/** The axis's range as a menu offers it. */
export function userRange(a: Axis): { min: number; default: number; max: number } {
  return { min: toUser(a, a.min), default: toUser(a, a.default), max: toUser(a, a.max) };
}

/** A location in design coordinates, on the user scale. */
export function userLocation(axes: readonly Axis[], location: Location): Location {
  const at: Record<string, number> = {};
  for (const a of axes) at[a.tag] = toUser(a, location[a.tag] ?? a.default);
  return at;
}

/**
 * What a font's `avar` says about one axis, or `null` where it has nothing to.
 *
 * The map again, on the −1 to 1 scale both ends of it are normalised to: the
 * user scale by the user range, the design scale by the design range. Always
 * holding −1, 0 and 1 — the format requires them — and nothing else where the
 * map is straight, which is when an axis needs no entry at all.
 */
export function avarSegments(a: Axis): (readonly [number, number])[] | null {
  if (a.map === undefined || a.map.length === 0) return null;

  const user = userRange(a);
  const pairs = new Map<number, number>([
    [-1, -1],
    [0, 0],
    [1, 1],
  ]);
  for (const [u, d] of a.map) {
    const from = normalisedValue(user, u);
    const to = normalisedValue(a, d);
    pairs.set(from, to);
  }

  const out = [...pairs.entries()].sort((one, two) => one[0] - two[0]);
  return out.every(([from, to]) => Math.abs(from - to) < 1e-9) ? null : out;
}

/** One value on the −1 to 1 scale of a range. */
function normalisedValue(
  range: { min: number; default: number; max: number },
  value: number,
): number {
  const v = clamp(value, range.min, range.max);
  if (v === range.default) return 0;
  if (v < range.default) {
    return range.min === range.default ? 0 : -(range.default - v) / (range.default - range.min);
  }
  return range.max === range.default ? 0 : (v - range.default) / (range.max - range.default);
}

function piecewise(pairs: readonly (readonly [number, number])[], value: number): number {
  if (pairs.length === 0) return value;

  const sorted = [...pairs].sort((one, two) => one[0] - two[0]);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (value <= first[0]) return value + first[1] - first[0];
  if (value >= last[0]) return value + last[1] - last[0];

  for (let i = 1; i < sorted.length; i++) {
    const [x1, y1] = sorted[i]!;
    if (value > x1) continue;
    const [x0, y0] = sorted[i - 1]!;
    if (value === x1) return y1;
    return y0 + ((value - x0) * (y1 - y0)) / (x1 - x0);
  }
  return value;
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
 *
 * Written for anything placed on the axes rather than for masters alone: the
 * instances want the same order for the same reason, and the sort has nothing
 * to say about which of the two it is looking at.
 */
export function inAxisOrder<T extends { readonly name: string; readonly location: Location }>(
  axes: readonly Axis[],
  masters: readonly T[],
): T[] {
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
