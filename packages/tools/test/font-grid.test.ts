import { vec } from "@typewright/geometry";
import {
  counterIds,
  fontDocument,
  glyph,
  rectContour,
  setFixedPitch,
  setGuides,
  sidebearings,
  verticalGuide,
} from "@typewright/font-model";
import type { ViewTransform } from "@typewright/view";
import { describe, expect, it } from "vitest";

import { placeContours } from "../src/clipboard.js";
import {
  fitToWidth,
  scaleFontTo,
  setFixedWidth,
  setGrid,
  setNameLigatures,
} from "../src/commands/font.js";
import { addDrawnGlyphs } from "../src/commands/glyphs.js";
import { nudgeSidebearing, setSidebearing } from "../src/commands/spacing.js";
import { pointerInput } from "../src/input.js";
import { pointerDown, pointerMove } from "../src/select.js";
import { type EditorState, editorState } from "../src/state.js";

/**
 * The font's grid and its fixed width, as the editing commands meet them: a
 * drag lands on the font's grid rather than on whole units, the commands that
 * set the two refuse what cannot be one, and a sidebearing in a fixed-width font
 * slides the drawing rather than changing the advance.
 */

const VIEW: ViewTransform = { scale: 1, tx: 0, ty: 0 };
const ids = counterIds("fg");

const box = (name: string, left: number, width: number, right: number) =>
  glyph(name, {
    advance: left + width + right,
    contours: [rectContour(ids, { minX: left, minY: 0, maxX: left + width, maxY: 700 })],
  });

const stateOf = (document: ReturnType<typeof fontDocument>, current = "n"): EditorState =>
  editorState({ document, view: VIEW, currentGlyph: current });

describe("a drag on the font's grid", () => {
  it("lands on the grid's step, where it lands on whole units without one", () => {
    const g = verticalGuide(ids.guide(), 320);
    const document = {
      ...setGuides(fontDocument([glyph("n", { advance: 1000 })]), [g]),
      grid: { step: 40, major: 0 },
    };
    let s = pointerDown(stateOf(document), pointerInput(vec(320, 400))).state;
    s = pointerMove(s, pointerInput(vec(345, 400))).state;
    expect(s.document.guides[0]?.pt.x).toBe(360);
  });
});

describe("setting the grid", () => {
  it("is one undo step, and refuses a step of nothing", () => {
    const s = stateOf(fontDocument([box("n", 40, 300, 50)]));
    const set = setGrid(s, 25, 4);
    expect(set.state.document.grid).toEqual({ step: 25, major: 4 });
    expect(setGrid(s, 0, 4).state).toBe(s);
    expect(setGrid(set.state, 25, 4).state).toBe(set.state);
  });
});

describe("a fixed width", () => {
  it("is said, then fitted to, as two steps", () => {
    const s = stateOf(fontDocument([box("n", 40, 300, 50), box("m", 20, 660, 20)]));
    const fixed = setFixedWidth(s, true, 600).state;
    expect(fixed.document.fixedWidth).toBe(600);
    expect(fixed.document.glyphs["m"]!.advance).toBe(700);

    const fitted = fitToWidth(fixed).state;
    expect(fitted.document.glyphs["m"]!.advance).toBe(600);
    expect(fitted.document.glyphs["n"]!.advance).toBe(600);
    expect(setFixedWidth(s, true, 0).state).toBe(s);
  });

  it("slides the drawing when a sidebearing is set or nudged, and keeps the advance", () => {
    const s = stateOf(setFixedPitch(fontDocument([box("n", 150, 300, 150)]), true, 600));

    const set = setSidebearing(s, "n", "left", 100).state.document.glyphs["n"]!;
    expect(set.advance).toBe(600);
    expect(sidebearings(set)).toEqual({ left: 100, right: 200 });

    const nudged = nudgeSidebearing(s, "n", "right", 10).state.document.glyphs["n"]!;
    expect(nudged.advance).toBe(600);
    expect(sidebearings(nudged)).toEqual({ left: 140, right: 160 });
  });

  it("leaves a proportional font's sidebearings as they always were", () => {
    const s = stateOf(fontDocument([box("n", 150, 300, 150)]));
    const set = setSidebearing(s, "n", "left", 100).state.document.glyphs["n"]!;
    expect(set.advance).toBe(550);
    expect(sidebearings(set)).toEqual({ left: 100, right: 150 });
  });
});

