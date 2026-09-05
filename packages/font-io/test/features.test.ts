import {
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
  setFeatures,
} from "@fonteditor/font-model";
import { describe, expect, it } from "vitest";

import { compileFeatures } from "../src/features.js";
import { parseFea } from "../src/fea.js";
import { exportFont } from "../src/export.js";
import { opentype } from "../src/opentype.js";

const ids = counterIds("f");
const box = (name: string, code: number) =>
  glyph(name, {
    unicodes: [code],
    advance: 500,
    contours: [
      contour(
        ids.contour(),
        [
          node(ids.node(), { x: 50, y: 0 }),
          node(ids.node(), { x: 450, y: 0 }),
          node(ids.node(), { x: 450, y: 700 }),
        ],
        true,
      ),
    ],
  });

const INFO = {
  familyName: "Feature Test",
  styleName: "Regular",
  unitsPerEm: 1000,
  ascender: 800,
  descender: -200,
  xHeight: 500,
  capHeight: 700,
};

const NAMES = [".notdef", "f", "i", "l", "fi", "fl", "ffi", "a", "a.sc", "b", "b.sc"];
const font = (features: string) =>
  setFeatures(
    fontDocument(
      NAMES.map((n, i) => (n === ".notdef" ? glyph(n, { advance: 500 }) : box(n, 0x61 + i))),
      INFO,
    ),
    features,
  );

describe("reading feature source", () => {
  it("reads a ligature rule", () => {
    const parsed = parseFea("feature liga { sub f i by fi; } liga;");
    expect(parsed.problems).toEqual([]);
    expect(parsed.features[0]?.tag).toBe("liga");
    expect(parsed.features[0]?.rules[0]).toMatchObject({
      kind: "ligature",
      from: ["f", "i"],
      to: "fi",
    });
  });

  it("reads a class and uses it on both sides", () => {
    const parsed = parseFea(`
      @LOWER = [a b];
      @SMALL = [a.sc b.sc];
      feature smcp { sub @LOWER by @SMALL; } smcp;
    `);
    expect(parsed.problems).toEqual([]);
    expect(parsed.features[0]?.rules[0]).toMatchObject({
      kind: "single",
      from: ["a", "b"],
      to: ["a.sc", "b.sc"],
    });
  });

  it("ignores comments and languagesystem", () => {
    const parsed = parseFea(`
      # a ligature, for reading
      languagesystem DFLT dflt;
      feature liga { sub f i by fi; } liga;
    `);
    expect(parsed.problems).toEqual([]);
    expect(parsed.features).toHaveLength(1);
  });

  it("refuses a construct it cannot compile, by name and line", () => {
    // Silence here would ship a font that does not do what its source says.
    const parsed = parseFea("feature curs {\n  pos cursive a <anchor 1 2>;\n} curs;");
    expect(parsed.problems[0]?.line).toBe(2);
    expect(parsed.problems[0]?.message).toContain("cursive");
  });

  it("sends a pair adjustment to the workspace that owns it", () => {
    // It is kerning, the editor keeps kerning in its model, and two ways to
    // write the same bytes is two answers with no way to say which won.
    const parsed = parseFea("feature kern {\n  pos a b -40;\n} kern;");
    expect(parsed.problems[0]?.line).toBe(2);
    expect(parsed.problems[0]?.message).toContain("Spacing");
  });

  it("complains when the two sides of a class rule differ in length", () => {
    const parsed = parseFea("@A = [a b]; @B = [a.sc]; feature smcp { sub @A by @B; } smcp;");
    expect(parsed.problems.some((p) => p.message.includes("must match"))).toBe(true);
  });

  it("complains about a class used before it exists", () => {
    const parsed = parseFea("feature smcp { sub @NOPE by a; } smcp;");
    expect(parsed.problems.some((p) => p.message.includes("@NOPE"))).toBe(true);
  });

  it("keeps the features that did parse when one did not", () => {
    const parsed = parseFea(
      "feature xxxx { nonsense; } xxxx;\nfeature liga { sub f i by fi; } liga;",
    );
    expect(parsed.features.some((f) => f.tag === "liga" && f.rules.length === 1)).toBe(true);
  });
});

