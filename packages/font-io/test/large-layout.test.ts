import {
  DEFAULT_FONT_INFO,
  type Kerning,
  contour,
  counterIds,
  fontDocument,
  glyph,
  groupKey,
  node,
  setFeatures,
} from "@typewright/font-model";
import { Blob, Buffer, Face, Font, shape } from "harfbuzzjs";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import {
  TableTooLarge,
  Writer,
  pairPosClassSubtables,
  pairPosGlyphSubtables,
} from "../src/gpos.js";
import { ligatureSubtables } from "../src/gsub.js";
import { layoutTable } from "../src/layout.js";

/**
 * Features and kerning larger than a sixteen-bit offset can reach.
 *
 * Nearly everything in GSUB and GPOS is found by an offset of sixteen bits, and
 * a font with a ligature for each of four thousand icons, or two hundred groups
 * kerned against two hundred, is past that. Such a font was written with its
 * offsets cut to their low sixteen bits — a table pointing into the middle of
 * itself — and nothing said so.
 *
 * Checked with HarfBuzz, which did not write these tables: text set with the
 * font comes out as the feature file and the kerning say.
 */

const ids = counterIds("big");
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
const INFO = { ...DEFAULT_FONT_INFO, familyName: "Large Layout", unitsPerEm: 1000 };
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const letters = () =>
  [...LETTERS].map((name) =>
    glyph(name, { unicodes: [name.charCodeAt(0)], advance: 500, contours: [drawn()] }),
  );

function set(font: Font, text: string) {
  const buffer = new Buffer();
  buffer.addText(text);
  buffer.guessSegmentProperties();
  shape(font, buffer, []);
  const placed = buffer.getGlyphInfosAndPositions();
  return {
    names: placed.map((p) => font.glyphName(p.codepoint)),
    advances: placed.map((p) => p.xAdvance ?? 0),
  };
}

/** A word of twelve letters for a number, no two the same. */
function word(n: number): string {
  let out = "";
  for (let i = 0, rest = n; i < 4; i++, rest = Math.floor(rest / 26)) {
    out += LETTERS.charAt(rest % 26);
  }
  return `${out}icon${out.split("").reverse().join("")}`;
}

