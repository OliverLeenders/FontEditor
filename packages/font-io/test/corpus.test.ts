import {
  type Contour,
  type FontDocument,
  correctDirections,
  counterIds,
  isEmptyContour,
  ligaturePart,
} from "@typewright/font-model";
import { Blob, Face, Font } from "harfbuzzjs";
import { beforeAll, describe, expect, it } from "vitest";

import { contoursFromCommands } from "../src/commands.js";
import { exportFont } from "../src/export.js";
import { type ImportResult, importFont } from "../src/import.js";
import { type SourceFont, parseFont } from "../src/source.js";
import { readUfo } from "../src/ufo-import.js";
import { ufoFiles } from "../src/ufo.js";
import { entryBytes } from "../src/zip.js";
import { fontBytes, inkApart, setDifferently } from "./real-fonts.js";

/**
 * Real fonts, each taken round: read in, written out, and set beside the font
 * it came from.
 *
 * A font this editor wrote and then read back proves only that it agrees with
 * itself. These are fonts somebody else made, of the kinds people bring to an
 * editor, and what is asked is what anybody would ask of a font opened and
 * exported again: that text set with it is the text it was. HarfBuzz sets the
 * same lines in the font as it was released and in the font as written here,
 * and the two have to come out as the same glyphs in the same places — every
 * character, thousands of pairs for the kerning, accents on letters and on
 * accents, and each feature the font has, switched on.
 *
 * The first time this was run, one font could not be written at all, another
 * lost every pair of its kerning and every accent, and three set `ff`
 * differently with their alternates on.
 *
 * What is known not to survive is written down here rather than left out: the
 * warnings each font is read and written with are the whole list, so a new one
 * is a failure, and so is one that has gone without this being told.
 */

type Case = {
  readonly name: string;
  readonly path: string;
  /** What reading it says, in full. */
  readonly readWith: readonly string[];
  /** What writing it may say: each warning has to be of one of these kinds. */
  readonly writtenWith: readonly RegExp[];
};

/** A place the glyphs' anchors say, which is where it is compiled from: said of each such rule. */
const ANCHORS_SAY = /attachment is where the glyphs' anchors say/;
/** U+0000, which the font gives a glyph of its own and the writer keeps for `.null`. */
const NULL_KEPT = /is left out of the character map, which keeps it for a glyph named \.null/;

const CASES: readonly Case[] = [
  {
    name: "Source Sans 3",
    path: "source-sans/SourceSans3-Regular.otf",
    readWith: ["the parameters of size are not imported"],
    writtenWith: [],
  },
  {
    name: "Noto Sans",
    path: "noto-sans/NotoSans-Regular.ttf",
    readWith: [],
    writtenWith: [ANCHORS_SAY, NULL_KEPT],
  },
  {
    name: "EB Garamond",
    path: "eb-garamond/EBGaramond[wght].ttf",
    readWith: ["device and variation adjustments in positioning are not imported"],
    writtenWith: [ANCHORS_SAY, NULL_KEPT],
  },
  {
    name: "Latin Modern Roman",
    path: "latin-modern/lmroman10-regular.otf",
    readWith: ["the parameters of size are not imported"],
    writtenWith: [],
  },
];

/** The letters and marks people set, of which each font is asked for the ones it has. */
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,-:;'\"()0123456789АВГТУаву";
const MARKS = [
  0x300, 0x301, 0x302, 0x303, 0x304, 0x306, 0x307, 0x308, 0x30a, 0x30c, 0x323, 0x327, 0x328,
];
const BASES = "AEIOUYCNSZaeiouycnszgjlt";
const LINES = [
  "The quick brown fox jumps over the lazy dog 0123456789",
  "THE QUICK BROWN FOX fi fl ff ffi ffl ft Th ct st",
  "1/2 3/4 H2O x2 (a) [b] {c} a-b a–b ¿¡ 1st 2nd",
];

