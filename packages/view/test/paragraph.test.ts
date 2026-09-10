import { fontDocument, glyph } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { layoutParagraph, paragraphWidth } from "../src/run.js";

/**
 * Every letter 100 units wide and the space 50, so a line's width can be read
 * off the text: "ab cd" is 100+100+50+100+100 = 450.
 */
const font = () =>
  fontDocument(
    "abcdefghijklmnopqrstuvwxyz"
      .split("")
      .map((c, i) => glyph(c, { unicodes: [0x61 + i], advance: 100 }))
      .concat([glyph("space", { unicodes: [0x20], advance: 50 })]),
  );

const LEADING = 1200;
const texts = (lines: ReturnType<typeof layoutParagraph>): string[] =>
  lines.map((l) => l.run.glyphs.map((p) => (p.name === "space" ? " " : p.name)).join(""));

describe("layoutParagraph", () => {
  it("keeps a line that fits on one line", () => {
    const lines = layoutParagraph(font(), "ab cd", 1000, LEADING);
    expect(texts(lines)).toEqual(["ab cd"]);
  });

  it("breaks at a space once the measure is passed", () => {
    // "ab cd" is 450; "ab cd ef" is 700. A measure of 500 takes the first only.
    const lines = layoutParagraph(font(), "ab cd ef", 500, LEADING);
    expect(texts(lines)).toEqual(["ab cd", "ef"]);
  });

  it("stacks each line one leading below the last", () => {
    const lines = layoutParagraph(font(), "ab cd ef", 500, LEADING);
    expect(lines.map((l) => l.y)).toEqual([0, LEADING]);
  });

  it("keeps the breaks the text already has", () => {
    // An explicit break is a decision somebody made, and rewrapping never
    // undoes one.
    const lines = layoutParagraph(font(), "ab\ncd", 100000, LEADING);
    expect(texts(lines)).toEqual(["ab", "cd"]);
  });

  it("gives a blank line its leading rather than dropping it", () => {
    const lines = layoutParagraph(font(), "ab\n\ncd", 100000, LEADING);
    expect(texts(lines)).toEqual(["ab", "", "cd"]);
    expect(lines.map((l) => l.y)).toEqual([0, LEADING, LEADING * 2]);
  });

  it("lets a word wider than the measure overhang rather than splitting it", () => {
    // Hyphenation is a subject of its own, and a proof that quietly cut a word
    // in half would be lying about how the font sets.
    const lines = layoutParagraph(font(), "abcdefgh", 200, LEADING);
    expect(texts(lines)).toEqual(["abcdefgh"]);
  });

  it("still breaks the words around an overhanging one", () => {
    const lines = layoutParagraph(font(), "ab abcdefgh cd", 300, LEADING);
    expect(texts(lines)).toEqual(["ab", "abcdefgh", "cd"]);
  });

  it("collapses the runs of spaces that a break would leave", () => {
    expect(texts(layoutParagraph(font(), "ab   cd", 100000, LEADING))).toEqual(["ab cd"]);
  });

  it("skips a character the font has no glyph for, as a run does", () => {
    expect(texts(layoutParagraph(font(), "a?b", 100000, LEADING))).toEqual(["ab"]);
  });

  it("gives an empty text one empty line rather than nothing", () => {
    // A page with no lines and a page with one blank line look the same; a
    // caller that has to handle both does not.
    const lines = layoutParagraph(font(), "", 1000, LEADING);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.run.glyphs).toEqual([]);
  });

  it("reports the width of its widest line", () => {
    const lines = layoutParagraph(font(), "ab cd ef", 500, LEADING);
    expect(paragraphWidth(lines)).toBe(450);
  });

  it("has no width at all when there is nothing set", () => {
    expect(paragraphWidth(layoutParagraph(font(), "", 1000, LEADING))).toBe(0);
  });
});
