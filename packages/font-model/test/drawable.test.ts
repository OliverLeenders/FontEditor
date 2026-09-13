import { translation } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import { component } from "../src/component.js";
import { contour } from "../src/contour.js";
import { fontDocument, putGlyph } from "../src/document.js";
import { drawableGlyph } from "../src/drawable.js";
import { glyph, glyphBounds } from "../src/glyph.js";
import { counterIds } from "../src/ids.js";
import { node } from "../src/node.js";

/**
 * A glyph as the browser, the spacing line and the proof draw it.
 *
 * Composites are nothing but references, and those three drew a glyph's own
 * contours — so an `ä` built from its parts was an empty cell and a gap in every
 * line. This is the one place the references are drawn in for them.
 */

const ids = counterIds("dr");

const triangle = (lift = 0) =>
  contour(
    ids.contour(),
    [
      node(ids.node(), { x: 0, y: lift }),
      node(ids.node(), { x: 100, y: lift }),
      node(ids.node(), { x: 50, y: lift + 100 }),
    ],
    true,
  );

const a = glyph("a", { unicodes: [0x61], advance: 500, contours: [triangle()] });
const dieresis = glyph("dieresiscomb", { unicodes: [0x308], contours: [triangle(), triangle(0)] });
const adieresis = glyph("adieresis", {
  unicodes: [0xe4],
  advance: 500,
  components: [
    component(ids.component(), "a"),
    component(ids.component(), "dieresiscomb", translation(0, 600)),
  ],
});

describe("a glyph as it is drawn", () => {
  it("is the glyph itself when it has no components", () => {
    const document = fontDocument([a]);
    expect(drawableGlyph(document, a)).toBe(a);
  });

  it("draws a composite's components in as contours", () => {
    const drawn = drawableGlyph(fontDocument([a, dieresis, adieresis]), adieresis);

    expect(drawn.contours).toHaveLength(3);
    expect(drawn.components).toEqual([]);
    // Where they were placed, not where they sit in their own glyphs.
    expect(glyphBounds(drawn)).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 700 });
  });

  it("keeps everything else about the glyph", () => {
    const drawn = drawableGlyph(fontDocument([a, dieresis, adieresis]), adieresis);
    expect(drawn.name).toBe("adieresis");
    expect(drawn.advance).toBe(500);
    expect(drawn.unicodes).toEqual([0xe4]);
  });

  it("works it out once per document", () => {
    const document = fontDocument([a, dieresis, adieresis]);
    expect(drawableGlyph(document, adieresis)).toBe(drawableGlyph(document, adieresis));
  });

  it("follows a change to a letter it is built from", () => {
    const before = fontDocument([a, dieresis, adieresis]);
    const after = putGlyph(before, { ...a, contours: [triangle(), triangle(200)] });

    expect(drawableGlyph(before, adieresis).contours).toHaveLength(3);
    expect(drawableGlyph(after, adieresis).contours).toHaveLength(4);
  });
});
