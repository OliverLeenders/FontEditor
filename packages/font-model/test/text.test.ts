import { describe, expect, it } from "vitest";

import { fontDocument, glyphsForString } from "../src/document.js";
import { glyph } from "../src/glyph.js";
import { codePointFromName, codePointFromTyped, textTokens } from "../src/text.js";

/**
 * Typed text with glyph names in it: `/a.001`, `/uni0301`, and the slash that is
 * only a slash.
 */

const names = (text: string) =>
  textTokens(text).map((t) =>
    t.kind === "name" ? `/${t.name}` : String.fromCodePoint(t.codePoint),
  );

describe("reading typed text", () => {
  it("reads plain characters one at a time, astral ones included", () => {
    expect(names("ab\u{1F600}")).toEqual(["a", "b", "\u{1F600}"]);
  });

  it("reads a name after a slash, up to a space or the next slash", () => {
    expect(names("/a.001/b c")).toEqual(["/a.001", "/b", "c"]);
  });

  it("takes one space after a name as the end of it, and leaves a second", () => {
    expect(names("/a b")).toEqual(["/a", "b"]);
    expect(names("/a  b")).toEqual(["/a", " ", "b"]);
  });

  it("leaves a newline after a name in the line", () => {
    expect(names("/a\nb")).toEqual(["/a", "\n", "b"]);
  });

  it("reads a slash with nothing after it, and a doubled one, as a slash", () => {
    expect(names("a/")).toEqual(["a", "/"]);
    expect(names("and / or")).toEqual(["a", "n", "d", " ", "/", " ", "o", "r"]);
    expect(names("a//b")).toEqual(["a", "/", "b"]);
  });

  it("keeps what was typed for each piece, so it can be shown back", () => {
    expect(textTokens("/a.001 b//").map((t) => t.text)).toEqual(["/a.001 ", "b", "//"]);
  });
});

describe("names that spell a code point", () => {
  it("reads uniXXXX and uXXXXX", () => {
    expect(codePointFromName("uni0301")).toBe(0x301);
    expect(codePointFromName("u1F600")).toBe(0x1f600);
  });

  it("reads nothing out of any other name", () => {
    expect(codePointFromName("acute")).toBeNull();
    expect(codePointFromName("uni030")).toBeNull();
    expect(codePointFromName("u110000")).toBeNull();
  });
});

describe("a code point as somebody types it", () => {
  it("reads what a name spells, as a name is read", () => {
    expect(codePointFromTyped("uni0301")).toBe(0x301);
    expect(codePointFromTyped("u1F600")).toBe(0x1f600);
  });

  it("reads U+ and the digits, in either case and with or without the zeros", () => {
    expect(codePointFromTyped("U+03B1")).toBe(0x3b1);
    expect(codePointFromTyped("u+3b1")).toBe(0x3b1);
    expect(codePointFromTyped("U+1F600")).toBe(0x1f600);
  });

  it("reads uni with the zeros left off", () => {
    expect(codePointFromTyped("uni3B1")).toBe(0x3b1);
    expect(codePointFromTyped("uni41")).toBe(0x41);
  });

  it("reads nothing out of what is not one, or is past the last of them", () => {
    expect(codePointFromTyped("acute")).toBeNull();
    expect(codePointFromTyped("U+")).toBeNull();
    expect(codePointFromTyped("U+110000")).toBeNull();
    expect(codePointFromTyped("uni03B1.alt")).toBeNull();
    expect(codePointFromTyped("union")).toBeNull();
  });
});

describe("the glyphs a line of text asks for", () => {
  const font = fontDocument([
    glyph("a", { unicodes: [0x61] }),
    glyph("a.001"),
    glyph("acutecomb", { unicodes: [0x301] }),
    glyph("uni0302"),
  ]);
  const found = (text: string) => glyphsForString(font, text).map((g) => g?.name ?? null);

  it("finds a glyph by its name, encoded or not", () => {
    expect(found("a/a.001")).toEqual(["a", "a.001"]);
  });

  it("finds a glyph by the code point its name spells, when none is called that", () => {
    expect(found("/uni0301")).toEqual(["acutecomb"]);
  });

  it("finds a glyph by its code point written as U+, or with the zeros left off", () => {
    expect(found("/U+0301")).toEqual(["acutecomb"]);
    expect(found("/uni301 a")).toEqual(["acutecomb", "a"]);
    expect(found("a/u+61")).toEqual(["a", "a"]);
  });

  it("prefers a glyph with the name to one with the code point", () => {
    expect(found("/uni0302")).toEqual(["uni0302"]);
  });

  it("leaves a gap for a name the font has not got", () => {
    expect(found("a/nothing a")).toEqual(["a", null, "a"]);
  });
});
