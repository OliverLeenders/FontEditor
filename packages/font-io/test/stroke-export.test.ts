import { vec } from "@typewright/geometry";
import {
  contour,
  contourBounds,
  counterIds,
  fontDocument,
  glyph,
  node,
  withNib,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { importFont } from "../src/import.js";
import { glif } from "../src/ufo.js";

/**
 * A stroke on its way out of the editor.
 *
 * What goes into a font is ink. A skeleton is the path a pen was drawn along, and
 * neither a font nor another application reading a .ufo has any idea what to do
 * with one: written as it is, a stroke would be an open line that fills nothing.
 */

const ids = counterIds("se");

/** An upright stem, drawn as a single stroke with a pen held level. */
const stem = () =>
  withNib(
    contour(ids.contour(), [node(ids.node(), vec(200, 0)), node(ids.node(), vec(200, 700))]),
    {
      angle: 0,
      width: 80,
    },
  );

describe("a stroke exported", () => {
  it("is the ink its pen leaves", () => {
    const g = glyph("l", { advance: 400, contours: [stem()] });
    const { warnings, bytes } = exportFont(fontDocument([g]), counterIds("e"));
    expect(warnings).toEqual([]);

    const back = importFont(bytes, counterIds("b")).document.glyphs["l"]!;
    expect(back.contours).toHaveLength(1);
    expect(back.contours[0]!.closed).toBe(true);
    // A level pen eighty wide drawn straight up: a stem eighty wide, centred on
    // the skeleton, as tall as it.
    expect(contourBounds(back.contours[0]!)).toEqual({ minX: 160, minY: 0, maxX: 240, maxY: 700 });
  });

  it("is joined to the outlines it overlaps", () => {
    // A stroke across a drawn bowl is one shape in the font, not two overlapping.
    const bowl = contour(
      ids.contour(),
      [
        node(ids.node(), vec(150, 200)),
        node(ids.node(), vec(450, 200)),
        node(ids.node(), vec(450, 500)),
        node(ids.node(), vec(150, 500)),
      ],
      true,
    );
    const g = glyph("b", { advance: 500, contours: [bowl, stem()] });
    const back = importFont(exportFont(fontDocument([g]), counterIds("e")).bytes, counterIds("b"))
      .document.glyphs["b"]!;
    expect(back.contours).toHaveLength(1);
  });
});

describe("a stroke written to a .ufo", () => {
  it("is written as ink, closed, with no open line in it", () => {
    const g = glyph("l", { advance: 400, contours: [stem()] });
    const text = glif(g);
    // Every contour written starts with a move only when it is open; the ink is
    // closed, so there is none.
    expect(text).toContain("<contour>");
    expect(text).not.toContain('type="move"');
  });
});
