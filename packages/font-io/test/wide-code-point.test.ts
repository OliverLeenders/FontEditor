import { contour, counterIds, fontDocument, glyph, node } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { opentype } from "../src/opentype.js";
import { readTablesOf } from "../src/sfnt.js";
import { exportTrueType } from "../src/truetype.js";

/**
 * A glyph mapped from a code point above U+FFFF as well as from one below.
 *
 * opentype.js writes the wide half of the character map only when some glyph's
 * first code point needs it. A glyph whose wide code point came second — an `A`
 * that also stands for the mathematical bold one — was written without it where
 * no other glyph in the font had a wide code point first, and the character was
 * quietly unmapped.
 */

const ids = counterIds("wide");

const drawn = () =>
  contour(
    ids.contour(),
    [
      node(ids.node(), { x: 0, y: 0 }),
      node(ids.node(), { x: 100, y: 0 }),
      node(ids.node(), { x: 50, y: 100 }),
    ],
    true,
  );

const BOLD_A = "\u{1d400}";
const BOLD_B = "\u{1d401}";

const font = () =>
  fontDocument([
    glyph(".notdef", { advance: 500, contours: [drawn()] }),
    glyph("A", { unicodes: [0x41, 0x1d400], advance: 600, contours: [drawn()] }),
    glyph("B", { unicodes: [0x42, 0x1d401], advance: 600, contours: [drawn()] }),
    glyph("C", { unicodes: [0x43], advance: 600, contours: [drawn()] }),
  ]);

describe("a wide code point that is not a glyph's first", () => {
  it("is kept in the character map, with the narrow ones beside it", () => {
    const parsed = opentype.parse(exportFont(font()).bytes);

    expect(parsed.charToGlyph(BOLD_A).name).toBe("A");
    expect(parsed.charToGlyph(BOLD_B).name).toBe("B");
    expect(parsed.charToGlyph("A").name).toBe("A");
    expect(parsed.charToGlyph("B").name).toBe("B");
    expect(parsed.charToGlyph("C").name).toBe("C");
  });

  it("is kept in the TrueType flavour as well", () => {
    const parsed = opentype.parse(exportTrueType(font()).bytes);

    expect(parsed.charToGlyph(BOLD_A).name).toBe("A");
    expect(parsed.charToGlyph("A").name).toBe("A");
  });

  it("leaves a font with no wide code point as it was, one half and no more", () => {
    const narrow = fontDocument([
      glyph(".notdef", { advance: 500, contours: [drawn()] }),
      glyph("A", { unicodes: [0x41], advance: 600, contours: [drawn()] }),
    ]);
    const { bytes } = exportFont(narrow);
    const cmap = readTablesOf(new Uint8Array(bytes)).find((t) => t.tag === "cmap")!.data;

    // The count of subtables, which is the table's second field.
    expect(new DataView(cmap.buffer, cmap.byteOffset, cmap.byteLength).getUint16(2)).toBe(1);
    expect(opentype.parse(bytes).charToGlyph("A").name).toBe("A");
  });
});