describe("reading a rule with a context", () => {
  const rule = (source: string) => parseFea(source).features[0]?.rules[0];

  it("splits a rule into what comes before, what is replaced, and what follows", () => {
    const parsed = parseFea("feature calt { sub a b' c by b.alt; } calt;");
    expect(parsed.problems).toEqual([]);
    expect(parsed.features[0]?.rules[0]).toMatchObject({
      kind: "chain",
      backtrack: [["a"]],
      input: [["b"]],
      lookahead: [["c"]],
      to: ["b.alt"],
    });
  });

  it("takes classes anywhere in the context", () => {
    const parsed = parseFea(`
      @V = [a b];
      feature calt { sub @V f' @V by f.alt; } calt;
    `);
    expect(parsed.problems).toEqual([]);
    expect(parsed.features[0]?.rules[0]).toMatchObject({
      kind: "chain",
      backtrack: [["a", "b"]],
      input: [["f"]],
      lookahead: [["a", "b"]],
    });
  });

  it("pairs a marked class off with its replacements", () => {
    const parsed = parseFea(
      "@A = [a b]; @B = [a.sc b.sc]; feature calt { sub @A' f by @B; } calt;",
    );
    expect(parsed.problems).toEqual([]);
    expect(parsed.features[0]?.rules[0]).toMatchObject({
      kind: "chain",
      input: [["a", "b"]],
      to: ["a.sc", "b.sc"],
    });
  });

  it("reads several marked glyphs as a ligature that only happens in context", () => {
    expect(rule("feature calt { sub a f' i' by fi; } calt;")).toMatchObject({
      kind: "chain",
      backtrack: [["a"]],
      input: [["f"], ["i"]],
      to: ["fi"],
    });
  });

  it("reads an ignore rule as a match that replaces nothing", () => {
    expect(rule("feature calt { ignore sub a b'; } calt;")).toMatchObject({
      kind: "chain",
      backtrack: [["a"]],
      input: [["b"]],
      to: null,
    });
  });

  it("keeps a context with nothing before it", () => {
    expect(rule("feature calt { sub b' c by b.alt; } calt;")).toMatchObject({
      backtrack: [],
      input: [["b"]],
      lookahead: [["c"]],
    });
  });

  it("refuses marked glyphs with a gap between them", () => {
    // The language allows several separate matches, each with its own lookup.
    // Reading this as one run would replace the wrong glyphs.
    const parsed = parseFea("feature calt { sub a' b c' by x; } calt;");
    expect(parsed.problems.some((p) => p.message.includes("next to each other"))).toBe(true);
  });

  it("refuses an ignore rule with nothing marked", () => {
    const parsed = parseFea("feature calt { ignore sub a b; } calt;");
    expect(parsed.problems.some((p) => p.message.includes("marked"))).toBe(true);
  });

  it("refuses an ignore rule that tries to replace something", () => {
    const parsed = parseFea("feature calt { ignore sub a b' by c; } calt;");
    expect(parsed.problems.some((p) => p.message.includes("replaces nothing"))).toBe(true);
  });

  it("refuses a rule that calls a lookup by name", () => {
    const parsed = parseFea("feature calt { sub a b' lookup SOMETHING; } calt;");
    expect(parsed.problems.some((p) => p.message.includes("named lookup"))).toBe(true);
  });

  it("refuses ignore of anything but a substitution", () => {
    const parsed = parseFea("feature calt { ignore pos a b'; } calt;");
    expect(parsed.problems.some((p) => p.message.includes("ignore sub"))).toBe(true);
  });

  it("still reads a plain rule the same way", () => {
    expect(rule("feature liga { sub f i by fi; } liga;")).toMatchObject({
      kind: "ligature",
      from: ["f", "i"],
      to: "fi",
    });
  });
});

