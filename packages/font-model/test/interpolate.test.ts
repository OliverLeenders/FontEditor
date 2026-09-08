import { vec } from "@fonteditor/geometry";
import { describe, expect, it } from "vitest";

import { addAnchor, addContour, glyph } from "../src/glyph.js";
import { anchor } from "../src/anchor.js";
import { component } from "../src/component.js";
import { contour } from "../src/contour.js";
import { WEIGHT } from "../src/designspace.js";
import { DEFAULT_FONT_INFO, fontDocument } from "../src/document.js";
import { interpolateFont, interpolateGlyph } from "../src/interpolate.js";
import { node } from "../src/node.js";

/**
 * A drawing worked out between the masters.
 *
 * Half of these are about the arithmetic being right and half are about it
 * being refused. The refusals matter more: nothing in the arithmetic can tell
 * whether the points it is adding describe the same part of the same letter, so
 * an instance drawn from masters that disagree is a letter with a spike in it,
 * and a gap is the better answer.
 */

let ids = 0;
const id = () => `i${String(++ids)}`;

/** A stem: two points, so the numbers in a test are readable. */
const stem = (width: number) =>
  contour(
    id(),
    [
      node(id(), vec(0, 0), { out: vec(0, 100) }),
      node(id(), vec(width, 700), { in: vec(width, 600) }),
    ],
    true,
  );

const drawn = (width: number, advance = 500) => addContour(glyph("n", { advance }), stem(width));

describe("mixing two drawings", () => {
  it("is each master exactly at its own end", () => {
    const light = drawn(60);
    const black = drawn(200);

    expect(interpolateGlyph([light, black], [1, 0])?.contours[0]?.nodes[1]?.pt.x).toBe(60);
    expect(interpolateGlyph([light, black], [0, 1])?.contours[0]?.nodes[1]?.pt.x).toBe(200);
  });

  it("takes the average in the middle, handles and all", () => {
    const mixed = interpolateGlyph([drawn(60), drawn(200)], [0.5, 0.5]);
    const node1 = mixed?.contours[0]?.nodes[1];

    expect(node1?.pt.x).toBe(130);
    expect(node1?.in?.x).toBe(130);
    // And the advance, which is as much a part of the design as the outline.
    expect(mixed?.advance).toBe(500);
  });

  it("interpolates the advance", () => {
    expect(interpolateGlyph([drawn(60, 400), drawn(200, 600)], [0.5, 0.5])?.advance).toBe(500);
  });

  it("keeps the name, the unicodes and everything that is not a shape", () => {
    const light = glyph("n", { advance: 500, unicodes: [0x6e] });
    const black = glyph("n", { advance: 600, unicodes: [0x6e] });

    const mixed = interpolateGlyph([light, black], [0.5, 0.5]);
    expect(mixed?.name).toBe("n");
    expect(mixed?.unicodes).toEqual([0x6e]);
  });

  it("moves the anchors with the drawing", () => {
    const light = addAnchor(drawn(60), anchor(id(), "top", { x: 100, y: 700 }));
    const black = addAnchor(drawn(200), anchor(id(), "top", { x: 140, y: 760 }));

    const top = interpolateGlyph([light, black], [0.5, 0.5])?.anchors[0];
    expect(top?.pt).toEqual({ x: 120, y: 730 });
  });

  it("matches anchors by name rather than by position in the list", () => {
    // An anchor is not part of the outline, and a master with them in another
    // order is perfectly interpolatable.
    const light = addAnchor(
      addAnchor(drawn(60), anchor(id(), "top", { x: 100, y: 700 })),
      anchor(id(), "bottom", { x: 100, y: 0 }),
    );
    const black = addAnchor(
      addAnchor(drawn(200), anchor(id(), "bottom", { x: 140, y: 0 })),
      anchor(id(), "top", { x: 140, y: 760 }),
    );

    const mixed = interpolateGlyph([light, black], [0.5, 0.5]);
    expect(mixed?.anchors.find((a) => a.name === "top")?.pt.y).toBe(730);
  });

  it("leaves out an anchor a master that counts does not have", () => {
    const light = addAnchor(drawn(60), anchor(id(), "top", { x: 100, y: 700 }));
    const black = drawn(200);

    expect(interpolateGlyph([light, black], [0.5, 0.5])?.anchors).toEqual([]);
  });

  it("moves a component's placement, keeping the glyph it names", () => {
    const light = glyph("Aacute", { advance: 600, components: [component(id(), "acute")] });
    const black = glyph("Aacute", {
      advance: 600,
      components: [
        component(id(), "acute", {
          xScale: 1,
          xyScale: 0,
          yxScale: 0,
          yScale: 1,
          xOffset: 100,
          yOffset: 40,
        }),
      ],
    });

    const mixed = interpolateGlyph([light, black], [0.5, 0.5]);
    expect(mixed?.components[0]?.base).toBe("acute");
    expect(mixed?.components[0]?.transform.xOffset).toBe(50);
  });
});

describe("what it refuses", () => {
  it("refuses masters that disagree about the shape", () => {
    const light = drawn(60);
    const black = addContour(drawn(200), stem(40));

    // One contour against two: the arithmetic would happily average the first
    // and drop the second, and the letter would come out missing a stem.
    expect(interpolateGlyph([light, black], [0.5, 0.5])).toBeNull();
  });

  it("refuses a glyph a master that counts does not have", () => {
    expect(interpolateGlyph([drawn(60), null], [0.5, 0.5])).toBeNull();
  });

  it("does not mind a glyph missing from a master that counts for nothing", () => {
    // At the light end the black has no say, and a glyph it happens to lack is
    // not a reason to refuse the light one.
    expect(interpolateGlyph([drawn(60), null], [1, 0])?.contours[0]?.nodes[1]?.pt.x).toBe(60);
  });

  it("has nothing to draw when no master counts at all", () => {
    expect(interpolateGlyph([drawn(60)], [0])).toBeNull();
    expect(interpolateGlyph([], [])).toBeNull();
  });
});

describe("a whole font at a location", () => {
  const light = fontDocument([drawn(60), glyph("space", { advance: 250 })], DEFAULT_FONT_INFO);
  const black = fontDocument([drawn(200), glyph("space", { advance: 260 })], DEFAULT_FONT_INFO);

  it("works out every glyph it can", () => {
    const { document, refused } = interpolateFont(
      [WEIGHT],
      [{ wght: 400 }, { wght: 900 }],
      [light, black],
      { wght: 650 },
    );

    expect(refused).toEqual([]);
    expect(document.glyphs["n"]?.contours[0]?.nodes[1]?.pt.x).toBe(130);
    expect(document.glyphs["space"]?.advance).toBe(255);
  });

  it("names the glyphs it could not, rather than leaving them wrong", () => {
    const broken = fontDocument(
      [addContour(drawn(200), stem(40)), glyph("space", { advance: 260 })],
      DEFAULT_FONT_INFO,
    );

    const { document, refused } = interpolateFont(
      [WEIGHT],
      [{ wght: 400 }, { wght: 900 }],
      [light, broken],
      { wght: 650 },
    );

    expect(refused).toEqual(["n"]);
    expect(document.glyphs["n"]).toBeUndefined();
    expect(document.glyphs["space"]).toBeDefined();
  });

  it("is a master exactly at that master's own location", () => {
    const { document } = interpolateFont([WEIGHT], [{ wght: 400 }, { wght: 900 }], [light, black], {
      wght: 900,
    });

    expect(document.glyphs["n"]?.contours[0]?.nodes[1]?.pt.x).toBe(200);
  });
});
