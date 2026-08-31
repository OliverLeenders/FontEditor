import type { Vec2 } from "@fonteditor/geometry";

/**
 * Where a line a drag can catch on came from.
 *
 * Carried so a guide can eventually say *what* was caught rather than only that
 * something was, and so the hysteresis below can recognise the line it is
 * holding across frames — the lines are rebuilt every move, so identity has to
 * be a value rather than a reference.
 */
export type SnapSource = "metric" | "origin" | "advance" | "extreme" | "neighbour";

export type SnapLine = {
  /** The coordinate, on whichever axis this line belongs to. */
  readonly at: number;
  readonly source: SnapSource;
  /**
   * The point that produced the line, for one derived from the outline; `null`
   * for a line the font itself defines and which therefore spans the canvas.
   */
  readonly from: Vec2 | null;
};

/**
 * Where a drag is allowed to land.
 *
 * Two mechanisms, in strict order of precedence. A *line* catches the drag when
 * it comes within reach — the baseline, the x-height, a stem edge across the
 * glyph. A *grid* quantises whatever is left over, and is what stops an ordinary
 * drag writing coordinates like 342.7183 into a font whose every other number is
 * whole.
 *
 * Lines win because they are the intent: someone dragging a point to the
 * x-height wants the x-height exactly, not the nearest unit to it. And the
 * x-height is not obliged to be a whole number.
 */
export type Snapping = {
  /** Vertical lines, as x coordinates. */
  readonly xs: readonly SnapLine[];
  /** Horizontal lines, as y coordinates. */
  readonly ys: readonly SnapLine[];
  /**
   * How near a line must come to catch, in design units. The caller converts
   * from screen pixels, so the pull feels the same at every zoom rather than
   * growing as you zoom out.
   */
  readonly enter: number;
  /** How far a line already caught may stray before it lets go. */
  readonly stay: number;
  /** How much nearer a rival must be to take a caught line's place. */
  readonly stickiness: number;
  /**
   * Quantisation, in design units. 1 rounds to whole units; 0 leaves the value
   * alone, which is how snapping is switched off.
   */
  readonly grid: number;
};

/** What a drag is currently caught on, one line per axis. */
export type SnapHold = {
  readonly x: SnapLine | null;
  readonly y: SnapLine | null;
};

export const NO_HOLD: SnapHold = { x: null, y: null };

/** Snapping that does nothing at all. */
export const NO_SNAPPING: Snapping = {
  xs: [],
  ys: [],
  enter: 0,
  stay: 0,
  stickiness: 1,
  grid: 0,
};

/** How near a line has to come to catch, in screen pixels. */
export const SNAP_PIXELS = 6;
/**
 * How far it may then stray before letting go.
 *
 * Wider than the catch, which is the whole of the hysteresis: without it a line
 * lets go the instant the pointer leaves the radius that caught it, and a drag
 * along a boundary flickers in and out of the snap several times a second.
 */
export const SNAP_STAY_PIXELS = 10;
/** How much nearer a rival must be to steal a caught line's place. */
export const SNAP_STICKINESS = 1.6;

/** Two lines are the same line when they say the same thing about the same axis. */
export function sameLine(a: SnapLine | null, b: SnapLine | null): boolean {
  if (a === null || b === null) return a === b;
  return a.at === b.at && a.source === b.source;
}

/** The smallest correction that would land any of `positions` on `at`. */
function correctionTo(at: number, positions: readonly number[]): number | null {
  let best: number | null = null;
  for (const p of positions) {
    const correction = at - p;
    if (best === null || Math.abs(correction) < Math.abs(best)) best = correction;
  }
  return best;
}

/**
 * The line one axis of a drag catches on, with the correction that lands it.
 *
 * The hysteresis is the same shape the Tunni controls use to decide which
 * segment is awake, and for the same reason: a caught line keeps its place until
 * the pointer is clearly done with it, and a rival has to be clearly nearer to
 * take over rather than merely nearer. Without that, dragging along the boundary
 * between two candidates flickers between them.
 */
function catchLine(
  positions: readonly number[],
  lines: readonly SnapLine[],
  held: SnapLine | null,
  snapping: Snapping,
): { readonly line: SnapLine; readonly correction: number } | null {
  let best: SnapLine | null = null;
  let bestCorrection = 0;

  for (const line of lines) {
    const correction = correctionTo(line.at, positions);
    if (correction === null) continue;
    if (best === null || Math.abs(correction) < Math.abs(bestCorrection)) {
      best = line;
      bestCorrection = correction;
    }
  }

  if (held !== null && !sameLine(held, best)) {
    // Asked of the held line directly rather than looked up among the
    // candidates: it may have stopped being one — a neighbour whose node left
    // the selection — and it should still be given its chance to hold on.
    const holding = correctionTo(held.at, positions);
    if (
      holding !== null &&
      Math.abs(holding) < snapping.stay &&
      (best === null || Math.abs(holding) < Math.abs(bestCorrection) * snapping.stickiness)
    ) {
      return { line: held, correction: holding };
    }
  }

  if (best === null) return null;

  const threshold = sameLine(held, best) ? snapping.stay : snapping.enter;
  return Math.abs(bestCorrection) < threshold ? { line: best, correction: bestCorrection } : null;
}

function quantise(v: number, grid: number): number {
  return grid > 0 ? Math.round(v / grid) * grid : v;
}

/** Land a single point on a line if one is in reach, and on the grid otherwise. */
export function snapPoint(
  p: Vec2,
  snapping: Snapping,
  held: SnapHold = NO_HOLD,
): { readonly point: Vec2; readonly hold: SnapHold } {
  const x = catchLine([p.x], snapping.xs, held.x, snapping);
  const y = catchLine([p.y], snapping.ys, held.y, snapping);

  return {
    point: {
      x: x === null ? quantise(p.x, snapping.grid) : p.x + x.correction,
      y: y === null ? quantise(p.y, snapping.grid) : p.y + y.correction,
    },
    hold: { x: x?.line ?? null, y: y?.line ?? null },
  };
}

/**
 * Correct a drag's offset so the points it moves land well.
 *
 * The offset is corrected rather than each point placed, because the points move
 * as a body: dragging six points and having two of them jump onto a line while
 * the rest stay put would not be snapping, it would be a deformation. So every
 * moving point is offered to every line, and the single smallest correction wins
 * the axis — whichever point found it.
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
  held: SnapHold = NO_HOLD,
): { readonly delta: Vec2; readonly hold: SnapHold } {
  const landedX = moving.map((p) => p.x + delta.x);
  const landedY = moving.map((p) => p.y + delta.y);

  const x = catchLine(landedX, snapping.xs, held.x, snapping);
  const y = catchLine(landedY, snapping.ys, held.y, snapping);

  return {
    delta: {
      x: x === null ? quantise(delta.x, snapping.grid) : delta.x + x.correction,
      y: y === null ? quantise(delta.y, snapping.grid) : delta.y + y.correction,
    },
    hold: { x: x?.line ?? null, y: y?.line ?? null },
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

/** A line the font defines, spanning the canvas. */
export function metricLine(at: number, source: SnapSource = "metric"): SnapLine {
  return { at, source, from: null };
}
