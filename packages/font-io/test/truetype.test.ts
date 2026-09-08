import {
  DEFAULT_FONT_INFO,
  addContour,
  contour,
  fontDocument,
  glyph,
  node,
} from "@fonteditor/font-model";
import { vec } from "@fonteditor/geometry";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { exportTrueType } from "../src/truetype.js";

/**
 * The TrueType flavour.
 *
 * What can be asserted here is that the file says it is one and carries the
 * tables one has. Whether the quadratics it holds are the curves that were
 * drawn is asked of fontTools, which reads the outlines back — see
 * `tools/otf-check`.
 */

let ids = 0;
const id = () => `t${String(++ids)}`;

/** A bowl: four curves, which is what the conversion actually has to do. */
const ring = () =>
  contour(
    id(),
    [
      node(id(), vec(250, 0), { type: "smooth", in: vec(110, 0), out: vec(390, 0) }),
      node(id(), vec(500, 350), { type: "smooth", in: vec(500, 155), out: vec(500, 545) }),
      node(id(), vec(250, 700), { type: "smooth", in: vec(390, 700), out: vec(110, 700) }),
      node(id(), vec(0, 350), { type: "smooth", in: vec(0, 545), out: vec(0, 155) }),
    ],
    true,
  );

const font = () =>
  fontDocument(
    [
      glyph(".notdef", { advance: 500 }),
      addContour(glyph("o", { advance: 550, unicodes: [0x6f] }), ring()),
      glyph("space", { unicodes: [0x20], advance: 250 }),
    ],
    { ...DEFAULT_FONT_INFO, familyName: "Quad" },
  );

const tagsOf = (bytes: ArrayBuffer): string[] => {
  const font = new Uint8Array(bytes);
  const view = new DataView(bytes);
  const out: string[] = [];
  for (let i = 0; i < view.getUint16(4); i++) {
    const at = 12 + i * 16;
    out.push(String.fromCharCode(font[at]!, font[at + 1]!, font[at + 2]!, font[at + 3]!));
  }
  return out;
};

describe("a TrueType font", () => {
  it("says which flavour it is in its first four bytes", () => {
    const bytes = exportTrueType(font()).bytes;
    // `OTTO` is the CFF flavour; a version number is this one, and a reader
    // decides which kind of outline to look for on these four bytes alone.
    expect(new DataView(bytes).getUint32(0)).toBe(0x00010000);
  });

  it("has the outline tables, and not the one it replaced", () => {
    const tags = tagsOf(exportTrueType(font()).bytes);

    expect(tags).toContain("glyf");
    expect(tags).toContain("loca");
    expect(tags).not.toContain("CFF ");
  });

  it("writes itself out when asked to", () => {
    const out = process.env["TRUETYPE_OUT"] ?? "";
    if (out === "") return;

    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });

    // Both flavours of the same drawing. The cubic one is exact, so it is what
    // the quadratic one is measured against: the question this cannot answer
    // for itself is whether the conversion moved the letter.
    writeFileSync(join(out, "Quad.ttf"), new Uint8Array(exportTrueType(font()).bytes));
    writeFileSync(join(out, "Quad.otf"), new Uint8Array(exportFont(font()).bytes));
  });
});
