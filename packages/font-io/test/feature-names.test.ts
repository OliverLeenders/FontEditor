import {
  DEFAULT_FONT_INFO,
  type FontDocument,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
  setFeatures,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { parseFea } from "../src/fea.js";
import { compileFeatures } from "../src/features.js";
import { importFont } from "../src/import.js";
import { GSUB, readLayout } from "../src/layout-read.js";
import { readNames } from "../src/names.js";
import { readTablesOf } from "../src/sfnt.js";

/**
 * Names for stylistic sets and character variants, and `aalt`.
 *
 * What is asked: that the feature file's names are read, that they go into the
 * font as feature parameters and name-table entries a reader finds, that a font
 * opened again gives them back as feature source, and that `aalt` is compiled as
 * written or gathered when it is not.
 */

const ids = counterIds("fn");
const box = (name: string, code: number | null) =>
  glyph(name, {
    unicodes: code === null ? [] : [code],
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

const INFO = { ...DEFAULT_FONT_INFO, familyName: "Named Sets", unitsPerEm: 1000, xHeight: 500 };
const NAMES = [".notdef", "a", "a.ss01", "a.alt", "a.swsh", "g", "g.cv01", "g.cv01b"];
const CODES: Record<string, number> = { a: 0x61, g: 0x67 };
const idOf = (name: string): number | undefined => {
  const i = NAMES.indexOf(name);
  return i < 0 ? undefined : i;
};

const font = (features: string): FontDocument =>
  setFeatures(
    fontDocument(
      NAMES.map((n) => (n === ".notdef" ? glyph(n, { advance: 500 }) : box(n, CODES[n] ?? null))),
      INFO,
    ),
    features,
  );

const NAMED = `
feature ss01 {
  featureNames {
    name "Single-storey a";
    name 1 "Single-storey a";
  };
  sub a by a.ss01;
} ss01;

feature cv01 {
  cvParameters {
    FeatUILabelNameID { name "Alternate g"; };
    ParamUILabelNameID { name "Open tail"; };
    ParamUILabelNameID { name "Looped tail"; };
    Character 0x0067;
  };
  sub g from [g.cv01 g.cv01b];
} cv01;
`;

describe("reading names", () => {
  it("reads a stylistic set's name, spaces and all", () => {
    const parsed = parseFea(NAMED);
    expect(parsed.problems).toEqual([]);
    const ss01 = parsed.features.find((f) => f.tag === "ss01")!;
    expect(ss01.names).toEqual([
      { platform: 3, encoding: 1, language: 0x409, text: "Single-storey a" },
      { platform: 1, encoding: 0, language: 0, text: "Single-storey a" },
    ]);
  });

  it("reads a name with a # in it, and escapes", () => {
    const parsed = parseFea(
      'feature ss02 { featureNames { name "No. #2 \\00E9t\\00E9"; }; sub a by a.alt; } ss02;',
    );
    expect(parsed.problems).toEqual([]);
    expect(parsed.features[0]!.names[0]!.text).toBe("No. #2 été");
  });

  it("reads a character variant's parameters", () => {
    const cv = parseFea(NAMED).features.find((f) => f.tag === "cv01")!.cvParameters!;
    expect(cv.label.map((n) => n.text)).toEqual(["Alternate g"]);
    expect(cv.params.map((p) => p[0]!.text)).toEqual(["Open tail", "Looped tail"]);
    expect(cv.characters).toEqual([0x67]);
  });

  it("says where names do not belong", () => {
    const parsed = parseFea('feature liga { featureNames { name "x"; }; } liga;');
    expect(parsed.problems[0]!.message).toMatch(/stylistic set/);
  });

  it("gathers features only in aalt", () => {
    expect(parseFea("feature salt { feature ss01; } salt;").problems[0]!.message).toMatch(
      /only aalt/,
    );
    const aalt = parseFea("feature aalt { feature ss01; feature salt; } aalt;").features[0]!;
    expect(aalt.statements.map((s) => (s.kind === "feature" ? s.tag : s.kind))).toEqual([
      "ss01",
      "salt",
    ]);
  });
});

describe("compiling names", () => {
  it("points a stylistic set at its name in the name table", () => {
    const compiled = compileFeatures(NAMED, idOf);
    expect(compiled.problems).toEqual([]);
    const layout = readLayout(compiled.table, GSUB, NAMES.length)!;
    const ss01 = layout.features.find((f) => f.tag === "ss01")!;
    expect(ss01.parameters).toEqual({ kind: "stylistic", name: 256 });
    expect(compiled.names.find((n) => n.id === 256)!.records[0]!.text).toBe("Single-storey a");
  });

  it("writes a character variant's names in a row and its characters", () => {
    const compiled = compileFeatures(NAMED, idOf);
    const layout = readLayout(compiled.table, GSUB, NAMES.length)!;
    const cv01 = layout.features.find((f) => f.tag === "cv01")!.parameters!;
    expect(cv01.kind).toBe("variant");
    if (cv01.kind !== "variant") return;
    const text = (id: number) => compiled.names.find((n) => n.id === id)!.records[0]!.text;
    expect(text(cv01.label)).toBe("Alternate g");
    expect(cv01.tooltip).toBe(0);
    expect(cv01.params.map(text)).toEqual(["Open tail", "Looped tail"]);
    expect(cv01.characters).toEqual([0x67]);
  });

  it("puts the names in the exported font", () => {
    const bytes = new Uint8Array(exportFont(font(NAMED)).bytes);
    const name = readTablesOf(bytes).find((t) => t.tag === "name")!.data;
    const windows = readNames(name).find((r) => r.nameId === 256 && r.platformId === 3)!;
    let text = "";
    for (let i = 0; i < windows.text.length; i += 2) {
      text += String.fromCharCode((windows.text[i]! << 8) | windows.text[i + 1]!);
    }
    expect(text).toBe("Single-storey a");
    const gsub = readTablesOf(bytes).find((t) => t.tag === "GSUB")!.data;
    const layout = readLayout(gsub, GSUB, NAMES.length)!;
    expect(layout.features.find((f) => f.tag === "ss01")!.parameters).toEqual({
      kind: "stylistic",
      name: 256,
    });
  });

  it("comes back as feature source when the font is opened again", () => {
    const bytes = new Uint8Array(exportFont(font(NAMED)).bytes).slice().buffer;
    const { document, warnings } = importFont(bytes, counterIds("re"));
    expect(warnings.filter((w) => /parameters/.test(w.message))).toEqual([]);
    const again = parseFea(document.features);
    expect(again.problems).toEqual([]);
    const ss01 = again.features.find((f) => f.tag === "ss01")!;
    expect(ss01.names.map((n) => [n.platform, n.text])).toEqual(
      [
        [1, "Single-storey a"],
        [3, "Single-storey a"],
      ].sort((a, b) => Number(a[0]) - Number(b[0])),
    );
    const cv = again.features.find((f) => f.tag === "cv01")!.cvParameters!;
    expect(cv.params.map((p) => p[0]!.text)).toEqual(["Open tail", "Looped tail"]);
    expect(cv.characters).toEqual([0x67]);
  });
});

describe("aalt", () => {
  const alternatesOf = (source: string) => {
    const compiled = compileFeatures(source, idOf, { gatherAalt: true });
    const layout = readLayout(compiled.table, GSUB, NAMES.length)!;
    const aalt = layout.features.filter((f) => f.tag === "aalt");
    return { compiled, aalt, layout };
  };

  it("is gathered from the stylistic features when the file has none", () => {
    const { compiled, aalt } = alternatesOf(`
      feature ss01 { sub a by a.ss01; } ss01;
      feature salt { sub a from [a.alt a.swsh]; } salt;
      feature liga { sub a g by a.alt; } liga;
    `);
    expect(compiled.tags).toContain("aalt");
    expect(aalt).toHaveLength(1);
    expect(aalt[0]!.lookups.length).toBeGreaterThan(0);
  });

  it("is compiled as written, gathering only what it names", () => {
    const { layout } = alternatesOf(`
      feature ss01 { sub a by a.ss01; } ss01;
      feature salt { sub g by g.cv01; } salt;
      feature aalt { feature ss01; } aalt;
    `);
    const aalt = layout.features.find((f) => f.tag === "aalt")!;
    // One glyph with one alternate: a single substitution, of a alone.
    expect(aalt.lookups).toHaveLength(1);
    const lookup = layout.lookups[aalt.lookups[0]!]!;
    expect(lookup.type).toBe(1);
  });

  it("puts a glyph with several alternates in an alternate substitution", () => {
    const { layout } = alternatesOf(`
      feature ss01 { sub a by a.ss01; } ss01;
      feature salt { sub a from [a.alt a.swsh]; } salt;
    `);
    const aalt = layout.features.find((f) => f.tag === "aalt")!;
    const types = aalt.lookups.map((i) => layout.lookups[i]!.type);
    expect(types).toContain(3);
  });

  it("is not made where there is nothing to gather", () => {
    const { compiled } = alternatesOf("feature liga { sub a g by a.alt; } liga;");
    expect(compiled.tags).not.toContain("aalt");
  });
});
