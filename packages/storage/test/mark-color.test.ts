import { glyph } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { decodeGlyph, encodeGlyph } from "../src/schema.js";

/**
 * A glyph's colour mark, through the working store.
 *
 * Stored glyphs are read back field by field, so a field the store does not
 * know about is dropped the next time the font is opened — which is what nearly
 * happened to the vertical metrics. The mark is written and read explicitly.
 */

describe("a colour mark in the working store", () => {
  it("survives being stored and read back", () => {
    const decoded = decodeGlyph(encodeGlyph(glyph("a", { advance: 500, markColor: "1,0,0,1" })));
    if (!decoded.ok) throw new Error(decoded.reason);
    expect(decoded.value.markColor).toBe("1,0,0,1");
  });

  it("is not written for a glyph without one, and reads back as none", () => {
    const stored = encodeGlyph(glyph("a", { advance: 500 }));
    expect("markColor" in stored).toBe(false);

    const decoded = decodeGlyph(stored);
    if (!decoded.ok) throw new Error(decoded.reason);
    expect(decoded.value.markColor).toBeNull();
  });

  it("reads a mark that is not a string as none, rather than failing the glyph", () => {
    const decoded = decodeGlyph({ ...encodeGlyph(glyph("a")), markColor: 42 });
    if (!decoded.ok) throw new Error(decoded.reason);
    expect(decoded.value.markColor).toBeNull();
  });
});
