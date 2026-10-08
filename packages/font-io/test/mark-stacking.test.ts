import {
  DEFAULT_FONT_INFO,
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
import { placeMarks, readMarks, writeMarks } from "../src/marks-source.js";
import { compileMarks, stackingSets } from "../src/marks.js";
import { set } from "./real-fonts.js";

/**
 * An accent on an accent, with a mark of another kind typed between them.
 *
 * An accent stacks on the accent before it — among the marks of its own kind.
 * With a dot below typed between two accents above, the second still belongs
 * on the first; left to look at the mark just before it, it found the dot,
 * which has no place for it, and sat on the letter under the first accent.
 * Each class's lookup of marks on marks now looks at the marks of that class
 * and passes over the rest.
 *
 * The marks here are typed as characters of the private use area, which a
 * shaper leaves in the order typed: combining marks proper it sorts by where
 * they sit before any font is asked, and would put the dot out of the way.
 */

const ids = counterIds("st");
const at = (name: string, x: number, y: number) => anchor(ids.anchor(), name, { x, y });
const box = (w: number, h: number) => rectContour(ids, { minX: 0, minY: 0, maxX: w, maxY: h });

const ABOVE = "";
const ABOVE_TOO = "";
const BELOW = "";
const BELOW_TOO = "";

function glyphs(): Glyph[] {
  const mark = (name: string, code: number, anchors: ReturnType<typeof at>[]) =>
    glyph(name, { unicodes: [code], advance: 0, contours: [box(60, 60)], anchors });
  return [
    glyph(".notdef", { advance: 500 }),
    glyph("o", {
      unicodes: [0x6f],
      advance: 500,
      contours: [box(400, 500)],
      anchors: [at("top", 250, 520), at("bottom", 250, -20)],
    }),
    mark("above", 0xe001, [at("_top", 30, 0), at("top", 30, 100)]),
    mark("above.too", 0xe002, [at("_top", 30, 0), at("top", 30, 100)]),
    mark("below", 0xe003, [at("_bottom", 30, 60), at("bottom", 30, -40)]),
    mark("below.too", 0xe004, [at("_bottom", 30, 60)]),
  ];
}

describe("an accent on an accent, past a mark of another kind", () => {
  const made = exportFont(
    fontDocument(glyphs(), { ...DEFAULT_FONT_INFO, unitsPerEm: 1000 }),
    counterIds("out"),
  );
  const font = new Font(new Face(new Blob(made.bytes)));
  const heights = (text: string) => set(font, text).map((g) => [g.name, g.y]);

  it("is written without a word about it", () => {
    expect(made.warnings).toEqual([]);
  });

  it("stacks on the accent before it, next to it", () => {
    expect(heights(`o${ABOVE}${ABOVE_TOO}`)).toEqual([
      ["o", 0],
      ["above", 520],
      ["above.too", 620],
    ]);
  });

  it("stacks on it still with a dot below typed between", () => {
    expect(heights(`o${ABOVE}${BELOW}${ABOVE_TOO}`)).toEqual([
      ["o", 0],
      ["above", 520],
      ["below", -80],
      ["above.too", 620],
    ]);
  });

  it("does the same below, past an accent above", () => {
    // The first below hangs by its top from the letter's bottom; the second
    // hangs from the first's own bottom, a hundred lower.
    expect(heights(`o${BELOW}${ABOVE}${BELOW_TOO}`)).toEqual([
      ["o", 0],
      ["below", -80],
      ["above", 520],
      ["below.too", -180],
    ]);
  });
});

describe("the sets the lookups of marks on marks look at", () => {
  it("are the marks of each class: the ones that attach by it and the ones that offer it", () => {
    expect([...stackingSets(glyphs())]).toEqual([
      ["top", ["above", "above.too"]],
      ["bottom", ["below", "below.too"]],
    ]);
  });

  it("are not there for a class nothing stacks in", () => {
    const flat = glyphs().map((g) => ({
      ...g,
      anchors: g.name === "o" ? g.anchors : g.anchors.filter((a) => a.name.startsWith("_")),
    }));
    expect(stackingSets(flat).size).toBe(0);
  });

  it("are written a lookup to a class, each under its set", () => {
    const order = new Map(glyphs().map((g, i) => [g.name, i]));
    const out = compileMarks(glyphs(), (name) => order.get(name));
    expect(out.lookups.map((l) => [l.type, l.flags ?? 0, l.markFilteringSet ?? null])).toEqual([
      [4, 0, null],
      [6, 0x0010, 0],
      [6, 0x0010, 1],
    ]);
    expect(out.markSets).toEqual([
      [order.get("above"), order.get("above.too")],
      [order.get("below"), order.get("below.too")],
    ]);
  });
});

describe("marks on marks in the Marks file", () => {
  const names = new Set(glyphs().map((g) => g.name));
  const reading = (text: string) => readMarks(text, (name) => names.has(name));

  it("are a lookup to a class, each saying the marks it looks at", () => {
    const text = writeMarks(glyphs());
    expect(text.slice(text.indexOf("feature mkmk"))).toBe(
      [
        "feature mkmk {",
        "    lookup mkmk_top {",
        "        lookupflag UseMarkFilteringSet [above above.too];",
        "        pos mark above <anchor 30 100> mark @MC_top;",
        "        pos mark above.too <anchor 30 100> mark @MC_top;",
        "    } mkmk_top;",
        "    lookup mkmk_bottom {",
        "        lookupflag UseMarkFilteringSet [below below.too];",
        "        pos mark below <anchor 30 -40> mark @MC_bottom;",
        "    } mkmk_bottom;",
        "} mkmk;",
        "",
      ].join("\n"),
    );
  });

  it("are read back as they were written, and change nothing", () => {
    const read = reading(writeMarks(glyphs()));
    expect(read.problems).toEqual([]);
    expect(placeMarks(glyphs(), read, ids)).toEqual([]);
  });
});
