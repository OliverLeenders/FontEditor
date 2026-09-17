import { describe, expect, it } from "vitest";

import { loadUnicodeNames, unicodeName, unicodeNamesReady } from "../src/unicode-names.js";

/**
 * The names the standard gives code points, which a font file does not carry.
 *
 * The table is generated from Python's Unicode data and shipped deflated, so
 * what is worth asserting here is that it unpacks, that it answers for the
 * characters the browser is hardest to read without it, and that a caller who
 * has not waited for it gets `null` rather than an exception.
 */

describe("the Unicode name table", () => {
  it("answers nothing until it has been loaded", () => {
    // Only true before the load below, so it is asserted first and once.
    if (!unicodeNamesReady()) expect(unicodeName(0x308)).toBeNull();
  });

  it("names a combining mark, the case a glyph name is worst at", () => {
    // `uni0308` in the cell, which says everything except which mark it is.
    return loadUnicodeNames().then(() => {
      expect(unicodeName(0x308)).toBe("COMBINING DIAERESIS");
      expect(unicodeName(0x41)).toBe("LATIN CAPITAL LETTER A");
      expect(unicodeName(0x1e9e)).toBe("LATIN CAPITAL LETTER SHARP S");
    });
  });

  it("has a name for every letter of the blocks the browser lists", async () => {
    await loadUnicodeNames();
    for (const codePoint of [0x100, 0x2af, 0x370, 0x4ff, 0x2070, 0x20ac]) {
      expect(unicodeName(codePoint)).not.toBeNull();
    }
  });

  it("says nothing for a code point with no name, rather than guessing", async () => {
    await loadUnicodeNames();
    // A surrogate, which is not a character, and a private-use code point.
    expect(unicodeName(0xd800)).toBeNull();
    expect(unicodeName(0xe000)).toBeNull();
  });

  it("loads once, however many callers ask", async () => {
    const [first, second] = await Promise.all([loadUnicodeNames(), loadUnicodeNames()]);
    expect(first).toBe(second);
    expect(unicodeNamesReady()).toBe(true);
  });
});
