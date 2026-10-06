import {
  DEFAULT_FONT_INFO,
  type FontDocument,
  type Glyph,
  type Kerning,
  anchor,
  counterIds,
  fontDocument,
  glyph,
  rectContour,
} from "@typewright/font-model";
import { Blob, Face, Font } from "harfbuzzjs";
import { describe, expect, it } from "vitest";

import { compileCursive } from "../src/cursive.js";
import { exportFont } from "../src/export.js";
import { importFont } from "../src/import.js";
import { placeMarks, readMarks, writeMarks } from "../src/marks-source.js";
import { set } from "./real-fonts.js";

/**
 * Letters joined one to the next, each where the one before left off.
 *
 * A glyph says where it is joined to and where the next joins it — an `entry`
 * and an `exit` — and the font is written with the rule that lets a shaper set
 * a word as a stair: each letter's entry on the exit of the one before, and
 * the last of them on the line. HarfBuzz is asked, since it wrote none of it;
 * and the font read in again has the anchors it was written from.
 */

const ids = counterIds("cu");
const at = (name: string, x: number, y: number) => anchor(ids.anchor(), name, { x, y });
const box = (w: number, h: number) => rectContour(ids, { minX: 0, minY: 0, maxX: w, maxY: h });

/**
 * Three letters. The first only leaves, the last only arrives, and the one
 * between does both; each leaves a hundred units above where it arrived.
 */
function glyphs(): Glyph[] {
  return [
    glyph(".notdef", { advance: 500 }),
    glyph("a", {
      unicodes: [0x61],
      advance: 500,
      contours: [box(400, 300)],
      anchors: [at("exit", 400, 100)],
    }),
    glyph("b", {
      unicodes: [0x62],
      advance: 500,
      contours: [box(400, 300)],
      anchors: [at("entry", 50, 0), at("exit", 420, 100), at("top", 200, 320)],
    }),
    glyph("c", {
      unicodes: [0x63],
      advance: 500,
      contours: [box(400, 300)],
      anchors: [at("entry", 30, 0)],
    }),
    glyph("d", { unicodes: [0x64], advance: 500, contours: [box(400, 300)] }),
    glyph("acutecomb", {
      unicodes: [0x301],
      advance: 0,
      contours: [box(80, 60)],
      anchors: [at("_top", 40, 0)],
    }),
  ];
}

function document(more: Partial<FontDocument> = {}): FontDocument {
  return { ...fontDocument(glyphs(), { ...DEFAULT_FONT_INFO, unitsPerEm: 1000 }), ...more };
}

