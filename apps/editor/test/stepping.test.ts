import { describe, expect, it } from "vitest";

import { canStep, stepValue } from "../src/stepping.js";

describe("stepping a value", () => {
  it("moves one step each way", () => {
    expect(stepValue(10, 1, 1)).toBe(11);
    expect(stepValue(10, 1, -1)).toBe(9);
  });

  it("stays on the step's own grid through a long hold", () => {
    // 2 + 0.25 four times is 2.9999999999999996 by addition. A field showing
    // "3.00" that is not three will disagree with something later.
    let at = 2;
    for (let i = 0; i < 4; i++) at = stepValue(at, 0.25, 1);
    expect(at).toBe(3);
  });

  it("brings a value that was off the grid onto it", () => {
    // Typed, or from a file drawn on a different grid. It steps to the next
    // multiple rather than carrying its offset along for ever.
    expect(stepValue(2.1, 0.25, 1)).toBe(2.25);
    expect(stepValue(2.1, 0.25, -1)).toBe(2);
  });

  it("always moves, even from a value already on the grid", () => {
    expect(stepValue(2.25, 0.25, 1)).toBe(2.5);
    expect(stepValue(2.25, 0.25, -1)).toBe(2);
  });

  it("holds at a bound rather than passing it", () => {
    expect(stepValue(6, 0.25, 1, { max: 6 })).toBe(6);
    expect(stepValue(0.5, 0.25, -1, { min: 0.5 })).toBe(0.5);
  });

  it("honours a bound that is not on the grid", () => {
    // Rounding after clamping would have turned a maximum of 6 into 6.25.
    expect(stepValue(5.9, 0.25, 1, { max: 6 })).toBe(6);
  });

  it("steps negative values the way it steps positive ones", () => {
    expect(stepValue(-250, 10, -1)).toBe(-260);
    expect(stepValue(-250, 10, 1)).toBe(-240);
    expect(stepValue(-7, 5, 1)).toBe(-5);
  });

  it("leaves a value alone when there is no sensible step", () => {
    expect(stepValue(10, 0, 1)).toBe(10);
    expect(stepValue(10, -1, 1)).toBe(10);
    expect(stepValue(Number.NaN, 1, 1)).toBeNaN();
  });

  it("says when a button would do nothing", () => {
    expect(canStep(6, 0.25, 1, { max: 6 })).toBe(false);
    expect(canStep(6, 0.25, -1, { max: 6 })).toBe(true);
    expect(canStep(3, 1, 1)).toBe(true);
  });
});
