import { describe, expect, it } from "vitest";

import {
  FEATURE_TAGS,
  completionsAt,
  glyphAt,
  namesDefined,
  wordAround,
} from "../src/completion.js";

const GLYPHS = ["a", "a.sc", "b", "f", "f_i", "f_f_i", "F", "fl", "i", "space"];

/** Completions with the caret where `|` is written. */
function at(text: string, asked = false) {
  const offset = text.indexOf("|");
  const source = text.replace("|", "");
  return completionsAt(source, offset, GLYPHS, asked);
}

const labels = (text: string, asked = false) => at(text, asked)?.items.map((i) => i.label) ?? null;

describe("the word at the caret", () => {
  it("runs to the punctuation either side", () => {
    expect(wordAround("sub [f_i a.sc];", 7)).toEqual({ start: 5, end: 8 });
    expect(wordAround("sub a' by b;", 5)).toEqual({ start: 4, end: 5 });
  });
});

describe("completing glyph names", () => {
  it("waits for two characters unless asked", () => {
    expect(at("sub f|")).toBeNull();
    expect(labels("sub f|", true)).toContain("f_i");
  });

  it("puts names that start with what is typed first, as typed, then in any case, then containing it", () => {
    expect(labels("sub f_|")).toEqual(["f_i", "f_f_i"]);
    expect(labels("sub fl|")).toEqual(["fl", "exclude_dflt", "include_dflt", "lookupflag"]);
    expect(labels("sub .s|")).toEqual(["a.sc"]);
  });

  it("replaces the whole word the caret is in", () => {
    const list = at("sub f_|x by y;");
    expect(list).toMatchObject({ from: 4, to: 7 });
  });

  it("offers keywords after the glyph names", () => {
    expect(labels("    lookupf|")).toEqual(["lookupflag"]);
    expect(labels("su|")).toEqual(["sub", "substitute", "subtable", "reversesub", "rsub"]);
  });

  it("stays shut when the only match is what is already written", () => {
    expect(at("sub f_f_i|;")).toBeNull();
    expect(labels("sub f_f_i|;", true)).toEqual(["f_f_i"]);
  });

  it("offers nothing inside a comment", () => {
    expect(at("# sub f_|", true)).toBeNull();
  });
});

describe("completing what the file names", () => {
  const FILE = [
    "@LOWER = [a b];",
    "markClass acute <anchor 0 0> @MC_top;",
    "lookup SMALL { sub a by a.sc; } SMALL;",
    "lookup SWASH useExtension { sub b by b; } SWASH;",
    "",
  ].join("\n");

  it("reads the classes and lookups a file defines", () => {
    expect(namesDefined(FILE)).toEqual({
      classes: ["@LOWER", "@MC_top"],
      lookups: ["SMALL", "SWASH"],
    });
  });

  it("offers classes after @", () => {
    expect(labels(`${FILE}sub @|`, true)).toEqual(["@LOWER", "@MC_top"]);
    expect(labels(`${FILE}sub @MC|`)).toEqual(["@MC_top"]);
  });

  it("offers lookups after lookup", () => {
    expect(labels(`${FILE}sub a' lookup S|`, true)).toEqual(["SMALL", "SWASH"]);
  });

  it("offers registered tags after feature", () => {
    expect(labels("feature ss0|", true)).toContain("ss01");
    expect(labels("feature lig|")).toEqual(["liga", "clig", "dlig", "hlig", "rlig"]);
    expect(FEATURE_TAGS).toContain("cv99");
  });
});

describe("the glyph name at a place", () => {
  it("is found inside the name and at either end of it", () => {
    const source = "sub f_i by f;";
    expect(glyphAt(source, 5)).toEqual({ start: 4, end: 7, name: "f_i" });
    expect(glyphAt(source, 4)?.name).toBe("f_i");
    expect(glyphAt(source, 7)?.name).toBe("f_i");
  });

  it("is not a keyword, a class, a tag or a comment", () => {
    expect(glyphAt("sub @A by b;", 1)).toBeNull();
    expect(glyphAt("sub @A by b;", 5)).toBeNull();
    expect(glyphAt("feature liga {", 10)).toBeNull();
    expect(glyphAt("# a comment", 3)).toBeNull();
  });

  it("drops the backslash an escaped name is written with", () => {
    expect(glyphAt("pos base \\mark <anchor 0 0> mark @MC_top;", 11)?.name).toBe("mark");
  });
});
