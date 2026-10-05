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
import { compileMarks } from "../src/marks.js";
import { set } from "./real-fonts.js";

/**
 * Accents on the parts of a ligature.
 *
 * A ligature is two letters in one glyph, and an accent typed after the first
 * of them belongs over the first. The glyph says where by an anchor for each
 * part — `top_1`, `top_2` — and the font is written with the rule a shaper
 * needs to put the accent there. HarfBuzz is asked, since it did not write any
 * of it; and the font read in again has the anchors it was written from.
 */

const ids = counterIds("lm");
const at = (name: string, x: number, y: number) => anchor(ids.anchor(), name, { x, y });
const box = (w: number, h: number) => rectContour(ids, { minX: 0, minY: 0, maxX: w, maxY: h });

const ACUTE = "́";
const DOT_BELOW = "̣";

/** f, i and their ligature, which has a place above each part and one below the second only. */
function glyphs(): Glyph[] {
  return [
    glyph(".notdef", { advance: 500 }),
    glyph("f", { unicodes: [0x66], advance: 300, contours: [box(250, 700)] }),
    glyph("i", {
      unicodes: [0x69],
      advance: 250,
      contours: [box(100, 500)],
      anchors: [at("top", 50, 520)],
    }),
    glyph("f_i", {
      advance: 560,
      contours: [box(500, 700)],
      anchors: [at("top_1", 140, 720), at("top_2", 430, 540), at("bottom_2", 430, -20)],
    }),
    glyph("acutecomb", {
      unicodes: [0x301],
      advance: 0,
      contours: [box(80, 60)],
      anchors: [at("_top", 40, 0)],
    }),
    glyph("dotbelowcomb", {
      unicodes: [0x323],
      advance: 0,
      contours: [box(60, 60)],
      anchors: [at("_bottom", 30, 60)],
    }),
  ];
}

/** The ligature made whatever accents stand between its letters. */
const FEATURES = [
  "feature liga {",
  "    lookupflag IgnoreMarks;",
  "    sub f i by f_i;",
  "} liga;",
  "",
].join("\n");

function document(): FontDocument {
  return {
    ...fontDocument(glyphs(), { ...DEFAULT_FONT_INFO, unitsPerEm: 1000 }),
    features: FEATURES,
  };
}

describe("accents on a ligature, in the font written", () => {
  const made = exportFont(document(), counterIds("out"));
  const font = new Font(new Face(new Blob(made.bytes)));
  /** The glyphs of a text and where each accent is, from where the pen stood. */
  const placed = (text: string) => set(font, text).map((g) => [g.name, g.x, g.y]);

  it("is written without a word about it", () => {
    expect(made.warnings).toEqual([]);
  });

  it("puts an accent over the part it was typed after", () => {
    // After the f: over the first part. The pen has passed the ligature, 560
    // wide, so the accent is drawn back by that, to where its own anchor
    // meets the part's.
    expect(placed(`f${ACUTE}i`)).toEqual([
      ["f_i", 0, 0],
      ["acutecomb", 140 - 40 - 560, 720],
    ]);
    // After the i: over the second.
    expect(placed(`fi${ACUTE}`)).toEqual([
      ["f_i", 0, 0],
      ["acutecomb", 430 - 40 - 560, 540],
    ]);
  });

  it("puts one over each, typed after each", () => {
    expect(placed(`f${ACUTE}i${ACUTE}`)).toEqual([
      ["f_i", 0, 0],
      ["acutecomb", 140 - 40 - 560, 720],
      ["acutecomb", 430 - 40 - 560, 540],
    ]);
  });

  it("leaves an accent where it falls on a part with no place for it", () => {
    // Below the second part there is a place, and below the first there is not.
    expect(placed(`fi${DOT_BELOW}`)).toEqual([
      ["f_i", 0, 0],
      ["dotbelowcomb", 430 - 30 - 560, -20 - 60],
    ]);
    expect(placed(`f${DOT_BELOW}i`)[1]).toEqual(["dotbelowcomb", 0, 0]);
  });

  it("still puts it on a letter that is not a ligature", () => {
    expect(placed(`i${ACUTE}`)).toEqual([
      ["i", 0, 0],
      ["acutecomb", 50 - 40 - 250, 520],
    ]);
  });

  it("comes back, read in, with the anchors it was written from", () => {
    const read = importFont(made.bytes, counterIds("back"));
    expect(read.warnings.map((w) => w.message).filter((m) => /ligature/.test(m))).toEqual([]);
    expect(read.document.features).not.toMatch(/pos ligature/);

    const back = read.document.glyphs["f_i"]!.anchors.map((a) => [a.name, a.pt.x, a.pt.y]);
    expect(back.sort()).toEqual(
      [
        ["bottom_2", 430, -20],
        ["top_1", 140, 720],
        ["top_2", 430, 540],
      ].sort(),
    );

    // And written again is set as it was.
    const again = new Font(
      new Face(new Blob(exportFont(read.document, counterIds("again")).bytes)),
    );
    for (const text of [`f${ACUTE}i`, `fi${ACUTE}`, `fi${DOT_BELOW}`, `f${DOT_BELOW}i`]) {
      expect(set(again, text), text).toEqual(set(font, text));
    }
  });
});

