import { describe, expect, it } from "vitest";

import {
  DEFAULT_FONT_INFO,
  type Kerning,
  fontDocument,
  glyph,
  groupKey,
  removeGlyph,
  removeGlyphFromKerning,
} from "../src/index.js";

/**
 * A glyph removed, and the kerning that named it.
 *
 * It stayed: in the groups it was in and the pairs it was a side of. That
 * kerned nothing, was written to the font's files for another tool to be told
 * of a glyph that is not there — and waited, so that a glyph made later under
 * the same name was kerned at once by what the old one had been.
 */

const KERNING: Kerning = {
  firstGroups: { round: ["O", "Q"], straight: ["H"] },
  secondGroups: { slanted: ["V", "Q"] },
  pairs: {
    Q: { V: -20, [groupKey("slanted")]: -30 },
    O: { Q: -5, V: -10 },
    [groupKey("round")]: { Q: -15, [groupKey("slanted")]: -40 },
    H: { Q: -8 },
  },
};

describe("a glyph taken out of the kerning", () => {
  it("leaves no group it was in and no pair that named it", () => {
    const without = removeGlyphFromKerning(KERNING, "Q");

    expect(without.firstGroups).toEqual({ round: ["O"], straight: ["H"] });
    expect(without.secondGroups).toEqual({ slanted: ["V"] });
    expect(without.pairs).toEqual({
      O: { V: -10 },
      [groupKey("round")]: { [groupKey("slanted")]: -40 },
    });
    expect(JSON.stringify(without)).not.toContain('"Q"');
  });

  it("keeps a group it leaves empty, and the pairs of that group", () => {
    const without = removeGlyphFromKerning(
      { firstGroups: { lone: ["Q"] }, secondGroups: {}, pairs: { [groupKey("lone")]: { V: -9 } } },
      "Q",
    );
    expect(without.firstGroups).toEqual({ lone: [] });
    expect(without.pairs).toEqual({ [groupKey("lone")]: { V: -9 } });
  });

  it("is the same kerning where the glyph was not in it", () => {
    expect(removeGlyphFromKerning(KERNING, "Z")).toBe(KERNING);
  });

  it("goes with the glyph when the glyph is removed from the font", () => {
    const font = {
      ...fontDocument(
        ["O", "Q", "H", "V"].map((name) => glyph(name, { advance: 500 })),
        DEFAULT_FONT_INFO,
      ),
      kerning: KERNING,
    };
    const without = removeGlyph(font, "Q")!;

    expect(without.glyphOrder).toEqual(["O", "H", "V"]);
    expect(without.kerning).toEqual(removeGlyphFromKerning(KERNING, "Q"));
    // And one that kerning never named leaves it as it was.
    expect(
      removeGlyph({ ...font, kerning: { ...KERNING, pairs: {} } }, "H")!.kerning.pairs,
    ).toEqual({});
  });
});
