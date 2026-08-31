import { describe, expect, it } from "vitest";

import { NO_SNAPPING, type Snapping, snapDelta, snapPoint, toGrid } from "../src/snap.js";

/** Lines at the baseline and an x-height that is deliberately not a whole number. */
const snapping: Snapping = {
  xs: [0, 500],
  ys: [0, 512.4, 700],
  tolerance: 10,
  grid: 1,
};

describe("snapPoint", () => {
  it("lands on a line that is within reach", () => {
    expect(snapPoint({ x: 4, y: 508 }, snapping)).toEqual({ x: 0, y: 512.4 });
  });

  it("keeps the line's own value, whole or not", () => {
    // The x-height is 512.4, so rounding after catching it would put the point a
    // fraction off the line it was just pulled onto.
    expect(snapPoint({ x: 200.2, y: 512 }, snapping).y).toBe(512.4);
  });

  it("rounds when no line is in reach", () => {
    expect(snapPoint({ x: 200.4, y: 342.7183 }, snapping)).toEqual({ x: 200, y: 343 });
  });

  it("treats the axes separately", () => {
    // Caught vertically, rounded horizontally.
    expect(snapPoint({ x: 200.6, y: 3 }, snapping)).toEqual({ x: 201, y: 0 });
  });

  it("takes the nearer of two lines in reach", () => {
    const close: Snapping = { ...snapping, ys: [100, 106], tolerance: 20 };
    expect(snapPoint({ x: 0, y: 105 }, close).y).toBe(106);
  });

  it("prefers the line listed first when two are equally near", () => {
    const tied: Snapping = { ...snapping, ys: [100, 110], tolerance: 20 };
    expect(snapPoint({ x: 0, y: 105 }, tied).y).toBe(100);
  });

  it("does nothing at all when snapping is off", () => {
    const p = { x: 200.4, y: 3.7 };
    expect(snapPoint(p, NO_SNAPPING)).toEqual(p);
  });
});

describe("snapDelta", () => {
  const at = (x: number, y: number) => ({ x, y });

  it("moves the whole body by the correction one point found", () => {
    // The second point lands 3 below the x-height; every point shifts by 3.
    const moved = snapDelta([at(0, 100), at(300, 400)], { x: 0, y: 109.4 }, snapping);
    expect(moved.y).toBeCloseTo(112.4, 10);
  });

  it("takes the smallest correction when several points are in reach", () => {
    // Landing at y = 8 and y = 703: the first is 8 from the baseline, the second
    // 3 from the cap height. The nearer catch wins the axis.
    const moved = snapDelta([at(0, 0), at(0, 695)], { x: 0, y: 8 }, snapping);
    expect(moved.y).toBeCloseTo(5, 10);
  });

  it("rounds the offset when nothing is caught", () => {
    const moved = snapDelta([at(0, 200)], { x: 12.6, y: -40.2 }, snapping);
    expect(moved).toEqual({ x: 13, y: -40 });
  });

  it("keeps a fractional shape rigid rather than reshaping it", () => {
    // Rounding the offset, not the landing positions: a point at 100.5 stays
    // half a unit off its neighbour instead of being quietly straightened.
    const moved = snapDelta([at(100.5, 200.5)], { x: 10.2, y: 0.4 }, snapping);
    expect(moved.x).toBe(10);
    expect(moved.y).toBe(0);
  });

  it("catches on a vertical line as readily as a horizontal one", () => {
    const moved = snapDelta([at(100, 300)], { x: 396, y: 0 }, snapping);
    expect(moved.x).toBe(400);
  });

  it("does nothing at all when snapping is off", () => {
    const delta = { x: 12.6, y: -40.2 };
    expect(snapDelta([at(0, 0)], delta, NO_SNAPPING)).toEqual(delta);
  });

  it("still rounds when nothing is moving", () => {
    expect(snapDelta([], { x: 3.7, y: 0 }, snapping)).toEqual({ x: 4, y: 0 });
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
