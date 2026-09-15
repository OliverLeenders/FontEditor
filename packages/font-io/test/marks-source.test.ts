import { type Glyph, anchor, counterIds, glyph } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { placeMarks, readMarks, writeMarks } from "../src/marks-source.js";

const ids = counterIds("ms");

const at = (name: string, x: number, y: number) => anchor(ids.anchor(), name, { x, y });

/** A letter, a second letter, an accent that stacks, and a mark below. */
function font(): Glyph[] {
  return [
    glyph("a", { anchors: [at("top", 250, 500), at("bottom", 250, 0)] }),
    glyph("o", { anchors: [at("top", 260, 510), at("exit", 500, 0)] }),
    glyph("acutecomb", { anchors: [at("_top", 0, 500), at("top", 0, 700)] }),
    glyph("cedillacomb", { anchors: [at("_bottom", 0, 0)] }),
  ];
}

const names = (glyphs: readonly Glyph[]) => new Set(glyphs.map((g) => g.name));
const reading = (glyphs: readonly Glyph[], text: string) =>
  readMarks(text, (name) => names(glyphs).has(name));

/** The file without its header, which is comments. */
const body = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .trim();

describe("writing the Marks file", () => {
  it("writes mark classes, the places letters offer, and the marks that stack", () => {
    expect(body(writeMarks(font()))).toBe(
      [
        "markClass acutecomb <anchor 0 500> @MC_top;",
        "",
        "markClass cedillacomb <anchor 0 0> @MC_bottom;",
        "",
        "feature mark {",
        "    pos base a",
        "        <anchor 250 500> mark @MC_top",
        "        <anchor 250 0> mark @MC_bottom;",
        "    pos base o <anchor 260 510> mark @MC_top;",
        "} mark;",
        "",
        "feature mkmk {",
        "    pos mark acutecomb <anchor 0 700> mark @MC_top;",
        "} mkmk;",
      ].join("\n"),
    );
  });

  it("names the master it was written from", () => {
    expect(writeMarks(font(), "Bold").split("\n")[0]).toBe("# Marks, from the anchors of Bold.");
  });

  it("leaves out anchors nothing attaches by", () => {
    expect(writeMarks(font())).not.toContain("exit");
  });

  it("escapes a glyph named like a keyword", () => {
    const glyphs = [
      glyph("mark", { anchors: [at("top", 1, 2)] }),
      glyph("acutecomb", { anchors: [at("_top", 0, 0)] }),
    ];
    const text = writeMarks(glyphs);
    expect(text).toContain("pos base \\mark <anchor 1 2> mark @MC_top;");
    expect(reading(glyphs, text).problems).toEqual([]);
  });

  it("writes a position that is not whole to two places", () => {
    const glyphs = [
      glyph("a", { anchors: [at("top", 250.004, -0.001)] }),
      glyph("acutecomb", { anchors: [at("_top", 0, 0)] }),
    ];
    expect(writeMarks(glyphs)).toContain("pos base a <anchor 250 0> mark @MC_top;");
  });

  it("leaves out a glyph whose names the file cannot spell, and says so", () => {
    const glyphs = [...font(), glyph("odd", { anchors: [at("_two words", 0, 0)] })];
    const text = writeMarks(glyphs);
    expect(text).toContain("# Left out, as names a feature file cannot spell: odd");
    expect(body(text)).not.toContain("odd");
  });
});

