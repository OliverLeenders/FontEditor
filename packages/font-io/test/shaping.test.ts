import { describe, expect, it } from "vitest";

import {
  DEFAULT_FEATURES,
  NO_POSITIONING,
  NO_SHAPING,
  featureTags,
  positionerFor,
  shaperFor,
} from "../src/shaping.js";

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

const CALT = `
feature calt {
  sub a b' c by b.alt;
} calt;
`;

const CLASSES = `
@round = [o c e];
feature calt {
  sub @round n' by n.alt;
} calt;
`;

const IGNORING = `
feature calt {
  ignore sub f a';
  sub a' by a.alt;
} calt;
`;

describe("shaping a run in context", () => {
  it("replaces the marked glyph only where the context holds", () => {
    expect(shaperFor(CALT)(["a", "b", "c"])).toEqual(["a", "b.alt", "c"]);
    expect(shaperFor(CALT)(["x", "b", "c"])).toEqual(["x", "b", "c"]);
    expect(shaperFor(CALT)(["a", "b", "x"])).toEqual(["a", "b", "x"]);
  });

  it("wants the whole context, not the end of the run", () => {
    // Nothing follows the b, so the lookahead cannot match.
    expect(shaperFor(CALT)(["a", "b"])).toEqual(["a", "b"]);
  });

  it("matches a class anywhere in the context", () => {
    expect(shaperFor(CLASSES)(["o", "n"])).toEqual(["o", "n.alt"]);
    expect(shaperFor(CLASSES)(["e", "n"])).toEqual(["e", "n.alt"]);
    expect(shaperFor(CLASSES)(["t", "n"])).toEqual(["t", "n"]);
  });

  it("lets an ignore rule stop the rule behind it", () => {
    expect(shaperFor(IGNORING)(["x", "a"])).toEqual(["x", "a.alt"]);
    expect(shaperFor(IGNORING)(["f", "a"])).toEqual(["f", "a"]);
  });

  it("applies a ligature that only happens in context", () => {
    const source = `feature calt { sub x f' i' by f_i; } calt;`;
    expect(shaperFor(source)(["x", "f", "i"])).toEqual(["x", "f_i"]);
    expect(shaperFor(source)(["y", "f", "i"])).toEqual(["y", "f", "i"]);
  });

  it("pairs a marked class off with its replacements", () => {
    const source = `
      @from = [a b];
      @to = [a.alt b.alt];
      feature calt { sub x @from' by @to; } calt;
    `;
    expect(shaperFor(source)(["x", "a"])).toEqual(["x", "a.alt"]);
    expect(shaperFor(source)(["x", "b"])).toEqual(["x", "b.alt"]);
  });

  it("steps past everything it matched, not just the first glyph", () => {
    // Both marked glyphs are consumed, so the second cannot start a match of
    // its own. Without that a rule whose output feeds its own input never ends.
    const source = `feature calt { sub x a' a' by aa; } calt;`;
    expect(shaperFor(source)(["x", "a", "a", "a"])).toEqual(["x", "aa", "a"]);
  });

  it("lets what it produced satisfy the next match", () => {
    // The x it writes is the x the following a needs behind it, so both are
    // replaced. That is what a shaper does: the context is the run as it now
    // stands, not the text that was typed.
    const source = `feature calt { sub x a' by x; } calt;`;
    expect(shaperFor(source)(["x", "a", "a"])).toEqual(["x", "x", "x"]);
  });

  it("sees the run as it now stands when it looks backwards", () => {
    // The first rule turns the b into b.alt, and the second is written against
    // what the first produced — which is what a shaper does and the only reading
    // under which two rules in a row compose.
    const source = `
      feature calt {
        sub a b' by b.alt;
        sub b.alt c' by c.alt;
      } calt;
    `;
    expect(shaperFor(source)(["a", "b", "c"])).toEqual(["a", "b.alt", "c.alt"]);
  });

  it("leaves a run alone when the feature is not asked for", () => {
    expect(shaperFor(CALT, ["liga"])(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });
});

const CPSP = `
@caps = [a b];
feature cpsp {
  pos @caps <10 -5 20 0>;
} cpsp;
`;

describe("positioning a run", () => {
  it("gives an entry per glyph and null where nothing applies", () => {
    expect(positionerFor(CPSP, ["cpsp"])(["a", "n"])).toEqual([
      { x: 10, y: -5, xAdvance: 20, yAdvance: 0 },
      null,
    ]);
  });

  it("applies one value to every member of a class", () => {
    const values = positionerFor(CPSP, ["cpsp"])(["a", "b"]);
    expect(values[0]).toEqual(values[1]);
  });

  it("reads a bare number as an advance", () => {
    expect(positionerFor("feature cpsp { pos a 20; } cpsp;", ["cpsp"])(["a"])).toEqual([
      { x: 0, y: 0, xAdvance: 20, yAdvance: 0 },
    ]);
  });

  it("takes the first rule of a feature and not the second", () => {
    // One subtable holds one answer for a glyph, and the subtables are tried in
    // the order they were written.
    const source = "feature cpsp { pos a 20; pos a 40; } cpsp;";
    expect(positionerFor(source, ["cpsp"])(["a"])[0]?.xAdvance).toBe(20);
  });

  it("adds up what two features each ask for", () => {
    // Two lookups both apply, which is what makes them two lookups.
    const source = `
      feature cpsp { pos a 20; } cpsp;
      feature test { pos a <5 0 5 0>; } test;
    `;
    expect(positionerFor(source, ["cpsp", "test"])(["a"])).toEqual([
      { x: 5, y: 0, xAdvance: 25, yAdvance: 0 },
    ]);
  });

  it("leaves out a feature that was not asked for", () => {
    expect(positionerFor(CPSP, ["liga"])(["a"])).toEqual([null]);
    // cpsp is not one a text renderer turns on by itself.
    expect(positionerFor(CPSP)(["a"])).toEqual([null]);
  });

  it("moves nothing for a font with no positioning", () => {
    expect(positionerFor("feature liga { sub f i by fi; } liga;")(["f", "i"])).toEqual([
      null,
      null,
    ]);
    expect(NO_POSITIONING(["a", "b"])).toEqual([null, null]);
  });
});
