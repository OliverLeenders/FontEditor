import {
  DEFAULT_FONT_INFO,
  type FontDocument,
  type Glyph,
  anchor,
  counterIds,
  fontDocument,
  glyph,
  rectContour,
} from "@typewright/font-model";
import { Blob, Face, Font } from "harfbuzzjs";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { importFont } from "../src/import.js";
import { placeMarks, readMarks, writeMarks } from "../src/marks-source.js";
import { compileMarks, markRounds } from "../src/marks.js";
import { set } from "./real-fonts.js";

/**
 * A mark that attaches by more than one anchor.
 *
 * A dot that sits at one height on round letters and at another on tall ones
 * carries two attaching anchors, `_top` and `_high`, and the letters offer a
 * `top` or a `high`. That is two classes of marks with the dot in both, and a
 * lookup gives a mark one class: so the classes are written in lookups of
 * their own, in the order the anchors are in on the mark, and where a letter
 * offers a place for both the later lookup is the one that stands. HarfBuzz is
 * asked where the dot goes.
 */

const ids = counterIds("mr");
const at = (name: string, x: number, y: number) => anchor(ids.anchor(), name, { x, y });
const box = (w: number, h: number) => rectContour(ids, { minX: 0, minY: 0, maxX: w, maxY: h });

const DOT = "̇";
const RING = "̊";

function glyphs(): Glyph[] {
  const letter = (name: string, anchors: ReturnType<typeof at>[]) =>
    glyph(name, {
      unicodes: [name.charCodeAt(0)],
      advance: 500,
      contours: [box(400, 500)],
      anchors,
    });
  return [
    glyph(".notdef", { advance: 500 }),
    // A round letter, a tall one, and one that has a place for both.
    letter("o", [at("top", 250, 520)]),
    letter("l", [at("high", 120, 760)]),
    letter("b", [at("top", 300, 520), at("high", 100, 760)]),
    letter("x", []),
    // The dot attaches by its foot to a top, and by its middle to a high.
    glyph("dotaccentcomb", {
      unicodes: [0x307],
      advance: 0,
      contours: [box(60, 60)],
      anchors: [at("_top", 30, 0), at("_high", 30, 30), at("top", 30, 90)],
    }),
    // The ring attaches one way only, and stacks on the dot.
    glyph("ringcomb", {
      unicodes: [0x30a],
      advance: 0,
      contours: [box(80, 80)],
      anchors: [at("_top", 40, 0)],
    }),
  ];
}

const document = (): FontDocument =>
  fontDocument(glyphs(), { ...DEFAULT_FONT_INFO, unitsPerEm: 1000 });

describe("the rounds a font's classes of marks are written in", () => {
  it("are one, where every mark attaches by one anchor", () => {
    const plain = glyphs().map((g) => ({
      ...g,
      anchors: g.anchors.filter((a) => a.name !== "_high"),
    }));
    expect([...markRounds(plain)]).toEqual([["top", 0]]);
  });

  it("put a mark's second class after its first", () => {
    expect([...markRounds(glyphs())]).toEqual([
      ["top", 0],
      ["high", 1],
    ]);
  });

  it("put a class after every class before it on any mark", () => {
    const m = (name: string, ...names: string[]) =>
      glyph(name, { anchors: names.map((n) => at(n, 0, 0)) });
    // c comes after b on one mark and b after a on another: three rounds,
    // though no mark has three anchors.
    const rounds = markRounds([m("one", "_a", "_b"), m("two", "_b", "_c"), m("three", "_d")]);
    expect(Object.fromEntries(rounds)).toEqual({ a: 0, b: 1, c: 2, d: 0 });
  });

  it("keep two classes of one mark apart where the marks disagree about the order", () => {
    const m = (name: string, ...names: string[]) =>
      glyph(name, { anchors: names.map((n) => at(n, 0, 0)) });
    const rounds = markRounds([m("one", "_a", "_b"), m("two", "_b", "_a")]);
    expect(rounds.get("a")).not.toBe(rounds.get("b"));
  });
});