describe("glyphs and shapes that arrive drawn", () => {
  it("adds the glyphs the font has not got, and opens the first", () => {
    const s = stateOf(fontDocument([box("n", 40, 300, 60)]));
    const added = addDrawnGlyphs(s, [
      box("n", 0, 10, 0),
      box("home", 100, 800, 100),
      box("star", 0, 900, 100),
    ]);
    // The `n` that is there is not drawn over.
    expect(added.state.document.glyphs["n"]!.advance).toBe(400);
    expect(added.state.document.glyphOrder).toEqual(["n", "home", "star"]);
    expect(added.state.currentGlyph).toBe("home");
    expect(addDrawnGlyphs(s, [box("n", 0, 10, 0)]).state).toBe(s);
  });

  it("redraws the glyphs it is told to, in the same step, and only ones the font has", () => {
    const s = stateOf(fontDocument([box("n", 40, 300, 60), box("home", 100, 800, 100)]));
    const again = addDrawnGlyphs(
      s,
      [box("star", 0, 900, 100)],
      [box("home", 50, 500, 50), box("gone", 0, 10, 0)],
    );
    expect(again.state.document.glyphs["home"]!.advance).toBe(600);
    expect(again.state.document.glyphOrder).toEqual(["n", "home", "star"]);
    expect(again.state.document.glyphs["gone"]).toBeUndefined();
    // Something new to look at before something changed.
    expect(again.state.currentGlyph).toBe("star");
    expect(addDrawnGlyphs(s, [], [box("home", 50, 500, 50)]).state.currentGlyph).toBe("home");
  });

  it("puts contours into the glyph selected, and gives an empty glyph their width", () => {
    const shape = () => [rectContour(ids, { minX: 0, minY: 0, maxX: 500, maxY: 500 })];

    const empty = stateOf(fontDocument([glyph("n", { advance: 300 })]));
    const filled = placeContours(empty, shape(), "Place SVG", 960).state;
    expect(filled.document.glyphs["n"]!.advance).toBe(960);
    expect(filled.document.glyphs["n"]!.contours).toHaveLength(1);
    expect(filled.selection).toHaveLength(4);

    // A glyph with something in it keeps the width it was spaced at.
    const drawn = stateOf(fontDocument([box("n", 40, 300, 60)]));
    const more = placeContours(drawn, shape(), "Place SVG", 960).state;
    expect(more.document.glyphs["n"]!.advance).toBe(400);
    expect(more.document.glyphs["n"]!.contours).toHaveLength(2);
  });

  it("switches icons' names as ligatures on and off", () => {
    const s = stateOf(fontDocument([box("n", 40, 300, 60)]));
    const on = setNameLigatures(s, true).state;
    expect(on.document.nameLigatures).toBe(true);
    expect(setNameLigatures(on, true).state).toBe(on);
  });
});

describe("moving the font to another em", () => {
  it("scales the drawing with it, and refuses an em the font cannot have", () => {
    const s = stateOf(fontDocument([box("n", 40, 300, 60)]));
    const scaled = scaleFontTo(s, 2000).state.document;
    expect(scaled.info.unitsPerEm).toBe(2000);
    expect(scaled.glyphs["n"]!.advance).toBe(800);
    expect(scaleFontTo(s, 0).state).toBe(s);
    expect(scaleFontTo(s, 1000).state).toBe(s);
  });
});