describe("a ligature among the lookups", () => {
  const order = new Map(glyphs().map((g, i) => [g.name, i]));
  const out = compileMarks(glyphs(), (name) => order.get(name));
  const u16 = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;

  it("has a lookup of its own, in the feature the letters' is in", () => {
    expect(out.features).toEqual(["mark", "mark"]);
    expect(out.lookups.map((l) => l.type)).toEqual([4, 5]);
  });

  it("is written with as many parts as its anchors name, each with a place for each class", () => {
    const sub = out.lookups[1]!.subtables[0]!;
    expect(u16(sub, 0)).toBe(1);
    expect(u16(sub, 6)).toBe(2); // top and bottom
    const array = u16(sub, 10);
    expect(u16(sub, array)).toBe(1); // one ligature
    const attach = array + u16(sub, array + 2);
    expect(u16(sub, attach)).toBe(2); // of two parts
    // The first part: a place above, none below. The second: both.
    const offsets = [0, 1, 2, 3].map((k) => u16(sub, attach + 2 + k * 2));
    expect(offsets.map((o) => o !== 0)).toEqual([true, false, true, true]);
    const second = attach + offsets[2]!;
    expect([u16(sub, second), u16(sub, second + 2), u16(sub, second + 4)]).toEqual([1, 430, 540]);
  });

  it("is said to be a ligature, and the letter a letter", () => {
    expect(out.classes.get(order.get("f_i")!)).toBe(2);
    expect(out.classes.get(order.get("i")!)).toBe(1);
    expect(out.classes.get(order.get("acutecomb")!)).toBe(3);
  });

  it("is a letter still, where nothing attaches by the name its anchor is numbered from", () => {
    // `exit_1` with no `_exit` anywhere is an anchor somebody named, and no
    // part of anything.
    const plain = [
      glyph("a", { anchors: [at("top", 250, 500), at("exit_1", 500, 0)] }),
      glyph("acutecomb", { anchors: [at("_top", 0, 500)] }),
    ];
    const made = compileMarks(plain, (name) => (name === "a" ? 1 : 2));
    expect(made.lookups.map((l) => l.type)).toEqual([4]);
    expect(made.classes.get(1)).toBe(1);
  });
});

describe("a ligature in the Marks file", () => {
  const names = new Set(glyphs().map((g) => g.name));
  const reading = (text: string) => readMarks(text, (name) => names.has(name));
  const rule = (text: string) => {
    const from = text.indexOf("    pos ligature");
    return text.slice(from, text.indexOf(";", from) + 1);
  };

  it("is written with its parts in turn", () => {
    expect(rule(writeMarks(glyphs()))).toBe(
      [
        "    pos ligature f_i",
        "        <anchor 140 720> mark @MC_top",
        "        ligComponent",
        "        <anchor 430 540> mark @MC_top",
        "        <anchor 430 -20> mark @MC_bottom;",
      ].join("\n"),
    );
  });

  it("is read back as it was written, and changes nothing", () => {
    const read = reading(writeMarks(glyphs()));
    expect(read.problems).toEqual([]);
    expect(placeMarks(glyphs(), read, ids)).toEqual([]);
  });

  it("has an anchor moved, added and taken away by its lines", () => {
    const text = writeMarks(glyphs())
      .replace("<anchor 140 720> mark @MC_top", "<anchor 150 730> mark @MC_top")
      .replace(
        "        <anchor 430 -20> mark @MC_bottom;",
        "        ligComponent\n        <anchor 600 0> mark @MC_bottom;",
      );
    const read = reading(text);
    expect(read.problems).toEqual([]);
    const [changed] = placeMarks(glyphs(), read, ids).filter((g) => g.name === "f_i");
    expect(changed!.anchors.map((a) => [a.name, a.pt.x, a.pt.y]).sort()).toEqual(
      [
        ["bottom_3", 600, 0],
        ["top_1", 150, 730],
        ["top_2", 430, 540],
      ].sort(),
    );
  });

  it("counts a part that has no place", () => {
    const text = writeMarks(glyphs()).replace(
      "        <anchor 140 720> mark @MC_top\n",
      "        <anchor NULL>\n",
    );
    const read = reading(text);
    expect(read.problems).toEqual([]);
    const [changed] = placeMarks(glyphs(), read, ids).filter((g) => g.name === "f_i");
    expect(changed!.anchors.map((a) => a.name).sort()).toEqual(["bottom_2", "top_2"]);
    // And writes it so: the first part there, and nothing on it.
    const again = glyphs().map((g) => (g.name === "f_i" ? changed! : g));
    expect(rule(writeMarks(again))).toBe(
      [
        "    pos ligature f_i",
        "        <anchor NULL>",
        "        ligComponent",
        "        <anchor 430 540> mark @MC_top",
        "        <anchor 430 -20> mark @MC_bottom;",
      ].join("\n"),
    );
  });

  it("keeps a place on the ligature that names no part, which is a component's", () => {
    const with_ = glyphs().map((g) =>
      g.name === "f_i" ? { ...g, anchors: [...g.anchors, at("top", 280, 720)] } : g,
    );
    const text = writeMarks(with_);
    expect(text).not.toMatch(/pos base f_i/);
    expect(placeMarks(with_, reading(text), ids)).toEqual([]);
  });

  it.each([
    [
      "a ligature that is a mark",
      "feature mark { pos ligature acutecomb <anchor 1 2> mark @MC_top; } mark;",
      "is a mark",
    ],
    [
      "a ligature that is also a letter",
      "feature mark { pos base f_i <anchor 1 2> mark @MC_top; pos ligature f_i <anchor 1 2> mark @MC_top; } mark;",
      "is a ligature",
    ],
    [
      "a ligature among the marks that stack",
      "feature mkmk { pos ligature f_i <anchor 1 2> mark @MC_top; } mkmk;",
      "belongs in feature mark",
    ],
    [
      "the same place on the same part twice",
      "feature mark { pos ligature f_i <anchor 1 2> mark @MC_top <anchor 3 4> mark @MC_top; } mark;",
      "on part 1",
    ],
  ])("refuses %s", (_, text, message) => {
    const read = reading(`markClass acutecomb <anchor 0 500> @MC_top;\n${text}`);
    expect(read.problems.map((p) => p.message).join(" | ")).toContain(message);
  });
});