describe("reading the Marks file back", () => {
  it("reads what it wrote without a problem, and changes nothing", () => {
    const glyphs = font();
    const read = reading(glyphs, writeMarks(glyphs));
    expect(read.problems).toEqual([]);
    expect(read.classes).toEqual(["top", "bottom"]);
    expect(placeMarks(glyphs, read, ids)).toEqual([]);
  });

  it("keeps a position that is not whole when its line is left as it was", () => {
    const glyphs = [
      glyph("a", { anchors: [at("top", 250.004, 500)] }),
      glyph("acutecomb", { anchors: [at("_top", 0, 0)] }),
    ];
    expect(placeMarks(glyphs, reading(glyphs, writeMarks(glyphs)), ids)).toEqual([]);
  });

  it("moves an anchor whose position changed, keeping its id", () => {
    const glyphs = font();
    const text = writeMarks(glyphs).replace("<anchor 260 510>", "<anchor 270 520>");
    const [o, ...rest] = placeMarks(glyphs, reading(glyphs, text), ids);
    expect(rest).toEqual([]);
    expect(o!.name).toBe("o");
    expect(o!.anchors.map((a) => [a.name, a.pt.x, a.pt.y])).toEqual([
      ["top", 270, 520],
      ["exit", 500, 0],
    ]);
    expect(o!.anchors[0]!.id).toBe(glyphs[1]!.anchors[0]!.id);
  });

  it("adds an anchor for a new line, and removes one whose line is gone", () => {
    const glyphs = [...font(), glyph("e", { anchors: [] })];
    const text = writeMarks(glyphs)
      .replace("    pos base o <anchor 260 510> mark @MC_top;\n", "")
      .replace("} mark;", "    pos base e <anchor 240 500> mark @MC_top;\n} mark;");
    const changed = placeMarks(glyphs, reading(glyphs, text), ids);
    expect(changed.map((g) => g.name)).toEqual(["o", "e"]);
    expect(changed[0]!.anchors.map((a) => a.name)).toEqual(["exit"]);
    expect(changed[1]!.anchors.map((a) => [a.name, a.pt.x, a.pt.y])).toEqual([["top", 240, 500]]);
  });

  it("keeps the anchors letters already have when the first mark for them is added", () => {
    const glyphs = [
      glyph("a", { anchors: [at("top", 250, 500)] }),
      glyph("acutecomb", { anchors: [] }),
    ];
    const text = `${writeMarks(glyphs)}markClass acutecomb <anchor 0 500> @MC_top;\n`;
    const changed = placeMarks(glyphs, reading(glyphs, text), ids);
    expect(changed.map((g) => g.name)).toEqual(["acutecomb"]);
    expect(changed[0]!.anchors.map((a) => a.name)).toEqual(["_top"]);
  });

  it("takes classes and bracketed lists", () => {
    const glyphs = [glyph("a"), glyph("o"), glyph("acutecomb"), glyph("gravecomb")];
    const read = reading(
      glyphs,
      `@ACCENTS = [acutecomb gravecomb];
       markClass @ACCENTS <anchor 0 500> @MC_top;
       feature mark { pos base [a o] <anchor 250 500> mark @MC_top; } mark;`,
    );
    expect(read.problems).toEqual([]);
    expect(read.places.map((p) => `${p.glyph} ${p.anchor}`)).toEqual([
      "acutecomb _top",
      "gravecomb _top",
      "a top",
      "o top",
    ]);
  });

  it("reads <anchor NULL> as no place", () => {
    const glyphs = [glyph("a"), glyph("acutecomb"), glyph("cedillacomb")];
    const read = reading(
      glyphs,
      `markClass acutecomb <anchor 0 500> @MC_top;
       markClass cedillacomb <anchor 0 0> @MC_bottom;
       feature mark { pos base a <anchor NULL> mark @MC_top <anchor 250 0> mark @MC_bottom; } mark;`,
    );
    expect(read.problems).toEqual([]);
    expect(read.places.filter((p) => p.glyph === "a").map((p) => p.anchor)).toEqual(["bottom"]);
  });
});

describe("what the Marks file refuses", () => {
  const glyphs = [glyph("a"), glyph("acutecomb"), glyph("f_i")];
  const MARK = "markClass acutecomb <anchor 0 500> @MC_top;\n";
  const problems = (text: string) => reading(glyphs, text).problems.map((p) => p.message);

  it.each([
    ["a class not named for an anchor", "markClass acutecomb <anchor 0 500> @TOP;", "@MC_"],
    ["a mark with no position", "markClass acutecomb <anchor NULL> @MC_top;", "cannot be NULL"],
    ["a glyph that is not there", "markClass nothing <anchor 0 500> @MC_top;", "no glyph named"],
    [
      "a contour point",
      "markClass acutecomb <anchor 0 500 contourpoint 2> @MC_top;",
      "position and nothing else",
    ],
    ["a named anchor", "markClass acutecomb <anchor TOP> @MC_top;", "named anchor"],
    [
      "a class used before it is defined",
      "feature mark { pos base a <anchor 1 2> mark @MC_top; } mark;",
      "not a mark class",
    ],
    [
      "pos base in mkmk",
      `${MARK}feature mkmk { pos base a <anchor 1 2> mark @MC_top; } mkmk;`,
      "belongs in feature mark",
    ],
    [
      "pos mark in mark",
      `${MARK}feature mark { pos mark acutecomb <anchor 1 2> mark @MC_top; } mark;`,
      "belongs in feature mkmk",
    ],
    [
      "a mark as a base",
      `${MARK}feature mark { pos base acutecomb <anchor 1 2> mark @MC_top; } mark;`,
      "is a mark",
    ],
    [
      "a letter as a mark",
      `${MARK}feature mkmk { pos mark a <anchor 1 2> mark @MC_top; } mkmk;`,
      "in no mark class",
    ],
    [
      "a ligature",
      `${MARK}feature mark { pos ligature f_i <anchor 1 2> mark @MC_top; } mark;`,
      "ligature",
    ],
    [
      "a lookup flag",
      `${MARK}feature mkmk { lookupflag UseMarkFilteringSet @X; } mkmk;`,
      "belongs in the feature file",
    ],
    ["another feature", "feature liga { sub f i by f_i; } liga;", "belongs in the feature file"],
    ["a language system", "languagesystem DFLT dflt;", "belongs in the feature file"],
    ["the same mark twice", `${MARK}${MARK}`, "already in @MC_top"],
    [
      "the same place twice",
      `${MARK}feature mark { pos base a <anchor 1 2> mark @MC_top; pos base a <anchor 3 4> mark @MC_top; } mark;`,
      "already offers a place",
    ],
  ])("refuses %s", (_, text, message) => {
    expect(problems(text).join(" | ")).toContain(message);
  });
});
