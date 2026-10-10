import { type Cubic, type Vec2, lineAsCubic, reverseLoop } from "@typewright/geometry";

/**
 * A serif on the end of a stroke.
 *
 * A stroke that is cut ends on a line. A serif stands on that line: it reaches
 * out past each edge of the stroke, is so high along the stroke, and comes back
 * into the stroke's edges square or round a curve. It is measured from the
 * stroke's own edges where the line crosses them, so a stem made heavier
 * carries its serif out with it and nothing is taken off or put back by hand.
 *
 * Seven numbers, and every serif there is a name for is some of them: a slab is
 * a reach and a height, a bracketed serif the same with a bracket, a wedge one
 * with a slope, a flag one with a reach on one side only.
 *
 * - `left` and `right` are the reach past the stroke's edge on each side, in
 *   units, as the serif is seen on the page: left is the side further left, or
 *   on a cut that stands upright the lower one.
 * - `height` is how far up the stroke the serif goes where it meets it.
 * - `bracket`, from nought to one, is how much of the corner between the serif
 *   and the stroke is a curve: none of it, or all the way out to the tip.
 * - `slope`, from nought to one, is how much thinner the serif is at its tip
 *   than at the stroke: nought a slab, one a wedge that comes to a point.
 * - `cup` is how far the middle of the serif's foot is hollowed, in units.
 * - `round`, from nought to one, is how much of the tip is rounded off: none,
 *   or the whole of it to a half circle.
 */
export type Serif = {
  readonly left: number;
  readonly right: number;
  readonly height: number;
  readonly bracket: number;
  readonly slope: number;
  readonly cup: number;
  readonly round: number;
};

/** The numbers of a serif, by name. */
export const SERIF_NUMBERS = [
  "left",
  "right",
  "height",
  "bracket",
  "slope",
  "cup",
  "round",
] as const;

export type SerifNumber = (typeof SERIF_NUMBERS)[number];

/** Which of a serif's numbers are a share of something, from nought to one, and not units. */
export const SERIF_SHARES: readonly SerifNumber[] = ["bracket", "slope", "round"];

/**
 * A serif the font has a name for.
 *
 * The font's own decision about what its serifs are, as its x-height is one:
 * a foot, a head, a flag. An end of a stroke that has the style has its
 * numbers, and a style that is changed changes every end that has it.
 */
export type SerifStyle = Serif & { readonly name: string };

/**
 * The serif an end of a stroke has.
 *
 * Its numbers, which are what is drawn. `style` is the font's style they came
 * from, and `own` the numbers that were set on this end and are no longer the
 * style's: changing the style leaves those alone. Without a style the numbers
 * are all the end's own.
 */
export type EndSerif = Serif & {
  readonly style?: string;
  readonly own?: readonly SerifNumber[];
};

/** A serif to start from: a slab, a little wider than a stem is thick. */
export const DEFAULT_SERIF: Serif = {
  left: 60,
  right: 60,
  height: 30,
  bracket: 0,
  slope: 0,
  cup: 0,
  round: 0,
};

/** Serifs to start a style from, by what they are called. */
export const SERIF_PRESETS: readonly SerifStyle[] = [
  { name: "Slab", left: 60, right: 60, height: 40, bracket: 0, slope: 0, cup: 0, round: 0 },
  { name: "Bracketed", left: 60, right: 60, height: 24, bracket: 0.7, slope: 0, cup: 4, round: 0 },
  { name: "Wedge", left: 70, right: 0, height: 60, bracket: 0, slope: 1, cup: 0, round: 0 },
  { name: "Hairline", left: 70, right: 70, height: 10, bracket: 0, slope: 0, cup: 0, round: 0 },
];

/** A serif's numbers made sound: no reach or height below nothing, each share within its range. */
export function soundSerif(serif: Serif): Serif {
  const length = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);
  const share = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
  return {
    left: length(serif.left),
    right: length(serif.right),
    height: length(serif.height),
    bracket: share(serif.bracket),
    slope: share(serif.slope),
    cup: length(serif.cup),
    round: share(serif.round),
  };
}

/** Whether two serifs are the same numbers. */
export function sameSerif(a: Serif, b: Serif): boolean {
  return SERIF_NUMBERS.every((key) => a[key] === b[key]);
}

/** A serif's numbers alone, without whatever else was carried with them. */
export function serifNumbers(serif: Serif): Serif {
  return {
    left: serif.left,
    right: serif.right,
    height: serif.height,
    bracket: serif.bracket,
    slope: serif.slope,
    cup: serif.cup,
    round: serif.round,
  };
}

/** A serif read from something written down: its numbers, absent ones the default's. */
export function readSerif(raw: unknown): Serif | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const from = raw as Record<string, unknown>;
  const said = (key: SerifNumber): number => {
    const value = from[key];
    return typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_SERIF[key];
  };
  return soundSerif({
    left: said("left"),
    right: said("right"),
    height: said("height"),
    bracket: said("bracket"),
    slope: said("slope"),
    cup: said("cup"),
    round: said("round"),
  });
}

