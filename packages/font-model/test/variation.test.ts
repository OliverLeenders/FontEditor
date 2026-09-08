import { describe, expect, it } from "vitest";

import { WEIGHT, axis } from "../src/designspace.js";
import { masterWeights, supportScalar, supportsFor } from "../src/variation.js";

/**
 * How much each master counts, anywhere in the designspace.
 *
 * Two properties carry the whole model, and everything here is a way of asking
 * about one of them. A designspace must reproduce the drawings it was made from
 * — at a master's own location that master counts one and the rest count
 * nothing — and the weights must add to one everywhere, or an instance is a sum
 * of letters rather than an average of them.
 */

const WIDTH = axis("wdth", "Width", 75, 100, 125);

/** The masters' locations, and the weights at a point among them. */
const at = (locations: Record<string, number>[], where: Record<string, number>, axes = [WEIGHT]) =>
  masterWeights(axes, locations, where);

const sums = (weights: readonly number[]): number => weights.reduce((a, b) => a + b, 0);

describe("one axis", () => {
  const light = { wght: 100 };
  const regular = { wght: 400 };
  const black = { wght: 900 };

  it("gives a master all of the say at its own location", () => {
    const weights = at([regular, black], regular);
    expect(weights[0]).toBeCloseTo(1, 10);
    expect(weights[1]).toBeCloseTo(0, 10);

    const there = at([regular, black], black);
    expect(there[0]).toBeCloseTo(0, 10);
    expect(there[1]).toBeCloseTo(1, 10);
  });

  it("mixes the two evenly in the middle", () => {
    // 650 is halfway from 400 to 900 on the normalised scale.
    const weights = at([regular, black], { wght: 650 });
    expect(weights[0]).toBeCloseTo(0.5, 10);
    expect(weights[1]).toBeCloseTo(0.5, 10);
  });

  it("adds up to one wherever you stand", () => {
    for (const wght of [100, 250, 400, 512, 650, 900]) {
      expect(sums(at([light, regular, black], { wght }))).toBeCloseTo(1, 10);
    }
  });

  it("keeps a master out of the half of the axis it is not in", () => {
    // Between light and regular, the black has nothing to say.
    const weights = at([light, regular, black], { wght: 250 });
    expect(weights[2]).toBeCloseTo(0, 10);
    expect(weights[0]).toBeCloseTo(0.5, 10);
    expect(weights[1]).toBeCloseTo(0.5, 10);
  });

  it("stops at the ends rather than running past them", () => {
    const weights = at([regular, black], { wght: 2000 });
    // The location is clamped onto the axis, so this is the black exactly.
    expect(weights[1]).toBeCloseTo(1, 10);
  });
});

describe("two axes", () => {
  const axes = [WEIGHT, WIDTH];
  const regular = { wght: 400, wdth: 100 };
  const black = { wght: 900, wdth: 100 };
  const condensed = { wght: 400, wdth: 75 };
  const blackCondensed = { wght: 900, wdth: 75 };

  it("reproduces every corner exactly", () => {
    const corners = [regular, black, condensed, blackCondensed];
    for (const [i, corner] of corners.entries()) {
      const weights = at(corners, corner, axes);
      expect(weights[i]).toBeCloseTo(1, 10);
      expect(sums(weights)).toBeCloseTo(1, 10);
    }
  });

  it("mixes all four in the middle of the square", () => {
    const corners = [regular, black, condensed, blackCondensed];
    const weights = at(corners, { wght: 650, wdth: 87.5 }, axes);

    // A point in the middle is between no pair of them, which is the case the
    // easy answer cannot do at all.
    for (const weight of weights) expect(weight).toBeCloseTo(0.25, 10);
    expect(sums(weights)).toBeCloseTo(1, 10);
  });

  it("does not let a master off the axis crowd one on it", () => {
    // The condensed sits at another width and has no say in where the black's
    // region along the weight axis ends.
    const weights = at([regular, black, condensed], { wght: 650, wdth: 100 }, axes);
    expect(weights[2]).toBeCloseTo(0, 10);
    expect(weights[1]).toBeCloseTo(0.5, 10);
  });
});

describe("the regions themselves", () => {
  it("gives the default master no say in any direction", () => {
    const [regular] = supportsFor([WEIGHT], [{ wght: 400 }, { wght: 900 }]);
    // It is the base everything else is measured from.
    expect(regular).toEqual({});
  });

  it("stops a master at its neighbour rather than at the end of the axis", () => {
    const supports = supportsFor([WEIGHT], [{ wght: 400 }, { wght: 900 }, { wght: 650 }]);
    const black = supports[1];

    expect(black?.["wght"]?.peak).toBeCloseTo(1, 10);
    // The 650 master sits between, so the black starts from there.
    expect(black?.["wght"]?.min).toBeCloseTo(0.5, 10);
  });

  it("counts for nothing outside its region", () => {
    const support = { wght: { min: 0, peak: 1, max: 1 } };
    expect(supportScalar(support, { wght: 0 })).toBe(0);
    expect(supportScalar(support, { wght: 1 })).toBe(1);
    expect(supportScalar(support, { wght: 0.5 })).toBeCloseTo(0.5, 10);
  });

  it("ignores an axis it has nothing to say about", () => {
    const support = { wght: { min: 0, peak: 1, max: 1 } };
    // No width in the support at all: moving along it changes nothing.
    expect(supportScalar(support, { wght: 1, wdth: -1 })).toBe(1);
  });
});

describe("a font with one master", () => {
  it("is entirely itself, wherever you ask", () => {
    expect(masterWeights([WEIGHT], [{ wght: 400 }], { wght: 900 })).toEqual([1]);
    expect(masterWeights([], [], {})).toEqual([]);
  });
});
