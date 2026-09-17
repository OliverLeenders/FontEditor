import { vec } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import { component } from "../src/component.js";
import { contour } from "../src/contour.js";
import { fontDocument, renameGlyph } from "../src/document.js";
import { addContour, glyph } from "../src/glyph.js";
import {
  BACKGROUND,
  addLayer,
  clearLayer,
  copyToLayer,
  inLayer,
  layerProblem,
  removeLayer,
  swapWithLayer,
  updateGlyphInLayer,
  withLayer,
} from "../src/layers.js";
import { node } from "../src/node.js";

/**
 * A glyph's other drawings.
 *
 * What matters most is what is not changed: the letter when its background is
 * edited, the background when the letter is, and a glyph handed back as the
 * same object when an edit to a layer changed nothing — which is how history
 * and autosave tell an edit from none.
 */

let ids = 0;
const id = () => `l${String(++ids)}`;
const stem = (width: number) =>
  contour(id(), [node(id(), vec(0, 0)), node(id(), vec(width, 700))], true);

const letter = () => addContour(glyph("n", { advance: 500, unicodes: [0x6e] }), stem(60));

describe("a glyph as drawn in a layer", () => {
  it("is empty and as wide as the letter where nothing is drawn yet, and keeps its name", () => {
    const view = inLayer(letter(), BACKGROUND);
    expect(view.contours).toEqual([]);
    expect(view.advance).toBe(500);
    expect(view.unicodes).toEqual([0x6e]);
  });

  it("is the glyph itself for the main drawing", () => {
    const g = letter();
    expect(inLayer(g, null)).toBe(g);
  });

  it("takes an edit into the layer, leaving the letter alone", () => {
    const g = letter();
    const drawn = addContour(inLayer(g, BACKGROUND), stem(200));
    const after = withLayer(g, BACKGROUND, drawn);

    expect(after.contours).toBe(g.contours);
    expect(after.layers[BACKGROUND]?.contours).toHaveLength(1);
  });

  it("is the same glyph after an edit that changed nothing, drawn in or not", () => {
    const g = letter();
    expect(withLayer(g, BACKGROUND, inLayer(g, BACKGROUND))).toBe(g);
    const layered = copyToLayer(g, BACKGROUND);
    expect(withLayer(layered, BACKGROUND, inLayer(layered, BACKGROUND))).toBe(layered);
  });

  it("is written through by the document helper every tool uses", () => {
    const document = fontDocument([letter()]);
    const out = updateGlyphInLayer(document, "n", "sketch", (g) => addContour(g, stem(10)));
    expect(out?.glyphs["n"]?.layers["sketch"]?.contours).toHaveLength(1);
    expect(out?.glyphs["n"]?.contours).toHaveLength(1);
  });
});

describe("moving drawings between layers", () => {
  it("copies the letter into a layer", () => {
    const g = copyToLayer(letter(), BACKGROUND);
    expect(g.layers[BACKGROUND]?.contours).toBe(g.contours);
  });

  it("trades the letter and a layer, advance and all", () => {
    const g = withLayer(letter(), BACKGROUND, {
      ...addContour(inLayer(letter(), BACKGROUND), stem(200)),
      advance: 640,
    });
    const swapped = swapWithLayer(g, BACKGROUND);

    expect(swapped.advance).toBe(640);
    expect(swapped.contours[0]?.nodes[1]?.pt.x).toBe(200);
    expect(swapped.layers[BACKGROUND]?.advance).toBe(500);
    expect(swapped.layers[BACKGROUND]?.contours[0]?.nodes[1]?.pt.x).toBe(60);
  });

  it("clears a layer, and is the same glyph where there was nothing to clear", () => {
    const g = copyToLayer(letter(), BACKGROUND);
    expect(clearLayer(g, BACKGROUND).layers).toEqual({});
    const bare = letter();
    expect(clearLayer(bare, BACKGROUND)).toBe(bare);
  });
});

describe("the font's layers", () => {
  it("are added once, and never as the main drawing", () => {
    let document = addLayer(fontDocument([letter()]), BACKGROUND);
    document = addLayer(document, BACKGROUND);
    expect(document.layers.map((l) => l.name)).toEqual([BACKGROUND]);
    expect(layerProblem(document, BACKGROUND)).toBe("taken");
    expect(layerProblem(document, "public.default")).toBe("no-name");
    expect(layerProblem(document, " ")).toBe("no-name");
  });

  it("take every glyph's drawing with them when removed", () => {
    let document = addLayer(fontDocument([copyToLayer(letter(), BACKGROUND)]), BACKGROUND);
    document = removeLayer(document, BACKGROUND);
    expect(document.layers).toEqual([]);
    expect(document.glyphs["n"]?.layers).toEqual({});
  });

  it("follow a component's base when the glyph it places is renamed", () => {
    const placing = glyph("m", {
      layers: {
        [BACKGROUND]: {
          advance: 500,
          contours: [],
          components: [component(id(), "n")],
          anchors: [],
          guides: [],
          image: null,
          kept: [],
        },
      },
    });
    const renamed = renameGlyph(fontDocument([letter(), placing]), "n", "n.alt");
    expect(renamed?.glyphs["m"]?.layers[BACKGROUND]?.components[0]?.base).toBe("n.alt");
  });
});
