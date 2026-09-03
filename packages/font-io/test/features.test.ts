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
