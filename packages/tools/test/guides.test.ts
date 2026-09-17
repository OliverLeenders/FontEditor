import { vec } from "@typewright/geometry";
import {
  type Guide,
  type GuideId,
  counterIds,
  fontDocument,
  glyph,
  horizontalGuide,
  setGuides,
  verticalGuide,
} from "@typewright/font-model";
import type { ViewTransform } from "@typewright/view";
import { describe, expect, it } from "vitest";

import { pointerInput } from "../src/input.js";
import { pointerDown, pointerMove } from "../src/select.js";
import { type EditorState, editorState } from "../src/state.js";

/**
 * Dragging a guide.
 *
 * A guide is placed against the drawing, so it snaps to the same lines
 * everything else does — but it must not snap to *itself*. The lines are rebuilt
 * from the document on every move, so a dragged guide's own line sits exactly
 * under the pointer and catches it: the guide then holds still until the pointer
 * has pulled a whole `stay` away, jumps to it, and catches itself again at the
 * new place. What that looks like in the hand is a guide moving in steps of ten
 * screen pixels, which could only be aligned by zooming in until ten pixels was
 * worth less than a unit.
 *
 * The view is the identity here, so a design unit is a screen pixel and the
 * tolerances can be read straight off: six units to catch, ten to let go.
 */

const VIEW: ViewTransform = { scale: 1, tx: 0, ty: 0 };

/** A letter with no outline, so nothing but the guides is under the pointer. */
function withGuides(...guides: readonly Guide[]): EditorState {
  const document = setGuides(fontDocument([glyph("n", { advance: 500 })]), guides);
  return editorState({ document, view: VIEW, currentGlyph: "n" });
}

const guideAt = (s: EditorState, id: GuideId): Guide => s.document.guides.find((g) => g.id === id)!;

describe("dragging a guide", () => {
  it("takes hold of the guide under the pointer", () => {
    const ids = counterIds();
    const g = verticalGuide(ids.guide(), 300);
    const state = pointerDown(withGuides(g), pointerInput(vec(300, 400))).state;
    expect(state.gesture?.kind).toBe("dragGuide");
  });

  it("follows the pointer a unit at a time rather than in jumps", () => {
    const ids = counterIds();
    const g = verticalGuide(ids.guide(), 300);

    let s = pointerDown(withGuides(g), pointerInput(vec(300, 400))).state;
    // One unit. This is the whole of the bug: the guide's own line used to catch
    // the pointer here and hold it, so the guide did not move at all.
    s = pointerMove(s, pointerInput(vec(301, 400))).state;
    expect(guideAt(s, g.id).pt.x).toBe(301);

    s = pointerMove(s, pointerInput(vec(305, 400))).state;
    expect(guideAt(s, g.id).pt.x).toBe(305);
  });

  it("moves a level guide the same way, up and down", () => {
    const ids = counterIds();
    const g = horizontalGuide(ids.guide(), 200);

    let s = pointerDown(withGuides(g), pointerInput(vec(250, 200))).state;
    s = pointerMove(s, pointerInput(vec(250, 203))).state;
    expect(guideAt(s, g.id).pt.y).toBe(203);
  });

  it("lands on whole units, because a font is written in them", () => {
    const ids = counterIds();
    const g = verticalGuide(ids.guide(), 300);

    let s = pointerDown(withGuides(g), pointerInput(vec(300, 400))).state;
    s = pointerMove(s, pointerInput(vec(305.7, 400))).state;
    expect(guideAt(s, g.id).pt.x).toBe(306);
  });

  // The exclusion is of one guide, not of snapping: everything a guide is
  // usually placed against still catches it.
  it("still catches another guide", () => {
    const ids = counterIds();
    const moving = verticalGuide(ids.guide(), 300);
    const still = verticalGuide(ids.guide(), 420);

    let s = pointerDown(withGuides(moving, still), pointerInput(vec(300, 400))).state;
    // Within the six units that catch, so it lands exactly on the other one.
    s = pointerMove(s, pointerInput(vec(417, 400))).state;
    expect(guideAt(s, moving.id).pt.x).toBe(420);
    // And the one it caught did not move.
    expect(guideAt(s, still.id).pt.x).toBe(420);
  });

  it("still catches the advance line", () => {
    const ids = counterIds();
    const g = verticalGuide(ids.guide(), 300);

    let s = pointerDown(withGuides(g), pointerInput(vec(300, 400))).state;
    s = pointerMove(s, pointerInput(vec(497, 400))).state;
    expect(guideAt(s, g.id).pt.x).toBe(500);
  });

  it("leaves the guide alone under ctrl, which turns snapping off entirely", () => {
    const ids = counterIds();
    const g = verticalGuide(ids.guide(), 300);

    let s = pointerDown(withGuides(g), pointerInput(vec(300, 400), { ctrl: true })).state;
    s = pointerMove(s, pointerInput(vec(305.7, 400), { ctrl: true })).state;
    // Not rounded either: ctrl means the coordinate is exactly what the cursor says.
    expect(guideAt(s, g.id).pt.x).toBeCloseTo(305.7, 10);
  });
});

/**
 * Letting a guide go.
 *
 * A guide stays picked so that the arrow keys nudge it and Backspace removes
 * it, which means there has to be a way of saying "not that one any more". The
 * obvious ones — click the empty canvas, drag a marquee across it — did
 * nothing, and the only way out was to pick something else.
 */
describe("letting a guide go", () => {
  const picked = (): EditorState => {
    const ids = counterIds();
    const g = verticalGuide(ids.guide(), 300);
    const state = pointerDown(withGuides(g), pointerInput(vec(300, 400))).state;
    expect(state.selectedGuide).toBe(g.id);
    return state;
  };

  it("lets go when the canvas is clicked where nothing is", () => {
    const after = pointerDown(picked(), pointerInput(vec(50, 50))).state;
    expect(after.selectedGuide).toBeNull();
    // And it is a marquee that began, so the same press can gather points.
    expect(after.gesture?.kind).toBe("marquee");
  });

  it("lets go when a marquee is dragged across the glyph", () => {
    let s = pointerDown(picked(), pointerInput(vec(50, 50))).state;
    s = pointerMove(s, pointerInput(vec(400, 600))).state;
    expect(s.selectedGuide).toBeNull();
  });

  it("keeps hold of a guide the pointer lands on", () => {
    const ids = counterIds();
    const first = verticalGuide(ids.guide(), 300);
    const second = horizontalGuide(ids.guide(), 100);
    let s = pointerDown(withGuides(first, second), pointerInput(vec(300, 400))).state;
    expect(s.selectedGuide).toBe(first.id);
    // The other guide, which is picked up instead of nothing being picked.
    s = pointerDown(s, pointerInput(vec(80, 100))).state;
    expect(s.selectedGuide).toBe(second.id);
  });
});