describe("letters joined, in the font written", () => {
  const made = exportFont(document(), counterIds("out"));
  const font = new Font(new Face(new Blob(made.bytes)));
  const placed = (text: string) => set(font, text).map((g) => [g.name, g.advance, g.x, g.y]);

  it("is written without a word about it", () => {
    expect(made.warnings).toEqual([]);
  });

  it("sets each letter's entry on the exit of the one before, the last on the line", () => {
    // a ends at its exit, 400 along; b is drawn back by its entry, 50, so the
    // two meet. And a is let down by the hundred its exit is above b's entry:
    // it is the last letter that stays where it is.
    expect(placed("ab")).toEqual([
      ["a", 400, 0, -100],
      ["b", 450, -50, 0],
    ]);
  });

  it("carries the fall through a word, a step for each join", () => {
    expect(placed("abc")).toEqual([
      ["a", 400, 0, -200],
      ["b", 370, -50, -100],
      ["c", 470, -30, 0],
    ]);
  });

  it("leaves alone a letter that is joined to nothing", () => {
    expect(placed("ad")).toEqual([
      ["a", 500, 0, 0],
      ["d", 500, 0, 0],
    ]);
    // And two that only leave, or only arrive, have nothing to meet.
    expect(placed("aa").map(([, advance, , y]) => [advance, y])).toEqual([
      [500, 0],
      [500, 0],
    ]);
  });

  it("joins across an accent, which goes with the letter it is on", () => {
    const [a, b, accent] = placed("ab́");
    expect(a).toEqual(["a", 400, 0, -100]);
    expect(b).toEqual(["b", 450, -50, 0]);
    expect(accent![0]).toBe("acutecomb");

    // The accent between them does not come between their joining.
    const between = placed("áb");
    expect(between[0]).toEqual(["a", 400, 0, -100]);
    expect(between[2]).toEqual(["b", 450, -50, 0]);
  });

  it("comes back, read in, with the anchors it was written from", () => {
    const read = importFont(made.bytes, counterIds("back"));
    expect(read.warnings.map((w) => w.message).filter((m) => /cursive/.test(m))).toEqual([]);
    expect(read.document.features).not.toMatch(/cursive/);
    const joins = (name: string) =>
      read.document.glyphs[name]!.anchors.filter(
        (a) => a.name === "entry" || a.name === "exit",
      ).map((a) => [a.name, a.pt.x, a.pt.y]);
    expect(joins("a")).toEqual([["exit", 400, 100]]);
    expect(joins("b")).toEqual([
      ["entry", 50, 0],
      ["exit", 420, 100],
    ]);
    expect(joins("c")).toEqual([["entry", 30, 0]]);

    const again = new Font(
      new Face(new Blob(exportFont(read.document, counterIds("again")).bytes)),
    );
    for (const text of ["ab", "abc", "áb", "ad"]) {
      expect(set(again, text), text).toEqual(set(font, text));
    }
  });
});

describe("the joins among the lookups", () => {
  const order = new Map(glyphs().map((g, i) => [g.name, i]));
  const u16 = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;

  it("are one lookup, read from the end of the line and passing over marks", () => {
    const [lookup, ...rest] = compileCursive(glyphs(), (name) => order.get(name));
    expect(rest).toEqual([]);
    expect(lookup!.type).toBe(3);
    expect(lookup!.flags).toBe(0x0001 | 0x0008);

    const sub = lookup!.subtables[0]!;
    expect(u16(sub, 0)).toBe(1);
    expect(u16(sub, 4)).toBe(3); // a, b and c
    // a has no entry and an exit; the exit is where it was put.
    expect(u16(sub, 6)).toBe(0);
    const exit = u16(sub, 8);
    expect([u16(sub, exit), u16(sub, exit + 2), u16(sub, exit + 4)]).toEqual([1, 400, 100]);
  });

  it("are none where no glyph is joined", () => {
    const plain = [glyph("a", { anchors: [at("top", 0, 0)] })];
    expect(compileCursive(plain, () => 1)).toEqual([]);
  });

  it("are not made of a place for an accent that happens to be called exit", () => {
    const named = [
      glyph("a", { anchors: [at("exit", 400, 100)] }),
      glyph("hook", { anchors: [at("_exit", 0, 0)] }),
    ];
    expect(compileCursive(named, (name) => (name === "a" ? 1 : 2))).toEqual([]);
  });
});

describe("a rule that calls a lookup, in a font that is kerned", () => {
  // The feature file's lookups are numbered by the feature file, and a rule in
  // a context has the number of the lookup it calls written into it. The
  // kerning was put ahead of them in the font, and the rule called whatever
  // then had that number.
  const features = [
    "lookup LIFT {",
    "    pos b <0 40 0 0>;",
    "} LIFT;",
    "",
    "feature kern {",
    "    pos d b' lookup LIFT;",
    "} kern;",
    "",
  ].join("\n");
  const kerning: Kerning = { firstGroups: {}, secondGroups: {}, pairs: { d: { d: -50 } } };

  it.each([
    ["with no kerning", {}],
    ["with kerning", { kerning }],
  ])("lifts the letter it names, %s", (_, more) => {
    const plain = fontDocument(
      glyphs().map((g) => ({ ...g, anchors: [] })),
      { ...DEFAULT_FONT_INFO, unitsPerEm: 1000 },
    );
    const out = exportFont({ ...plain, features, ...more }, counterIds("k"));
    expect(out.warnings).toEqual([]);
    const font = new Font(new Face(new Blob(out.bytes)));
    expect(set(font, "db").map((g) => [g.name, g.y])).toEqual([
      ["d", 0],
      ["b", 40],
    ]);
    if ("kerning" in more) expect(set(font, "dd")[0]!.advance).toBe(450);
  });
});

