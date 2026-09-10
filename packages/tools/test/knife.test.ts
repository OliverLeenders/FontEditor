import {
  counterIds,
  fontDocument,
  glyph,
  orderedGlyphs,
  rectContour,
} from "@fonteditor/font-model";
import { vec } from "@fonteditor/geometry";
import type { ViewTransform } from "@fonteditor/view";
import { describe, expect, it } from "vitest";

import { pointerInput } from "../src/input.js";
import {
  cancel,
  knifeStroke,
  pointerDown,
  pointerLeave,
  pointerMove,
  pointerUp,
} from "../src/knife.js";
import { type EditorState, editorState } from "../src/state.js";

const VIEW: ViewTransform = { scale: 1, tx: 0, ty: 0 };
const ids = counterIds("kt");
const opts = { ids };

/** One square, so the cut has something plain to work on. */
function start(): EditorState {
  return editorState({
    document: fontDocument([
      glyph("a", {
        advance: 500,
        contours: [rectContour(ids, { minX: 0, minY: 0, maxX: 400, maxY: 400 })],
      }),
    ]),
    view: VIEW,
    activeTool: "knife",
  });
}

const stroke = (
  state: EditorState,
  from: { x: number; y: number },
  to: { x: number; y: number },
) => {
  let s = pointerDown(state, pointerInput(vec(from.x, from.y))).state;
  s = pointerMove(s, pointerInput(vec(to.x, to.y))).state;
  return pointerUp(s, pointerInput(vec(to.x, to.y)), opts);
};

const contoursOf = (s: EditorState) => orderedGlyphs(s.document)[0]!.contours;

describe("the knife tool", () => {
  it("cuts one shape into two", () => {
    const out = stroke(start(), { x: -50, y: 200 }, { x: 450, y: 200 });
    expect(contoursOf(out.state)).toHaveLength(2);
    expect(contoursOf(out.state).every((c) => c.closed)).toBe(true);
  });

  it("is one undo step", () => {
    const out = stroke(start(), { x: -50, y: 200 }, { x: 450, y: 200 });
    expect(out.effects.filter((e) => e.kind === "beginTransaction")).toHaveLength(1);
  });

  it("does nothing at all when the stroke misses", () => {
    const out = stroke(start(), { x: -50, y: 900 }, { x: 450, y: 900 });
    expect(contoursOf(out.state)).toHaveLength(1);
    // No transaction either: a stroke through empty space is not an edit.
    expect(out.effects.some((e) => e.kind === "beginTransaction")).toBe(false);
  });

  it("does nothing when the stroke stops inside the shape", () => {
    // One crossing is a graze. There is no honest pair of shapes to make from
    // it, so the glyph is left exactly as it was.
    const out = stroke(start(), { x: -50, y: 200 }, { x: 200, y: 200 });
    expect(contoursOf(out.state)).toHaveLength(1);
  });

  it("clears the selection, since nothing it pointed at survives the cut", () => {
    const before = start();
    const c = contoursOf(before)[0]!;
    const selected: EditorState = {
      ...before,
      selection: [{ contourId: c.id, nodeId: c.nodes[0]!.id, part: "point" }],
    };
    expect(pointerDown(selected, pointerInput(vec(0, 0))).state.selection).toEqual([]);
  });

  it("shows the stroke while it is being drawn, and not after", () => {
    let s = pointerDown(start(), pointerInput(vec(-50, 200))).state;
    s = pointerMove(s, pointerInput(vec(450, 200))).state;
    expect(knifeStroke(s)).toEqual([
      { x: -50, y: 200 },
      { x: 450, y: 200 },
    ]);

    expect(knifeStroke(pointerUp(s, undefined, opts).state)).toBeNull();
  });

  it("forgets the stroke on escape, leaving the glyph whole", () => {
    let s = pointerDown(start(), pointerInput(vec(-50, 200))).state;
    s = pointerMove(s, pointerInput(vec(450, 200))).state;
    const out = cancel(s).state;

    expect(out.knife).toBeNull();
    expect(contoursOf(out)).toHaveLength(1);
  });

  it("abandons the stroke when the pointer leaves", () => {
    let s = pointerDown(start(), pointerInput(vec(-50, 200))).state;
    s = pointerMove(s, pointerInput(vec(450, 200))).state;
    expect(pointerLeave(s).state.knife).toBeNull();
  });

  it("does not snap the stroke to anything", () => {
    // Snapping exists so a point lands where you meant it. A cut is not a point:
    // pulling the stroke onto whole units would move the cut off what was aimed
    // at, and the crossing is what matters, not the stroke's own ends.
    let s = pointerDown(start(), pointerInput(vec(-50.4, 200.7))).state;
    s = pointerMove(s, pointerInput(vec(450.3, 200.7))).state;
    expect(knifeStroke(s)).toEqual([
      { x: -50.4, y: 200.7 },
      { x: 450.3, y: 200.7 },
    ]);
  });
});

/**
 * What the stroke did, in the undo menu.
 *
 * Three things wear the knife now, and a history of four steps all called "Cut"
 * is one nobody can read backwards.
 */
describe("what the step is called", () => {
  it("calls a stroke that stopped in the ink an inserted point", () => {
    const out = stroke(start(), { x: -50, y: 200 }, { x: 200, y: 200 });
    expect(out.effects[0]).toMatchObject({ label: "Insert point" });
  });

  it("calls a stroke that went through an opened contour", () => {
    // Out of the square and beyond it: one crossing, ending in open air.
    const out = stroke(start(), { x: 200, y: 200 }, { x: 200, y: 900 });
    expect(out.effects[0]).toMatchObject({ label: "Open contour" });
  });

  it("still calls a cut a cut", () => {
    const out = stroke(start(), { x: -50, y: 200 }, { x: 500, y: 200 });
    expect(out.effects[0]).toMatchObject({ label: "Cut" });
  });
});