describe("a dot that attaches two ways, in the font written", () => {
  const made = exportFont(document(), counterIds("out"));
  const font = new Font(new Face(new Blob(made.bytes)));
  const dot = (text: string) => {
    const placed = set(font, text);
    const it = placed[placed.length - 1]!;
    return [it.name, it.x, it.y];
  };

  it("is written without a word about it", () => {
    expect(made.warnings).toEqual([]);
  });

  it("sits by its foot on a round letter, and by its middle on a tall one", () => {
    // Its anchor on the letter's, less the letter's width the pen has passed.
    expect(dot(`o${DOT}`)).toEqual(["dotaccentcomb", 250 - 30 - 500, 520]);
    expect(dot(`l${DOT}`)).toEqual(["dotaccentcomb", 120 - 30 - 500, 760 - 30]);
  });

  it("takes the later of the two where a letter has a place for both", () => {
    expect(dot(`b${DOT}`)).toEqual(["dotaccentcomb", 100 - 30 - 500, 760 - 30]);
  });

  it("is left where it falls on a letter with a place for neither", () => {
    expect(dot(`x${DOT}`)).toEqual(["dotaccentcomb", 0, 0]);
  });

  it("leaves a mark that attaches one way attaching that way", () => {
    expect(dot(`o${RING}`)).toEqual(["ringcomb", 250 - 40 - 500, 520]);
    expect(dot(`b${RING}`)).toEqual(["ringcomb", 300 - 40 - 500, 520]);
    // A tall letter has no place for it.
    expect(dot(`l${RING}`)).toEqual(["ringcomb", 0, 0]);
  });

  it("still has an accent stack on it, wherever it was put", () => {
    // The ring on the dot's own top, which is ninety above the dot's foot: on
    // the tall letter the dot sits by its middle, thirty lower.
    expect(dot(`o${DOT}${RING}`)).toEqual(["ringcomb", 250 - 40 - 500, 520 + 90]);
    expect(dot(`l${DOT}${RING}`)).toEqual(["ringcomb", 120 - 40 - 500, 760 - 30 + 90]);
  });

  it("comes back, read in, with both anchors on the dot and in their order", () => {
    const read = importFont(made.bytes, counterIds("back"));
    expect(read.warnings.map((w) => w.message)).toEqual([]);
    expect(read.document.features).not.toMatch(/pos base|pos mark/);

    const back = read.document.glyphs["dotaccentcomb"]!.anchors.filter((a) =>
      a.name.startsWith("_"),
    );
    expect(back.map((a) => [a.pt.x, a.pt.y])).toEqual([
      [30, 0],
      [30, 30],
    ]);
    // The names are given again from where the letters carry them; what has
    // to hold is that there are two, and which letters offer which.
    const [first, second] = back.map((a) => a.name.slice(1));
    expect(first).not.toBe(second);
    const offers = (name: string) =>
      read.document.glyphs[name]!.anchors.filter((a) => !a.name.startsWith("_")).map((a) => a.name);
    expect(offers("o")).toEqual([first]);
    expect(offers("l")).toEqual([second]);
    expect(offers("b").sort()).toEqual([first, second].sort());

    const again = new Font(
      new Face(new Blob(exportFont(read.document, counterIds("again")).bytes)),
    );
    for (const text of [
      `o${DOT}`,
      `l${DOT}`,
      `b${DOT}`,
      `b${RING}`,
      `l${DOT}${RING}`,
      `o${DOT}${RING}`,
    ]) {
      expect(set(again, text), text).toEqual(set(font, text));
    }
  });
});

describe("the lookups a mark in two classes is written in", () => {
  const order = new Map(glyphs().map((g, i) => [g.name, i]));
  const out = compileMarks(glyphs(), (name) => order.get(name));

  it("are a lookup of letters for each round, and then the marks on marks", () => {
    expect(out.lookups.map((l) => l.type)).toEqual([4, 4, 6]);
    expect(out.features).toEqual(["mark", "mark", "mkmk"]);
    expect(out.warnings).toEqual([]);
  });
});

describe("a mark in two classes, in the Marks file", () => {
  const names = new Set(glyphs().map((g) => g.name));
  const reading = (text: string) => readMarks(text, (name) => names.has(name));
  const body = (text: string) =>
    text
      .split("\n")
      .filter((line) => !line.startsWith("#"))
      .join("\n")
      .trim();

  it("is in a class for each anchor, and the letters' rules in a lookup for each round", () => {
    expect(body(writeMarks(glyphs()))).toBe(
      [
        "markClass dotaccentcomb <anchor 30 0> @MC_top;",
        "markClass ringcomb <anchor 40 0> @MC_top;",
        "",
        "markClass dotaccentcomb <anchor 30 30> @MC_high;",
        "",
        "feature mark {",
        "    lookup mark_1 {",
        "        pos base o <anchor 250 520> mark @MC_top;",
        "        pos base b <anchor 300 520> mark @MC_top;",
        "    } mark_1;",
        "    lookup mark_2 {",
        "        pos base l <anchor 120 760> mark @MC_high;",
        "        pos base b <anchor 100 760> mark @MC_high;",
        "    } mark_2;",
        "} mark;",
        "",
        "feature mkmk {",
        "    lookupflag UseMarkFilteringSet [dotaccentcomb ringcomb];",
        "    pos mark dotaccentcomb <anchor 30 90> mark @MC_top;",
        "} mkmk;",
      ].join("\n"),
    );
  });

  it("is read back as it was written, and changes nothing", () => {
    const read = reading(writeMarks(glyphs()));
    expect(read.problems).toEqual([]);
    expect(placeMarks(glyphs(), read, ids)).toEqual([]);
  });

  it("has a second way of attaching added by a line, and taken away by its going", () => {
    const text = writeMarks(glyphs()).replace(
      "markClass dotaccentcomb <anchor 30 30> @MC_high;",
      "markClass dotaccentcomb <anchor 30 30> @MC_high;\nmarkClass ringcomb <anchor 40 40> @MC_high;",
    );
    const read = reading(text);
    expect(read.problems).toEqual([]);
    const [ring] = placeMarks(glyphs(), read, ids).filter((g) => g.name === "ringcomb");
    expect(ring!.anchors.map((a) => [a.name, a.pt.x, a.pt.y])).toEqual([
      ["_top", 40, 0],
      ["_high", 40, 40],
    ]);

    const without = writeMarks(glyphs()).replace(
      "markClass dotaccentcomb <anchor 30 30> @MC_high;\n",
      "",
    );
    // The class is then one nothing attaches by, and its rules name nothing.
    expect(
      reading(without)
        .problems.map((p) => p.message)
        .join(" | "),
    ).toContain("not a mark class");
  });

  it("does not take a lookup inside a lookup, or one among the joins", () => {
    const nested =
      "markClass ringcomb <anchor 0 0> @MC_top;\nfeature mark { lookup a { lookup b { } b; } a; } mark;";
    expect(reading(nested).problems.length).toBeGreaterThan(0);
  });
});
