import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Cubic } from "../src/cubic.js";
import {
  balance,
  handleIntersection,
  moveTunniLine,
  setTunniPoint,
  tunniLambdas,
  tunniPoint,
  tunniStatus,
} from "../src/tunni.js";
import { type Vec2, cross, distance, length, sub } from "../src/vec2.js";
import {
  arbitrarySegment,
  degenerateProneSegment,
  sharedDirectionPair,
  wellFormedSegment,
} from "./arbitraries.js";

/** Relative parallelism measure: |sin θ| between two vectors, or 0 if either is null. */
function sineBetween(u: Vec2, v: Vec2): number {
  const scaleRef = length(u) * length(v);
  if (scaleRef === 0) return 0;
  return Math.abs(cross(u, v)) / scaleRef;
}

/** Distance expressed as a fraction of the segment's chord, so scale drops out. */
function relativeError(actual: Vec2, expected: Vec2, segment: Cubic): number {
  const chord = Math.max(length(sub(segment.b, segment.a)), 1);
  return distance(actual, expected) / chord;
}

function isFinitePoint(p: Vec2): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function isFiniteCubic(s: Cubic): boolean {
  return isFinitePoint(s.a) && isFinitePoint(s.c1) && isFinitePoint(s.c2) && isFinitePoint(s.b);
}

const RUNS = 2000;