/** An end's serif read from something written down. */
export function readEndSerif(raw: unknown): EndSerif | undefined {
  const numbers = readSerif(raw);
  if (numbers === undefined) return undefined;
  const from = raw as Record<string, unknown>;
  const style = typeof from["style"] === "string" && from["style"] !== "" ? from["style"] : null;
  const own = Array.isArray(from["own"])
    ? SERIF_NUMBERS.filter((key) => (from["own"] as unknown[]).includes(key))
    : [];
  return {
    ...numbers,
    ...(style === null ? {} : { style }),
    ...(style === null || own.length === 0 ? {} : { own }),
  };
}

/** A font's serif styles read from something written down: the sound ones, one to a name. */
export function readSerifStyles(raw: unknown): SerifStyle[] {
  if (!Array.isArray(raw)) return [];
  const out: SerifStyle[] = [];
  for (const entry of raw) {
    const numbers = readSerif(entry);
    const name = (entry as Record<string, unknown> | null)?.["name"];
    if (numbers === undefined || typeof name !== "string" || name.trim() === "") continue;
    if (out.some((style) => style.name === name.trim())) continue;
    out.push({ name: name.trim(), ...numbers });
  }
  return out;
}

/**
 * An end's serif as a style has it now: the style's numbers, but for the ones
 * that are the end's own.
 */
export function restyled(serif: EndSerif, style: SerifStyle): EndSerif {
  const own = serif.own ?? [];
  const numbers = { ...serifNumbers(style) };
  for (const key of own) numbers[key] = serif[key];
  return { ...numbers, style: style.name, ...(own.length === 0 ? {} : { own }) };
}

/** An end's serif with one number set on it, which is the end's own from then on. */
export function withSerifNumber(serif: EndSerif, key: SerifNumber, value: number): EndSerif {
  const numbers = soundSerif({ ...serifNumbers(serif), [key]: value });
  if (serif.style === undefined) return numbers;
  const own = SERIF_NUMBERS.filter((k) => k === key || (serif.own ?? []).includes(k));
  return { ...numbers, style: serif.style, own };
}

/**
 * Where a serif stands: the line it stands on, and the stroke it is on the end
 * of.
 *
 * `through` is a point of the line and `normal` the way the line faces, away
 * from the stroke. `foot` is where the line crosses the stroke's two edges and
 * `top` where a line `rise` further up the stroke does, each as two distances
 * along the line from `through` — along it a quarter turn anticlockwise of
 * `normal`.
 */
export type SerifSeat = {
  readonly through: Vec2;
  readonly normal: Vec2;
  readonly foot: { readonly from: number; readonly to: number };
  readonly top: { readonly from: number; readonly to: number };
  readonly rise: number;
};

/**
 * How far up the stroke a serif goes altogether: its height, and above that as
 * far as the longer of its two brackets runs up the stroke's edge.
 */
export function serifRise(serif: Serif): number {
  const s = soundSerif(serif);
  const tip = s.height * (1 - s.slope);
  const run = (reach: number): number => {
    const rounded = Math.min((s.round * tip) / 2, reach);
    return s.bracket * Math.max(0, reach - rounded);
  };
  return s.height + Math.max(run(s.left), run(s.right));
}

/**
 * How far short of the line the stroke is stopped where its serif is laid over
 * its end, not joined to it: past the hollow of a cupped foot, and well inside
 * the serif, so that no edge of the one lies along an edge of the other.
 */
export function serifInset(serif: Serif): number {
  const s = soundSerif(serif);
  return Math.max(Math.min(s.cup, s.height * CUP_MOST), s.height / 2);
}

/** The most of a serif's height its foot may be hollowed by. */
const CUP_MOST = 0.75;

/** How far along the way to a corner a curve's handles reach to round it as a circle does. */
const ROUND = 0.5523;

/** One piece of a serif's outline, and whether it is a straight line by what it is. */
export type SerifPiece = { readonly curve: Cubic; readonly line: boolean };

/**
 * The outline of a serif: fourteen pieces, whatever its numbers.
 *
 * Along the foot from the left tip to the right; up round the right tip; in
 * along the top to the stroke and up its edge round the bracket; across the
 * stroke at the top of the serif; and down the left side the same way. A piece
 * that a number makes nothing of — the round of a square tip, the bracket of a
 * slab — is there with no length, so two serifs with different numbers have
 * the same pieces, which is what a variable font wants of them.
 *
 * Turned anticlockwise, as ink is. `null` for a serif with no height, or one
 * standing on a stroke of no width.
 */
