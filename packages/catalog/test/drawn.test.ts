import { component, contour, counterIds, fontDocument, glyph, node } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { catalog } from "../src/catalog.js";

/**
 * What the browser counts as drawn.
 *
 * Counting outline points alone filed every composite under "Not yet drawn" and
 * handed its cell nothing to show: an accented letter built from its parts has
 * no contours of its own, and is as drawn as the letters it is made of.
 */

const ids = counterIds("cd");

const a = glyph("a", {
  unicodes: [0x61],
  advance: 500,
  contours: [
    contour(
      ids.contour(),
      [
        node(ids.node(), { x: 0, y: 0 }),
        node(ids.node(), { x: 10, y: 0 }),
        node(ids.node(), { x: 5, y: 10 }),
      ],
      true,
    ),
  ],
});

describe("what counts as drawn", () => {
  it("counts a composite, which is drawn by reference", () => {
    const composite = glyph("adieresis", {
      unicodes: [0xe4],
      advance: 500,
      components: [component(ids.component(), "a")],
    });
    const entry = catalog(fontDocument([a, composite])).find((e) => e.name === "adieresis");

    expect(entry?.drawn).toBe(true);
    // The counts are still of its own outline, which it has none of.
    expect(entry?.contourCount).toBe(0);
  });

  it("still counts a glyph with nothing in it as not drawn", () => {
    const space = glyph("space", { unicodes: [0x20], advance: 250 });
    expect(catalog(fontDocument([a, space])).find((e) => e.name === "space")?.drawn).toBe(false);
  });
});
