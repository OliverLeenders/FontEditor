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
    const parsed = parseFea("feature kern {\n  pos a b -40;\n} kern;");
    expect(parsed.problems[0]?.line).toBe(2);
    expect(parsed.problems[0]?.message).toContain("pos");
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
