import { type FontDocument, counterIds } from "@typewright/font-model";
import { Blob, Face, Font } from "harfbuzzjs";
import { beforeAll, describe, expect, it } from "vitest";

import { CURSIVE_FLAGS } from "../src/cursive.js";
import { exportFont, layoutTables, writtenOrder } from "../src/export.js";
import { type ImportResult, importFont } from "../src/import.js";
import { withTable } from "../src/sfnt.js";
import { type SourceFont, parseFont } from "../src/source.js";
import { type Placed, fontBytes, set } from "./real-fonts.js";

/**
 * A Nastaliq, for the letters joined one to the next.
 *
 * Urdu is written on a slope: a word starts high and falls to the line, each
 * letter where the one before it left off. Noto Nastaliq Urdu says where by
 * cursive attachment on seven hundred glyphs, and it is the font of the corpus
 * that is here for that.
 *
 * It is also the most intricate font there is, and not everything it does
 * comes through this editor: its dots are placed by more lookups than a glyph
 * has anchors for. That is said when it is read, and listed below. So what is
 * asked is its letters, and not its dots.
 *
 * Twice. The joining by itself: the positioning this editor writes from the
 * font as read is put into the font as released, in place of its own, and
 * HarfBuzz sets Urdu with both; the substitutions are then the font's own. And
 * the font taken round whole, where they are not: eleven thousand rules in a
 * context, read in as source and compiled again, have to choose the same form
 * of every letter for the joining to have anything to join.
 */

const PATH = "noto-nastaliq-urdu/NotoNastaliqUrdu[wght].ttf";

/** Words people write, with the joins a Nastaliq is made of: long stairs, and the yeh that sweeps back. */
const WORDS =
  "پاکستان اردو زبان محبت کتاب دوست زندگی خوبصورت بہت شکریہ ہندوستان نستعلیق تحریر لکھنا پڑھنا سیکھنا بچے لڑکی لڑکا گھر پانی کھانا مجھے تمہیں ہمیں انہیں کیونکہ لیکن چاہیے بیٹھنا".split(
    " ",
  );

/** What the font is read with: everything known not to come through, and nothing of its joins. */
const READ_WITH = [
  "device and variation adjustments in positioning are not imported",
  "mark attachment lookup 20 could not be made into anchors, and is kept as feature source",
  "mark attachment lookup 21 could not be made into anchors, and is kept as feature source",
  "mark attachment lookup 22 could not be made into anchors, and is kept as feature source",
  "mark attachment lookup 26 could not be made into anchors, and is kept as feature source",
  "mark attachment lookup 27 could not be made into anchors, and is kept as feature source",
  "mark attachment lookup 28 could not be made into anchors, and is kept as feature source",
  "uni08E3_AltNS attaches by more than one anchor, which export gives one class",
  "uni08F2_AltNS attaches by more than one anchor, which export gives one class",
  "mark attachment to ligatures is kept as feature source, which this editor does not compile",
];

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

  it("is the same letters in the same places, read in and written out whole", () => {
    const written = exportFont(document, counterIds("out"));
    // Nothing said of its substitutions or its joins: only of the dots, which
    // the anchors place and the source it was read with does not.
    const strange = written.warnings.filter(
      (w) =>
        !/attachment is where the glyphs' anchors say/.test(w) &&
        !/has 2 attaching anchors/.test(w) &&
        !/is left out of the character map/.test(w),
    );
    expect(strange.slice(0, 5)).toEqual([]);

    const before = new Font(new Face(new Blob(bytes)));
    const after = new Font(new Face(new Blob(written.bytes)));
    const marks = new Set<string>();
    for (const [id, kind] of source.layout?.gdef?.classes ?? []) {
      if (kind === 3) marks.add(source.glyphs[id]!.name ?? "");
    }
    const letters = (placed: readonly Placed[]): string =>
      placed
        .filter((g) => !marks.has(g.name))
        .map((g) => `${g.name}+${String(g.advance)}@${String(g.x)},${String(g.y)}`)
        .join(" ");
    const named = (placed: readonly Placed[]): string => placed.map((g) => g.name).join(" ");

    const wrong: string[] = [];
    for (const word of WORDS) {
      const was = set(before, word);
      const is = set(after, word);
      // Every glyph, the dots among them, is the glyph it was; and every
      // letter is where it was.
      if (named(was) !== named(is)) wrong.push(`${word}: ${named(was)}  IS  ${named(is)}`);
      else if (letters(was) !== letters(is)) {
        wrong.push(`${word}: ${letters(was)}  IS  ${letters(is)}`);
      }
    }
    expect(wrong.slice(0, 3)).toEqual([]);
  }, 300_000);
});
