import { describe, expect, it } from "vitest";

import { highlightFea } from "../src/highlight.js";

/**
 * Colouring feature source.
 *
 * Two things matter: nothing typed is lost or doubled on its way into colour,
 * and each word is called what a reader would call it — including in a file that
 * does not compile yet, which is what a file being typed usually is.
 */

const kinds = (source: string) =>
  highlightFea(source)
    .filter((token) => token.kind !== "space" && token.kind !== "newline")
    .map((token) => `${token.kind}:${token.text}`);

describe("colouring feature source", () => {
  it("gives back every character, in order", () => {
    const source =
      "languagesystem DFLT dflt;\n@FIGS = [zero one];\n\nfeature liga {\n\tsub f' i by fi; # a comment\n} liga;\n  pos @caps <10 0 20 0>;";
    expect(
      highlightFea(source)
        .map((token) => token.text)
        .join(""),
    ).toBe(source);
  });

  it("names keywords, the tags after them, classes and glyphs", () => {
    expect(kinds("feature liga {\n    sub f i by fi;\n} liga;")).toEqual([
      "keyword:feature",
      "tag:liga",
      "punctuation:{",
      "keyword:sub",
      "glyph:f",
      "glyph:i",
      "keyword:by",
      "glyph:fi",
      "punctuation:;",
      "punctuation:}",
      "tag:liga",
      "punctuation:;",
    ]);
  });

  it("takes both tags a language system names", () => {
    expect(kinds("languagesystem latn DEU;")).toEqual([
      "keyword:languagesystem",
      "tag:latn",
      "tag:DEU",
      "punctuation:;",
    ]);
  });

  it("sees classes, numbers, marked glyphs and value records", () => {
    expect(kinds("pos @caps' <10 0 -20 0>;")).toEqual([
      "keyword:pos",
      "class:@caps",
      "mark:'",
      "punctuation:<",
      "number:10",
      "number:0",
      "number:-20",
      "number:0",
      "punctuation:>",
      "punctuation:;",
    ]);
  });

  it("runs a comment to the end of its line and no further", () => {
    expect(kinds("sub a by b; # sub c by d;\nsub e by f;")).toEqual([
      "keyword:sub",
      "glyph:a",
      "keyword:by",
      "glyph:b",
      "punctuation:;",
      "comment:# sub c by d;",
      "keyword:sub",
      "glyph:e",
      "keyword:by",
      "glyph:f",
      "punctuation:;",
    ]);
  });

  it("does not carry a closing tag onto the next line", () => {
    // A `}` with nothing after it on its line names nothing on the next.
    expect(kinds("}\nsub a by b;")).toEqual([
      "punctuation:}",
      "keyword:sub",
      "glyph:a",
      "keyword:by",
      "glyph:b",
      "punctuation:;",
    ]);
  });
});
