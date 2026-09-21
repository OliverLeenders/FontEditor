import type { Vec2 } from "@typewright/geometry";

/**
 * Where a line a drag can catch on came from.
 *
 * Carried so a guide can eventually say *what* was caught rather than only that
 * something was, and so the hysteresis below can recognise the line it is
 * holding across frames — the lines are rebuilt every move, so identity has to
 * be a value rather than a reference.
 */
export type SnapSource =
  "metric" | "origin" | "advance" | "extreme" | "neighbour" | "point" | "guide";

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
 * A line at any angle a drag can catch on.
 *
 * The lines above are coordinates on an axis, which is all a drag needed while
 * everything worth aligning to was upright or level. A slanted design has
 * neither: an italic's stems run at the italic angle and are cut across it, and
 * a right angle in that frame is at no axis at all. So a ray is a point and a
 * direction, and what it catches is the perpendicular distance to it.
 */
export type SnapRay = {
  readonly through: Vec2;
  /** A unit vector along the line. Its sign does not matter: a line has no end. */
  readonly direction: Vec2;
  readonly source: SnapSource;
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
  /**
   * Lines at an angle: angled guides, and the perpendiculars and parallels of
   * the segment beside what is being dragged.
   *
   * Judged against the axis lines by plain distance, and the nearest wins. A
   * ray corrects in two dimensions at once — it is one line rather than a
   * coordinate — so when one catches it takes the whole offset and the axes sit
   * that frame out.
   */
  readonly rays?: readonly SnapRay[];
};

/** What a drag is currently caught on: one line per axis, or one ray. */
export type SnapHold = {
  readonly x: SnapLine | null;
  readonly y: SnapLine | null;
  readonly ray?: SnapRay | null;
};

export const NO_HOLD: SnapHold = { x: null, y: null, ray: null };

/** Snapping that does nothing at all. */
export const NO_SNAPPING: Snapping = {
  xs: [],
  ys: [],
  rays: [],
  enter: 0,
  stay: 0,
  stickiness: 1,
  grid: 0,
};

/**
 * How near a line has to come to catch, in screen pixels.
 *
 * Four rather than six, since every point in the glyph is a candidate now and
 * not a curated few: what stops that being sticky is a radius small enough that
 * aiming between two points a few pixels apart is possible.
 */
export const SNAP_PIXELS = 4;
/**
 * How far it may then stray before letting go.
 *
 * Wider than the catch, which is the whole of the hysteresis: without it a line
 * lets go the instant the pointer leaves the radius that caught it, and a drag
 * along a boundary flickers in and out of the snap several times a second.
 */
export const SNAP_STAY_PIXELS = 7;
/** How much nearer a rival must be to steal a caught line's place. */
export const SNAP_STICKINESS = 1.6;

/** Two lines are the same line when they say the same thing about the same axis. */
export function sameLine(a: SnapLine | null, b: SnapLine | null): boolean {
  if (a === null || b === null) return a === b;
  return a.at === b.at && a.source === b.source;
}

/** And two rays, which are rebuilt every frame and so compared by value. */
export function sameRay(a: SnapRay | null | undefined, b: SnapRay | null | undefined): boolean {
  if (a == null || b == null) return (a ?? null) === (b ?? null);
  return (
    a.source === b.source &&
    a.through.x === b.through.x &&
    a.through.y === b.through.y &&
    a.direction.x === b.direction.x &&
    a.direction.y === b.direction.y
  );
}

/** How far `p` sits off the line, and which way it would have to move. */
function offRay(p: Vec2, ray: SnapRay): { readonly away: number; readonly onto: Vec2 } {
  const dx = p.x - ray.through.x;
  const dy = p.y - ray.through.y;
  // The component across the line, which is what has to go.
  const across = dx * -ray.direction.y + dy * ray.direction.x;
  // The offset itself, which is that component along the normal.
  return { away: across, onto: { x: -ray.direction.y * across, y: ray.direction.x * across } };
}

/**
 * The ray a drag catches on, with the offset that lands it.
 *
 * The same hysteresis the axis lines take, measured perpendicular to the line
 * rather than along an axis: a caught ray keeps its place until the drag is
 * clearly done with it, and a rival has to be clearly nearer to take over.
 */
function catchRay(
  landed: readonly Vec2[],
  snapping: Snapping,
  held: SnapRay | null | undefined,
): { readonly ray: SnapRay; readonly correction: Vec2 } | null {
  const nearest = (ray: SnapRay): { away: number; onto: Vec2 } | null => {
    let best: { away: number; onto: Vec2 } | null = null;
    for (const p of landed) {
      const found = offRay(p, ray);
      if (best === null || Math.abs(found.away) < Math.abs(best.away)) best = found;
    }
    return best;
  };

  let best: SnapRay | null = null;
  let bestOff: { away: number; onto: Vec2 } | null = null;
  for (const ray of snapping.rays ?? []) {
    const found = nearest(ray);
    if (found === null) continue;
    if (bestOff === null || Math.abs(found.away) < Math.abs(bestOff.away)) {
      best = ray;
      bestOff = found;
    }
  }

  if (held != null && !sameRay(held, best)) {
    const holding = nearest(held);
    if (
      holding !== null &&
      Math.abs(holding.away) < snapping.stay &&
      (bestOff === null || Math.abs(holding.away) < Math.abs(bestOff.away) * snapping.stickiness)
    ) {
      return { ray: held, correction: { x: -holding.onto.x, y: -holding.onto.y } };
    }
  }

  if (best === null || bestOff === null) return null;

  const threshold = sameRay(held, best) ? snapping.stay : snapping.enter;
  return Math.abs(bestOff.away) < threshold
    ? { ray: best, correction: { x: -bestOff.onto.x, y: -bestOff.onto.y } }
    : null;
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

  const ray = catchRay([p], snapping, held.ray);
  const across = ray === null ? Infinity : Math.hypot(ray.correction.x, ray.correction.y);
  const nearestAxis = Math.min(
    x === null ? Infinity : Math.abs(x.correction),
    y === null ? Infinity : Math.abs(y.correction),
  );

  if (ray !== null && across < nearestAxis) {
    return {
      point: { x: p.x + ray.correction.x, y: p.y + ray.correction.y },
      hold: { x: null, y: null, ray: ray.ray },
    };
  }

  return {
    point: {
      x: x === null ? quantise(p.x, snapping.grid) : p.x + x.correction,
      y: y === null ? quantise(p.y, snapping.grid) : p.y + y.correction,
    },
    hold: { x: x?.line ?? null, y: y?.line ?? null, ray: null },
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

  // An angled line, judged against the axis lines by plain distance. It wins
  // only by being nearer than both of them, because an axis line is the commoner
  // intent and a ray takes the whole offset rather than one coordinate of it.
  const ray = catchRay(
    moving.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y })),
    snapping,
    held.ray,
  );
  const across = ray === null ? Infinity : Math.hypot(ray.correction.x, ray.correction.y);
  const nearestAxis = Math.min(
    x === null ? Infinity : Math.abs(x.correction),
    y === null ? Infinity : Math.abs(y.correction),
  );

  if (ray !== null && across < nearestAxis) {
    return {
      delta: { x: delta.x + ray.correction.x, y: delta.y + ray.correction.y },
      hold: { x: null, y: null, ray: ray.ray },
    };
  }

  return {
    delta: {
      x: x === null ? quantise(delta.x, snapping.grid) : delta.x + x.correction,
      y: y === null ? quantise(delta.y, snapping.grid) : delta.y + y.correction,
    },
    hold: { x: x?.line ?? null, y: y?.line ?? null, ray: null },
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