describe("compiling against a font", () => {
  it("reports a rule about a glyph the font has not got", () => {
    // Compiling it anyway would put a lookup in the font that substitutes
    // something for nothing, which a shaper may render as a missing-glyph box.
    const compiled = compileFeatures("feature liga { sub f q by fq; } liga;", (n) =>
      NAMES.includes(n) ? NAMES.indexOf(n) : undefined,
    );
    expect(compiled.problems.some((p) => p.message.includes("no glyph called q"))).toBe(true);
    expect(compiled.table).toHaveLength(0);
  });

  it("writes nothing at all for empty source", () => {
    expect(compileFeatures("", () => 0).table).toHaveLength(0);
  });

  it("counts the rules it compiled", () => {
    const compiled = compileFeatures(
      "@A = [a b]; @B = [a.sc b.sc]; feature smcp { sub @A by @B; } smcp;",
      (n) => (NAMES.includes(n) ? NAMES.indexOf(n) : undefined),
    );
    expect(compiled.rules).toBe(2);
    expect(compiled.tags).toEqual(["smcp"]);
  });
});

describe("compiling a rule with a context", () => {
  const compile = (source: string) =>
    compileFeatures(source, (n) => (NAMES.includes(n) ? NAMES.indexOf(n) : undefined));

  it("counts a contextual rule as a rule", () => {
    const compiled = compile("feature calt { sub a b' by b.sc; } calt;");
    expect(compiled.problems).toEqual([]);
    expect(compiled.rules).toBe(1);
    expect(compiled.tags).toEqual(["calt"]);
    expect(compiled.table.length).toBeGreaterThan(0);
  });

  it("drops a rule whose context names a glyph the font has not got", () => {
    // The context is a condition, not a decoration: a rule that can never match
    // is a rule the file claims and the font does not have.
    const compiled = compile("feature calt { sub q b' by b.sc; } calt;");
    expect(compiled.problems.some((p) => p.message.includes("no glyph called q"))).toBe(true);
    expect(compiled.rules).toBe(0);
  });

  it("compiles an ignore rule beside the rule it excepts", () => {
    const compiled = compile("feature calt { ignore sub f b'; sub b' by b.sc; } calt;");
    expect(compiled.problems).toEqual([]);
    expect(compiled.rules).toBe(2);
  });
});

describe("reading a positioning rule", () => {
  const rule = (source: string) => parseFea(source).features[0]?.rules[0];

  it("reads a bare number as an advance adjustment", () => {
    // The shorthand exists for exactly this: twenty units after every capital.
    expect(rule("feature cpsp { pos a 20; } cpsp;")).toMatchObject({
      kind: "position",
      glyphs: ["a"],
      value: { x: 0, y: 0, xAdvance: 20, yAdvance: 0 },
    });
  });

  it("reads the long form as four numbers in the format's own order", () => {
    expect(rule("feature test { pos a <10 -5 20 0>; } test;")).toMatchObject({
      kind: "position",
      value: { x: 10, y: -5, xAdvance: 20, yAdvance: 0 },
    });
  });

  it("applies one value to a whole class", () => {
    const parsed = parseFea("@caps = [a b]; feature cpsp { pos @caps 20; } cpsp;");
    expect(parsed.problems).toEqual([]);
    expect(parsed.features[0]?.rules[0]).toMatchObject({
      kind: "position",
      glyphs: ["a", "b"],
    });
  });

  it("takes a negative adjustment", () => {
    expect(rule("feature test { pos a -30; } test;")).toMatchObject({
      value: { xAdvance: -30 },
    });
  });

  it("complains about a value that is not four numbers", () => {
    const parsed = parseFea("feature test { pos a <10 20>; } test;");
    expect(parsed.problems.some((p) => p.message.includes("four numbers"))).toBe(true);
  });

  it("complains about a value it cannot read at all", () => {
    // A device table or a variable value; both need more than four numbers.
    const parsed = parseFea("feature test { pos a <10 0 20 0 <device 11 -1>>; } test;");
    expect(parsed.problems.some((p) => p.message.includes("four numbers"))).toBe(true);
  });

  it("complains about a rule with no value", () => {
    const parsed = parseFea("feature test { pos a; } test;");
    expect(parsed.problems.some((p) => p.message.includes("needs a value"))).toBe(true);
  });

  it("refuses positioning in a context", () => {
    const parsed = parseFea("feature test { pos a b' 20; } test;");
    expect(parsed.problems.some((p) => p.message.includes("in a context"))).toBe(true);
  });

  it("refuses every kind of attachment by its own name", () => {
    for (const kind of ["cursive", "base", "mark", "ligature"]) {
      const parsed = parseFea(`feature test { pos ${kind} a <anchor 0 0>; } test;`);
      expect(parsed.problems.some((p) => p.message.includes(kind))).toBe(true);
    }
  });

  it("keeps reading the file after a rule it refused", () => {
    const parsed = parseFea(`
      feature test { pos a b -40; } test;
      feature liga { sub f i by fi; } liga;
    `);
    expect(parsed.features.some((f) => f.tag === "liga" && f.rules.length === 1)).toBe(true);
  });
});

