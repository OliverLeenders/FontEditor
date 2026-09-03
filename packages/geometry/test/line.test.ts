import { describe, expect, it } from "vitest";

import { distanceToLine, intersectLines, projectOntoLine, sameSide, sideOf } from "../src/line.js";
import { vec } from "../src/vec2.js";

describe("intersectLines", () => {
  it("finds the crossing of two lines", () => {
    // y = x meets x + y = 4 at (2, 2).
    expect(intersectLines(vec(0, 0), vec(2, 2), vec(0, 4), vec(4, 0))).toEqual(vec(2, 2));
  });

  it("extends the lines beyond the given points", () => {
    const p = intersectLines(vec(0, 0), vec(1, 0), vec(10, -5), vec(10, -4));
    expect(p).toEqual(vec(10, 0));
  });

  // The prototype returned `b2` here — a real point, just not the intersection,
  // which then propagated straight into handle positions.
  it("returns null for parallel lines", () => {
    expect(intersectLines(vec(0, 0), vec(10, 0), vec(0, 5), vec(10, 5))).toBeNull();
  });

  it("returns null for coincident lines", () => {
    expect(intersectLines(vec(0, 0), vec(10, 0), vec(2, 0), vec(6, 0))).toBeNull();
  });

  it("returns null when a line has no direction", () => {
    expect(intersectLines(vec(3, 3), vec(3, 3), vec(0, 0), vec(1, 1))).toBeNull();
  });

  it("detects parallelism at any scale", () => {
    // A fixed absolute epsilon on the determinant would call these parallel,
    // because the determinant is tiny purely from the coordinates being small.
    const p = intersectLines(vec(0, 0), vec(0.001, 0), vec(0, -0.001), vec(0.001, 0.001));
    expect(p).not.toBeNull();
  });
});

describe("sideOf", () => {
  it("reports left as positive in y-up space", () => {
    expect(sideOf(vec(0, 0), vec(10, 0), vec(5, 3))).toBe(1);
    expect(sideOf(vec(0, 0), vec(10, 0), vec(5, -3))).toBe(-1);
    expect(sideOf(vec(0, 0), vec(10, 0), vec(5, 0))).toBe(0);
  });

  it("returns zero when the line has no direction", () => {
    expect(sideOf(vec(2, 2), vec(2, 2), vec(9, 9))).toBe(0);
  });
});

describe("sameSide", () => {
  it("is true only when both points are strictly on one side", () => {
    expect(sameSide(vec(0, 0), vec(10, 0), vec(2, 5), vec(8, 1))).toBe(true);
    expect(sameSide(vec(0, 0), vec(10, 0), vec(2, 5), vec(8, -1))).toBe(false);
  });

  // The prototype compared side values directly, so two points sitting *on* the
  // line reported as being on the same side as each other.
  it("is false when a point lies on the line", () => {
    expect(sameSide(vec(0, 0), vec(10, 0), vec(2, 0), vec(8, 3))).toBe(false);
    expect(sameSide(vec(0, 0), vec(10, 0), vec(2, 0), vec(8, 0))).toBe(false);
  });
});

describe("distanceToLine", () => {
  it("measures the perpendicular distance", () => {
    expect(distanceToLine(vec(0, 0), vec(10, 0), vec(4, 7))).toBeCloseTo(7, 12);
  });

  it("returns null when the line has no direction", () => {
    expect(distanceToLine(vec(1, 1), vec(1, 1), vec(4, 5))).toBeNull();
  });
});

describe("projectOntoLine", () => {
  it("reports position as a fraction of the segment", () => {
    expect(projectOntoLine(vec(0, 0), vec(10, 0), vec(2.5, 4))).toBeCloseTo(0.25, 12);
  });

  it("keeps the sign when the point is behind the start", () => {
    expect(projectOntoLine(vec(0, 0), vec(10, 0), vec(-5, 0))).toBeCloseTo(-0.5, 12);
  });

  it("returns null for a zero-length segment", () => {
    expect(projectOntoLine(vec(1, 1), vec(1, 1), vec(2, 2))).toBeNull();
  });
});
