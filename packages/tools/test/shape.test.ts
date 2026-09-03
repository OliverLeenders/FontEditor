import { counterIds, fontDocument, glyph, glyphBounds, orderedGlyphs } from "@fonteditor/font-model";
import { vec } from "@fonteditor/geometry";
import type { ViewTransform } from "@fonteditor/view";
import { describe, expect, it } from "vitest";

import { pointerInput } from "../src/input.js";
import { cancel, pointerDown, pointerLeave, pointerMove, pointerUp, shapeRect } from "../src/shape.js";
import { type EditorState, editorState } from "../src/state.js";

const VIEW: ViewTransform = { scale: 1, tx: 0, ty: 0 };
const ids = counterIds("t");

/** An empty glyph, so whatever is drawn is the only thing in it. */
function start(tool: "rect" | "ellipse" = "rect"): EditorState {
  return editorState({
    document: fontDocument([glyph("a", { advance: 600 })]),
    view: VIEW,
    activeTool: tool,
  });
}

const opts = { ids, snap: false as const };

/** Press, drag and release, which is the whole of using either tool. */
function drag(
  state: EditorState,
  from: { x: number; y: number },
  to: { x: number; y: number },
  mods: { shift?: boolean; alt?: boolean } = {},
): EditorState {
  let s = pointerDown(state, pointerInput(vec(from.x, from.y), mods), opts).state;
  s = pointerMove(s, pointerInput(vec(to.x, to.y), mods), opts).state;
  return pointerUp(s, pointerInput(vec(to.x, to.y), mods), opts).state;
}

const only = (s: EditorState) => orderedGlyphs(s.document)[0]!.contours[0];

describe("the rectangle tool", () => {
  it("draws one from corner to corner", () => {
    const out = drag(start(), { x: 100, y: 0 }, { x: 400, y: 250 });
    expect(only(out)?.nodes).toHaveLength(4);
    expect(glyphBounds(orderedGlyphs(out.document)[0]!)).toEqual({
      minX: 100,
      minY: 0,
      maxX: 400,
      maxY: 250,
    });
  });

  it("draws the same rectangle dragged the other way", () => {
    // Up-and-left is a drag like any other; the box is what the two corners
    // describe, not the order they arrived in.
    const a = drag(start(), { x: 100, y: 0 }, { x: 400, y: 250 });
    const b = drag(start(), { x: 400, y: 250 }, { x: 100, y: 0 });
    expect(glyphBounds(orderedGlyphs(a.document)[0]!)).toEqual(
      glyphBounds(orderedGlyphs(b.document)[0]!),
    );
  });

  it("squares it off the longer side when shift is held", () => {
    const out = drag(start(), { x: 0, y: 0 }, { x: 300, y: 100 }, { shift: true });
    const box = glyphBounds(orderedGlyphs(out.document)[0]!)!;
    expect(box.maxX - box.minX).toBe(300);
    expect(box.maxY - box.minY).toBe(300);
  });

  it("treats the press as the centre when alt is held", () => {
    const out = drag(start(), { x: 200, y: 200 }, { x: 300, y: 250 }, { alt: true });
    expect(glyphBounds(orderedGlyphs(out.document)[0]!)).toEqual({
      minX: 100,
      minY: 150,
      maxX: 300,
      maxY: 250,
    });
  });

  it("selects what it just drew", () => {
    const out = drag(start(), { x: 0, y: 0 }, { x: 100, y: 100 });
    expect(out.selection).toHaveLength(4);
    expect(out.selection.every((i) => i.part === "point")).toBe(true);
  });

  it("is one undo step", () => {
    let s = pointerDown(start(), pointerInput(vec(0, 0)), opts).state;
    s = pointerMove(s, pointerInput(vec(100, 100)), opts).state;
    const out = pointerUp(s, pointerInput(vec(100, 100)), opts);
    expect(out.effects.filter((e) => e.kind === "beginTransaction")).toHaveLength(1);
  });

  it("draws nothing for a click that never became a drag", () => {
    // Four points on top of each other is not a rectangle, and is something to
    // find later rather than something anyone asked for.
    const out = drag(start(), { x: 100, y: 100 }, { x: 100, y: 100 });
    expect(orderedGlyphs(out.document)[0]!.contours).toHaveLength(0);
    expect(out.shape).toBeNull();
  });

  it("draws nothing for a drag with no height", () => {
    const out = drag(start(), { x: 100, y: 100 }, { x: 400, y: 100 });
    expect(orderedGlyphs(out.document)[0]!.contours).toHaveLength(0);
  });

  it("forgets the drag on escape, and leaves the glyph alone", () => {
    let s = pointerDown(start(), pointerInput(vec(0, 0)), opts).state;
    s = pointerMove(s, pointerInput(vec(100, 100)), opts).state;
    const out = cancel(s).state;

    expect(out.shape).toBeNull();
    expect(orderedGlyphs(out.document)[0]!.contours).toHaveLength(0);
  });

  it("abandons the drag when the pointer leaves", () => {
    let s = pointerDown(start(), pointerInput(vec(0, 0)), opts).state;
    s = pointerMove(s, pointerInput(vec(100, 100)), opts).state;
    expect(pointerLeave(s).state.shape).toBeNull();
  });
});

describe("the ellipse tool", () => {
  it("draws one in the box the drag describes", () => {
    const out = drag(start("ellipse"), { x: 100, y: 0 }, { x: 500, y: 300 });
    const c = only(out);

    expect(c?.nodes).toHaveLength(4);
    expect(c?.nodes.every((n) => n.type === "smooth")).toBe(true);
  });

  it("makes a circle when shift is held", () => {
    const out = drag(start("ellipse"), { x: 0, y: 0 }, { x: 200, y: 80 }, { shift: true });
    const box = glyphBounds(orderedGlyphs(out.document)[0]!)!;
    expect(box.maxX - box.minX).toBeCloseTo(box.maxY - box.minY, 6);
  });
});

describe("shapeRect", () => {
  const base = { kind: "rect" as const, even: false, fromCentre: false };

  it("gives nothing for a drag of no width", () => {
    expect(shapeRect({ ...base, from: vec(0, 0), to: vec(0, 100) })).toBeNull();
  });

  it("squares off the longer side, keeping the direction of travel", () => {
    // Dragging down and left must square down and left, not jump across the
    // press to the other quadrant.
    const box = shapeRect({ ...base, even: true, from: vec(0, 0), to: vec(-300, -100) })!;
    expect(box).toEqual({ minX: -300, minY: -300, maxX: 0, maxY: 0 });
  });
});
