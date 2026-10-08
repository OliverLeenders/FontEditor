import { type FontDocument, counterIds } from "@typewright/font-model";
import { Blob, Face, Font } from "harfbuzzjs";
import { beforeAll, describe, expect, it } from "vitest";

import { CURSIVE_FLAGS } from "../src/cursive.js";
import { exportFont, layoutTables, writtenOrder } from "../src/export.js";
import { type ImportResult, importFont } from "../src/import.js";
import { withTable } from "../src/sfnt.js";
import { type SourceFont, parseFont } from "../src/source.js";
import { type Placed, fontBytes, set, setDifferently } from "./real-fonts.js";

/**
 * A Nastaliq, for the letters joined one to the next.
 *
 * Urdu is written on a slope: a word starts high and falls to the line, each
 * letter where the one before it left off. Noto Nastaliq Urdu says where by
 * cursive attachment on seven hundred glyphs, and it is the font of the corpus
 * that is here for that.
 *
 * It is also the most intricate font there is. Eleven thousand rules in a
 * context choose the form of each letter, and its dots are placed by one
 * lookup after another, the same dot attaching by a different point in each.
 *
 * Asked twice. The joining by itself: the positioning this editor writes from
 * the font as read is put into the font as released, in place of its own, and
 * HarfBuzz sets Urdu with both; the substitutions are then the font's own, and
 * every letter has to be where it was. And the font taken round whole — read
 * in, written out, and set beside the font it came from: the same glyphs, each
 * letter and each dot where it was.
 */

const PATH = "noto-nastaliq-urdu/NotoNastaliqUrdu[wght].ttf";

/** Words people write, with the joins a Nastaliq is made of: long stairs, and the yeh that sweeps back. */
const WORDS =
  "پاکستان اردو زبان محبت کتاب دوست زندگی خوبصورت بہت شکریہ ہندوستان نستعلیق تحریر لکھنا پڑھنا سیکھنا بچے لڑکی لڑکا گھر پانی کھانا مجھے تمہیں ہمیں انہیں کیونکہ لیکن چاہیے بیٹھنا".split(
    " ",
  );

/** With the marks a reader of the Quran or a learner writes: short vowels, doubling, and a stack of two. */
const VOWELLED = [
  "بِسْمِ",
  "اللّٰہ",
  "مُحَمَّد",
  "کِتَابٌ",
  "قُرْآن",
  "اَلْحَمْدُ",
  "عَلَیْہِ",
  // A vowel below a letter that has a dot below and a doubling sign above: the
  // vowel stacks on the dot, past the sign typed between them.
  "رَبِّ",
];

/** What the font is read with: the one thing known not to come through. */
const READ_WITH = ["device and variation adjustments in positioning are not imported"];

