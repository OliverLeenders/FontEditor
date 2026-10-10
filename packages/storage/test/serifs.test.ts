import {
  DEFAULT_FONT_INFO,
  DEFAULT_SERIF,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
  withNib,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { decodeFontInfo, decodeGlyph, encodeFontInfo, encodeGlyph } from "../src/schema.js";

/**
 * Serifs in the working store: the font's styles with its information, and
 * each end's serif with the point it is on. A project saved before there were
 * any opens as a font with none.
 */

const ids = counterIds("serif-store");
const FOOT = { ...DEFAULT_SERIF, name: "Foot", left: 50, bracket: 0.6 };

describe("serifs in the working store", () => {
  it("keeps the font's styles, and reads an older project as having none", () => {
    const font = { ...fontDocument([], DEFAULT_FONT_INFO), serifs: [FOOT] };
    const stored = JSON.parse(JSON.stringify(encodeFontInfo(font))) as unknown;
    expect(decodeFontInfo(stored).serifs).toEqual([FOOT]);

    expect(decodeFontInfo({ schema: 1, familyName: "Older" }).serifs).toEqual([]);
    expect(encodeFontInfo(fontDocument([], DEFAULT_FONT_INFO))).not.toHaveProperty("serifs");
  });

  it("keeps an end's serif, its style and the numbers that are its own", () => {
    const serif = { ...DEFAULT_SERIF, left: 50, right: 5, style: "Foot", own: ["right" as const] };
    const stem = withNib(
      contour(
        ids.contour(),
        [
          node(ids.node(), { x: 200, y: 600 }),
          node(ids.node(), { x: 200, y: 0 }, { end: { cut: 0, serif } }),
        ],
        false,
      ),
      { angle: 30, width: 80 },
    );
    const stored = JSON.parse(
      JSON.stringify(encodeGlyph(glyph("l", { contours: [stem] }))),
    ) as unknown;
    const back = decodeGlyph(stored);
    if (!back.ok) throw new Error(back.reason);
    expect(back.value.contours[0]!.nodes[1]!.end).toEqual({ cut: 0, serif });
  });
});
