import { describe, expect, it } from "vitest";

import {
  EMPTY_KERNING,
  type Kerning,
  clearKern,
  groupKey,
  kernIndex,
  kernMatch,
  kernPairCount,
  kernPairs,
  kernValue,
  removeKernGroup,
  setKern,
  setKernException,
  setKernGroup,
} from "../src/kerning.js";

/**
 * Round letters on the left, stems and diagonals on the right, plus a couple of
 * exceptions — the shape real kerning takes.
 */
function sample(): Kerning {
  let k: Kerning = EMPTY_KERNING;
  k = setKernGroup(k, "first", "O", ["O", "Q", "C", "G"]);
  k = setKernGroup(k, "first", "T", ["T"]);
  k = setKernGroup(k, "second", "A", ["A", "Aacute"]);
  k = setKernGroup(k, "second", "n", ["n", "m", "r"]);

  k = setKern(k, groupKey("O"), groupKey("A"), -40);
  k = setKern(k, groupKey("T"), groupKey("A"), -80);
  k = setKern(k, "T", "A", -95); // an exception, more specific than the classes
  k = setKern(k, "V", "a", -30); // a plain pair, no groups involved
  return k;
}

const value = (k: Kerning, left: string, right: string): number =>
  kernValue(kernIndex(k), left, right);

describe("kernValue", () => {
  it("finds a value written between two groups", () => {
    expect(value(sample(), "O", "A")).toBe(-40);
    // Every member of each group gets it.
    expect(value(sample(), "Q", "Aacute")).toBe(-40);
    expect(value(sample(), "G", "A")).toBe(-40);
  });

  it("finds a plain pair with no groups involved", () => {
    expect(value(sample(), "V", "a")).toBe(-30);
  });

  it("lets the more specific pair win", () => {
    // T is in a group kerned -80 against the A group, but T+A says -95.
    expect(value(sample(), "T", "A")).toBe(-95);
    // Its groupmate is unaffected, which is the point of an exception.
    expect(value(sample(), "T", "Aacute")).toBe(-80);
  });

  it("prefers a glyph on either side over a group on that side", () => {
    let k = sample();
    k = setKern(k, "O", groupKey("A"), -10);
    expect(value(k, "O", "A")).toBe(-10);
    expect(value(k, "Q", "A")).toBe(-40);
  });

  it("is zero for a pair nobody wrote", () => {
    expect(value(sample(), "x", "y")).toBe(0);
    expect(value(EMPTY_KERNING, "A", "V")).toBe(0);
  });

  it("does not kern a glyph that is in no group against a group rule", () => {
    // "z" is not in the O group, so the O/A rule must not reach it.
    expect(value(sample(), "z", "A")).toBe(0);
  });

  it("treats an explicit zero as an answer, not as absence", () => {
    // "these two, specifically, are not kerned" has to beat the class.
    const k = setKernException(sample(), "T", "Aacute");
    expect(value(k, "T", "Aacute")).toBe(0);
    expect(value(k, "T", "A")).toBe(-95);
  });
});

describe("kernMatch", () => {
  it("says which pair applied and whether a group was involved", () => {
    const index = kernIndex(sample());
    expect(kernMatch(index, "O", "A")).toMatchObject({
      first: "@O",
      second: "@A",
      value: -40,
      grouped: true,
    });
    expect(kernMatch(index, "T", "A")).toMatchObject({
      first: "T",
      second: "A",
      value: -95,
      grouped: false,
    });
  });

  it("is null when nothing applied", () => {
    expect(kernMatch(kernIndex(sample()), "x", "y")).toBeNull();
  });
});

describe("kernIndex", () => {
  it("puts a glyph in at most one group per side", () => {
    let k = setKernGroup(EMPTY_KERNING, "first", "one", ["A"]);
    k = setKernGroup(k, "first", "two", ["A"]);
    // Predictable rather than arbitrary: the first listed wins.
    expect(kernIndex(k).firstOf.get("A")).toBe("one");
  });

  it("keeps the two sides apart", () => {
    let k = setKernGroup(EMPTY_KERNING, "first", "O", ["O"]);
    k = setKernGroup(k, "second", "O", ["C"]);
    const index = kernIndex(k);
    expect(index.firstOf.get("O")).toBe("O");
    expect(index.secondOf.get("O")).toBeUndefined();
    expect(index.secondOf.get("C")).toBe("O");
  });
});

describe("setKern", () => {
  it("stores a value", () => {
    const k = setKern(EMPTY_KERNING, "A", "V", -50);
    expect(value(k, "A", "V")).toBe(-50);
    expect(kernPairCount(k)).toBe(1);
  });

  it("clears rather than storing a zero", () => {
    const k = setKern(setKern(EMPTY_KERNING, "A", "V", -50), "A", "V", 0);
    expect(kernPairCount(k)).toBe(0);
    expect(k.pairs["A"]).toBeUndefined();
  });

  it("returns the same object when nothing changes", () => {
    const k = setKern(EMPTY_KERNING, "A", "V", -50);
    expect(setKern(k, "A", "V", -50)).toBe(k);
    expect(clearKern(k, "A", "nothing")).toBe(k);
  });

  it("leaves other pairs in the same row alone", () => {
    let k = setKern(EMPTY_KERNING, "A", "V", -50);
    k = setKern(k, "A", "W", -30);
    k = clearKern(k, "A", "V");
    expect(value(k, "A", "W")).toBe(-30);
    expect(value(k, "A", "V")).toBe(0);
  });
});

describe("removeKernGroup", () => {
  it("takes the pairs that referred to it as well", () => {
    // A rule naming a group that no longer exists can never match, and reads as
    // kerning that mysteriously does nothing.
    const k = removeKernGroup(sample(), "first", "O");
    expect(k.firstGroups["O"]).toBeUndefined();
    expect(value(k, "O", "A")).toBe(0);
    // Everything else survives.
    expect(value(k, "T", "A")).toBe(-95);
    expect(value(k, "V", "a")).toBe(-30);
  });

  it("clears second-side references too", () => {
    const k = removeKernGroup(sample(), "second", "A");
    expect(value(k, "O", "A")).toBe(0);
    expect(value(k, "T", "A")).toBe(-95); // the plain exception is untouched
  });

  it("does nothing for a group that is not there", () => {
    const k = sample();
    expect(removeKernGroup(k, "first", "nope")).toBe(k);
  });
});

describe("kernPairs", () => {
  it("lists every pair once", () => {
    const all = kernPairs(sample());
    expect(all).toHaveLength(4);
    expect(all).toContainEqual({ first: "T", second: "A", value: -95 });
    expect(all).toContainEqual({ first: "@O", second: "@A", value: -40 });
  });
});
