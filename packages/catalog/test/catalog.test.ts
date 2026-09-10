import { contour, counterIds, fontDocument, glyph, node } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { blockOf } from "../src/blocks.js";
import { catalog } from "../src/catalog.js";
import { DEFAULT_QUERY, filterCatalog, setCounts } from "../src/query.js";

const ids = counterIds();

const drawn = () =>
  contour(
    ids.contour(),
    [node(ids.node(), { x: 0, y: 0 }), node(ids.node(), { x: 10, y: 10 })],
    true,
  );

const doc = fontDocument([
  glyph(".notdef", { advance: 500, contours: [drawn()] }),
  glyph("A", { unicodes: [0x41], advance: 600, contours: [drawn()] }),
  glyph("space", { unicodes: [0x20], advance: 250 }),
  glyph("Omega", { unicodes: [0x3a9], advance: 700, contours: [drawn()] }),
  glyph("A.alt", { advance: 600, contours: [drawn()] }),
  glyph("smile", { unicodes: [0x1f600], advance: 900 }),
]);

const entries = catalog(doc);
const names = (query: Partial<typeof DEFAULT_QUERY>) =>
  filterCatalog(entries, { ...DEFAULT_QUERY, ...query }).map((e) => e.name);

describe("catalog", () => {
  it("keeps the font's own glyph order", () => {
    expect(entries.map((e) => e.name)).toEqual([
      ".notdef",
      "A",
      "space",
      "Omega",
      "A.alt",
      "smile",
    ]);
  });

  it("separates being encoded from being drawn", () => {
    const space = entries.find((e) => e.name === "space");
    expect(space?.codePoint).toBe(0x20);
    expect(space?.drawn).toBe(false);

    const alt = entries.find((e) => e.name === "A.alt");
    expect(alt?.codePoint).toBeNull();
    expect(alt?.drawn).toBe(true);
  });

  it("takes the lowest code point when a glyph has several", () => {
    const many = catalog(fontDocument([glyph("x", { unicodes: [0x78, 0x2093, 0x44] })]));
    expect(many[0]?.codePoint).toBe(0x44);
  });

  it("assigns a Unicode block", () => {
    expect(entries.find((e) => e.name === "Omega")?.block?.id).toBe("greek");
    expect(entries.find((e) => e.name === "A.alt")?.block).toBeNull();
  });
});

describe("blockOf", () => {
  it("finds blocks at their boundaries and returns null between them", () => {
    expect(blockOf(0x0000)?.id).toBe("basic-latin");
    expect(blockOf(0x007f)?.id).toBe("basic-latin");
    expect(blockOf(0x0080)?.id).toBe("latin-1");
    expect(blockOf(0x1f600)?.id).toBe("emoji");
    // A gap in the curated list, not a block we claim to know.
    expect(blockOf(0x0800)).toBeNull();
  });
});

describe("filterCatalog", () => {
  it("returns everything by default", () => {
    expect(names({})).toHaveLength(6);
  });

  it("filters by state", () => {
    expect(names({ set: "drawn" })).toEqual([".notdef", "A", "Omega", "A.alt"]);
    expect(names({ set: "undrawn" })).toEqual(["space", "smile"]);
    expect(names({ set: "unencoded" })).toEqual([".notdef", "A.alt"]);
    expect(names({ set: "ascii" })).toEqual(["A", "space"]);
  });

  it("filters by Unicode block", () => {
    expect(names({ set: "block:greek" })).toEqual(["Omega"]);
    expect(names({ set: "block:emoji" })).toEqual(["smile"]);
  });

  it("shows everything for a set id it does not recognise", () => {
    // A stale id from a restored session must not present an empty font.
    expect(names({ set: "block:nonsense" })).toHaveLength(6);
  });

  it("searches names case-insensitively", () => {
    expect(names({ search: "omeg" })).toEqual(["Omega"]);
    expect(names({ search: "a." })).toEqual(["A.alt"]);
  });

  it("searches by explicit code point in the notations people type", () => {
    expect(names({ search: "U+0041" })).toEqual(["A"]);
    expect(names({ search: "u+41" })).toEqual(["A"]);
    expect(names({ search: "0x3A9" })).toEqual(["Omega"]);
  });

  it("matches a single typed character by both code point and name", () => {
    // Substring, not prefix: "a" reaches "Omega" and "space" as well as "A".
    // Broad on a single letter, but it is what keeps "alt" finding "A.alt", and
    // narrowing is one more keystroke. Worth revisiting once the grid exists and
    // there is something to judge ranked results against.
    expect(names({ search: "A" })).toEqual(["A", "space", "Omega", "A.alt"]);
    // "s" matches no code point here, so it falls back to names alone.
    expect(names({ search: "s" })).toEqual(["space", "smile"]);
  });

  it("finds an astral character typed literally", () => {
    expect(names({ search: "\u{1F600}" })).toEqual(["smile"]);
  });

  it("combines a set with a search", () => {
    // "space" contains an "a" but is not drawn, so the set filter removes it.
    expect(names({ set: "drawn", search: "a" })).toEqual(["A", "Omega", "A.alt"]);
  });

  it("sorts by code point with unencoded glyphs gathered at the end", () => {
    expect(names({ order: "codePoint" })).toEqual([
      "space",
      "A",
      "Omega",
      "smile",
      ".notdef",
      "A.alt",
    ]);
  });

  it("sorts by name", () => {
    expect(names({ order: "name" })[0]).toBe(".notdef");
    expect(names({ order: "name" })).toContain("Omega");
  });

  it("leaves font order untouched rather than sorting it", () => {
    expect(names({ order: "font" })).toEqual(entries.map((e) => e.name));
  });
});

describe("setCounts", () => {
  it("counts every set in one pass", () => {
    const counts = setCounts(entries);
    expect(counts.get("all")).toBe(6);
    expect(counts.get("drawn")).toBe(4);
    expect(counts.get("undrawn")).toBe(2);
    expect(counts.get("encoded")).toBe(4);
    expect(counts.get("block:greek")).toBe(1);
  });

  it("gives every known set an entry, including empty ones", () => {
    const counts = setCounts(entries);
    expect(counts.get("block:cjk")).toBe(0);
    expect(counts.has("block:hangul")).toBe(true);
  });
});
