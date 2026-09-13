// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { NewGlyph, parseGlyphRequest } = await import("../src/components/NewGlyph.js");
const { GLYPH_SETS, codePointsOfSet } = await import("@typewright/catalog");

/**
 * Making glyphs from the browser's bar: one by what is typed, or the missing
 * ones of a set.
 *
 * The commands are tested in tools. What this component decides is how what
 * was typed is read — a name, a character, a code point — and when the button
 * for a whole set is worth showing at all.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

describe("reading what was typed", () => {
  it("reads a single character as that character, named as the convention says", () => {
    expect(parseGlyphRequest("é")).toEqual({ name: "uni00E9", unicodes: [0xe9] });
    // And a letter is its own name, which is where the two readings agree.
    expect(parseGlyphRequest("a")).toEqual({ name: "a", unicodes: [0x61] });
  });

  it("reads an explicit code point in either notation", () => {
    expect(parseGlyphRequest("U+0301")).toEqual(parseGlyphRequest("0x301"));
    expect(parseGlyphRequest("u+41")?.unicodes).toEqual([0x41]);
  });

  it("takes anything else as a name, however unusual", () => {
    expect(parseGlyphRequest("  a.ss01 ")).toEqual({ name: "a.ss01" });
  });

  it("reads nothing out of nothing", () => {
    expect(parseGlyphRequest("   ")).toBeNull();
  });
});

describe("the field", () => {
  const field = () => screen.getByLabelText("New glyph name or character");

  it("makes the glyph on Enter, opens it, and empties itself", () => {
    const { store } = render(<NewGlyph />);

    fireEvent.change(field(), { target: { value: "a.ss01" } });
    fireEvent.keyDown(field(), { key: "Enter" });

    expect(store.editor.document.glyphs["a.ss01"]).toBeDefined();
    expect(store.editor.currentGlyph).toBe("a.ss01");
    expect((field() as HTMLInputElement).value).toBe("");
  });

  it("gives a new glyph half an em, whatever the em is", () => {
    const { store } = render(<NewGlyph />);
    fireEvent.change(field(), { target: { value: "x.alt" } });
    fireEvent.keyDown(field(), { key: "Enter" });

    expect(store.editor.document.glyphs["x.alt"]?.advance).toBe(
      Math.round(store.editor.document.info.unitsPerEm / 2),
    );
  });

  it("does not overwrite a glyph that is already there", () => {
    const { store } = render(<NewGlyph />);
    const existing = store.editor.document.glyphOrder.find((name) => name !== ".notdef")!;
    const before = store.editor.document.glyphs[existing];

    fireEvent.change(field(), { target: { value: existing } });
    fireEvent.keyDown(field(), { key: "Enter" });

    expect(store.editor.document.glyphs[existing]).toBe(before);
  });
});

describe("adding the missing glyphs of a set", () => {
  /** The first set with code points the starter font does not cover. */
  function setWithGaps(store: ReturnType<typeof freshStore>) {
    const glyphs = Object.values(store.editor.document.glyphs);
    for (const set of GLYPH_SETS) {
      const covered = codePointsOfSet(set.id);
      if (covered === null) continue;
      const missing = covered.filter((code) => !glyphs.some((g) => g.unicodes.includes(code)));
      if (missing.length > 0) return { id: set.id, missing };
    }
    throw new Error("every set is already complete in the starter font");
  }

  it("offers them, by count, and makes every one in a single step", () => {
    const store = freshStore();
    const { id, missing } = setWithGaps(store);
    store.setCatalogQuery({ set: id });
    render(<NewGlyph />, store);

    const before = store.editor.document.glyphOrder.length;
    fireEvent.click(screen.getByRole("button", { name: `Add ${String(missing.length)} missing` }));

    expect(store.editor.document.glyphOrder.length).toBe(before + missing.length);
    store.undo();
    expect(store.editor.document.glyphOrder.length).toBe(before);
  });

  it("is not offered for the whole font, which has no list to be missing from", () => {
    const store = freshStore();
    store.setCatalogQuery({ set: "all" });
    render(<NewGlyph />, store);

    expect(screen.queryByRole("button", { name: /missing/ })).toBeNull();
  });
});
