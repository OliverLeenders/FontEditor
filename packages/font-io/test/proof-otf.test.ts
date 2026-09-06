import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  type FontDocument,
  addAnchor,
  anchor,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
} from "@fonteditor/font-model";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";

/**
 * A font written for something else to check.
 *
 * The UFO has `tools/ufo-check`, which reads it with fontTools and complains.
 * This is the same idea for the binary: mark attachment is a tree of offsets
 * into offsets, and the only convincing proof that it is right is a reader
 * nobody here wrote opening it and finding the anchors where they were put.
 *
 * `OTF_OUT` says where to write it. Without it the test asserts what it can from
 * inside and writes nothing, so the suite stays a suite.
 */

const OUT = process.env["OTF_OUT"] ?? "";

const ids = counterIds("otf");

/** A rectangle, which is all the shape any of this needs. */
function box(minX: number, minY: number, maxX: number, maxY: number) {
  return contour(
    ids.contour(),
    [
      node(ids.node(), { x: minX, y: minY }),
      node(ids.node(), { x: maxX, y: minY }),
      node(ids.node(), { x: maxX, y: maxY }),
      node(ids.node(), { x: minX, y: maxY }),
    ],
    true,
  );
}

/**
 * A letter, two combining accents, and one accent that stacks on another.
 *
 * `a` offers `top`. `acutecomb` attaches by `_top` and offers a `top` of its
 * own, which is what makes a second accent stack on it. `ogonekcomb` attaches by
 * `_ogonek`, so there are two mark classes and a base that offers only one of
 * them — the case a null anchor offset exists for.
 */
export function proofFont(): FontDocument {
  const a = addAnchor(
    addAnchor(
      glyph("a", { unicodes: [0x61], advance: 500, contours: [box(0, 0, 400, 600)] }),
      anchor(ids.anchor(), "top", { x: 200, y: 620 }),
    ),
    anchor(ids.anchor(), "ogonek", { x: 320, y: 0 }),
  );

  const acute = addAnchor(
    addAnchor(
      glyph("acutecomb", { unicodes: [0x301], advance: 0, contours: [box(-40, 640, 40, 700)] }),
      anchor(ids.anchor(), "_top", { x: 0, y: 640 }),
    ),
    anchor(ids.anchor(), "top", { x: 0, y: 720 }),
  );

  const ogonek = addAnchor(
    glyph("ogonekcomb", { unicodes: [0x328], advance: 0, contours: [box(-30, -160, 30, 0)] }),
    anchor(ids.anchor(), "_ogonek", { x: 0, y: 0 }),
  );

  const macron = addAnchor(
    glyph("macroncomb", { unicodes: [0x304], advance: 0, contours: [box(-50, 660, 50, 700)] }),
    anchor(ids.anchor(), "_top", { x: 0, y: 660 }),
  );

  return fontDocument([glyph(".notdef", { advance: 500 }), a, acute, ogonek, macron], {
    familyName: "Tunni Marks",
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 780,
    descender: -220,
    xHeight: 520,
    capHeight: 700,
  });
}

describe("the mark-attachment proof font", () => {
  it("exports without complaint", () => {
    const { bytes, warnings } = exportFont(proofFont());
    expect(warnings).toEqual([]);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("writes itself out when asked to", () => {
    if (OUT === "") return;

    const { bytes } = exportFont(proofFont());
    rmSync(OUT, { recursive: true, force: true });
    const path = join(OUT, "TunniMarks-Regular.otf");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, new Uint8Array(bytes));
  });
});
