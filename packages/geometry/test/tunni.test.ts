import { describe, expect, it } from "vitest";

import { cubic } from "../src/cubic.js";
import {
  balance,
  cubicFromLambdas,
  handleIntersection,
  moveTunniLine,
  panOf,
  pannedLambdas,
  setLambdas,
  setTunniPoint,
  tunniLambdas,
  tunniLine,
  tunniPoint,
  tunniStatus,
} from "../src/tunni.js";
import { type Vec2, cross, distance, length, sub, vec } from "../src/vec2.js";
import {
  ASYMMETRIC,
  ASYMMETRIC_BALANCED,
  ASYMMETRIC_INTERSECTION,
  ASYMMETRIC_LAMBDA_1,
  ASYMMETRIC_LAMBDA_2,
  COINCIDENT_ANCHORS,
  CROSSED,
  DEGENERATE_CASES,
  DIVERGENT,
  FLAT,
  PARALLEL_HANDLES,
  SYMMETRIC,
  SYMMETRIC_TUNNI_POINT,
  ZERO_LENGTH_HANDLE,
} from "./fixtures.js";

/**
 * Assert that two vectors are parallel, independent of their magnitudes.
 *
 * A raw cross product would be compared against a threshold that only suits one
 * scale — the same trap the prototype fell into with its literal `7`.
 */
function expectParallel(u: Vec2, v: Vec2): void {
  const scaleRef = length(u) * length(v);
  expect(scaleRef).toBeGreaterThan(0);
  expect(Math.abs(cross(u, v)) / scaleRef).toBeLessThan(1e-9);
}

describe("handleIntersection", () => {
  it("recovers the hand-computed intersection", () => {
    const is = handleIntersection(ASYMMETRIC);
    expect(is).not.toBeNull();
    expect(distance(is!, ASYMMETRIC_INTERSECTION)).toBeCloseTo(0, 9);
  });

  it("returns null when the handles are parallel", () => {
    expect(handleIntersection(PARALLEL_HANDLES)).toBeNull();
  });

  it("returns null when a handle has no length", () => {
    expect(handleIntersection(ZERO_LENGTH_HANDLE)).toBeNull();
  });
});

describe("tunniPoint", () => {
  it("matches the hand-computed value", () => {
    const t = tunniPoint(SYMMETRIC);
    expect(t).not.toBeNull();
    expect(distance(t!, SYMMETRIC_TUNNI_POINT)).toBeCloseTo(0, 9);
  });

  it("returns null when there is no handle intersection", () => {
    expect(tunniPoint(PARALLEL_HANDLES)).toBeNull();
    expect(tunniPoint(FLAT)).toBeNull();
  });
});

describe("tunniLambdas", () => {
  it("reads back the scales the segment was built from", () => {
    const scales = tunniLambdas(ASYMMETRIC);
    expect(scales).not.toBeNull();
    expect(scales!.lambda1).toBeCloseTo(ASYMMETRIC_LAMBDA_1, 9);
    expect(scales!.lambda2).toBeCloseTo(ASYMMETRIC_LAMBDA_2, 9);
  });

  it("round-trips through cubicFromLambdas", () => {
    const rebuilt = cubicFromLambdas(ASYMMETRIC.a, ASYMMETRIC.b, ASYMMETRIC_INTERSECTION, {
      lambda1: ASYMMETRIC_LAMBDA_1,
      lambda2: ASYMMETRIC_LAMBDA_2,
    });
    expect(rebuilt).not.toBeNull();
    expect(distance(rebuilt!.c1, ASYMMETRIC.c1)).toBeCloseTo(0, 9);
    expect(distance(rebuilt!.c2, ASYMMETRIC.c2)).toBeCloseTo(0, 9);
  });

  // An unsigned length ratio cannot tell these apart; a signed projection can.
  it("is negative for a handle pointing away from the intersection", () => {
    const flipped = cubic(ASYMMETRIC.a, vec(-36, -33), ASYMMETRIC.c2, ASYMMETRIC.b);
    const scales = tunniLambdas(flipped);
    expect(scales).not.toBeNull();
    expect(scales!.lambda1).toBeLessThan(0);
  });
});

describe("tunniStatus", () => {
  it("accepts a well-formed segment", () => {
    expect(tunniStatus(ASYMMETRIC)).toBe("ok");
    expect(tunniStatus(SYMMETRIC)).toBe("ok");
  });

  it("names each way a segment can fail", () => {
    expect(tunniStatus(CROSSED)).toBe("crossed");
    expect(tunniStatus(DIVERGENT)).toBe("divergent");
    expect(tunniStatus(FLAT)).toBe("flat");
    expect(tunniStatus(PARALLEL_HANDLES)).toBe("degenerate");
    expect(tunniStatus(COINCIDENT_ANCHORS)).toBe("degenerate");
    expect(tunniStatus(ZERO_LENGTH_HANDLE)).toBe("degenerate");
  });
});

