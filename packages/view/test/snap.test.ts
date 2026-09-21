import { describe, expect, it } from "vitest";

import {
  NO_HOLD,
  NO_SNAPPING,
  type SnapHold,
  type SnapLine,
  type SnapRay,
  type Snapping,
  metricLine,
  sameLine,
  sameRay,
  snapDelta,
  snapPoint,
  toGrid,
} from "../src/snap.js";

const at = (x: number, y: number) => ({ x, y });

/** Lines at the baseline and an x-height that is deliberately not a whole number. */
const snapping: Snapping = {
  xs: [metricLine(0, "origin"), metricLine(500, "advance")],
  ys: [metricLine(0), metricLine(512.4), metricLine(700)],
  enter: 10,
  stay: 16,
  stickiness: 1.6,
  grid: 1,
};

/** The same, with the hysteresis disabled, for testing catching on its own. */
const strict: Snapping = { ...snapping, stay: 10, stickiness: 1 };

describe("snapPoint", () => {
  it("lands on a line that is within reach", () => {
    expect(snapPoint(at(4, 508), snapping).point).toEqual({ x: 0, y: 512.4 });
  });

  it("keeps the line's own value, whole or not", () => {
    // The x-height is 512.4, so rounding after catching it would put the point a
    // fraction off the line it was just pulled onto.
    expect(snapPoint(at(200.2, 512), snapping).point.y).toBe(512.4);
  });

  it("rounds when no line is in reach", () => {
    expect(snapPoint(at(200.4, 342.7183), snapping).point).toEqual({ x: 200, y: 343 });
  });

  it("treats the axes separately", () => {
    // Caught vertically, rounded horizontally.
    expect(snapPoint(at(200.6, 3), snapping).point).toEqual({ x: 201, y: 0 });
  });

  it("says what it caught, and on which axis", () => {
    const { hold } = snapPoint(at(200.6, 3), snapping);
    expect(hold.y?.source).toBe("metric");
    expect(hold.y?.at).toBe(0);
    expect(hold.x).toBeNull();
  });

  it("takes the nearer of two lines in reach", () => {
    const close: Snapping = {
      ...strict,
      ys: [metricLine(100), metricLine(106)],
      enter: 20,
      stay: 20,
    };
    expect(snapPoint(at(0, 105), close).point.y).toBe(106);
  });

  it("prefers the line listed first when two are equally near", () => {
    const tied: Snapping = {
      ...strict,
      ys: [metricLine(100), metricLine(110)],
      enter: 20,
      stay: 20,
    };
    expect(snapPoint(at(0, 105), tied).point.y).toBe(100);
  });

  it("does nothing at all when snapping is off", () => {
    const p = at(200.4, 3.7);
    expect(snapPoint(p, NO_SNAPPING).point).toEqual(p);
  });
});

describe("snapDelta", () => {
  it("moves the whole body by the correction one point found", () => {
    // The second point lands 3 below the x-height; every point shifts by 3.
    const moved = snapDelta([at(0, 100), at(300, 400)], at(0, 109.4), snapping);
    expect(moved.delta.y).toBeCloseTo(112.4, 10);
  });

  it("takes the smallest correction when several points are in reach", () => {
    // Landing at y = 8 and y = 703: the first is 8 from the baseline, the second
    // 3 from the cap height. The nearer catch wins the axis.
    const moved = snapDelta([at(0, 0), at(0, 695)], at(0, 8), snapping);
    expect(moved.delta.y).toBeCloseTo(5, 10);
  });

  it("rounds the offset when nothing is caught", () => {
    const moved = snapDelta([at(0, 200)], at(12.6, -40.2), snapping);
    expect(moved.delta).toEqual({ x: 13, y: -40 });
  });

  it("keeps a fractional shape rigid rather than reshaping it", () => {
    // Rounding the offset, not the landing positions: a point at 100.5 stays
    // half a unit off its neighbour instead of being quietly straightened.
    const moved = snapDelta([at(100.5, 200.5)], at(10.2, 0.4), snapping);
    expect(moved.delta).toEqual({ x: 10, y: 0 });
  });

  it("catches on a vertical line as readily as a horizontal one", () => {
    const moved = snapDelta([at(100, 300)], at(396, 0), snapping);
    expect(moved.delta.x).toBe(400);
  });

  it("does nothing at all when snapping is off", () => {
    const delta = at(12.6, -40.2);
    expect(snapDelta([at(0, 0)], delta, NO_SNAPPING).delta).toEqual(delta);
  });

  it("still rounds when nothing is moving", () => {
    expect(snapDelta([], at(3.7, 0), snapping).delta).toEqual({ x: 4, y: 0 });
  });
});

