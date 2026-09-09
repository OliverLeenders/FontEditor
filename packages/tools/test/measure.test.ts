import { counterIds, fontDocument, glyph, rectContour } from "@fonteditor/font-model";
import { vec } from "@fonteditor/geometry";
import type { ViewTransform } from "@fonteditor/view";
import { describe, expect, it } from "vitest";

import { pointerInput } from "../src/input.js";
import {
  cancel,
  pointerDown,
  pointerLeave,
  pointerMove,
  shownMeasurement,
} from "../src/measure.js";
import { type EditorState, editorState } from "../src/state.js";

const VIEW: ViewTransform = { scale: 1, tx: 0, ty: 0 };
const ids = counterIds("mt");

/** An upright stem 80 wide, so a reading across it is 80. */
function start(): EditorState {
  return editorState({
    document: fontDocument([
      glyph("l", {
        advance: 300,
        contours: [rectContour(ids, { minX: 100, minY: 0, maxX: 180, maxY: 700 })],
      }),
    ]),
    view: VIEW,
    activeTool: "measure",
  });
}

/**
 * Point inside the stem, near its left wall.
 *
 * Near rather than dead centre: the reach is in screen pixels, and at a scale of
 * one the middle of an eighty-wide stem is exactly forty units from either wall,
 * which is the boundary itself. At any real zoom it is well inside.
 */
const hover = (state: EditorState, x: number, y: number) =>
  pointerMove(state, pointerInput(vec(x, y))).state;

describe("the measure tool", () => {
  it("reads the stem's width from inside it", () => {
    const s = hover(start(), 120, 350);
    expect(shownMeasurement(s)?.distance).toBeCloseTo(80, 6);
  });

  it("reads nothing before the pointer has been anywhere", () => {
    expect(shownMeasurement(start())).toBeNull();
  });

  it("reads nothing from outside the shape", () => {
    // The normal points away from the ink, so there is nothing to measure.
    const s = hover(start(), 40, 350);
    expect(shownMeasurement(s)).toBeNull();
  });

  it("changes nothing about the glyph", () => {
    // The only tool here that edits nothing, so this is worth pinning down.
    const before = start();
    const s = hover(before, 120, 350);
    expect(s.document).toBe(before.document);
    expect(pointerDown(s, pointerInput(vec(120, 350))).state.document).toBe(before.document);
  });

  it("commits no undo step", () => {
    const s = hover(start(), 120, 350);
    expect(pointerDown(s, pointerInput(vec(120, 350))).effects).toEqual([]);
  });

  it("pins the reading on a click", () => {
    const s = pointerDown(hover(start(), 120, 350), pointerInput(vec(120, 350))).state;
    expect(s.measure).not.toBeNull();
    expect(s.measure?.distance).toBeCloseTo(80, 6);
  });

  it("keeps showing the pinned reading once the pointer has moved off", () => {
    // The point of pinning: the number stays while you go and do something.
    let s = pointerDown(hover(start(), 120, 350), pointerInput(vec(120, 350))).state;
    s = hover(s, 40, 350);
    expect(shownMeasurement(s)?.distance).toBeCloseTo(80, 6);
  });

  it("reads the gap to the letter beside it when it is pointing at neither", () => {
    // The stem runs 100 to 180 and the neighbour is placed 300 to the right, so
    // its own stem stands at 400 to 480 and the gap between the two is 220.
    const beside = [{ glyph: start().document.glyphs["l"]!, x: 300 }];
    const s = hover(start(), 250, 350);

    expect(shownMeasurement(s, { neighbours: beside })?.distance).toBeCloseTo(220, 6);
  });

  it("says nothing about the gap when the neighbours are not on screen", () => {
    // Turning them off turns the reading off with them: a number measured
    // against a letter that is not drawn has nothing beside it to explain it.
    const s = hover(start(), 250, 350);
    expect(shownMeasurement(s)).toBeNull();
  });

  it("still reads the stem when the pointer is on one, neighbours or not", () => {
    const beside = [{ glyph: start().document.glyphs["l"]!, x: 300 }];
    const s = hover(start(), 120, 350);

    expect(shownMeasurement(s, { neighbours: beside })?.distance).toBeCloseTo(80, 6);
  });

  it("pins a gap reading the same way it pins a stem", () => {
    const beside = [{ glyph: start().document.glyphs["l"]!, x: 300 }];
    const s = pointerDown(hover(start(), 250, 350), pointerInput(vec(250, 350)), {
      neighbours: beside,
    }).state;

    expect(s.measure?.distance).toBeCloseTo(220, 6);
    // And it stays without being handed the neighbours again, because a pinned
    // reading is a number that was taken rather than one being taken.
    expect(shownMeasurement(s)?.distance).toBeCloseTo(220, 6);
  });

  it("lets go of a pinned reading on a second click", () => {
    let s = pointerDown(hover(start(), 120, 350), pointerInput(vec(120, 350))).state;
    s = pointerDown(s, pointerInput(vec(120, 350))).state;
    expect(s.measure).toBeNull();
  });

  it("lets go on escape too", () => {
    const s = pointerDown(hover(start(), 120, 350), pointerInput(vec(120, 350))).state;
    expect(cancel(s).state.measure).toBeNull();
  });

  it("keeps a pinned reading when the pointer leaves the canvas", () => {
    const s = pointerDown(hover(start(), 120, 350), pointerInput(vec(120, 350))).state;
    expect(pointerLeave(s).state.measure).not.toBeNull();
  });

  it("forgets what it was hovering when the pointer leaves with nothing pinned", () => {
    const s = hover(start(), 120, 350);
    expect(pointerLeave(s).state.hoveredSegment).toBeNull();
  });
});
