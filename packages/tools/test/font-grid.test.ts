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

import { fitToWidth, scaleFontTo, setFixedWidth, setGrid } from "../src/commands/font.js";
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
