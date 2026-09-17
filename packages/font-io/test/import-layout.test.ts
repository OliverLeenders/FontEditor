import {
  DEFAULT_FONT_INFO,
  type FontDocument,
  anchor,
  contour,
  counterIds,
  fontDocument,
  glyph,
  groupKey,
  node,
  setFeatures,
  setKern,
  setKernGroup,
  setKerning,
  EMPTY_KERNING,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { importFont } from "../src/import.js";
import { GSUB, readLayout } from "../src/layout-read.js";
import { readTablesOf } from "../src/sfnt.js";
import { fromWoff, isWoff, toWoff } from "../src/woff.js";

/**
 * What a binary font does, read back when it is opened.
 *
 * The proofs in `proof-features.test.ts` open whole fonts and ask whether they
 * set text as before. These ask about the parts: what the kerning, the anchors
 * and the source come back as, and what happens to a table that cannot be read.
 */

const ids = counterIds("il");

const drawn = () =>
  contour(
    ids.contour(),
    [
      node(ids.node(), { x: 0, y: 0 }),
      node(ids.node(), { x: 100, y: 0 }),
      node(ids.node(), { x: 50, y: 100 }),
    ],
    true,
  );

const INFO = { ...DEFAULT_FONT_INFO, familyName: "Layout", unitsPerEm: 1000, xHeight: 500 };

function font(
  glyphs: readonly (readonly [
    string,
    number | null,
    readonly (readonly [string, number, number])[],
  ])[],
): FontDocument {
  return fontDocument(
    [
      glyph(".notdef", { advance: 500 }),
      ...glyphs.map(([name, code, anchors]) =>
        glyph(name, {
          unicodes: code === null ? [] : [code],
          advance: name.endsWith("comb") ? 0 : 500,
          contours: [drawn()],
          anchors: anchors.map(([n, x, y]) => anchor(ids.anchor(), n, { x, y })),
        }),
      ),
    ],
    INFO,
  );
}

const reopen = (document: FontDocument) =>
  importFont(new Uint8Array(exportFont(document).bytes).slice().buffer, counterIds("re"));

describe("kerning", () => {
  it("comes back into the model, the exception beside its group", () => {
    let kerning = setKernGroup(EMPTY_KERNING, "first", "round", ["o", "c"]);
    kerning = setKernGroup(kerning, "second", "vee", ["v", "w"]);
    kerning = setKern(kerning, groupKey("round"), groupKey("vee"), -30);
    kerning = setKern(kerning, "o", "v", -50);
    const document = setKerning(
      font([
        ["o", 0x6f, []],
        ["c", 0x63, []],
        ["v", 0x76, []],
        ["w", 0x77, []],
      ]),
      kerning,
    );

    const { document: read, warnings } = reopen(document);
    expect(warnings).toEqual([]);
    expect(read.kerning.pairs["o"]?.["v"]).toBe(-50);
    const [first] = Object.values(read.kerning.firstGroups);
    expect([...(first ?? [])].sort()).toEqual(["c", "o"]);
    // And no feature source for it: kerning is the Spacing workspace's.
    expect(read.features).toBe("");
  });
});

describe("mark attachment", () => {
  it("comes back as anchors named by where they sit, numbered where two classes would share a name", () => {
    const document = font([
      [
        "a",
        0x61,
        [
          ["top", 250, 520],
          ["above", 260, 600],
          ["bottom", 240, -10],
        ],
      ],
      ["acutecomb", 0x301, [["_top", 0, 500]]],
      ["dotaccentcomb", 0x307, [["_above", 0, 520]]],
      ["dotbelowcomb", 0x323, [["_bottom", 0, 0]]],
    ]);

    const { document: read } = reopen(document);
    const names = (glyphName: string) =>
      (read.glyphs[glyphName]?.anchors ?? []).map((a) => a.name).sort();

    expect(names("a")).toEqual(["bottom", "top", "top2"]);
    expect(names("dotbelowcomb")).toEqual(["_bottom"]);
    // The two marks above are two classes, so two names.
    expect([...names("acutecomb"), ...names("dotaccentcomb")].sort()).toEqual(["_top", "_top2"]);
    expect(read.features).not.toMatch(/markClass|pos base/);
  });
});

describe("feature source", () => {
  it("puts a lookup only a context calls above the rule that calls it", () => {
    const document = setFeatures(
      font([
        ["a", 0x61, []],
        ["b", 0x62, []],
        ["a.sc", null, []],
      ]),
      `lookup SMALL { sub a by a.sc; } SMALL;
feature liga { sub b by a; } liga;
feature calt { sub b a' lookup SMALL; } calt;
`,
    );

    const { document: read, warnings } = reopen(document);
    expect(warnings).toEqual([]);
    const small = read.features.indexOf("sub a by a.sc;");
    const calling = read.features.indexOf("' lookup");
    expect(small).toBeGreaterThan(-1);
    expect(small).toBeLessThan(calling);
    // It compiles again without a problem.
    expect(exportFont(read).warnings).toEqual([]);
  });

  it("names a glyph set that recurs, after what its glyphs have in common", () => {
    const document = setFeatures(
      font([
        ["a", 0x61, []],
        ["b", 0x62, []],
        ["a.sc", null, []],
        ["b.sc", null, []],
      ]),
      `feature smcp { sub [a b] by [a.sc b.sc]; } smcp;
feature c2sc { sub [a.sc b.sc] by [a b]; } c2sc;
feature calt { sub [a.sc b.sc] [a b]' by [a.sc b.sc]; } calt;
`,
    );
    const { document: read } = reopen(document);
    expect(read.features).toMatch(/@sc = \[a\.sc b\.sc\];/);
  });
});

describe("a table that cannot be read", () => {
  it("costs the lookup that points past the end, and says so", () => {
    const document = setFeatures(
      font([
        ["f", 0x66, []],
        ["i", 0x69, []],
        ["f_i", null, []],
      ]),
      "feature liga { sub f i by f_i; } liga;",
    );
    const bytes = new Uint8Array(exportFont(document).bytes);
    const gsub = readTablesOf(bytes).find((t) => t.tag === "GSUB")!.data;

    const read = readLayout(gsub.subarray(0, gsub.length - 6), GSUB, 5);
    expect(read?.lookups).toEqual([null]);
    expect(read?.problems.join(" ")).toMatch(/past the end/);
  });
});

describe("a WOFF", () => {
  const document = setFeatures(
    font([
      ["f", 0x66, []],
      ["i", 0x69, []],
      ["f_i", null, []],
    ]),
    "feature liga { sub f i by f_i; } liga;",
  );

  it("is unpacked into the font it wraps, layout and all", async () => {
    const woff = await toWoff(new Uint8Array(exportFont(document).bytes));
    expect(isWoff(woff)).toBe(true);

    const plain = await fromWoff(woff);
    const read = importFont(plain.slice().buffer, counterIds("wf"));
    expect(read.document.features).toMatch(/sub f i by f_i;/);
  });

  it("opened as it is, says its layout was not read", async () => {
    const woff = await toWoff(new Uint8Array(exportFont(document).bytes));
    const read = importFont(woff.slice().buffer, counterIds("wf"));
    expect(read.warnings.map((w) => w.message).join(" ")).toMatch(/not a plain font file/);
  });
});
