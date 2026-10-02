import {
  type Contour,
  contourBounds,
  counterIds,
  fontDocument,
  glyph,
  rectContour,
} from "@typewright/font-model";
import type { Selection, ViewTransform } from "@typewright/view";
import { describe, expect, it } from "vitest";

import {
  alignSelection,
  canAlign,
  canDistribute,
  distributeSelection,
} from "../src/commands/align.js";
import { type EditorState, currentGlyph, editorState } from "../src/state.js";

/**
 * Lining things up and spacing them.
 *
 * Whole contours selected are shapes and move as shapes; anything less is
 * points, each moved alone. What they line up to is the box round them, or for
 * one shape alone the glyph's own box.
 */

const VIEW: ViewTransform = { scale: 1, tx: 0, ty: 0 };
const ids = counterIds("al");

const box = (minX: number, minY: number, maxX: number, maxY: number): Contour =>
  rectContour(ids, { minX, minY, maxX, maxY });

const all = (...contours: Contour[]): Selection =>
  contours.flatMap((c) =>
    c.nodes.map((n) => ({ contourId: c.id, nodeId: n.id, part: "point" as const })),
  );

const stateOf = (contours: Contour[], selection: Selection): EditorState =>
  editorState({
    document: fontDocument([glyph("icon", { advance: 1000, contours })]),
    view: VIEW,
    currentGlyph: "icon",
    selection,
  });

const boxes = (state: EditorState) => currentGlyph(state)!.contours.map((c) => contourBounds(c)!);

describe("lining up whole contours", () => {
  const a = box(100, 100, 300, 200);
  const b = box(400, 300, 500, 700);

  it("moves each as a shape, to the box round them all", () => {
    const s = stateOf([a, b], all(a, b));

    expect(boxes(alignSelection(s, "left").state).map((r) => r.minX)).toEqual([100, 100]);
    expect(boxes(alignSelection(s, "right").state).map((r) => r.maxX)).toEqual([500, 500]);
    expect(boxes(alignSelection(s, "top").state).map((r) => r.maxY)).toEqual([700, 700]);
    expect(boxes(alignSelection(s, "bottom").state).map((r) => r.minY)).toEqual([100, 100]);

    const centred = boxes(alignSelection(s, "centre").state);
    expect(centred.map((r) => (r.minX + r.maxX) / 2)).toEqual([300, 300]);
    // And keeps its size: a shape is moved, not stretched.
    expect(centred.map((r) => r.maxX - r.minX)).toEqual([200, 100]);
    const middled = boxes(alignSelection(s, "middle").state);
    expect(middled.map((r) => (r.minY + r.maxY) / 2)).toEqual([400, 400]);
  });

  it("leaves what is not selected where it is", () => {
    const c = box(800, 0, 900, 50);
    const s = stateOf([a, b, c], all(a, b));
    expect(boxes(alignSelection(s, "left").state)[2]).toEqual(contourBounds(c));
  });

  it("lines one shape up with the glyph's own box, which is how an icon is centred", () => {
    const s = stateOf([a], all(a));
    expect(canAlign(s)).toBe(true);
    // The advance is 1000, and the line runs from -250 to 750.
    const centred = boxes(alignSelection(alignSelection(s, "centre").state, "middle").state)[0]!;
    expect((centred.minX + centred.maxX) / 2).toBe(500);
    expect((centred.minY + centred.maxY) / 2).toBe(250);
    expect(boxes(alignSelection(s, "left").state)[0]!.minX).toBe(0);
    expect(boxes(alignSelection(s, "top").state)[0]!.maxY).toBe(750);
  });

  it("lands on whole units where the middle is between two", () => {
    const odd = box(0, 0, 101, 100);
    const even = box(300, 0, 400, 100);
    const s = stateOf([odd, even], all(odd, even));
    for (const r of boxes(alignSelection(s, "centre").state)) {
      expect(Number.isInteger(r.minX)).toBe(true);
    }
  });

  it("is one step, and nothing where everything is already in line", () => {
    const s = stateOf([a, b], all(a, b));
    const once = alignSelection(s, "left");
    expect(once.effects.map((e) => e.kind)).toEqual(["beginTransaction", "commitTransaction"]);
    expect(alignSelection(once.state, "left").state).toBe(once.state);
  });
});

describe("lining up points", () => {
  it("puts the points selected on one line, each moved alone", () => {
    const a = box(100, 100, 300, 200);
    const b = box(400, 300, 500, 700);
    // The left two of the first, and the lower left of the second.
    const selection: Selection = [
      { contourId: a.id, nodeId: a.nodes[0]!.id, part: "point" },
      { contourId: b.id, nodeId: b.nodes[0]!.id, part: "point" },
    ];
    const s = stateOf([a, b], selection);
    expect(canAlign(s)).toBe(true);

    const after = currentGlyph(alignSelection(s, "left").state)!.contours;
    const first = after[0]!.nodes[0]!.pt.x;
    expect(after[1]!.nodes[0]!.pt.x).toBe(first);
    // The contours they belong to are no longer the rectangles they were:
    // only the point moved.
    expect(contourBounds(after[1]!)!.maxX).toBe(500);
  });

  it("has nothing to do with one point", () => {
    const a = box(100, 100, 300, 200);
    const s = stateOf([a], [{ contourId: a.id, nodeId: a.nodes[0]!.id, part: "point" }]);
    expect(canAlign(s)).toBe(false);
    expect(alignSelection(s, "left").state).toBe(s);
  });
});

describe("spacing evenly", () => {
  it("keeps the first and the last, and makes the gaps between the same", () => {
    const a = box(0, 0, 100, 100);
    const b = box(150, 0, 350, 100);
    const c = box(700, 0, 800, 100);
    const s = stateOf([a, b, c], all(a, b, c));
    expect(canDistribute(s)).toBe(true);

    const spaced = boxes(distributeSelection(s, "across").state);
    expect(spaced[0]).toEqual(contourBounds(a));
    expect(spaced[2]).toEqual(contourBounds(c));
    // 800 across, 400 of it shapes: two gaps of 200.
    expect(spaced[1]!.minX - spaced[0]!.maxX).toBe(200);
    expect(spaced[2]!.minX - spaced[1]!.maxX).toBe(200);
  });

  it("does the same down the page", () => {
    const a = box(0, 0, 100, 100);
    const b = box(0, 120, 100, 220);
    const c = box(0, 600, 100, 700);
    const s = stateOf([a, b, c], all(a, b, c));
    const spaced = boxes(distributeSelection(s, "down").state);
    expect(spaced[1]!.minY - spaced[0]!.maxY).toBe(spaced[2]!.minY - spaced[1]!.maxY);
  });

  it("needs three things", () => {
    const a = box(0, 0, 100, 100);
    const b = box(150, 0, 350, 100);
    const s = stateOf([a, b], all(a, b));
    expect(canDistribute(s)).toBe(false);
    expect(distributeSelection(s, "across").state).toBe(s);
  });
});