export function serifOutline(serif: Serif, seat: SerifSeat): SerifPiece[] | null {
  const s = soundSerif(serif);
  if (!(s.height > 0) || !(seat.rise > 0)) return null;
  if (!(seat.foot.to - seat.foot.from > 1e-6)) return null;

  const along = { x: -seat.normal.y, y: seat.normal.x };
  // Left and right as they are on the page: a foot's line runs rightwards, a
  // head's leftwards, and both have a left serif on the left.
  const flipped = along.x < -1e-9 || (Math.abs(along.x) <= 1e-9 && along.y < 0);
  const v = flipped ? { x: -along.x, y: -along.y } : along;
  const up = { x: -seat.normal.x, y: -seat.normal.y };
  const at = (a: number, h: number): Vec2 => ({
    x: seat.through.x + v.x * a + up.x * h,
    y: seat.through.y + v.y * a + up.y * h,
  });
  const span = (c: { from: number; to: number }): [number, number] =>
    flipped ? [-c.to, -c.from] : [c.from, c.to];
  const [footLeft, footRight] = span(seat.foot);
  const [topLeft, topRight] = span(seat.top);

  const tip = s.height * (1 - s.slope);
  const width = footRight - footLeft + s.left + s.right;
  // A foot hollowed deeper than a thin tip is thick would come through the
  // top of the serif on its way up: no deeper than the top rises there.
  let cup = Math.min(s.cup, s.height * CUP_MOST);
  for (const reach of [s.left, s.right]) {
    if (reach > 0 && tip < cup) {
      cup = Math.min(cup, Math.max(tip, (width * (s.height - tip)) / (4 * reach)));
    }
  }

  /**
   * One side, from the end of the foot up to the top of the serif on the
   * stroke's edge: six pieces. `out` is which way is outward, as a sign.
   */
  const side = (reach: number, foot: number, top: number, out: 1 | -1): SerifPiece[] => {
    const edge = (h: number): Vec2 => at(foot + ((top - foot) * h) / seat.rise, h);
    const hasReach = reach > 1e-9;
    const corner = hasReach ? at(foot + out * reach, 0) : edge(0);
    const tipTop = hasReach ? at(foot + out * reach, tip) : edge(tip);
    const meets = edge(s.height);
    const rounded = Math.min((s.round * tip) / 2, reach);
    const towards = (from: Vec2, to: Vec2, by: number): Vec2 => {
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      if (!(length > 1e-12)) return from;
      const k = Math.min(by, length) / length;
      return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
    };
    const rounding = (a: Vec2, round: Vec2, b: Vec2): SerifPiece => ({
      curve: {
        a,
        c1: { x: a.x + (round.x - a.x) * ROUND, y: a.y + (round.y - a.y) * ROUND },
        c2: { x: b.x + (round.x - b.x) * ROUND, y: b.y + (round.y - b.y) * ROUND },
        b,
      },
      line: false,
    });
    const line = (a: Vec2, b: Vec2): SerifPiece => ({ curve: lineAsCubic(a, b), line: true });

    const footEnd = towards(corner, at(foot, 0), rounded);
    const tipFrom = towards(corner, tipTop, rounded);
    const tipTo = towards(tipTop, corner, rounded);
    const topLength = Math.hypot(meets.x - tipTop.x, meets.y - tipTop.y);
    const topRounded = Math.min(rounded, topLength);
    const topFrom = towards(tipTop, meets, topRounded);
    const run = s.bracket * Math.max(0, topLength - topRounded);
    const bracketFrom = towards(meets, tipTop, run);
    const bracketTo = edge(Math.min(seat.rise, s.height + run));
    return [
      rounding(footEnd, corner, tipFrom),
      line(tipFrom, tipTo),
      rounding(tipTo, tipTop, topFrom),
      line(topFrom, bracketFrom),
      rounding(bracketFrom, meets, bracketTo),
      line(bracketTo, edge(seat.rise)),
    ];
  };

  const right = side(s.right, footRight, topRight, 1);
  const left = side(s.left, footLeft, topLeft, -1);
  const footFrom = left[0]!.curve.a;
  const footTo = right[0]!.curve.a;
  const lift = (cup * 4) / 3;
  const footPiece: SerifPiece = {
    curve: {
      a: footFrom,
      c1: {
        x: footFrom.x + (footTo.x - footFrom.x) / 3 + up.x * lift,
        y: footFrom.y + (footTo.y - footFrom.y) / 3 + up.y * lift,
      },
      c2: {
        x: footFrom.x + ((footTo.x - footFrom.x) * 2) / 3 + up.x * lift,
        y: footFrom.y + ((footTo.y - footFrom.y) * 2) / 3 + up.y * lift,
      },
      b: footTo,
    },
    line: false,
  };
  const across: SerifPiece = {
    curve: lineAsCubic(right[5]!.curve.b, left[5]!.curve.b),
    line: true,
  };
  const down = reverseLoop(left.map((piece) => piece.curve)).map((curve, k) => ({
    curve,
    line: left[left.length - 1 - k]!.line,
  }));
  const loop = [footPiece, ...right, across, ...down];
  // Anticlockwise where the line's rightward way and the way up the stroke are
  // a quarter turn anticlockwise apart; a head serif's are the other way.
  const turned = v.x * up.y - v.y * up.x > 0;
  if (turned) return loop;
  return reverseLoop(loop.map((piece) => piece.curve)).map((curve, k) => ({
    curve,
    line: loop[loop.length - 1 - k]!.line,
  }));
}
