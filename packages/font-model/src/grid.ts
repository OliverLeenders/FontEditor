/**
 * The grid a font is drawn on.
 *
 * Every font is drawn on one: a point lands on whole units, which is a grid of
 * one. An icon font is drawn on a coarser one — a 24 pixel icon on a 960 unit
 * em is drawn on a grid of 40, and a point between two lines of it is a blurred
 * edge at the size the icon is meant for. So the grid is the font's, written
 * into its source, and the same on every machine it is opened on: drawing an
 * icon on somebody else's grid is drawing a different icon.
 *
 * Neither UFO nor OpenType has a field for it, so it is kept in the lib under
 * this editor's name. Nothing compiled from the font knows it was there.
 */
export type Grid = {
  /**
   * The distance between two lines, in units: what a point snaps to and what
   * the finest lines are drawn at. May be fractional, where the em is not a
   * multiple of the size an icon is drawn for.
   */
  readonly step: number;
  /**
   * Every how many steps a line is drawn stronger — the pixel of an icon drawn
   * on a half-pixel grid, the eight-unit block of a pixel font — or `0` for
   * none.
   */
  readonly major: number;
};

/** Whole units, which is what a font is drawn on unless it says otherwise. */
export const DEFAULT_GRID: Grid = { step: 1, major: 0 };

/** The smallest step a grid may have: below this it is not a grid but noise. */
export const MIN_GRID_STEP = 0.01;

/** Whether the grid is the one every font has anyway. */
export function isDefaultGrid(grid: Grid): boolean {
  return grid.step === DEFAULT_GRID.step && grid.major === DEFAULT_GRID.major;
}

/**
 * A grid as asked for, made sound: a step that is a positive number, and a
 * major spacing that is a whole number of steps or nothing. `null` where the
 * step cannot be one at all.
 */
export function grid(step: number, major = 0): Grid | null {
  if (!Number.isFinite(step) || step < MIN_GRID_STEP) return null;
  const every = Number.isFinite(major) && major >= 2 ? Math.round(major) : 0;
  return { step, major: every };
}

/**
 * The grid of an icon drawn `pixels` pixels square on this em, split into
 * `parts` per pixel: one line per pixel at `1`, and a line on each half pixel
 * at `2`, with the pixel's line drawn stronger.
 *
 * The step is fractional wherever the em is not a multiple of the pixels — a
 * 24 pixel icon on 1000 units is 41.67 units to the pixel — which a designer
 * may well want to change the em for; see {@link isWholeStep}.
 */
export function iconGrid(unitsPerEm: number, pixels: number, parts = 1): Grid | null {
  if (pixels <= 0 || parts <= 0) return null;
  return grid(unitsPerEm / pixels / parts, parts > 1 ? parts : 0);
}

/**
 * The em nearest this one on which an icon of `pixels` has a whole, round
 * pixel: a step of ten units or a multiple of ten where the pixel is that big,
 * so a 24 pixel icon on 1000 units suggests 960 (40 to the pixel) rather than
 * 1008 (42), and halves and quarters of the pixel stay whole too.
 */
export function iconEm(unitsPerEm: number, pixels: number): number {
  const raw = unitsPerEm / pixels;
  const step = raw >= 10 ? Math.round(raw / 10) * 10 : Math.max(1, Math.round(raw));
  return step * pixels;
}

/** Whether a grid's lines fall on whole units, which a compiled font's points must. */
export function isWholeStep(grid: Grid): boolean {
  return Math.abs(grid.step - Math.round(grid.step)) < 1e-9;
}