describe("Noto Nastaliq Urdu, and its letters joined", () => {
  let bytes: ArrayBuffer;
  let source: SourceFont;
  let read: ImportResult;
  let document: FontDocument;

  beforeAll(() => {
    bytes = fontBytes(PATH);
    source = parseFont(bytes);
    read = importFont(bytes, counterIds("in"));
    document = read.document;
  }, 300_000);

  /** The font's own cursive attachment: each glyph's entry and exit, by name. */
  const itsJoins = (): Map<string, { entry: number[] | null; exit: number[] | null }> => {
    const out = new Map<string, { entry: number[] | null; exit: number[] | null }>();
    for (const lookup of source.layout?.gpos?.lookups ?? []) {
      if (lookup === null || lookup.type !== 3) continue;
      expect(lookup.flags).toBe(CURSIVE_FLAGS);
      for (const sub of lookup.subtables) {
        if (sub.kind !== "cursive") continue;
        for (const g of sub.glyphs) {
          out.set(source.glyphs[g.glyph]!.name ?? "", {
            entry: g.entry === null ? null : [g.entry.x, g.entry.y],
            exit: g.exit === null ? null : [g.exit.x, g.exit.y],
          });
        }
      }
    }
    return out;
  };

  it("is read saying what is known not to come through, and nothing of its joins", () => {
    expect(document.glyphOrder).toHaveLength(source.glyphs.length);
    expect(read.warnings.map((w) => w.message)).toEqual(READ_WITH);
  });

  it("has each joined glyph's entry and exit as anchors, where the font put them", () => {
    const joins = itsJoins();
    expect(joins.size).toBeGreaterThan(700);
    const wrong: string[] = [];
    for (const [name, join] of joins) {
      const at = (anchor: string): number[] | null => {
        const a = document.glyphs[name]?.anchors.find((it) => it.name === anchor);
        return a === undefined ? null : [a.pt.x, a.pt.y];
      };
      if (JSON.stringify([at("entry"), at("exit")]) !== JSON.stringify([join.entry, join.exit])) {
        wrong.push(name);
      }
    }
    expect(wrong).toEqual([]);
    // And no glyph the font does not join has been given one.
    const joined = document.glyphOrder.filter((name) =>
      document.glyphs[name]!.anchors.some((a) => a.name === "entry" || a.name === "exit"),
    );
    expect(joined).toHaveLength(joins.size);
    // Nothing of it is left as source to be read and not compiled.
    expect(document.features).not.toMatch(/pos cursive/);
  });

  it("sets every letter of Urdu where the font as released sets it", () => {
    // The font as released, with the positioning written here in place of its
    // own. The glyphs are numbered as they were, so the table fits.
    const order = writtenOrder(document);
    expect(order).toEqual(source.glyphs.map((g) => g.name));
    const ids = new Map(order.map((name, i) => [name, i]));
    const layout = layoutTables(document, (name) => ids.get(name));
    const before = new Font(new Face(new Blob(bytes)));
    const after = new Font(
      new Face(new Blob(withTable(new Uint8Array(bytes), "GPOS", layout.gpos))),
    );

    // The letters, and not the dots: those are marks, placed by the lookups
    // that are said above not to have come through.
    const marks = new Set<string>();
    for (const [id, kind] of source.layout?.gdef?.classes ?? []) {
      if (kind === 3) marks.add(source.glyphs[id]!.name ?? "");
    }
    expect(marks.size).toBeGreaterThan(50);
    const letters = (placed: readonly Placed[]): string =>
      placed
        .filter((g) => !marks.has(g.name))
        .map((g) => `${g.name}+${String(g.advance)}@${String(g.x)},${String(g.y)}`)
        .join(" ");

    const wrong: string[] = [];
    let lifted = 0;
    for (const word of WORDS) {
      const was = set(before, word);
      const is = set(after, word);
      if (letters(was) !== letters(is)) wrong.push(`${word}: ${letters(was)}  IS  ${letters(is)}`);
      lifted += was.filter((g) => !marks.has(g.name) && g.y > 0).length;
    }
    expect(wrong.slice(0, 3)).toEqual([]);
    // Asked of something: most of these letters are off the line.
    expect(lifted).toBeGreaterThan(40);
  }, 120_000);

  it("is the same glyphs in the same places, read in and written out whole", () => {
    const written = exportFont(document, counterIds("out"));
    // Nothing said of its substitutions, its joins or its dots.
    const strange = written.warnings.filter((w) => !/is left out of the character map/.test(w));
    expect(strange.slice(0, 5)).toEqual([]);

    const before = new Font(new Face(new Blob(bytes)));
    const after = new Font(new Face(new Blob(written.bytes)));
    const texts = [...WORDS, ...VOWELLED];
    expect(setDifferently(before, after, texts).slice(0, 3)).toEqual([]);

    // Asked of something: there are dots in these words, off the line, and
    // more than one on a letter.
    const marks = new Set<string>();
    for (const [id, kind] of source.layout?.gdef?.classes ?? []) {
      if (kind === 3) marks.add(source.glyphs[id]!.name ?? "");
    }
    const dots = texts.flatMap((text) => set(before, text).filter((g) => marks.has(g.name)));
    expect(dots.length).toBeGreaterThan(60);
    expect(dots.filter((g) => g.y !== 0).length).toBeGreaterThan(40);
  }, 300_000);
});
