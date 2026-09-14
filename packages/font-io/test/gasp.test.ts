import { contour, counterIds, fontDocument, glyph, node } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { readTablesOf } from "../src/sfnt.js";
import { exportTrueType } from "../src/truetype.js";

/**
 * How Windows is told to draw an unhinted TrueType font: smoothed at every size,
 * with dropout control on so a thin stroke does not vanish at small sizes.
 *
 * Read off the bytes, as the other table tests are, because the claim is about
 * what is in the file.
 */

const ids = counterIds("g");

const font = () =>
  fontDocument([
    glyph("H", {
      unicodes: [0x48],
      advance: 600,
      contours: [
        contour(
          ids.contour(),
          [
            node(ids.node(), { x: 50, y: 0 }),
            node(ids.node(), { x: 550, y: 0 }),
            node(ids.node(), { x: 550, y: 700 }),
          ],
          true,
        ),
      ],
    }),
  ]);

function table(bytes: ArrayBuffer, tag: string): DataView | null {
  const found = readTablesOf(new Uint8Array(bytes)).find((t) => t.tag === tag);
  return found === undefined
    ? null
    : new DataView(found.data.buffer, found.data.byteOffset, found.data.byteLength);
}

describe("gasp and prep in the TrueType flavour", () => {
  it("says to smooth every size, in one range", () => {
    const gasp = table(exportTrueType(font()).bytes, "gasp");
    expect(gasp).not.toBeNull();
    expect(gasp!.byteLength).toBe(8);
    expect(gasp!.getUint16(0)).toBe(1); // version
    expect(gasp!.getUint16(2)).toBe(1); // one range
    expect(gasp!.getUint16(4)).toBe(0xffff); // up to every size
    expect(gasp!.getUint16(6)).toBe(0x000f); // grid-fit, grayscale, and both symmetric
  });

  it("turns dropout control on in prep, as a font with no hinting needs", () => {
    const prep = table(exportTrueType(font()).bytes, "prep");
    // PUSHW[] 511, SCANCTRL[], PUSHB[] 4, SCANTYPE[]
    expect([...new Uint8Array(prep!.buffer, prep!.byteOffset, prep!.byteLength)]).toEqual([
      0xb8, 0x01, 0xff, 0x85, 0xb0, 0x04, 0x8d,
    ]);
  });

  it("declares the stack the prep program needs in maxp", () => {
    const maxp = table(exportTrueType(font()).bytes, "maxp");
    expect(maxp!.getUint32(0)).toBe(0x00010000);
    expect(maxp!.getUint16(24)).toBe(1); // maxStackElements
  });

  it("leaves the CFF flavour without either, which has no TrueType program to run", () => {
    const bytes = exportFont(font()).bytes;
    expect(table(bytes, "gasp")).toBeNull();
    expect(table(bytes, "prep")).toBeNull();
  });
});