describe("tunniLine", () => {
  it("joins the two control points", () => {
    expect(tunniLine(ASYMMETRIC)).toEqual({ from: ASYMMETRIC.c1, to: ASYMMETRIC.c2 });
  });

  it("is undefined where dragging it has no meaning", () => {
    expect(tunniLine(FLAT)).toBeNull();
    expect(tunniLine(PARALLEL_HANDLES)).toBeNull();
  });

  // Visibility is the caller's decision, driven by status. The line itself is
  // still well defined for a crossed segment and should not vanish mid-drag.
  it("still exists for a crossed segment", () => {
    expect(tunniLine(CROSSED)).not.toBeNull();
  });
});

describe("balance", () => {
  it("averages the two handle scales", () => {
    const result = balance(ASYMMETRIC);
    expect(result).not.toBeNull();
    expect(distance(result!.c1, ASYMMETRIC_BALANCED.c1)).toBeCloseTo(0, 9);
    expect(distance(result!.c2, ASYMMETRIC_BALANCED.c2)).toBeCloseTo(0, 9);
  });

  it("leaves the anchors untouched", () => {
    const result = balance(ASYMMETRIC)!;
    expect(result.a).toEqual(ASYMMETRIC.a);
    expect(result.b).toEqual(ASYMMETRIC.b);
  });

  it("leaves the Tunni line parallel to the chord", () => {
    const result = balance(ASYMMETRIC)!;
    expectParallel(sub(result.b, result.a), sub(result.c2, result.c1));
  });

  it("is idempotent", () => {
    const once = balance(ASYMMETRIC)!;
    const twice = balance(once)!;
    expect(distance(once.c1, twice.c1)).toBeCloseTo(0, 9);
    expect(distance(once.c2, twice.c2)).toBeCloseTo(0, 9);
  });

  // The prototype's guard was `avg !== avg && avg !== Infinity && ...`, which
  // catches NaN by accident and lets an infinity straight through.
  for (const [name, segment] of DEGENERATE_CASES) {
    it(`returns null for ${name}`, () => {
      expect(balance(segment)).toBeNull();
    });
  }
});

describe("setTunniPoint", () => {
  it("is a no-op when asked for the point the segment already has", () => {
    const result = setTunniPoint(SYMMETRIC, SYMMETRIC_TUNNI_POINT);
    expect(result).not.toBeNull();
    expect(distance(result!.c1, SYMMETRIC.c1)).toBeCloseTo(0, 9);
    expect(distance(result!.c2, SYMMETRIC.c2)).toBeCloseTo(0, 9);
  });

  it("reaches a target from different starting handles", () => {
    // Worked by hand: moving ASYMMETRIC's Tunni point to (120, 88) must land on
    // SYMMETRIC's handles, since the two share anchors and handle directions.
    // This is also what makes the operation order-independent — the prototype
    // solved c2 from an already-updated c1 and would not land here.
    const result = setTunniPoint(ASYMMETRIC, SYMMETRIC_TUNNI_POINT);
    expect(result).not.toBeNull();
    expect(distance(result!.c1, SYMMETRIC.c1)).toBeCloseTo(0, 9);
    expect(distance(result!.c2, SYMMETRIC.c2)).toBeCloseTo(0, 9);
  });

  it("keeps the anchors and both handle directions", () => {
    const result = setTunniPoint(ASYMMETRIC, vec(120, 60))!;
    expect(result.a).toEqual(ASYMMETRIC.a);
    expect(result.b).toEqual(ASYMMETRIC.b);
    expectParallel(sub(ASYMMETRIC.c1, ASYMMETRIC.a), sub(result.c1, result.a));
    expectParallel(sub(ASYMMETRIC.c2, ASYMMETRIC.b), sub(result.c2, result.b));
  });

  it("refuses a target that would pull a handle through its anchor", () => {
    expect(setTunniPoint(ASYMMETRIC, vec(120, -4000))).toBeNull();
  });

  it("returns null for a non-finite target", () => {
    expect(setTunniPoint(ASYMMETRIC, vec(Number.NaN, 0))).toBeNull();
    expect(setTunniPoint(ASYMMETRIC, vec(0, Number.POSITIVE_INFINITY))).toBeNull();
  });

  it("returns null when a handle has no direction to follow", () => {
    expect(setTunniPoint(ZERO_LENGTH_HANDLE, vec(120, 60))).toBeNull();
  });
});

