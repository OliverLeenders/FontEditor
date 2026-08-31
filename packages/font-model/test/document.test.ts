import { vec } from "@fonteditor/geometry";
import { describe, expect, it } from "vitest";

import { contour } from "../src/contour.js";
import {
  DEFAULT_FONT_INFO,
  fontDocument,
  glyphCount,
  glyphForCodePoint,
  glyphNamed,
  glyphsForString,
  orderedGlyphs,
  putGlyph,
  removeGlyph,
  setFontInfo,
  setGlyphOrder,
  updateGlyph,
} from "../src/document.js";
import { addContour, glyph, setAdvance } from "../src/glyph.js";
import { counterIds } from "../src/ids.js";
import { node } from "../src/node.js";

const letter = (name: string, codePoint: number) =>
  glyph(name, { unicodes: [codePoint], advance: 500 });

function sample() {
  return fontDocument([letter("a", 0x61), letter("b", 0x62), letter("c", 0x63)]);
}

describe("building a document", () => {
  it("keeps the order glyphs were given in", () => {
    expect(sample().glyphOrder).toEqual(["a", "b", "c"]);
    expect(glyphCount(sample())).toBe(3);
  });

  it("looks a glyph up by name", () => {
    expect(glyphNamed(sample(), "b")?.name).toBe("b");
    expect(glyphNamed(sample(), "z")).toBeNull();
  });

  it("returns glyphs in font order, not map order", () => {
    const reordered = setGlyphOrder(sample(), ["c", "a", "b"]);
    expect(orderedGlyphs(reordered).map((g) => g.name)).toEqual(["c", "a", "b"]);
  });

  it("starts with sensible font measurements", () => {
    expect(sample().info).toEqual(DEFAULT_FONT_INFO);
    expect(sample().info.unitsPerEm).toBe(1000);
  });

  it("is empty when given nothing", () => {
    expect(glyphCount(fontDocument())).toBe(0);
    expect(orderedGlyphs(fontDocument())).toEqual([]);
  });
});

describe("putGlyph", () => {
  it("appends a new glyph to the order", () => {
    const next = putGlyph(sample(), letter("d", 0x64));
    expect(next.glyphOrder).toEqual(["a", "b", "c", "d"]);
  });

  it("replaces an existing glyph without moving it", () => {
    const next = putGlyph(sample(), setAdvance(letter("b", 0x62), 999));
    expect(next.glyphOrder).toEqual(["a", "b", "c"]);
    expect(glyphNamed(next, "b")?.advance).toBe(999);
  });

  // Reference equality is what the history and autosave layers read to tell
  // "nothing happened" from "something did", so an unchanged put must not
  // produce a new document.
  it("returns the same document when the glyph is unchanged", () => {
    const document = sample();
    const existing = glyphNamed(document, "b")!;
    expect(putGlyph(document, existing)).toBe(document);
  });

  it("leaves untouched glyphs as the very same objects", () => {
    const document = sample();
    const before = glyphNamed(document, "a")!;
    const next = putGlyph(document, setAdvance(letter("c", 0x63), 700));
    expect(glyphNamed(next, "a")).toBe(before);
  });
});

describe("removeGlyph", () => {
  it("drops it from both the map and the order", () => {
    const next = removeGlyph(sample(), "b")!;
    expect(next.glyphOrder).toEqual(["a", "c"]);
    expect(glyphNamed(next, "b")).toBeNull();
  });

  it("returns null for a glyph that is not there", () => {
    expect(removeGlyph(sample(), "z")).toBeNull();
  });
});

describe("updateGlyph", () => {
  it("applies a pure edit by name", () => {
    const ids = counterIds();
    const box = contour(ids.contour(), [node(ids.node(), vec(0, 0))]);
    const next = updateGlyph(sample(), "a", (g) => addContour(g, box))!;
    expect(glyphNamed(next, "a")!.contours).toHaveLength(1);
  });

  it("returns null for an unknown glyph", () => {
    expect(updateGlyph(sample(), "z", (g) => g)).toBeNull();
  });

  // A declined edit must not half-apply.
  it("returns null when the operation declines", () => {
    expect(updateGlyph(sample(), "a", () => null)).toBeNull();
  });
});

describe("character lookup", () => {
  it("finds the glyph carrying a code point", () => {
    expect(glyphForCodePoint(sample(), 0x62)?.name).toBe("b");
    expect(glyphForCodePoint(sample(), 0x7a)).toBeNull();
  });

  it("resolves a string to one entry per character", () => {
    const found = glyphsForString(sample(), "cab");
    expect(found.map((g) => g?.name ?? null)).toEqual(["c", "a", "b"]);
  });

  it("reports a gap rather than skipping it, so positions still line up", () => {
    const found = glyphsForString(sample(), "azb");
    expect(found.map((g) => g?.name ?? null)).toEqual(["a", null, "b"]);
  });

  // Iterating the string rather than indexing it: an astral character is two
  // UTF-16 units and must resolve as one character, not two broken halves.
  it("treats an astral character as one character", () => {
    const withEmoji = putGlyph(sample(), glyph("smile", { unicodes: [0x1f600] }));
    const found = glyphsForString(withEmoji, "a\u{1F600}b");
    expect(found).toHaveLength(3);
    expect(found[1]?.name).toBe("smile");
  });

  it("handles an empty string", () => {
    expect(glyphsForString(sample(), "")).toEqual([]);
  });
});

describe("font info", () => {
  it("replaces the measurements without disturbing the glyphs", () => {
    const document = sample();
    const next = setFontInfo(document, { ...document.info, unitsPerEm: 2048 });
    expect(next.info.unitsPerEm).toBe(2048);
    expect(next.glyphs).toBe(document.glyphs);
  });
});

describe("serializability", () => {
  // The rule the whole history and storage design rests on.
  it("survives structuredClone and JSON unchanged", () => {
    const document = sample();
    expect(structuredClone(document)).toEqual(document);
    expect(JSON.parse(JSON.stringify(document))).toEqual(document);
  });
});
