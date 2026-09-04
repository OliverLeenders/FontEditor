import { describe, expect, it } from "vitest";

import { type WheelLike, wheelIntent } from "../src/wheel.js";

const wheel = (over: Partial<WheelLike>): WheelLike => ({
  deltaX: 0,
  deltaY: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...over,
});

describe("what a wheel means", () => {
  it("pans against the scroll, so the view follows the fingers", () => {
    // Scrolling down moves the page up, which is the view moving up the glyph.
    expect(wheelIntent(wheel({ deltaY: 100 }))).toEqual({ kind: "pan", dx: 0, dy: -100 });
  });

  it("takes the horizontal a trackpad already sends", () => {
    expect(wheelIntent(wheel({ deltaX: 40, deltaY: -12 }))).toEqual({
      kind: "pan",
      dx: -40,
      dy: 12,
    });
  });

  it("turns a one-wheel mouse sideways with shift", () => {
    expect(wheelIntent(wheel({ deltaY: 60, shiftKey: true }))).toEqual({
      kind: "pan",
      dx: -60,
      dy: 0,
    });
  });

  it("leaves a trackpad's diagonal alone when shift is held", () => {
    // Otherwise a shift-held two-finger scroll would move horizontally twice:
    // once from its own deltaX and once from the redirected deltaY.
    expect(wheelIntent(wheel({ deltaX: 20, deltaY: 60, shiftKey: true }))).toEqual({
      kind: "pan",
      dx: -20,
      dy: -60,
    });
  });

  it("zooms in when ctrl is held and the wheel goes up", () => {
    const intent = wheelIntent(wheel({ deltaY: -100, ctrlKey: true }));
    expect(intent.kind).toBe("zoom");
    expect(intent.kind === "zoom" && intent.factor).toBeGreaterThan(1);
  });

  it("zooms out by exactly what zooming in put on", () => {
    // Symmetric, so a wheel up and a wheel down leave the scale where it began
    // rather than creeping in one direction.
    const inward = wheelIntent(wheel({ deltaY: -100, ctrlKey: true }));
    const outward = wheelIntent(wheel({ deltaY: 100, ctrlKey: true }));
    const product =
      (inward.kind === "zoom" ? inward.factor : 0) * (outward.kind === "zoom" ? outward.factor : 0);
    expect(product).toBeCloseTo(1, 12);
  });

  it("treats cmd as ctrl, for the Mac", () => {
    expect(wheelIntent(wheel({ deltaY: -100, metaKey: true })).kind).toBe("zoom");
  });

  it("reads a browser that counts in lines rather than pixels", () => {
    // Firefox sends deltaMode 1 with a delta of about 3. Taken literally that is
    // three pixels of pan and a zoom step too small to see.
    expect(wheelIntent(wheel({ deltaY: 3, deltaMode: 1 }))).toEqual({
      kind: "pan",
      dx: 0,
      dy: -48,
    });
  });

  it("reads one that counts in pages", () => {
    expect(wheelIntent(wheel({ deltaY: 1, deltaMode: 2 }))).toEqual({
      kind: "pan",
      dx: 0,
      dy: -400,
    });
  });

  it("zooms by the same amount however the delta was measured", () => {
    const pixels = wheelIntent(wheel({ deltaY: -48, ctrlKey: true }));
    const lines = wheelIntent(wheel({ deltaY: -3, deltaMode: 1, ctrlKey: true }));
    expect(pixels).toEqual(lines);
  });

  it("does nothing for a wheel that did not turn", () => {
    expect(wheelIntent(wheel({}))).toEqual({ kind: "pan", dx: 0, dy: 0 });
  });
});
