import { describe, expect, it } from "vitest";

import {
  add,
  angleBetween,
  boundsOf,
  coincident,
  cross,
  distance,
  dot,
  normalize,
  rotate,
  stretchToLength,
  sub,
  vec,
} from "../src/vec2.js";

describe("vec2 algebra", () => {
  it("adds and subtracts componentwise", () => {
    expect(add(vec(1, 2), vec(3, 4))).toEqual(vec(4, 6));
    expect(sub(vec(1, 2), vec(3, 4))).toEqual(vec(-2, -2));
  });

  it("gives cross a positive sign when the second vector turns left", () => {
    // y-up: (0, 1) is counter-clockwise from (1, 0).
    expect(cross(vec(1, 0), vec(0, 1))).toBeGreaterThan(0);
    expect(cross(vec(1, 0), vec(0, -1))).toBeLessThan(0);
    expect(cross(vec(1, 0), vec(2, 0))).toBe(0);
  });

  it("measures distance and dot product", () => {
    expect(distance(vec(0, 0), vec(3, 4))).toBe(5);
    expect(dot(vec(1, 2), vec(3, 4))).toBe(11);
  });

  it("returns a signed angle between vectors", () => {
    expect(angleBetween(vec(1, 0), vec(0, 1))).toBeCloseTo(Math.PI / 2, 12);
    expect(angleBetween(vec(1, 0), vec(0, -1))).toBeCloseTo(-Math.PI / 2, 12);
  });
});

describe("rotate", () => {
  // The prototype computed `cos(a) - sin(a)` in place of `x·cos(a) - y·sin(a)`,
  // which made every rotation land on the same point regardless of input.
  it("rotates a quarter turn counter-clockwise about the origin", () => {
    const r = rotate(vec(1, 0), vec(0, 0), Math.PI / 2);
    expect(r.x).toBeCloseTo(0, 12);
    expect(r.y).toBeCloseTo(1, 12);
  });

  it("rotates about an arbitrary centre", () => {
    const r = rotate(vec(11, 10), vec(10, 10), Math.PI);
    expect(r.x).toBeCloseTo(9, 12);
    expect(r.y).toBeCloseTo(10, 12);
  });

  it("depends on the point being rotated", () => {
    const a = rotate(vec(3, 0), vec(0, 0), 0.7);
    const b = rotate(vec(5, 0), vec(0, 0), 0.7);
    expect(a).not.toEqual(b);
  });

  it("leaves the centre fixed", () => {
    expect(rotate(vec(4, 7), vec(4, 7), 1.234)).toEqual(vec(4, 7));
  });
});

describe("normalize and stretchToLength", () => {
  it("normalizes to unit length", () => {
    const n = normalize(vec(3, 4));
    expect(n).not.toBeNull();
    expect(distance(vec(0, 0), n!)).toBeCloseTo(1, 12);
  });

  it("returns null rather than dividing by zero", () => {
    expect(normalize(vec(0, 0))).toBeNull();
  });

  it("stretches while preserving direction", () => {
    const p = stretchToLength(vec(0, 0), vec(3, 4), 10);
    expect(p).toEqual(vec(6, 8));
  });

  // The prototype returned the input unchanged here, silently producing a
  // handle of the wrong length instead of reporting that there is no direction.
  it("returns null when there is no direction to preserve", () => {
    expect(stretchToLength(vec(5, 5), vec(5, 5), 10)).toBeNull();
  });
});

describe("coincident", () => {
  it("is true for identical points and false for distinct ones", () => {
    expect(coincident(vec(1, 1), vec(1, 1))).toBe(true);
    expect(coincident(vec(0, 0), vec(1, 0))).toBe(false);
  });

  it("stays meaningful at large coordinates", () => {
    // Two points a whole design unit apart in a 2048-unit em are distinct.
    expect(coincident(vec(2048, 2048), vec(2049, 2048))).toBe(false);
  });
});

describe("boundsOf", () => {
  it("returns null for an empty list", () => {
    expect(boundsOf([])).toBeNull();
  });

  it("brackets every point", () => {
    expect(boundsOf([vec(1, 5), vec(-3, 2), vec(4, -1)])).toEqual({
      minX: -3,
      minY: -1,
      maxX: 4,
      maxY: 5,
    });
  });
});
