import { translation, vec } from "@typewright/geometry";
import {
  BACKGROUND,
  addContour,
  contour,
  copyToLayer,
  fontDocument,
  glyph,
  node,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import {
  BOX_CENTRE,
  clearLayerAt,
  copyToLayerAt,
  currentGlyph,
  drawInLayer,
  removeLayerNamed,
  selectAllPoints,
  swapWithLayerAt,
  transformSelection,
} from "../src/index.js";
import { editorState } from "../src/state.js";

/**
 * The tools, pointed at a layer.
 *
 * Nothing about a tool knows layers exist: it reads the glyph and writes it
 * back through the state, and the state says which drawing. So one tool moving
 * points in the background, and the letter left exactly as it was, is the
 * whole of what there is to ask.
 */

let ids = 0;
const id = () => `t${String(++ids)}`;
const stem = (width: number) =>
  contour(id(), [node(id(), vec(0, 0)), node(id(), vec(width, 700))], true);

const state = () =>
  editorState({
    document: fontDocument([
      addContour(glyph("n", { advance: 500 }), stem(60)),
      addContour(glyph("o", { advance: 520 }), stem(80)),
    ]),
    view: { scale: 1, tx: 0, ty: 0 },
    currentGlyph: "n",
  });

describe("drawing in a layer", () => {
  it("adds the layer the first time, as a step of its own", () => {
    const out = drawInLayer(state(), BACKGROUND);
    expect(out.state.layer).toBe(BACKGROUND);
    expect(out.state.document.layers.map((l) => l.name)).toEqual([BACKGROUND]);
    expect(out.effects[0]).toMatchObject({ kind: "beginTransaction" });
  });

  it("is only a change of where the tools point once the layer is there", () => {
    const there = drawInLayer(state(), BACKGROUND).state;
    const back = drawInLayer(there, null);
    expect(back.effects).toEqual([]);
    const again = drawInLayer(back.state, BACKGROUND);
    expect(again.effects).toEqual([]);
    expect(again.state.document).toBe(back.state.document);
  });

  it("moves the layer's points and leaves the letter where it was", () => {
    let s = drawInLayer(state(), BACKGROUND).state;
    s = copyToLayerAt(s, ["n"], BACKGROUND).state;
    s = selectAllPoints(s).state;
    s = transformSelection(s, translation(15, 0), BOX_CENTRE, "Move").state;

    const letter = s.document.glyphs["n"]!;
    expect(letter.contours[0]?.nodes[1]?.pt.x).toBe(60);
    expect(letter.layers[BACKGROUND]?.contours[0]?.nodes[1]?.pt.x).toBe(75);
    expect(currentGlyph(s)?.contours[0]?.nodes[1]?.pt.x).toBe(75);
  });

  it("points back at the letter when the layer it was drawing in is removed", () => {
    const s = drawInLayer(state(), "sketch").state;
    const out = removeLayerNamed(s, "sketch");
    expect(out.state.layer).toBeNull();
    expect(out.state.document.layers).toEqual([]);
  });
});

describe("moving drawings for several glyphs", () => {
  it("copies, swaps and clears each glyph named, in one step each", () => {
    let s = state();
    const copied = copyToLayerAt(s, ["n", "o"], BACKGROUND);
    expect(copied.effects[0]).toMatchObject({ label: "Copy to background in 2 glyphs" });
    s = copied.state;
    expect(s.document.glyphs["o"]?.layers[BACKGROUND]?.advance).toBe(520);

    s = {
      ...s,
      document: {
        ...s.document,
        glyphs: {
          ...s.document.glyphs,
          n: copyToLayer(addContour(glyph("n", { advance: 600 }), stem(200)), BACKGROUND),
        },
      },
    };
    s = swapWithLayerAt(s, ["n"], BACKGROUND).state;
    expect(s.document.glyphs["n"]?.advance).toBe(600);

    s = clearLayerAt(s, ["n", "o"], BACKGROUND).state;
    expect(s.document.glyphs["n"]?.layers).toEqual({});
    expect(s.document.glyphs["o"]?.layers).toEqual({});
  });
});