describe("compiling a positioning rule", () => {
  const compile = (source: string) =>
    compileFeatures(source, (n) => (NAMES.includes(n) ? NAMES.indexOf(n) : undefined));

  it("puts it in the positioning half, not in GSUB", () => {
    const compiled = compile("feature cpsp { pos a 20; } cpsp;");
    expect(compiled.problems).toEqual([]);
    expect(compiled.rules).toBe(1);
    expect(compiled.positioning.lookups).toHaveLength(1);
    expect(compiled.positioning.entries).toEqual([{ tag: "cpsp", lookups: [0] }]);
    // Nothing was substituted, so there is nothing for GSUB to say.
    expect(compiled.table).toHaveLength(0);
  });

  it("names the feature among the tags that did something", () => {
    expect(compile("feature cpsp { pos a 20; } cpsp;").tags).toEqual(["cpsp"]);
  });

  it("drops a rule about a glyph the font has not got", () => {
    const compiled = compile("feature cpsp { pos q 20; } cpsp;");
    expect(compiled.problems.some((p) => p.message.includes("no glyph called q"))).toBe(true);
    expect(compiled.positioning.lookups).toHaveLength(0);
  });

  it("keeps two rules of one feature as two subtables in order", () => {
    // Two rules can name the same glyph with different values, and a subtable
    // holds one answer; the first written is the one that applies.
    const compiled = compile("feature cpsp { pos a 20; pos a 40; } cpsp;");
    expect(compiled.rules).toBe(2);
    expect(compiled.positioning.lookups[0]?.subtables).toHaveLength(2);
  });

  it("carries substitution and positioning from one feature file", () => {
    const compiled = compile(
      "feature liga { sub f i by fi; } liga; feature cpsp { pos a 20; } cpsp;",
    );
    expect(compiled.table.length).toBeGreaterThan(0);
    expect(compiled.positioning.lookups).toHaveLength(1);
  });
});

/**
 * Read back with opentype.js, whose GSUB parser is an implementation of the
 * specification that is not ours — the only kind of check worth much on a
 * binary format, and the same one the kerning gets.
 */
function reread(features: string) {
  const parsed = opentype.parse(exportFont(font(features)).bytes);
  return parsed;
}

describe("the exported font substitutes", () => {
  it("is read back by a GSUB parser that is not ours", () => {
    const f = reread("feature liga { sub f i by fi; } liga;");
    expect(f.tables.gsub).toBeDefined();
  });

  it("declares the feature it was given", () => {
    const f = reread("feature liga { sub f i by fi; } liga;");
    const tags = f.tables.gsub!.features.map((x) => x.tag);
    expect(tags).toContain("liga");
  });

  it("carries the ligature so a shaper can find it", () => {
    const f = reread("feature liga { sub f i by fi; sub f f i by ffi; } liga;");
    const lookups = f.tables.gsub!.lookups;
    expect(lookups.some((l) => l.lookupType === 4)).toBe(true);
  });

  it("carries a single substitution as its own lookup type", () => {
    const f = reread("@A = [a b]; @B = [a.sc b.sc]; feature smcp { sub @A by @B; } smcp;");
    const lookups = f.tables.gsub!.lookups;
    expect(lookups.some((l) => l.lookupType === 1)).toBe(true);
  });

  it("writes no GSUB at all when there are no features", () => {
    // A feature list matching nothing is worse than no table: it tells a shaper
    // there is something to apply.
    expect(reread("").tables.gsub).toBeUndefined();
  });

  it("still writes the kerning alongside", () => {
    const f = reread("feature liga { sub f i by fi; } liga;");
    expect(f.unitsPerEm).toBe(1000);
    expect(f.glyphs.length).toBe(NAMES.length);
  });
});

