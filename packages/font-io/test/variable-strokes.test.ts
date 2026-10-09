import {
  type FontDocument,
  DEFAULT_FONT_INFO,
  WEIGHT,
  component,
  contour,
  contourBounds,
  counterIds,
  fontDocument,
  glyph,
  node,
  withNib,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { writtenOrder } from "../src/export.js";
import { opentype } from "../src/opentype.js";
import { drawnWithPen, exportVariableFont, flattened } from "../src/variable.js";
import { exportVariableTrueType } from "../src/variable-truetype.js";

/**
 * A stroke in a variable font.
 *
 * A stroke is a path and a pen, and what goes in a font is the ink. The static
 * export has always written it; the variable one wrote the path itself, closed
 * up and filled. It is the ink now — the default master's, at every weight,
 * and said to be, until the ink is worked out to the same points in every
 * master.
 */

const ids = counterIds("vs");
const at = (x: number, y: number) => ({ x, y });

/** An S drawn with a pen of a given width, and a letter that is the S again. */
const master = (pen: number): FontDocument => {
  const skeleton = withNib(
    contour(
      ids.contour(),
      [
        node(ids.node(), at(100, 100), { out: at(300, 100) }),
        node(ids.node(), at(300, 350), {
          type: "smooth",
          in: at(400, 250),
          out: at(200, 450),
        }),
        node(ids.node(), at(500, 600), { in: at(300, 600) }),
      ],
      false,
    ),
    { angle: 30, width: pen, thickness: pen / 4 },
  );
  return fontDocument(
    [
      glyph(".notdef", { advance: 500 }),
      glyph("s", { advance: 600, unicodes: [0x73], contours: [skeleton] }),
      glyph("dollar", {
        advance: 600,
        unicodes: [0x24],
        components: [component(ids.component(), "s")],
      }),
      glyph("n", {
        advance: 500,
        unicodes: [0x6e],
        contours: [
          contour(
            ids.contour(),
            [
              node(ids.node(), at(0, 0)),
              node(ids.node(), at(pen, 0)),
              node(ids.node(), at(pen, 700)),
              node(ids.node(), at(0, 700)),
            ],
            true,
          ),
        ],
      }),
    ],
    { ...DEFAULT_FONT_INFO, familyName: "Penned" },
  );
};

const axes = [WEIGHT];
const family = () => [
  { name: "Regular", location: { wght: 400 }, document: master(60) },
  { name: "Black", location: { wght: 900 }, document: master(140) },
];

describe("a stroke in a variable font", () => {
  it("is prepared as its ink, not as the path it was drawn along", () => {
    const document = master(60);
    const prepared = flattened(document, writtenOrder(document));
    const s = prepared.find((g) => g.name === "s")!;

    expect(s.contours.length).toBeGreaterThan(0);
    for (const c of s.contours) {
      expect(c.closed).toBe(true);
      expect(c.nib).toBeUndefined();
    }
    // The path runs from 100 to 500; the ink is a pen's reach wider.
    const xs = s.contours.map((c) => contourBounds(c)!);
    expect(Math.min(...xs.map((b) => b.minX))).toBeLessThan(90);
    expect(Math.max(...xs.map((b) => b.maxX))).toBeGreaterThan(510);
  });

  it("is ink in a glyph that only names it, too", () => {
    const document = master(60);
    const dollar = flattened(document, writtenOrder(document)).find((g) => g.name === "dollar")!;

    expect(dollar.contours.length).toBeGreaterThan(0);
    expect(dollar.contours.every((c) => c.closed && c.nib === undefined)).toBe(true);
    expect(drawnWithPen(document, "dollar")).toBe(true);
    expect(drawnWithPen(document, "n")).toBe(false);
  });

  it("is written as the default master draws it, and said not to vary", () => {
    const { warnings, notVarying } = exportVariableFont(axes, family());

    expect(notVarying).toEqual(expect.arrayContaining(["s", "dollar"]));
    expect(notVarying).not.toContain("n");
    expect(warnings).toContainEqual(
      expect.stringMatching(/drawn with a pen do not vary.*s, dollar/),
    );
    expect(warnings.some((w) => w.includes("masters disagree"))).toBe(false);
  });

  it("is the ink in the font with quadratic outlines as well", () => {
    const { bytes, warnings } = exportVariableTrueType(axes, family());
    const s = opentype.parse(bytes).charToGlyph("s");
    const box = s.path.getBoundingBox();

    expect(box.x1).toBeLessThan(90);
    expect(box.x2).toBeGreaterThan(510);
    expect(warnings).toContainEqual(expect.stringMatching(/drawn with a pen do not vary/));
  });
});
