import { contour, counterIds, fontDocument, glyph, node } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { readTablesOf } from "../src/sfnt.js";
import { exportTrueType } from "../src/truetype.js";

/**
 * The left sidebearings in `hmtx`, read off the bytes.
 *
 * Every font exported until FreeType drew one said zero for every glyph, and
 * the TrueType flavour was drawn shifted by it: a rasteriser following the
 * TrueType model puts the outline where the sidebearing says.
 */

const ids = counterIds("sb");

const box = (minX: number, maxX: number) =>
  contour(
    ids.contour(),
    [
      node(ids.node(), { x: minX, y: 0 }),
      node(ids.node(), { x: maxX, y: 0 }),
      node(ids.node(), { x: maxX, y: 700 }),
      node(ids.node(), { x: minX, y: 700 }),
    ],
    true,
  );

/** A bowl whose leftmost point is a curve's extreme, not a point of the drawing. */
const bowl = () =>
  contour(
    ids.contour(),
    [
      node(
        ids.node(),
        { x: 300, y: 0 },
        { type: "smooth", in: { x: 150, y: 0 }, out: { x: 450, y: 0 } },
      ),
      node(
        ids.node(),
        { x: 300, y: 600 },
        { type: "smooth", in: { x: 450, y: 600 }, out: { x: 150, y: 600 } },
      ),
    ],
    true,
  );

const font = () =>
  fontDocument([
    glyph(".notdef", { advance: 500 }),
    glyph("space", { unicodes: [0x20], advance: 250 }),
    glyph("H", { unicodes: [0x48], advance: 600, contours: [box(40, 560)] }),
    glyph("l", { unicodes: [0x6c], advance: 208, contours: [box(100, 108)] }),
    glyph("o", { unicodes: [0x6f], advance: 600, contours: [bowl()] }),
  ]);

/** Each glyph's left sidebearing, by glyph id. */
function sidebearings(bytes: ArrayBuffer): number[] {
  const tables = readTablesOf(new Uint8Array(bytes));
  const view = (tag: string) => {
    const found = tables.find((t) => t.tag === tag)!;
    return new DataView(found.data.buffer, found.data.byteOffset, found.data.byteLength);
  };
  const hhea = view("hhea");
  const hmtx = view("hmtx");
  const glyphs = view("maxp").getUint16(4);
  const metrics = hhea.getUint16(34);
  return Array.from({ length: glyphs }, (_, g) =>
    hmtx.getInt16(g < metrics ? g * 4 + 2 : metrics * 4 + (g - metrics) * 2),
  );
}

describe("left sidebearings", () => {
  it("say where each outline starts in the TrueType flavour", () => {
    const [notdef, space, H, l, o] = sidebearings(exportTrueType(font()).bytes);
    expect([notdef, space, H, l]).toEqual([0, 0, 40, 100]);
    // The leftmost point written, off-curve points included, which is what the
    // glyph's own bounds say: left of the cubic's extreme at 187.5, and not as
    // far as the drawing's handles at 150.
    expect(o).toBeGreaterThanOrEqual(150);
    expect(o).toBeLessThanOrEqual(188);
  });

  it("say where each outline starts in the CFF flavour too", () => {
    const [notdef, space, H, l, o] = sidebearings(exportFont(font()).bytes);
    expect([notdef, space, H, l]).toEqual([0, 0, 40, 100]);
    // A cubic from (300, 0) bending towards 150 reaches 187.5 at its furthest.
    expect(o).toBe(187);
  });
});