describe("the joins in the Marks file", () => {
  const names = new Set(glyphs().map((g) => g.name));
  const reading = (text: string) => readMarks(text, (name) => names.has(name));
  const block = (text: string) => text.slice(text.indexOf("feature curs"));

  it("are written under the flags they are compiled with, each glyph's entry and then its exit", () => {
    expect(block(writeMarks(glyphs()))).toBe(
      [
        "feature curs {",
        "    lookupflag RightToLeft IgnoreMarks;",
        "    pos cursive a <anchor NULL> <anchor 400 100>;",
        "    pos cursive b <anchor 50 0> <anchor 420 100>;",
        "    pos cursive c <anchor 30 0> <anchor NULL>;",
        "} curs;",
        "",
      ].join("\n"),
    );
    // And a joined letter's place for an accent is still its place for one.
    expect(writeMarks(glyphs())).toMatch(/pos base b <anchor 200 320> mark @MC_top;/);
    expect(writeMarks(glyphs())).not.toMatch(/@MC_entry|@MC_exit/);
  });

  it("are read back as they were written, and change nothing", () => {
    const read = reading(writeMarks(glyphs()));
    expect(read.problems).toEqual([]);
    expect(placeMarks(glyphs(), read, ids)).toEqual([]);
  });

  it("are moved, added and taken away by their lines", () => {
    const text = writeMarks(glyphs())
      .replace(
        "pos cursive a <anchor NULL> <anchor 400 100>;",
        "pos cursive a <anchor 10 0> <anchor 410 90>;",
      )
      .replace("    pos cursive c <anchor 30 0> <anchor NULL>;\n", "");
    const read = reading(text);
    expect(read.problems).toEqual([]);
    const changed = new Map(placeMarks(glyphs(), read, ids).map((g) => [g.name, g]));
    expect(
      changed
        .get("a")!
        .anchors.map((a) => [a.name, a.pt.x, a.pt.y])
        .sort(),
    ).toEqual([
      ["entry", 10, 0],
      ["exit", 410, 90],
    ]);
    expect(changed.get("c")!.anchors).toEqual([]);
    expect(changed.has("b")).toBe(false);
  });

  it.each([
    [
      "a join among the marks",
      "feature mark { pos cursive a <anchor 1 2> <anchor 3 4>; } mark;",
      "belongs in feature curs",
    ],
    [
      "a letter's accent among the joins",
      "feature curs { pos base a <anchor 1 2> mark @MC_top; } curs;",
      "belongs in feature mark",
    ],
    [
      "a glyph joined to nothing",
      "feature curs { pos cursive a <anchor NULL> <anchor NULL>; } curs;",
      "not both",
    ],
    [
      "a glyph joined twice",
      "feature curs { pos cursive a <anchor 1 2> <anchor 3 4>; pos cursive a <anchor 1 2> <anchor 3 4>; } curs;",
      "already has its entry and exit",
    ],
    [
      "other flags",
      "feature curs { lookupflag IgnoreMarks; pos cursive a <anchor 1 2> <anchor 3 4>; } curs;",
      "and no other",
    ],
    [
      "a join with one anchor",
      "feature curs { pos cursive a <anchor 1 2>; } curs;",
      "expected an anchor",
    ],
  ])("refuse %s", (_, text, message) => {
    const read = reading(`markClass acutecomb <anchor 0 500> @MC_top;\n${text}`);
    expect(read.problems.map((p) => p.message).join(" | ")).toContain(message);
  });
});