describe("moveTunniLine", () => {
  it("is a no-op when the line is dragged onto itself", () => {
    const onLine = vec(
      (ASYMMETRIC.c1.x + ASYMMETRIC.c2.x) / 2,
      (ASYMMETRIC.c1.y + ASYMMETRIC.c2.y) / 2,
    );
    const result = moveTunniLine(ASYMMETRIC, onLine);
    expect(result).not.toBeNull();
    expect(distance(result!.c1, ASYMMETRIC.c1)).toBeCloseTo(0, 9);
    expect(distance(result!.c2, ASYMMETRIC.c2)).toBeCloseTo(0, 9);
  });

  it("keeps the line's direction while moving it", () => {
    const result = moveTunniLine(ASYMMETRIC, vec(100, 40))!;
    expectParallel(sub(ASYMMETRIC.c2, ASYMMETRIC.c1), sub(result.c2, result.c1));
  });

  it("keeps both handle directions", () => {
    const result = moveTunniLine(ASYMMETRIC, vec(100, 40))!;
    expectParallel(sub(ASYMMETRIC.c1, ASYMMETRIC.a), sub(result.c1, result.a));
    expectParallel(sub(ASYMMETRIC.c2, ASYMMETRIC.b), sub(result.c2, result.b));
  });

  // The README calls for this check; the prototype detected the failure only
  // after the fact, by ending the drag.
  it("refuses to pull a handle through its anchor", () => {
    expect(moveTunniLine(ASYMMETRIC, vec(120, -500))).toBeNull();
  });

  it("returns null when there is no line to move", () => {
    expect(moveTunniLine(FLAT, vec(120, 40))).toBeNull();
    expect(moveTunniLine(ZERO_LENGTH_HANDLE, vec(120, 40))).toBeNull();
  });
});

describe("setLambdas", () => {
  it("puts the handles exactly at the scales it was given", () => {
    const next = setLambdas(ASYMMETRIC, { lambda1: 0.4, lambda2: 0.55 })!;
    expect(next).not.toBeNull();

    const scales = tunniLambdas(next)!;
    expect(scales.lambda1).toBeCloseTo(0.4, 9);
    expect(scales.lambda2).toBeCloseTo(0.55, 9);
    // Anchors are not the tension's business.
    expect(next.a).toEqual(ASYMMETRIC.a);
    expect(next.b).toEqual(ASYMMETRIC.b);
  });

  it("refuses a scale that would collapse a handle onto its anchor or past it", () => {
    expect(setLambdas(ASYMMETRIC, { lambda1: 0, lambda2: 0.5 })).toBeNull();
    expect(setLambdas(ASYMMETRIC, { lambda1: -0.2, lambda2: 0.5 })).toBeNull();
  });

  it("declines where there is no intersection to measure against", () => {
    expect(setLambdas(PARALLEL_HANDLES, { lambda1: 0.5, lambda2: 0.5 })).toBeNull();
    expect(setLambdas(ASYMMETRIC, { lambda1: Number.NaN, lambda2: 0.5 })).toBeNull();
  });
});

describe("pan", () => {
  it("reads how lopsided a pair of scales is", () => {
    // 0.3 and 0.7: the second handle holds the extra fifth of the total.
    expect(panOf({ lambda1: ASYMMETRIC_LAMBDA_1, lambda2: ASYMMETRIC_LAMBDA_2 })).toBeCloseTo(
      -0.4,
      12,
    );
    expect(panOf({ lambda1: 0.45, lambda2: 0.45 })).toBe(0);
    expect(panOf({ lambda1: 0.5, lambda2: -0.5 })).toBeNull();
  });

  it("holds the sum, so panning moves length across rather than adding it", () => {
    const scales = { lambda1: ASYMMETRIC_LAMBDA_1, lambda2: ASYMMETRIC_LAMBDA_2 };
    for (const at of [-0.9, -0.25, 0, 0.25, 0.9]) {
      const panned = pannedLambdas(scales, at)!;
      expect(panned.lambda1 + panned.lambda2).toBeCloseTo(1, 12);
      expect(panOf(panned)).toBeCloseTo(at, 12);
    }
  });

  it("is the balance command at its middle", () => {
    const scales = tunniLambdas(ASYMMETRIC)!;
    const centred = setLambdas(ASYMMETRIC, pannedLambdas(scales, 0)!)!;
    const balanced = balance(ASYMMETRIC)!;

    expect(distance(centred.c1, balanced.c1)).toBeLessThan(1e-9);
    expect(distance(centred.c2, balanced.c2)).toBeLessThan(1e-9);
    expect(distance(centred.c1, ASYMMETRIC_BALANCED.c1)).toBeLessThan(1e-9);
  });

  it("slides the Tunni point along the chord, which is what makes it a pan", () => {
    // The claim the whole choice of invariant rests on: holding the sum moves
    // the Tunni point by a multiple of (b - a) and by nothing across it. Here
    // the chord is horizontal, so panning may move x and must not move y.
    const scales = tunniLambdas(ASYMMETRIC)!;
    const before = tunniPoint(ASYMMETRIC)!;

    for (const at of [-0.6, 0, 0.6]) {
      const panned = setLambdas(ASYMMETRIC, pannedLambdas(scales, at)!)!;
      const after = tunniPoint(panned)!;
      expect(after.y).toBeCloseTo(before.y, 9);
    }

    const far = setLambdas(ASYMMETRIC, pannedLambdas(scales, 0.6)!)!;
    expect(tunniPoint(far)!.x).not.toBeCloseTo(before.x, 3);
  });
});