describe.each(CASES)("$name, taken round", ({ path, readWith, writtenWith }) => {
  let source: SourceFont;
  let read: ImportResult;
  let document: FontDocument;
  let written: { bytes: ArrayBuffer; warnings: readonly string[] };
  let before: Font;
  let after: Font;
  let codes: number[];

  beforeAll(() => {
    const bytes = fontBytes(path);
    source = parseFont(bytes);
    read = importFont(bytes, counterIds("in"));
    document = read.document;
    written = exportFont(document, counterIds("out"));
    before = new Font(new Face(new Blob(bytes)));
    after = new Font(new Face(new Blob(written.bytes)));
    codes = [...new Set(Object.values(document.glyphs).flatMap((g) => g.unicodes))].sort(
      (a, b) => a - b,
    );
  }, 300_000);

  const has = (text: string): string[] =>
    [...text].filter((c) => codes.includes(c.codePointAt(0)!));

  it("is read with every glyph, and says only what is known to be left out", () => {
    expect(document.glyphOrder).toHaveLength(source.glyphs.length);
    expect(read.warnings.map((w) => w.message)).toEqual(readWith);
    expect(read.warnings.every((w) => w.glyph === null)).toBe(true);
  });

  it("is written saying only what is known of it", () => {
    const strange = written.warnings.filter((w) => !writtenWith.some((kind) => kind.test(w)));
    expect(strange.slice(0, 5)).toEqual([]);
  });

  it("sets every character it has as the font it came from does", () => {
    // But U+0000, which is not a character anybody sets.
    const texts = codes.filter((c) => c !== 0).map((c) => String.fromCodePoint(c));
    expect(texts.length).toBeGreaterThan(200);
    expect(setDifferently(before, after, texts).slice(0, 5)).toEqual([]);
  });

  it("kerns every pair of the letters people set as it does", () => {
    const letters = has(LETTERS);
    const pairs = letters.flatMap((l) => letters.map((r) => l + r));
    expect(pairs.length).toBeGreaterThan(3000);
    expect(setDifferently(before, after, pairs).slice(0, 5)).toEqual([]);
  });

  it("puts accents on letters, and accents on accents, where it does", () => {
    const marks = MARKS.filter((c) => codes.includes(c)).map((c) => String.fromCodePoint(c));
    const bases = has(BASES);
    const one = bases.flatMap((b) => marks.map((m) => b + m));
    const two = bases
      .slice(0, 8)
      .flatMap((b) => marks.slice(0, 6).flatMap((m) => marks.slice(0, 6).map((n) => b + m + n)));
    expect(setDifferently(before, after, [...one, ...two]).slice(0, 5)).toEqual([]);
  });

  it("puts an accent on the part of a ligature it was typed after", () => {
    // Every ligature the font offers a place on, by the letters its own rules
    // make it of, with an accent after each of them in turn and after all.
    const marks = MARKS.filter((c) => codes.includes(c)).map((c) => String.fromCodePoint(c));
    const typed = (name: string): string | null => {
      const [code] = document.glyphs[name]?.unicodes ?? [];
      return code === undefined ? null : String.fromCodePoint(code);
    };
    const texts: string[] = [];
    let ligatures = 0;
    for (const name of document.glyphOrder) {
      if (!document.glyphs[name]!.anchors.some((a) => ligaturePart(a.name) !== null)) continue;
      const rule = new RegExp(`^\\s*sub ([^;']+) by ${name.replace(/\./g, "\\.")};`, "m");
      const letters = rule.exec(document.features)?.[1]?.trim().split(/\s+/).map(typed);
      if (letters === undefined || letters.includes(null)) continue;
      ligatures += 1;
      for (const mark of marks) {
        for (let after = 0; after < letters.length; after++) {
          texts.push(letters.map((l, i) => (i === after ? l! + mark : l!)).join(""));
        }
        texts.push(letters.map((l) => l! + mark).join(""));
      }
    }
    const tags = ["liga", "dlig", "hlig", "ccmp"];
    expect(setDifferently(before, after, texts, tags).slice(0, 5)).toEqual([]);
    // Asked of something: the two faces that offer places on their ligatures.
    if (/Noto|Garamond/i.test(path)) expect(ligatures).toBeGreaterThan(4);
  });

  it("does with each of its features what the font it came from does", () => {
    const tags = [
      ...new Set([...document.features.matchAll(/^feature (\w{4}) \{/gm)].map((m) => m[1]!)),
    ];
    expect(tags.length).toBeGreaterThan(5);
    const wrong = tags.flatMap((tag) =>
      setDifferently(before, after, LINES, [tag]).map((line) => `${tag}: ${line}`),
    );
    expect(wrong.slice(0, 5)).toEqual([]);
  });

  it("is the ink it was, glyph by glyph", () => {
    // One glyph in seven, which is hundreds of them: the outline as the file
    // draws it, and as the font written here does, on a file's whole-unit grid.
    const back = importFont(written.bytes, counterIds("back")).document;
    const wrong: string[] = [];
    let asked = 0;
    source.glyphs.forEach((g, index) => {
      if (index % 7 !== 0) return;
      const name = document.glyphOrder[index]!;
      const mine = back.glyphs[name];
      const drawn: Contour[] = contoursFromCommands(g.commands, counterIds("file"), 0.001).filter(
        (c) => c.closed && !isEmptyContour(c),
      );
      // Its own outlines only: a composite's are the glyphs it places.
      if (drawn.length === 0 || document.glyphs[name]!.components.length > 0) return;
      asked += 1;
      // As this editor fills what came back: turned by its nesting.
      const apart = mine === undefined ? 1 : inkApart(drawn, correctDirections(mine.contours));
      if (apart > 0.03) wrong.push(`${name} (${String(Math.round(apart * 100))}%)`);
    });
    expect(asked).toBeGreaterThan(80);
    expect(wrong).toEqual([]);
  }, 120_000);

  it("comes back from a UFO as it went into one", () => {
    const round = (d: FontDocument): FontDocument => {
      const files = ufoFiles(d).map((e) => ({ path: e.path, bytes: entryBytes(e) }));
      const out = readUfo(files, counterIds("ufo"));
      if ("reason" in out) throw new Error(out.reason);
      expect(out.warnings).toEqual([]);
      return out.document;
    };
    const once = round(document);

    // The font as read, to the last point: its glyphs by name and what each is
    // typed as, every outline and anchor where it was, the kerning, and the
    // features as written. Not on a grid — an outline read from a TrueType
    // font has its handles a third of the way along, and they stay there.
    const plain = (d: FontDocument): string =>
      JSON.stringify(d, (key, value: unknown) => (key === "id" ? undefined : value));
    expect(once.glyphOrder).toEqual(document.glyphOrder);
    for (const name of document.glyphOrder) {
      const was = document.glyphs[name]!;
      const is = once.glyphs[name]!;
      expect(is.unicodes, name).toEqual(was.unicodes);
      expect(is.advance, name).toBe(was.advance);
      expect(
        JSON.stringify(is.contours.map((c) => c.nodes.map((n) => [n.pt, n.in, n.out]))),
        name,
      ).toBe(JSON.stringify(was.contours.map((c) => c.nodes.map((n) => [n.pt, n.in, n.out]))));
      expect(
        is.anchors.map((a) => [a.name, a.pt]),
        name,
      ).toEqual(was.anchors.map((a) => [a.name, a.pt]));
    }
    expect(once.kerning).toEqual(document.kerning);
    expect(once.features).toBe(document.features);

    // And twice round is once round.
    expect(plain(round(once))).toBe(plain(once));
  });
});
