import { describe, expect, it } from "vitest";

import { type Token, highlightFea, highlightLines } from "../src/highlight.js";

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
  it("colours a name as one string, spaces and # and all", () => {
    expect(kinds('featureNames { name "No. #2 alt"; };')).toEqual([
      "keyword:featureNames",
      "punctuation:{",
      "keyword:name",
      'string:"No. #2 alt"',
      "punctuation:;",
      "punctuation:}",
      "punctuation:;",
    ]);
  });

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

describe("colouring a line at a time", () => {
  const source = [
    "feature liga {",
    "    sub f i by f_i; # the usual",
    "",
    '    name "No. #2";',
    "} liga;",
    "    sub f i by f_i; # the usual",
  ].join("\n");

  /** The whole file cut up at once, then put into lines: what a line at a time must match. */
  const whole = (text: string) => {
    const lines: ReturnType<typeof highlightFea>[] = [[]];
    for (const token of highlightFea(text)) {
      if (token.kind === "newline") lines.push([]);
      else lines.at(-1)!.push(token);
    }
    return lines;
  };

  it("gives what cutting the whole file up gives", () => {
    expect(highlightLines(source, new Map())).toEqual(whole(source));
    expect(highlightLines("", new Map())).toEqual(whole(""));
    expect(highlightLines("a\n", new Map())).toEqual(whole("a\n"));
    // A tag is waited for to the end of its line and no further.
    expect(highlightLines("feature\nliga {", new Map())).toEqual(whole("feature\nliga {"));
  });

  it("hands back the lines that have not changed, the very same", () => {
    const known = new Map<string, readonly Token[]>();
    const before = highlightLines(source, known);
    const after = highlightLines(source.replace("the usual", "the usual one"), known);

    expect(after[0]).toBe(before[0]);
    expect(after[3]).toBe(before[3]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[1]!.at(-1)).toEqual({ kind: "comment", text: "# the usual one" });
    // Two lines alike are one line's work.
    expect(before[5]).toBe(before[1]);
  });

  it("remembers one file's lines and no more", () => {
    const known = new Map<string, readonly Token[]>();
    highlightLines("one\ntwo\nthree", known);
    highlightLines("one\nfour", known);
    expect([...known.keys()].sort()).toEqual(["four", "one"]);
  });
});