describe("hysteresis", () => {
  const holding = (line: SnapLine): SnapHold => ({ x: null, y: line });
  const baseline = metricLine(0);

  it("keeps a caught line past the radius that caught it", () => {
    // 13 away: too far to catch afresh, near enough to hold on.
    expect(snapPoint(at(0, 13), snapping).hold.y).toBeNull();
    expect(snapPoint(at(0, 13), snapping, holding(baseline)).hold.y).toEqual(baseline);
  });

  it("lets go once the pointer is clearly done with it", () => {
    expect(snapPoint(at(0, 20), snapping, holding(baseline)).hold.y).toBeNull();
  });

  it("makes a rival be clearly nearer, not merely nearer", () => {
    const rivals: Snapping = { ...snapping, ys: [metricLine(0), metricLine(20)] };
    // At y = 11 the rival at 20 is 9 away and the held baseline 11 — nearer, but
    // not by the margin it takes to steal the place.
    expect(snapPoint(at(0, 11), rivals, holding(baseline)).hold.y?.at).toBe(0);
  });

  it("hands over once the rival is far enough ahead", () => {
    const rivals: Snapping = { ...snapping, ys: [metricLine(0), metricLine(20)] };
    // At y = 16 the rival is 4 away against the baseline's 16.
    expect(snapPoint(at(0, 16), rivals, holding(baseline)).hold.y?.at).toBe(20);
  });

  it("holds a line that has stopped being a candidate at all", () => {
    // A neighbour whose node left the selection is no longer offered, and would
    // otherwise be dropped mid-drag — a snap that vanishes without the pointer
    // moving reads as a glitch.
    const gone: SnapLine = { at: 0, source: "neighbour", from: at(0, 0) };
    const without: Snapping = { ...snapping, ys: [metricLine(700)] };
    expect(snapPoint(at(0, 6), without, holding(gone)).hold.y).toEqual(gone);
  });

  it("carries through a body drag as well as a single point", () => {
    const held = snapDelta([at(0, 100)], at(0, -87), snapping, holding(baseline));
    expect(held.hold.y).toEqual(baseline);
    expect(held.delta.y).toBe(-100);
  });

  it("starts from nothing held", () => {
    expect(snapPoint(at(0, 13), snapping, NO_HOLD).hold.y).toBeNull();
  });
});

describe("sameLine", () => {
  it("compares by value, since the lines are rebuilt every move", () => {
    expect(sameLine(metricLine(500), metricLine(500))).toBe(true);
  });

  it("tells apart two lines that agree only on the number", () => {
    // A stem edge that happens to sit on the cap height is a different account
    // of the same coordinate, and the guide would name a different thing.
    expect(sameLine(metricLine(700), { at: 700, source: "extreme", from: at(9, 700) })).toBe(false);
  });

  it("treats nothing held as no match", () => {
    expect(sameLine(null, metricLine(0))).toBe(false);
    expect(sameLine(null, null)).toBe(true);
  });
});

/**
 * Lines at an angle.
 *
 * The axis lines are coordinates, which is all a drag needed while everything
 * worth aligning to was upright or level. A slanted design has neither, and a
 * right angle in that frame is at no axis at all.
 */
describe("a line at an angle", () => {
  /** A line through the origin at 45 degrees, and the same rotated a quarter turn. */
  const up: SnapRay = {
    through: at(0, 0),
    direction: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
    source: "guide",
  };
  const across: SnapRay = {
    through: at(0, 0),
    direction: { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
    source: "guide",
  };

  const angled: Snapping = { ...NO_SNAPPING, rays: [up], enter: 10, stay: 16, stickiness: 1.6 };

  it("pulls a point onto it, square to the line", () => {
    // Three units off a 45-degree line through the origin.
    const landed = snapPoint(at(100, 104), angled);
    expect(landed.point.x).toBeCloseTo(102, 6);
    expect(landed.point.y).toBeCloseTo(102, 6);
    expect(landed.hold.ray).toEqual(up);
  });

  it("leaves a point that is clearly off it alone", () => {
    const landed = snapPoint(at(100, 140), angled);
    expect(landed.point).toEqual(at(100, 140));
    expect(landed.hold.ray ?? null).toBeNull();
  });

  it("moves a whole drag onto it, by the nearest point in the body", () => {
    const landed = snapDelta([at(100, 104), at(300, 200)], at(0, 0), angled);
    // The first point is two units off the line, the second seventy.
    expect(landed.delta.x).toBeCloseTo(2, 6);
    expect(landed.delta.y).toBeCloseTo(-2, 6);
    expect(landed.hold.ray).toEqual(up);
  });

  it("takes the nearer of two angled lines", () => {
    const both: Snapping = { ...angled, rays: [up, across] };
    // Nearer the one going up: five units off it, and fifty off the other.
    expect(snapDelta([at(100, 95)], at(0, 0), both).hold.ray).toEqual(up);
  });

  it("holds the line it caught past the radius that caught it", () => {
    const held: SnapHold = { x: null, y: null, ray: up };
    // Twelve units off: too far to catch afresh, not too far to hold.
    const landed = snapPoint(at(100, 117), angled, held);
    expect(landed.hold.ray).toEqual(up);
  });

  it("lets go once the pointer is clearly done with it", () => {
    const held: SnapHold = { x: null, y: null, ray: up };
    expect(snapPoint(at(100, 160), angled, held).hold.ray ?? null).toBeNull();
  });

  it("gives way to an axis line that is nearer", () => {
    // One unit under the x-height and four off the angled line: the axis wins,
    // and takes only its own coordinate.
    const mixed: Snapping = { ...snapping, rays: [up] };
    const landed = snapPoint(at(508, 511.4), mixed);
    expect(landed.point.y).toBe(512.4);
    expect(landed.hold.ray ?? null).toBeNull();
  });

  it("wins where it is nearer than either axis line", () => {
    const mixed: Snapping = { ...snapping, rays: [up] };
    // Two units off the angled line, nine from the x-height.
    const landed = snapPoint(at(300, 303), mixed);
    expect(landed.point.x).toBeCloseTo(301.5, 6);
    expect(landed.point.y).toBeCloseTo(301.5, 6);
  });

  it("knows one line from another", () => {
    expect(sameRay(up, { ...up })).toBe(true);
    expect(sameRay(up, across)).toBe(false);
    expect(sameRay(null, up)).toBe(false);
    expect(sameRay(null, null)).toBe(true);
  });
});

describe("toGrid", () => {
  it("rounds a lone measurement", () => {
    expect(toGrid(512.6, snapping)).toBe(513);
  });

  it("leaves it alone when snapping is off", () => {
    expect(toGrid(512.6, NO_SNAPPING)).toBe(512.6);
  });

  it("honours a grid coarser than one unit", () => {
    expect(toGrid(512.6, { ...snapping, grid: 10 })).toBe(510);
  });
});
