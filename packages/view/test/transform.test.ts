import { distance, vec } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import {
  IDENTITY_VIEW,
  fitRect,
  panBy,
  screenTolerance,
  setScaleAt,
  toDesign,
  toScreen,
  toScreenLength,
  visibleRect,
  zoomAt,
} from "../src/transform.js";

const VIEW = { scale: 0.5, tx: 300, ty: 700 };

describe("toScreen and toDesign", () => {
  it("flips the y axis", () => {
    // Design is y-up, screen is y-down: a point above the baseline sits higher
    // on screen, meaning a smaller y.
    const baseline = toScreen(VIEW, vec(0, 0));
    const above = toScreen(VIEW, vec(0, 100));
    expect(above.y).toBeLessThan(baseline.y);
  });

  it("places the design origin at the translation", () => {
    expect(toScreen(VIEW, vec(0, 0))).toEqual(vec(300, 700));
  });

  it("scales design units into pixels", () => {
    expect(toScreen(VIEW, vec(200, 400))).toEqual(vec(400, 500));
  });

  it("round-trips exactly enough for hit testing", () => {
    for (const p of [vec(0, 0), vec(512, -240), vec(-1000, 1000), vec(0.5, 0.25)]) {
      expect(distance(toDesign(VIEW, toScreen(VIEW, p)), p)).toBeLessThan(1e-9);
    }
  });

  it("is the identity at unit scale and no offset", () => {
    expect(toScreen(IDENTITY_VIEW, vec(7, -3))).toEqual(vec(7, 3));
  });
});

describe("tolerance conversion", () => {
  // The fix for the prototype's hardcoded `< 7`: a hit radius is a fact about
  // screens, so it is stated in pixels and converted at the boundary. Zoom out
  // and it covers more design units, which is what keeps a control clickable.
  it("turns pixels into design units", () => {
    expect(screenTolerance({ scale: 0.5, tx: 0, ty: 0 }, 7)).toBe(14);
    expect(screenTolerance({ scale: 2, tx: 0, ty: 0 }, 7)).toBe(3.5);
  });

  it("is the inverse of the length conversion", () => {
    const v = { scale: 0.37, tx: 12, ty: -8 };
    expect(toScreenLength(v, screenTolerance(v, 9))).toBeCloseTo(9, 12);
  });
});

describe("panBy", () => {
  it("shifts in screen pixels and leaves the scale alone", () => {
    const p = panBy(VIEW, 40, -25);
    expect(p).toEqual({ scale: 0.5, tx: 340, ty: 675 });
  });
});

describe("zoomAt", () => {
  it("keeps the anchored design point under the anchor", () => {
    const anchor = vec(410, 260);
    const before = toDesign(VIEW, anchor);
    const zoomed = zoomAt(VIEW, anchor, 2.5);
    const after = toDesign(zoomed, anchor);
    expect(distance(after, before)).toBeLessThan(1e-9);
  });

  it("actually changes the scale", () => {
    expect(zoomAt(VIEW, vec(0, 0), 2).scale).toBeCloseTo(1, 12);
  });

  it("clamps rather than running away", () => {
    expect(zoomAt(VIEW, vec(0, 0), 1e9, 0.01, 8).scale).toBe(8);
    expect(zoomAt(VIEW, vec(0, 0), 1e-9, 0.01, 8).scale).toBe(0.01);
  });

  it("holds the anchor even when the zoom is clamped", () => {
    const anchor = vec(120, 90);
    const before = toDesign(VIEW, anchor);
    const zoomed = zoomAt(VIEW, anchor, 1e9, 0.01, 8);
    expect(distance(toDesign(zoomed, anchor), before)).toBeLessThan(1e-9);
  });

  it("ignores a nonsensical factor instead of producing a broken view", () => {
    expect(zoomAt(VIEW, vec(0, 0), 0)).toEqual(VIEW);
    expect(zoomAt(VIEW, vec(0, 0), -2)).toEqual(VIEW);
    expect(zoomAt(VIEW, vec(0, 0), Number.NaN)).toEqual(VIEW);
  });
});

describe("setScaleAt", () => {
  it("reaches the requested scale about the anchor", () => {
    const anchor = vec(200, 200);
    const before = toDesign(VIEW, anchor);
    const set = setScaleAt(VIEW, anchor, 3);
    expect(set.scale).toBeCloseTo(3, 12);
    expect(distance(toDesign(set, anchor), before)).toBeLessThan(1e-9);
  });
});

describe("fitRect", () => {
  const em = { minX: 0, minY: -200, maxX: 600, maxY: 800 };

  it("centres the rectangle in the viewport", () => {
    const v = fitRect(em, 800, 600, 20)!;
    const centre = toScreen(v, vec(300, 300));
    expect(centre.x).toBeCloseTo(400, 9);
    expect(centre.y).toBeCloseTo(300, 9);
  });

  it("fits the constraining axis inside the padding", () => {
    // 1000 units tall into 600 - 40 = 560 pixels.
    const v = fitRect(em, 800, 600, 20)!;
    expect(v.scale).toBeCloseTo(560 / 1000, 9);
  });

  it("returns null when the viewport is smaller than its own padding", () => {
    expect(fitRect(em, 30, 30, 20)).toBeNull();
  });

  it("returns null for a rectangle with no extent", () => {
    expect(fitRect({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 800, 600)).toBeNull();
  });

  it("still frames a rectangle that is flat in one axis", () => {
    const v = fitRect({ minX: 0, minY: 0, maxX: 600, maxY: 0 }, 800, 600, 20);
    expect(v).not.toBeNull();
    expect(v!.scale).toBeCloseTo(760 / 600, 9);
  });
});

describe("visibleRect", () => {
  it("reports the design area under the viewport", () => {
    const v = { scale: 2, tx: 0, ty: 0 };
    const r = visibleRect(v, 400, 200);
    expect(r.minX).toBeCloseTo(0, 9);
    expect(r.maxX).toBeCloseTo(200, 9);
    // Screen y grows downward, so the visible design y is negative.
    expect(r.minY).toBeCloseTo(-100, 9);
    expect(r.maxY).toBeCloseTo(0, 9);
  });

  it("agrees with the corners of the viewport", () => {
    const r = visibleRect(VIEW, 800, 600);
    const topLeft = toDesign(VIEW, vec(0, 0));
    expect(r.maxY).toBeCloseTo(topLeft.y, 9);
    expect(r.minX).toBeCloseTo(topLeft.x, 9);
  });
});
