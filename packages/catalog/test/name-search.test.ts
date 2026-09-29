import { fontDocument, glyph } from "@typewright/font-model";
import { beforeAll, describe, expect, it } from "vitest";

import { catalog } from "../src/catalog.js";
import { DEFAULT_QUERY, filterCatalog, listCatalog } from "../src/query.js";
import { loadUnicodeNames, nameMatches, nameWords } from "../src/unicode-names.js";

/**
 * A search finds glyphs by what the standard calls their characters: `dotless`
 * finds ı and ȷ whatever the font named them, and offers the ones it has not
 * got.
 */

const doc = fontDocument([
  glyph("A", { unicodes: [0x41] }),
  glyph("uni0131", { unicodes: [0x131] }),
  glyph("o", { unicodes: [0x6f] }),
]);
const entries = catalog(doc);

beforeAll(async () => {
  await loadUnicodeNames();
});

describe("nameWords", () => {
  it("looks among the names only from three letters on", () => {
    expect(nameWords("o")).toBeNull();
    expect(nameWords("do")).toBeNull();
    expect(nameWords(" Dotless  J ")).toEqual(["dotless", "j"]);
  });
});

describe("nameMatches", () => {
  it("wants every word, each at the start of one of the name's", () => {
    expect(nameMatches("LATIN SMALL LETTER DOTLESS I", ["dotless"])).toBe(true);
    expect(nameMatches("LATIN SMALL LETTER DOTLESS I", ["dotless", "j"])).toBe(false);
    expect(nameMatches("LATIN SMALL LETTER DOTLESS I", ["less"])).toBe(false);
    expect(nameMatches("HYPHEN-MINUS", ["minus"])).toBe(true);
  });
});

describe("a search by what a character is called", () => {
  it("finds a glyph the font has, whatever it is named", () => {
    const found = filterCatalog(entries, { ...DEFAULT_QUERY, search: "dotless" });
    expect(found.map((e) => e.name)).toEqual(["uni0131"]);
  });

  it("offers the characters so named that the font has not got", () => {
    const listed = listCatalog(entries, { ...DEFAULT_QUERY, search: "dotless" });
    expect(listed.find((e) => e.name === "uni0131")?.inFont).toBe(true);
    const dotlessJ = listed.find((e) => e.codePoint === 0x237);
    expect(dotlessJ?.inFont).toBe(false);
  });

  it("keeps to the set showing", () => {
    const listed = listCatalog(entries, {
      ...DEFAULT_QUERY,
      set: "block:latin-b",
      search: "dotless",
    });
    expect(listed.map((e) => e.codePoint)).toEqual([0x237]);
  });

  it("leaves a short search to the glyph names", () => {
    const found = filterCatalog(entries, { ...DEFAULT_QUERY, search: "o" });
    expect(found.map((e) => e.name)).toEqual(["o"]);
  });
});
