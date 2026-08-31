import type { Vec2 } from "@fonteditor/geometry";

/**
 * Where a drag is allowed to land.
 *
 * Two mechanisms, in strict order of precedence. A *line* catches the drag when
 * it comes within tolerance — the baseline, the x-height, the lines the renderer
 * already draws. A *grid* quantises whatever is left over, and is what stops an
 * ordinary drag writing coordinates like 342.7183 into a font whose every other
 * number is whole.
 *
 * Lines win because they are the intent: someone dragging a point to the
 * x-height wants the x-height exactly, not the nearest unit to it. And the
 * x-height is not obliged to be a whole number.
 */
export type Snapping = {
  /** Vertical lines, as x coordinates. */
  readonly xs: readonly number[];
  /** Horizontal lines, as y coordinates. */
  readonly ys: readonly number[];
  /**
   * Catch radius, in design units. The caller converts from screen pixels, so
   * the pull feels the same at every zoom rather than growing as you zoom out.
   */
  readonly tolerance: number;
  /**
   * Quantisation, in design units. 1 rounds to whole units; 0 leaves the value
   * alone, which is how snapping is switched off.
   */
  readonly grid: number;
};

/** Snapping that does nothing at all. */
export const NO_SNAPPING: Snapping = { xs: [], ys: [], tolerance: 0, grid: 0 };

/** How close to a line a drag has to come, in screen pixels. */
export const SNAP_PIXELS = 6;

/**
 * The correction that lands `v` on the nearest line, or `null` for none in range.
 *
 * Ties go to the first line listed, which is why {@link metricLines} puts the
 * baseline first: where the baseline and another line coincide, catching "the
 * baseline" is the more useful account of what happened.
 */
function pullTo(v: number, lines: readonly number[], tolerance: number): number | null {
  let best: number | null = null;
  for (const line of lines) {
    const correction = line - v;
    if (Math.abs(correction) > tolerance) continue;
    if (best === null || Math.abs(correction) < Math.abs(best)) best = correction;
  }
  return best;
}

function quantise(v: number, grid: number): number {
  return grid > 0 ? Math.round(v / grid) * grid : v;
}

/** Land a single point on a line if one is close, and on the grid otherwise. */
export function snapPoint(p: Vec2, snapping: Snapping): Vec2 {
  const dx = pullTo(p.x, snapping.xs, snapping.tolerance);
  const dy = pullTo(p.y, snapping.ys, snapping.tolerance);
  return {
    x: dx === null ? quantise(p.x, snapping.grid) : p.x + dx,
    y: dy === null ? quantise(p.y, snapping.grid) : p.y + dy,
  };
}

/**
 * Correct a drag's offset so the points it moves land well.
 *
 * The offset is corrected rather than each point placed, because the points move
 * as a body: dragging six points and having two of them jump onto a line while
 * the rest stay put would not be snapping, it would be a deformation. So every
 * moving point is offered to every line, and the single smallest correction
 * wins the axis — whichever point found it.
 *
 * When nothing is caught the *offset* is quantised, not the landing positions.
 * A drag then preserves whatever relationship the points had: from whole
 * coordinates it lands on whole coordinates, and a shape that was already
 * fractional is moved rather than silently reshaped.
 */
export function snapDelta(
  moving: readonly Vec2[],
  delta: Vec2,
  snapping: Snapping,
): Vec2 {
  let bestX: number | null = null;
  let bestY: number | null = null;

  for (const p of moving) {
    const dx = pullTo(p.x + delta.x, snapping.xs, snapping.tolerance);
    if (dx !== null && (bestX === null || Math.abs(dx) < Math.abs(bestX))) bestX = dx;

    const dy = pullTo(p.y + delta.y, snapping.ys, snapping.tolerance);
    if (dy !== null && (bestY === null || Math.abs(dy) < Math.abs(bestY))) bestY = dy;
  }

  return {
    x: bestX === null ? quantise(delta.x, snapping.grid) : delta.x + bestX,
    y: bestY === null ? quantise(delta.y, snapping.grid) : delta.y + bestY,
  };
}

/**
 * Put a lone measurement on the grid.
 *
 * For the drags that move a number rather than a point — an advance, a
 * sidebearing — where there is nothing yet to catch on and quantising is the
 * whole of the behaviour.
 */
export function toGrid(v: number, snapping: Snapping): number {
  return quantise(v, snapping.grid);
}
