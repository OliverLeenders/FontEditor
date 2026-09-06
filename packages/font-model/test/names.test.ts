import { describe, expect, it } from "vitest";

import { glyphFileName, glyphNameForCodePoint } from "../src/names.js";

/**
 * Turning a glyph name into a filename, and a code point into a glyph name.
 *
 * Both are conventions rather than arithmetic, and both have a failure mode that
 * only shows up on someone else's machine: a name that collides on a
 * case-insensitive filesystem, or a file called `con` that Windows will not
 * open.
 */

describe("naming a glyph's file", () => {
  it("leaves a plain lowercase name alone", () => {
    expect(glyphFileName("a")).toBe("a.json");
    expect(glyphFileName("aacute")).toBe("aacute.json");
  });

  it("marks capitals, so `A` and `a` cannot become the same file", () => {
    // The UFO convention, and the reason for it: most filesystems in use do not
    // tell the two apart, so the name has to.
    expect(glyphFileName("A")).toBe("A_.json");
    expect(glyphFileName("Adieresis")).toBe("A_dieresis.json");
    expect(glyphFileName("AA")).toBe("A_A_.json");
  });

  it("escapes anything a filesystem would object to", () => {
    expect(glyphFileName("a/b")).toBe("a%2Fb.json");
    expect(glyphFileName("a b")).toBe("a%20b.json");
    // Above ASCII it is the UTF-8 bytes, one escape each.
    expect(glyphFileName("é")).toBe("%C3%A9.json");
  });

  it("keeps the characters a name legitimately uses", () => {
    expect(glyphFileName("a.sc")).toBe("a.sc.json");
    expect(glyphFileName("f_f_i")).toBe("f_f_i.json");
    expect(glyphFileName("uni0041")).toBe("uni0041.json");
  });

  it("gets a name out of the way of the device names Windows reserves", () => {
    // `con.json` is not a file that can be created on Windows at all.
    expect(glyphFileName("con")).toBe("_con.json");
    expect(glyphFileName("nul")).toBe("_nul.json");
    expect(glyphFileName("lpt1")).toBe("_lpt1.json");
  });

  it("gives an empty name something to be called", () => {
    expect(glyphFileName("")).toBe("_empty.json");
  });

  it("truncates a very long name, and keeps two of them apart", () => {
    const long = "x".repeat(400);
    const other = `${"x".repeat(399)}y`;

    const a = glyphFileName(long);
    const b = glyphFileName(other);
    expect(a.length).toBeLessThan(230);
    // Truncation alone would make these the same file.
    expect(a).not.toBe(b);
  });

  it("takes the extension it is given", () => {
    expect(glyphFileName("a", ".glif")).toBe("a.glif");
    expect(glyphFileName("A", "")).toBe("A_");
  });
});

describe("naming a code point", () => {
  it("calls letters themselves", () => {
    expect(glyphNameForCodePoint(0x41)).toBe("A");
    expect(glyphNameForCodePoint(0x7a)).toBe("z");
  });

  it("calls a digit by its word, as the AGL does", () => {
    expect(glyphNameForCodePoint(0x30)).toBe("zero");
    expect(glyphNameForCodePoint(0x35)).toBe("five");
  });

  it("uses the conventional name for the rest of ASCII", () => {
    expect(glyphNameForCodePoint(0x20)).toBe("space");
    expect(glyphNameForCodePoint(0x2e)).toBe("period");
    expect(glyphNameForCodePoint(0x26)).toBe("ampersand");
  });

  it("falls back to the AGL form, which is what the importer invents too", () => {
    expect(glyphNameForCodePoint(0xe9)).toBe("uni00E9");
    expect(glyphNameForCodePoint(0x2022)).toBe("uni2022");
  });

  it("uses the six-digit form above the basic plane", () => {
    expect(glyphNameForCodePoint(0x1f600)).toBe("u01F600");
  });
});
