import { NOTDEF, fontDocument, glyph } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { deleteGlyphs, setMarkColors } from "../src/commands/glyphs.js";
import { roundGlyphsAt } from "../src/commands/rounding.js";
import { editorState } from "../src/state.js";

/**
 * What the glyph browser does to several cells at once: each is one undo step,
 * because it was one decision.
 */

const RED = "1,0,0,1";

function state(currentGlyph = "a") {
  const document = fontDocument([
    glyph(NOTDEF, { advance: 500 }),
    glyph("a", { unicodes: [0x61], advance: 500 }),
    glyph("b", { unicodes: [0x62], advance: 500 }),
    glyph("c", { unicodes: [0x63], advance: 500.4 }),
  ]);
  return editorState({ document, view: { scale: 1, tx: 0, ty: 0 }, currentGlyph });
}

describe("deleting several glyphs", () => {
  it("removes them all in one undo step", () => {
    const out = deleteGlyphs(state("c"), ["a", "b"]);

    expect(out.state.document.glyphOrder).toEqual([NOTDEF, "c"]);
    expect(out.effects).toEqual([
      expect.objectContaining({ label: "Delete 2 glyphs" }),
      expect.anything(),
    ]);
    expect(out.state.currentGlyph).toBe("c");
  });

  it("passes over .notdef and names that are not there, and deletes the rest", () => {
    const out = deleteGlyphs(state(), [NOTDEF, "gone", "b"]);
    expect(out.state.document.glyphOrder).toEqual([NOTDEF, "a", "c"]);
    expect(out.effects[0]).toMatchObject({ label: "Delete b" });
  });

  it("moves off the open glyph when it is one of them", () => {
    expect(deleteGlyphs(state("a"), ["a"]).state.currentGlyph).toBe(NOTDEF);
  });

  it("does nothing when nothing can go", () => {
    const before = state();
    expect(deleteGlyphs(before, [NOTDEF]).state).toBe(before);
  });
});

describe("marking several glyphs", () => {
  it("marks them all in one undo step", () => {
    const out = setMarkColors(state(), ["a", "b"], RED);
    expect(out.state.document.glyphs["a"]?.markColor).toBe(RED);
    expect(out.state.document.glyphs["b"]?.markColor).toBe(RED);
    expect(out.effects).toHaveLength(2);
  });

  it("does nothing when every one is already marked so", () => {
    const marked = setMarkColors(state(), ["a", "b"], RED).state;
    expect(setMarkColors(marked, ["a", "b"], RED).state).toBe(marked);
  });
});

describe("rounding several glyphs", () => {
  it("rounds the ones that need it, in one undo step", () => {
    const out = roundGlyphsAt(state(), ["b", "c"]);
    expect(out.state.document.glyphs["c"]?.advance).toBe(500);
    expect(out.effects).toHaveLength(2);
  });

  it("does nothing when every one is already whole", () => {
    const before = state();
    expect(roundGlyphsAt(before, ["a", "b"]).state).toBe(before);
  });
});
