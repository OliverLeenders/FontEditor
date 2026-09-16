import { describe, expect, it } from "vitest";

import { findAll, matchFrom, replaced } from "../src/search.js";

const PLAIN = { matchCase: false, wholeWord: false };

describe("finding", () => {
  it("finds literal text, not a pattern", () => {
    expect(findAll("a.sc abc a.sc", "a.sc", PLAIN)).toEqual([
      { start: 0, end: 4 },
      { start: 9, end: 13 },
    ]);
  });

  it("ignores case unless asked not to", () => {
    expect(findAll("Liga liga", "liga", PLAIN)).toHaveLength(2);
    expect(findAll("Liga liga", "liga", { ...PLAIN, matchCase: true })).toEqual([
      { start: 5, end: 9 },
    ]);
  });

  it("takes a whole word as a whole name", () => {
    const text = "sub a by a.sc; sub [a b]' by c;";
    expect(findAll(text, "a", { ...PLAIN, wholeWord: true }).map((m) => m.start)).toEqual([4, 20]);
  });

  it("finds nothing for nothing", () => {
    expect(findAll("abc", "", PLAIN)).toEqual([]);
  });
});

describe("replacing", () => {
  it("replaces every match given, and only those", () => {
    const text = "sub a by a.sc;";
    const matches = findAll(text, "a", { ...PLAIN, wholeWord: true });
    expect(replaced(text, matches, "b")).toBe("sub b by a.sc;");
    expect(replaced(text, findAll(text, "a", PLAIN), "x")).toBe("sub x by x.sc;");
  });
});

describe("the match to start from", () => {
  const matches = [
    { start: 2, end: 3 },
    { start: 8, end: 9 },
  ];

  it("is the first at or after the place, wrapping round", () => {
    expect(matchFrom(matches, 0)).toBe(0);
    expect(matchFrom(matches, 3)).toBe(1);
    expect(matchFrom(matches, 9)).toBe(0);
    expect(matchFrom([], 4)).toBe(-1);
  });
});