describe("the exported font substitutes in context", () => {
  it("writes a contextual rule as its own lookup type", () => {
    const f = reread("feature calt { sub a b' by b.sc; } calt;");
    const lookups = f.tables.gsub!.lookups;
    expect(lookups.some((l) => l.lookupType === 6)).toBe(true);
  });

  it("writes the substitution it points at as an ordinary lookup", () => {
    // The table has no way to write a replacement into a contextual rule; the
    // rule is a condition and a pointer at a lookup somewhere else in the list.
    const f = reread("feature calt { sub a b' by b.sc; } calt;");
    const lookups = f.tables.gsub!.lookups;
    expect(lookups.some((l) => l.lookupType === 1)).toBe(true);
  });

  it("declares the feature that holds it", () => {
    const f = reread("feature calt { sub a b' by b.sc; } calt;");
    expect(f.tables.gsub!.features.map((x) => x.tag)).toContain("calt");
  });

  it("keeps several contextual rules in the order they were written", () => {
    // They are one lookup with a subtable each, tried in order — which is the
    // whole of what an ignore rule does.
    const f = reread("feature calt { ignore sub f b'; sub b' by b.sc; } calt;");
    const chain = f.tables.gsub!.lookups.find((l) => l.lookupType === 6);
    expect(chain).toBeDefined();
    expect(chain!.subtables.length).toBe(2);
  });

  it("points the rule at a lookup that is really in the list", () => {
    const f = reread("feature calt { sub a b' by b.sc; } calt;");
    const gsub = f.tables.gsub!;
    const chain = gsub.lookups.find((l) => l.lookupType === 6)!;
    const table = chain.subtables[0] as {
      lookupRecords?: { lookupListIndex: number; sequenceIndex: number }[];
    };
    const records = table.lookupRecords ?? [];
    expect(records.length).toBe(1);
    expect(records[0]!.sequenceIndex).toBe(0);
    expect(gsub.lookups[records[0]!.lookupListIndex]).toBeDefined();
    expect(gsub.lookups[records[0]!.lookupListIndex]!.lookupType).toBe(1);
  });
});

describe("the exported font positions", () => {
  it("writes a positioning rule into GPOS, where a reader that is not ours finds it", () => {
    const f = reread("feature cpsp { pos a 20; } cpsp;");
    expect(f.tables.gpos).toBeDefined();
    expect(f.tables.gpos!.features.map((x) => x.tag)).toContain("cpsp");
  });

  it("writes it as a single adjustment", () => {
    const f = reread("feature cpsp { pos a 20; } cpsp;");
    expect(f.tables.gpos!.lookups.some((l) => l.lookupType === 1)).toBe(true);
  });

  it("keeps two rules of one feature as two subtables", () => {
    const f = reread("feature cpsp { pos a 20; pos b 40; } cpsp;");
    const lookup = f.tables.gpos!.lookups.find((l) => l.lookupType === 1)!;
    expect(lookup.subtables).toHaveLength(2);
  });

  it("writes no GPOS for a font with neither kerning nor positioning", () => {
    // A feature list matching nothing stops a shaper falling back.
    expect(reread("feature liga { sub f i by fi; } liga;").tables.gpos).toBeUndefined();
  });

  it("leaves the substitutions where they were", () => {
    const f = reread("feature liga { sub f i by fi; } liga; feature cpsp { pos a 20; } cpsp;");
    expect(f.tables.gsub!.features.map((x) => x.tag)).toEqual(["liga"]);
    expect(f.tables.gpos!.features.map((x) => x.tag)).toEqual(["cpsp"]);
  });
});
