import fc from "fast-check";

import type { Cubic } from "../src/cubic.js";
import { type Vec2, addScaled, perpendicular, sub, vec } from "../src/vec2.js";

const coordinate = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

/**
 * A segment built to be well-conditioned, together with the parameters it was
 * built from.
 *
 * Constructing from anchors, a handle intersection off the chord, and two
 * positive handle scales guarantees `tunniStatus` is `ok`: both handles sit
 * between their anchor and the intersection, so all three are on one side of the
 * chord by construction. Generating four free control points and filtering for
 * `ok` would work too, but it would throw away most of the samples and bias what
 * survives.
 */
export type WellFormed = {
  readonly segment: Cubic;
  readonly a: Vec2;
  readonly b: Vec2;
  readonly intersection: Vec2;
  readonly lambda1: number;
  readonly lambda2: number;
};

function build(
  a: Vec2,
  chordAngle: number,
  chordLength: number,
  along: number,
  height: number,
  lambda1: number,
  lambda2: number,
): WellFormed {
  const direction = vec(Math.cos(chordAngle), Math.sin(chordAngle));
  const b = addScaled(a, direction, chordLength);
  const onChord = addScaled(a, direction, chordLength * along);
  const intersection = addScaled(onChord, perpendicular(direction), height);
  const c1 = addScaled(a, sub(intersection, a), lambda1);
  const c2 = addScaled(b, sub(intersection, b), lambda2);
  return { segment: { a, c1, c2, b }, a, b, intersection, lambda1, lambda2 };
}

/**
 * Well-formed segments across the range of scales a font editor actually sees:
 * anchors anywhere in a few ems, chords from 20 to 900 units, and handles from
 * stubby to nearly touching their intersection.
 */
export const wellFormedSegment: fc.Arbitrary<WellFormed> = fc
  .tuple(
    coordinate(-2000, 2000),
    coordinate(-2000, 2000),
    coordinate(0, Math.PI * 2),
    coordinate(20, 900),
    coordinate(0.15, 0.85),
    coordinate(15, 500),
    coordinate(0.08, 0.92),
    coordinate(0.08, 0.92),
  )
  .map(([ax, ay, angle, chord, along, height, l1, l2]) =>
    build(vec(ax, ay), angle, chord, along, height, l1, l2),
  );

/**
 * Two well-formed segments sharing anchors and a handle intersection, and so
 * sharing handle *directions* — differing only in their handle scales.
 *
 * This is what makes the round-trip property meaningful: the second segment's
 * Tunni point is guaranteed to be reachable from the first, so the test asserts
 * on real work rather than being satisfied by a stream of nulls.
 */
export const sharedDirectionPair: fc.Arbitrary<readonly [WellFormed, WellFormed]> = fc
  .tuple(wellFormedSegment, coordinate(0.08, 0.92), coordinate(0.08, 0.92))
  .map(([base, l1, l2]) => {
    const c1 = addScaled(base.a, sub(base.intersection, base.a), l1);
    const c2 = addScaled(base.b, sub(base.intersection, base.b), l2);
    const other: WellFormed = {
      segment: { a: base.a, c1, c2, b: base.b },
      a: base.a,
      b: base.b,
      intersection: base.intersection,
      lambda1: l1,
      lambda2: l2,
    };
    return [base, other] as const;
  });

/**
 * Four unconstrained control points, including coincident and collinear ones.
 *
 * Used for the totality properties: whatever this produces, the kernel must
 * answer with a finite result or `null`, and never with a `NaN` wearing the
 * shape of a coordinate.
 */
export const arbitrarySegment: fc.Arbitrary<Cubic> = fc
  .tuple(
    coordinate(-1000, 1000),
    coordinate(-1000, 1000),
    coordinate(-1000, 1000),
    coordinate(-1000, 1000),
    coordinate(-1000, 1000),
    coordinate(-1000, 1000),
    coordinate(-1000, 1000),
    coordinate(-1000, 1000),
  )
  .map(([ax, ay, c1x, c1y, c2x, c2y, bx, by]) => ({
    a: vec(ax, ay),
    c1: vec(c1x, c1y),
    c2: vec(c2x, c2y),
    b: vec(bx, by),
  }));

/**
 * Segments drawn from a small pool of coordinates, so coincident points and
 * collinear handles turn up often rather than never.
 */
export const degenerateProneSegment: fc.Arbitrary<Cubic> = fc
  .tuple(
    fc.constantFrom(0, 0, 100, 100, 200, -100),
    fc.constantFrom(0, 0, 100, 100, 200, -100),
    fc.constantFrom(0, 0, 100, 100, 200, -100),
    fc.constantFrom(0, 0, 100, 100, 200, -100),
    fc.constantFrom(0, 0, 100, 100, 200, -100),
    fc.constantFrom(0, 0, 100, 100, 200, -100),
    fc.constantFrom(0, 0, 100, 100, 200, -100),
    fc.constantFrom(0, 0, 100, 100, 200, -100),
  )
  .map(([ax, ay, c1x, c1y, c2x, c2y, bx, by]) => ({
    a: vec(ax, ay),
    c1: vec(c1x, c1y),
    c2: vec(c2x, c2y),
    b: vec(bx, by),
  }));