describe("totality", () => {
  // The class of bug this replaces: the prototype's `intersection` returned an
  // arbitrary point on a zero determinant, and `balance` let an infinity through
  // its guard. Both produced coordinates that are numbers and are not answers.
  it("never returns a non-finite result, for any input", () => {
    fc.assert(
      fc.property(fc.oneof(arbitrarySegment, degenerateProneSegment), (segment) => {
        const is = handleIntersection(segment);
        expect(is === null || isFinitePoint(is)).toBe(true);

        const t = tunniPoint(segment);
        expect(t === null || isFinitePoint(t)).toBe(true);

        const scales = tunniLambdas(segment);
        expect(
          scales === null || (Number.isFinite(scales.lambda1) && Number.isFinite(scales.lambda2)),
        ).toBe(true);

        const balanced = balance(segment);
        expect(balanced === null || isFiniteCubic(balanced)).toBe(true);

        const moved = moveTunniLine(segment, segment.c1);
        expect(moved === null || isFiniteCubic(moved)).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it("always classifies a segment, and only says ok when an intersection exists", () => {
    fc.assert(
      fc.property(fc.oneof(arbitrarySegment, degenerateProneSegment), (segment) => {
        const status = tunniStatus(segment);
        expect(["ok", "flat", "crossed", "divergent", "degenerate"]).toContain(status);
        if (status === "ok") {
          expect(handleIntersection(segment)).not.toBeNull();
          expect(tunniPoint(segment)).not.toBeNull();
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("reports every constructed well-formed segment as ok", () => {
    fc.assert(
      fc.property(wellFormedSegment, ({ segment }) => {
        expect(tunniStatus(segment)).toBe("ok");
      }),
      { numRuns: RUNS },
    );
  });
});

describe("handle scales", () => {
  it("recovers the scales a segment was built from", () => {
    fc.assert(
      fc.property(wellFormedSegment, ({ segment, lambda1, lambda2 }) => {
        const scales = tunniLambdas(segment);
        expect(scales).not.toBeNull();
        expect(Math.abs(scales!.lambda1 - lambda1)).toBeLessThan(1e-6);
        expect(Math.abs(scales!.lambda2 - lambda2)).toBeLessThan(1e-6);
      }),
      { numRuns: RUNS },
    );
  });

  it("recovers the intersection a segment was built from", () => {
    fc.assert(
      fc.property(wellFormedSegment, ({ segment, intersection }) => {
        const is = handleIntersection(segment);
        expect(is).not.toBeNull();
        expect(relativeError(is!, intersection, segment)).toBeLessThan(1e-6);
      }),
      { numRuns: RUNS },
    );
  });
});

describe("invariants shared by every Tunni operation", () => {
  const operations: ReadonlyArray<readonly [string, (s: Cubic) => Cubic | null]> = [
    ["balance", (s) => balance(s)],
    ["setTunniPoint", (s) => (tunniPoint(s) === null ? null : setTunniPoint(s, tunniPoint(s)!))],
    ["moveTunniLine", (s) => moveTunniLine(s, s.c1)],
  ];

  for (const [name, operation] of operations) {
    it(`${name} leaves the anchors exactly where they were`, () => {
      fc.assert(
        fc.property(wellFormedSegment, ({ segment }) => {
          const result = operation(segment);
          if (result === null) return;
          expect(result.a).toEqual(segment.a);
          expect(result.b).toEqual(segment.b);
        }),
        { numRuns: RUNS },
      );
    });

    it(`${name} preserves both handle directions`, () => {
      fc.assert(
        fc.property(wellFormedSegment, ({ segment }) => {
          const result = operation(segment);
          if (result === null) return;
          expect(sineBetween(sub(segment.c1, segment.a), sub(result.c1, result.a))).toBeLessThan(
            1e-6,
          );
          expect(sineBetween(sub(segment.c2, segment.b), sub(result.c2, result.b))).toBeLessThan(
            1e-6,
          );
        }),
        { numRuns: RUNS },
      );
    });

    it(`${name} never moves a handle through its anchor`, () => {
      fc.assert(
        fc.property(wellFormedSegment, ({ segment }) => {
          const result = operation(segment);
          if (result === null) return;
          const scales = tunniLambdas(result);
          expect(scales).not.toBeNull();
          expect(scales!.lambda1).toBeGreaterThan(0);
          expect(scales!.lambda2).toBeGreaterThan(0);
        }),
        { numRuns: RUNS },
      );
    });
  }
});

describe("setTunniPoint", () => {
  // The central round-trip. The target is drawn from a segment sharing anchors
  // and handle directions, so it is always reachable and the property cannot be
  // satisfied vacuously by returning null.
  it("puts the Tunni point where it was asked to", () => {
    fc.assert(
      fc.property(sharedDirectionPair, ([from, to]) => {
        const target = tunniPoint(to.segment);
        expect(target).not.toBeNull();

        const result = setTunniPoint(from.segment, target!);
        expect(result).not.toBeNull();

        const achieved = tunniPoint(result!);
        expect(achieved).not.toBeNull();
        expect(relativeError(achieved!, target!, from.segment)).toBeLessThan(1e-6);
      }),
      { numRuns: RUNS },
    );
  });

  // Stronger, and the reason solve order matters: the map from handle scales to
  // Tunni point is invertible, so reaching the target must reproduce the exact
  // handles that generated it, whatever handles we started from.
  it("reconstructs the handles that generated the target", () => {
    fc.assert(
      fc.property(sharedDirectionPair, ([from, to]) => {
        const target = tunniPoint(to.segment);
        const result = setTunniPoint(from.segment, target!);
        expect(result).not.toBeNull();
        expect(relativeError(result!.c1, to.segment.c1, from.segment)).toBeLessThan(1e-6);
        expect(relativeError(result!.c2, to.segment.c2, from.segment)).toBeLessThan(1e-6);
      }),
      { numRuns: RUNS },
    );
  });

  it("does not depend on which handle is solved first", () => {
    // Applying the operation twice must be the same as applying it once: the
    // second call starts from handles that already satisfy the target.
    fc.assert(
      fc.property(sharedDirectionPair, ([from, to]) => {
        const target = tunniPoint(to.segment)!;
        const once = setTunniPoint(from.segment, target);
        expect(once).not.toBeNull();
        const twice = setTunniPoint(once!, target);
        expect(twice).not.toBeNull();
        expect(relativeError(twice!.c1, once!.c1, from.segment)).toBeLessThan(1e-6);
        expect(relativeError(twice!.c2, once!.c2, from.segment)).toBeLessThan(1e-6);
      }),
      { numRuns: RUNS },
    );
  });
});

describe("balance", () => {
  it("leaves the Tunni line parallel to the chord", () => {
    fc.assert(
      fc.property(wellFormedSegment, ({ segment }) => {
        const result = balance(segment);
        expect(result).not.toBeNull();
        expect(sineBetween(sub(result!.b, result!.a), sub(result!.c2, result!.c1))).toBeLessThan(
          1e-6,
        );
      }),
      { numRuns: RUNS },
    );
  });

  it("equalises the two handle scales", () => {
    fc.assert(
      fc.property(wellFormedSegment, ({ segment }) => {
        const scales = tunniLambdas(balance(segment)!);
        expect(scales).not.toBeNull();
        expect(Math.abs(scales!.lambda1 - scales!.lambda2)).toBeLessThan(1e-6);
      }),
      { numRuns: RUNS },
    );
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(wellFormedSegment, ({ segment }) => {
        const once = balance(segment);
        expect(once).not.toBeNull();
        const twice = balance(once!);
        expect(twice).not.toBeNull();
        expect(relativeError(twice!.c1, once!.c1, segment)).toBeLessThan(1e-6);
        expect(relativeError(twice!.c2, once!.c2, segment)).toBeLessThan(1e-6);
      }),
      { numRuns: RUNS },
    );
  });

  it("sets each scale to the mean of the originals", () => {
    fc.assert(
      fc.property(wellFormedSegment, ({ segment, lambda1, lambda2 }) => {
        const scales = tunniLambdas(balance(segment)!);
        expect(Math.abs(scales!.lambda1 - (lambda1 + lambda2) / 2)).toBeLessThan(1e-6);
      }),
      { numRuns: RUNS },
    );
  });
});

describe("moveTunniLine", () => {
  it("passes the line through the point it was dragged to", () => {
    fc.assert(
      fc.property(wellFormedSegment, ({ segment }) => {
        // Drag to a point on the existing line, offset along it — the line must
        // still contain that point afterwards.
        const along = sub(segment.c2, segment.c1);
        const target = {
          x: segment.c1.x + along.x * 0.25,
          y: segment.c1.y + along.y * 0.25,
        };
        const result = moveTunniLine(segment, target);
        if (result === null) return;
        expect(sineBetween(sub(result.c2, result.c1), sub(target, result.c1))).toBeLessThan(1e-6);
      }),
      { numRuns: RUNS },
    );
  });

  it("keeps the line's direction", () => {
    fc.assert(
      fc.property(wellFormedSegment, ({ segment }) => {
        const result = moveTunniLine(segment, segment.c1);
        if (result === null) return;
        expect(sineBetween(sub(segment.c2, segment.c1), sub(result.c2, result.c1))).toBeLessThan(
          1e-6,
        );
      }),
      { numRuns: RUNS },
    );
  });
});
