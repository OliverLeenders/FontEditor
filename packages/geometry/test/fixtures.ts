import type { Cubic } from "../src/cubic.js";
import { vec } from "../src/vec2.js";

/**
 * The reference segment, worked out by hand so the tests assert against known
 * values rather than against whatever the implementation happens to produce.
 *
 * Anchors on the baseline 240 units apart, handle intersection 110 units above
 * the chord's midpoint, and asymmetric handle scales:
 *
 *   a  = (0, 0)          b  = (240, 0)          s = (120, 110)
 *   λ₁ = 0.3             λ₂ = 0.7
 *   c1 = a + 0.3·(s − a) = (36, 33)
 *   c2 = b + 0.7·(s − b) = (156, 77)
 *
 * Balancing sets both scales to 0.5, giving c1 = (60, 55) and c2 = (180, 55) —
 * a Tunni line at constant y, parallel to the chord, as the definition requires.
 */
export const ASYMMETRIC: Cubic = {
  a: vec(0, 0),
  c1: vec(36, 33),
  c2: vec(156, 77),
  b: vec(240, 0),
};

export const ASYMMETRIC_INTERSECTION = vec(120, 110);
export const ASYMMETRIC_LAMBDA_1 = 0.3;
export const ASYMMETRIC_LAMBDA_2 = 0.7;

export const ASYMMETRIC_BALANCED: Cubic = {
  a: vec(0, 0),
  c1: vec(60, 55),
  c2: vec(180, 55),
  b: vec(240, 0),
};

/**
 * The same anchors and intersection with equal scales of 0.45.
 *
 *   c1 = (54, 49.5)      c2 = (186, 49.5)
 *
 * Its Tunni point works out to (120, 88): symmetric in x, and between the curve
 * and the handle intersection in y.
 *
 *   t = 2c1 − a + 2c2 − b − s
 *     = (108 + 372 − 240 − 120, 99 + 99 − 110)
 *     = (120, 88)
 */
export const SYMMETRIC: Cubic = {
  a: vec(0, 0),
  c1: vec(54, 49.5),
  c2: vec(186, 49.5),
  b: vec(240, 0),
};

export const SYMMETRIC_TUNNI_POINT = vec(120, 88);

/** Handles on opposite sides of the chord. */
export const CROSSED: Cubic = {
  a: vec(0, 0),
  c1: vec(60, 80),
  c2: vec(180, -80),
  b: vec(240, 0),
};

/** Handles on the same side but pointing away from each other. */
export const DIVERGENT: Cubic = {
  a: vec(0, 0),
  c1: vec(-60, 60),
  c2: vec(300, 60),
  b: vec(240, 0),
};

/** All four control points on the chord. */
export const FLAT: Cubic = {
  a: vec(0, 0),
  c1: vec(80, 0),
  c2: vec(160, 0),
  b: vec(240, 0),
};

/** Handles parallel to each other, so they never intersect. */
export const PARALLEL_HANDLES: Cubic = {
  a: vec(0, 0),
  c1: vec(0, 80),
  c2: vec(240, 80),
  b: vec(240, 0),
};

/** Both anchors at the same place. */
export const COINCIDENT_ANCHORS: Cubic = {
  a: vec(100, 100),
  c1: vec(140, 160),
  c2: vec(60, 160),
  b: vec(100, 100),
};

/** A handle sitting exactly on its own anchor. */
export const ZERO_LENGTH_HANDLE: Cubic = {
  a: vec(0, 0),
  c1: vec(0, 0),
  c2: vec(180, 60),
  b: vec(240, 0),
};

/** Every segment above that should be rejected by the kernel. */
export const DEGENERATE_CASES: ReadonlyArray<readonly [string, Cubic]> = [
  ["flat", FLAT],
  ["parallel handles", PARALLEL_HANDLES],
  ["coincident anchors", COINCIDENT_ANCHORS],
  ["zero-length handle", ZERO_LENGTH_HANDLE],
];
