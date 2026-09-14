import { contour, counterIds, fontDocument, glyph, node } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { importFont } from "../src/import.js";
import { opentype } from "../src/opentype.js";
import { readTablesOf } from "../src/sfnt.js";
import { exportTrueType } from "../src/truetype.js";

/**
 * Glyph names in the TrueType flavour.
 *
 * The CFF table held them, the TrueType flavour replaces it, and the `post`
 * table left behind was the version with no names. Opened again, every glyph
 * was named after its character or its number.
 */

const ids = counterIds("pn");

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

const font = () =>
  fontDocument([
    glyph(".notdef", { advance: 500, contours: [drawn()] }),
    glyph("a", { unicodes: [0x61], advance: 500, contours: [drawn()] }),
    glyph("a.ss01", { advance: 500, contours: [drawn()] }),
    glyph("f_i", { advance: 500, contours: [drawn()] }),
  ]);

describe("glyph names in the TrueType flavour", () => {
  it("writes post version 2", () => {
    const post = readTablesOf(new Uint8Array(exportTrueType(font()).bytes)).find(
      (t) => t.tag === "post",
    )!.data;
    expect(new DataView(post.buffer, post.byteOffset, post.byteLength).getUint32(0)).toBe(
      0x00020000,
    );
  });

  it("keeps every name through a round trip, unencoded glyphs included", () => {
    const { document } = importFont(exportTrueType(font()).bytes, counterIds("r"));
    expect(document.glyphOrder).toEqual([".notdef", "a", "a.ss01", "f_i"]);
  });

  it("is read the same way by opentype.js", () => {
    const parsed = opentype.parse(exportTrueType(font()).bytes);
    expect(parsed.glyphs.get(2).name).toBe("a.ss01");
  });
});
