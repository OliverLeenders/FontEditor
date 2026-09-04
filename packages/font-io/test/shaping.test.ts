import { describe, expect, it } from "vitest";

import { DEFAULT_FEATURES, NO_SHAPING, featureTags, shaperFor } from "../src/shaping.js";

const LIGA = `
feature liga {
  sub f i by f_i;
  sub f f i by f_f_i;
} liga;
`;

const SMCP = `
@lower = [a b c];
@small = [a.sc b.sc c.sc];
feature smcp {
  sub @lower by @small;
} smcp;
`;

describe("shaping a run", () => {
  it("replaces a ligature's glyphs with the ligature", () => {
    expect(shaperFor(LIGA)(["f", "i", "n"])).toEqual(["f_i", "n"]);
  });

  it("prefers the longer ligature when the file lists it first", () => {
    // `f f i` is written after `f i` here, so the shorter rule has already
    // consumed the pair — which is exactly why a feature file puts its longest
    // ligatures first, and why this reports what the file says rather than
    // silently reordering it.
    expect(shaperFor(LIGA)(["f", "f", "i"])).toEqual(["f", "f_i"]);

    const longestFirst = `
      feature liga {
        sub f f i by f_f_i;
        sub f i by f_i;
      } liga;
    `;
    expect(shaperFor(longestFirst)(["f", "f", "i"])).toEqual(["f_f_i"]);
  });

  it("takes every occurrence, not just the first", () => {
    expect(shaperFor(LIGA)(["f", "i", "x", "f", "i"])).toEqual(["f_i", "x", "f_i"]);
  });

  it("does not let a ligature's output start another match", () => {
    // Non-overlapping, left to right. Anything else fails to terminate on a rule
    // whose output contains its own input.
    const odd = `
      feature liga {
        sub a a by a;
      } liga;
    `;
    expect(shaperFor(odd)(["a", "a", "a", "a"])).toEqual(["a", "a"]);
  });

  it("leaves a run with nothing to substitute alone", () => {
    expect(shaperFor(LIGA)(["n", "o", "n"])).toEqual(["n", "o", "n"]);
  });

  it("pairs off two classes in a single substitution", () => {
    expect(shaperFor(SMCP, ["smcp"])(["a", "b", "d"])).toEqual(["a.sc", "b.sc", "d"]);
  });

  it("swaps in one pass, so a chain of pairs does not run away", () => {
    // `a` becomes `b` and `b` becomes `c`, in one rule. An `a` must come out as
    // a `b`: applying the pairs one after another would carry it on to `c`.
    const chain = `
      feature ss01 {
        sub [a b] by [b c];
      } ss01;
    `;
    expect(shaperFor(chain, ["ss01"])(["a", "b"])).toEqual(["b", "c"]);
  });
});

describe("which features run", () => {
  it("applies the ones a text renderer would turn on by itself", () => {
    expect(DEFAULT_FEATURES).toContain("liga");
    expect(shaperFor(LIGA)(["f", "i"])).toEqual(["f_i"]);
  });

  it("leaves the ones a document has to ask for", () => {
    // Small capitals are not what typing gets you, so a proof must not show them
    // until they are asked for.
    expect(shaperFor(SMCP)(["a", "b"])).toEqual(["a", "b"]);
  });

  it("runs a feature that is asked for by name", () => {
    expect(shaperFor(SMCP, ["smcp"])(["a"])).toEqual(["a.sc"]);
  });

  it("says nothing about a tag the font does not define", () => {
    expect(shaperFor(LIGA, ["smcp"])(["f", "i"])).toEqual(["f", "i"]);
  });

  it("shapes nothing when the source is empty", () => {
    expect(shaperFor("")(["f", "i"])).toEqual(["f", "i"]);
  });

  it("carries on past a source it cannot parse", () => {
    // The Features workspace reports the error. A proof that refused to draw
    // would be reporting it in the least useful place — and the rules above the
    // mistake are still what the font says.
    const broken = `
      feature liga {
        sub f i by f_i;
        wibble;
      } liga;
    `;
    expect(shaperFor(broken)(["f", "i"])).toEqual(["f_i"]);
  });

  it("lists the tags a source defines", () => {
    expect(featureTags(`${LIGA}\n${SMCP}`)).toEqual(["liga", "smcp"]);
  });

  it("has a shaper that does nothing, and copies rather than aliases", () => {
    const names = ["a", "b"];
    const out = NO_SHAPING(names);
    expect(out).toEqual(names);
    expect(out).not.toBe(names);
  });
});
