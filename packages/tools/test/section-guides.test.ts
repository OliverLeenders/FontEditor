import { vec } from "@typewright/geometry";
import {
  addGuide,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
  setGuides,
  verticalGuide,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { shownSection } from "../src/section.js";
import { type EditorState, editorState } from "../src/state.js";

/**
 * The ruler on the canvas stops at the guides on the canvas — the font's and
 * the letter's own, since both are drawn and either is somewhere a designer
 * would measure to.
 */

const ids = counterIds("sg");

/** A crossing is the root of a cubic, so it is compared to within arithmetic. */
const round = (n: number): number => Math.round(n * 1e6) / 1e6 + 0;

function ruled(): EditorState {
  const bar = contour(
    ids.contour(),
    [vec(0, 0), vec(100, 0), vec(100, 700), vec(0, 700)].map((p) => node(ids.node(), p)),
    true,
  );
  const letter = addGuide(
    glyph("l", { advance: 600, contours: [bar] }),
    verticalGuide(ids.guide(), 300),
  );
  const document = setGuides(fontDocument([letter]), [verticalGuide(ids.guide(), 200)]);
  return {
    ...editorState({ document, view: { scale: 1, tx: 0, ty: 0 }, currentGlyph: "l" }),
    section: { from: vec(-50, 350), to: vec(400, 350), drawing: false },
  };
}

describe("the ruler and the guides on the canvas", () => {
  it("stops at the font's guides and the letter's", () => {
    const section = shownSection(ruled())!;

    expect(section.stops.map((s) => [s.kind, round(s.point.x)])).toEqual([
      ["outline", 0],
      ["outline", 100],
      ["guide", 200],
      ["guide", 300],
    ]);
    expect(section.spans.map((s) => round(s.distance))).toEqual([100, 100, 100]);
  });
});