describe("a layout table too large for sixteen bits", () => {
  it("makes every ligature of an icon font with thousands of them", () => {
    const COUNT = 3000;
    const icons = Array.from({ length: COUNT }, (_, i) =>
      glyph(`icon${String(i)}`, { advance: 1000, contours: [drawn()] }),
    );
    const rules = icons
      .map((icon, i) => `  sub ${[...word(i)].join(" ")} by ${icon.name};`)
      .join("\n");
    const document = setFeatures(
      fontDocument([glyph(".notdef", { advance: 500 }), ...letters(), ...icons], INFO),
      `feature liga {\n${rules}\n} liga;`,
    );

    const { bytes } = exportFont(document);
    const font = new Font(new Face(new Blob(bytes)));
    for (const i of [0, 1, 25, 26, 700, 1499, 1500, 2998, 2999]) {
      expect(set(font, word(i)).names, word(i)).toEqual([`icon${String(i)}`]);
    }
    // And a word that is nobody's is left as its letters.
    expect(set(font, "zzzzzzzzzzzz").names).toHaveLength(12);
  });

  it("kerns every pair of two hundred groups against two hundred", () => {
    const N = 220;
    const lefts = Array.from({ length: N }, (_, i) =>
      glyph(`l${String(i)}`, { unicodes: [0xe000 + i], advance: 500, contours: [drawn()] }),
    );
    const rights = Array.from({ length: N }, (_, i) =>
      glyph(`r${String(i)}`, { unicodes: [0xe400 + i], advance: 500, contours: [drawn()] }),
    );
    const value = (i: number, j: number): number => -(1 + ((i * 7 + j * 3) % 90));

    const firstGroups: Record<string, string[]> = {};
    const secondGroups: Record<string, string[]> = {};
    const pairs: Record<string, Record<string, number>> = {};
    for (let i = 0; i < N; i++) {
      firstGroups[`L${String(i)}`] = [`l${String(i)}`];
      secondGroups[`R${String(i)}`] = [`r${String(i)}`];
      const row: Record<string, number> = {};
      for (let j = 0; j < N; j++) row[groupKey(`R${String(j)}`)] = value(i, j);
      pairs[groupKey(`L${String(i)}`)] = row;
    }
    // And glyph against glyph, enough of them to be past one subtable too.
    for (let i = 0; i < N; i++) {
      const row: Record<string, number> = {};
      for (let j = 0; j < 100; j++) row[`l${String(j)}`] = -(100 + ((i + j) % 50));
      pairs[`r${String(i)}`] = row;
    }
    const kerning: Kerning = { firstGroups, secondGroups, pairs };

    const base = fontDocument([glyph(".notdef", { advance: 500 }), ...lefts, ...rights], INFO);
    const { bytes } = exportFont({ ...base, kerning });
    const font = new Font(new Face(new Blob(bytes)));

    const pair = (a: number, b: number): string => String.fromCodePoint(a, b);
    for (const [i, j] of [
      [0, 0],
      [1, 219],
      [110, 5],
      [219, 219],
      [150, 73],
    ] as const) {
      expect(
        set(font, pair(0xe000 + i, 0xe400 + j)).advances[0],
        `l${String(i)} r${String(j)}`,
      ).toBe(500 + value(i, j));
    }
    for (const [i, j] of [
      [0, 0],
      [219, 99],
      [100, 50],
    ] as const) {
      expect(
        set(font, pair(0xe400 + i, 0xe000 + j)).advances[0],
        `r${String(i)} l${String(j)}`,
      ).toBe(500 - (100 + ((i + j) % 50)));
    }
  });

  it("divides what is too large into subtables that each fit", () => {
    const ligatures = Array.from({ length: 6000 }, (_, i) => ({
      from: [1 + (i % 40), ...Array.from({ length: 11 }, (_, k) => 1 + ((i + k) % 26))],
      to: 100 + i,
    }));
    const subs = ligatureSubtables(ligatures);
    expect(subs.length).toBeGreaterThan(1);
    for (const sub of subs) expect(sub.length).toBeLessThanOrEqual(0xffff);

    const pairs = new Map<number, Map<number, number>>();
    for (let i = 0; i < 300; i++) {
      pairs.set(i, new Map(Array.from({ length: 300 }, (_, j) => [j, -10])));
    }
    const glyphSubs = pairPosGlyphSubtables(pairs);
    expect(glyphSubs.length).toBeGreaterThan(1);
    for (const sub of glyphSubs) expect(sub.length).toBeLessThanOrEqual(0xffff);

    const class1 = new Map(Array.from({ length: 300 }, (_, i) => [i, i + 1]));
    const class2 = new Map(Array.from({ length: 300 }, (_, i) => [1000 + i, i + 1]));
    const classSubs = pairPosClassSubtables(
      [...class1.keys()],
      class1,
      class2,
      301,
      301,
      new Map(),
    );
    expect(classSubs.length).toBeGreaterThan(1);
    for (const sub of classSubs) expect(sub.length).toBeLessThanOrEqual(0xffff);
  });

  it("refuses to write a number that does not fit, where it once wrote part of it", () => {
    expect(() => new Writer().u16(0x10000)).toThrow(TableTooLarge);
    // A lookup list too large, with nothing said about which table it is for.
    const big = new Uint8Array(40_000);
    const lookups = [{ type: 4, subtables: [big, big, big] }];
    expect(() => layoutTable([{ tag: "liga", lookups: [0] }], lookups)).toThrow(TableTooLarge);
    expect(() =>
      layoutTable([{ tag: "liga", lookups: [0] }], lookups, undefined, [], "GSUB"),
    ).not.toThrow();
  });
});
