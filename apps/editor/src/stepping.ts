/**
 * What a step button does to a number.
 *
 * Apart from the button so it can be checked without one. The arithmetic is
 * where the mistakes are: a quarter-unit step on a floating-point value walks
 * off the grid after four presses, and a clamp applied before rounding lets a
 * value sit just outside its own range.
 */

export type StepBounds = {
  readonly min?: number;
  readonly max?: number;
};

/**
 * The value one press away, snapped to the step's own grid.
 *
 * Snapping rather than adding: 2 + 0.25 four times is 2.9999999999999996, and a
 * field showing "3.00" that is not three is a field that will disagree with a
 * comparison somewhere later. Rounding to the grid also means a value that was
 * off it — typed, or from an older file — steps onto it rather than carrying its
 * offset along forever.
 */
export function stepValue(
  value: number,
  step: number,
  direction: 1 | -1,
  bounds: StepBounds = {},
): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;

  const grid = Math.round((value / step + Number.EPSILON) * 1e6) / 1e6;
  // From where it is, not from where it would round to: a press must always
  // move, and a value already on the grid must move exactly one step.
  const next = (direction > 0 ? Math.floor(grid) + 1 : Math.ceil(grid) - 1) * step;

  // Rounded before clamping, so a bound that is not on the grid is still
  // honoured exactly — a maximum of 6 stays 6 rather than becoming 6.25.
  const settled = Math.round(next * 1e6) / 1e6;
  const low = bounds.min ?? Number.NEGATIVE_INFINITY;
  const high = bounds.max ?? Number.POSITIVE_INFINITY;
  return Math.min(high, Math.max(low, settled));
}

/** Whether stepping that way would change anything, for greying the button. */
export function canStep(
  value: number,
  step: number,
  direction: 1 | -1,
  bounds: StepBounds = {},
): boolean {
  return stepValue(value, step, direction, bounds) !== value;
}
