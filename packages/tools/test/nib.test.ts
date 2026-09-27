import {
  type Contour,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
  withNib,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { parseClipboard, clipboardText } from "../src/clipboard.js";
import { changePen, drawWithPen, selectionNib } from "../src/commands/nib.js";
import { type EditorState, editorState } from "../src/state.js";

const ids = counterIds("nib-cmd");
const VIEW = { scale: 1, tx: 0, ty: 0 };

/**
 * The Pen section's commands, and the pen going where the path goes.
 *
 * The ink is the model's business and is tested there. What is asked here is the
 * three things a panel over a selection has to be able to say, that switching the
 * pen on gives a mixed selection one pen, that a typed number changes only the
 * thing it names, and that a copied stroke pastes as a stroke.
 */

const stroke = (x: number): Contour =>
  contour(ids.contour(), [node(ids.node(), { x, y: 0 }), node(ids.node(), { x, y: 300 })]);

function withContours(...contours: Contour[]): EditorState {
  return editorState({
    document: fontDocument([glyph("l", { advance: 600, contours })]),
    view: VIEW,
    currentGlyph: "l",
  });
}

const selecting = (state: EditorState, ...which: number[]): EditorState => {
  const contours = state.document.glyphs["l"]!.contours;
  return {
    ...state,
    selection: which.map((i) => ({
      contourId: contours[i]!.id,
      nodeId: contours[i]!.nodes[0]!.id,
      part: "point" as const,
    })),
  };
};

const penOf = (state: EditorState, i: number) => state.document.glyphs["l"]!.contours[i]!.nib;

describe("what the section shows", () => {
  it("is nothing with nothing selected", () => {
    expect(selectionNib(withContours(stroke(0)))).toBeNull();
  });

  it("is none for an outline", () => {
    expect(selectionNib(selecting(withContours(stroke(0)), 0))).toBe("none");
  });

  it("is the pen for a stroke", () => {
    const state = selecting(withContours(withNib(stroke(0), { angle: 30, width: 80 })), 0);
    expect(selectionNib(state)).toEqual({ angle: 30, width: 80 });
  });

  it("is a mixture where the selection disagrees", () => {
    const state = selecting(
      withContours(withNib(stroke(0), { angle: 30, width: 80 }), stroke(200)),
      0,
      1,
    );
    expect(selectionNib(state)).toBe("mixed");
  });
});

describe("switching the pen on and off", () => {
  it("gives an outline the default pen", () => {
    const { state, effects } = drawWithPen(selecting(withContours(stroke(0)), 0), true);
    expect(penOf(state, 0)).toEqual({ angle: 30, width: 80 });
    expect(effects[0]).toMatchObject({ kind: "beginTransaction", label: "Draw with a pen" });
  });

  it("gives a mixed selection the pen the first of them has", () => {
    // A stem and a bar selected together should end up drawn with one pen, which
    // is the reason to have selected them together.
    const chosen = selecting(
      withContours(withNib(stroke(0), { angle: 45, width: 50 }), stroke(200)),
      0,
      1,
    );
    const { state } = drawWithPen(chosen, true);
    expect(penOf(state, 1)).toEqual({ angle: 45, width: 50 });
  });

  it("takes the pen away and leaves the path", () => {
    const chosen = selecting(withContours(withNib(stroke(0), { angle: 30, width: 80 })), 0);
    const { state, effects } = drawWithPen(chosen, false);
    expect(penOf(state, 0)).toBeUndefined();
    expect(state.document.glyphs["l"]!.contours[0]!.nodes).toHaveLength(2);
    expect(effects[0]).toMatchObject({ label: "Stop drawing with a pen" });
  });

  it("puts nothing in the history when nothing changes", () => {
    const chosen = selecting(withContours(stroke(0)), 0);
    const { state, effects } = drawWithPen(chosen, false);
    expect(state).toBe(chosen);
    expect(effects).toEqual([]);
  });
});

describe("changing the pen", () => {
  it("changes the thing typed and leaves the other", () => {
    // Two strokes with different widths: a typed angle gives both that angle and
    // leaves each its own width.
    const chosen = selecting(
      withContours(
        withNib(stroke(0), { angle: 30, width: 80 }),
        withNib(stroke(200), { angle: 30, width: 20 }),
      ),
      0,
      1,
    );
    const { state, effects } = changePen(chosen, { angle: 60 });

    expect(penOf(state, 0)).toEqual({ angle: 60, width: 80 });
    expect(penOf(state, 1)).toEqual({ angle: 60, width: 20 });
    expect(effects[0]).toMatchObject({ label: "Pen angle" });
  });

  it("changes the thickness on its own, and says so", () => {
    const chosen = selecting(withContours(withNib(stroke(0), { angle: 30, width: 80 })), 0);
    const { state, effects } = changePen(chosen, { thickness: 20 });
    expect(penOf(state, 0)).toEqual({ angle: 30, width: 80, thickness: 20 });
    expect(effects[0]).toMatchObject({ label: "Pen thickness" });
  });

  it("pastes an oval pen with its thickness", () => {
    const chosen = selecting(
      withContours(withNib(stroke(0), { angle: 30, width: 80, thickness: 20 })),
      0,
    );
    const pasted = parseClipboard(clipboardText(chosen)!, ids)!;
    expect(pasted[0]!.nib).toEqual({ angle: 30, width: 80, thickness: 20 });
  });

  it("passes over a contour with no pen", () => {
    const chosen = selecting(
      withContours(withNib(stroke(0), { angle: 30, width: 80 }), stroke(200)),
      0,
      1,
    );
    const { state } = changePen(chosen, { width: 40 });
    expect(penOf(state, 1)).toBeUndefined();
  });

  it("waits for a width that is a width", () => {
    const chosen = selecting(withContours(withNib(stroke(0), { angle: 30, width: 80 })), 0);
    expect(changePen(chosen, { width: -5 }).state).toBe(chosen);
  });
});

describe("the clipboard", () => {
  it("pastes a stroke as a stroke", () => {
    // A skeleton pasted without its pen would be a bare path that fills nothing.
    const chosen = selecting(withContours(withNib(stroke(0), { angle: 30, width: 80 })), 0);
    const pasted = parseClipboard(clipboardText(chosen)!, ids)!;
    expect(pasted[0]!.nib).toEqual({ angle: 30, width: 80 });
  });

  it("pastes a held join still held", () => {
    const held = contour(ids.contour(), [
      node(ids.node(), { x: 0, y: 0 }, { out: { x: 40, y: 80 } }),
      node(
        ids.node(),
        { x: 150, y: 120 },
        { in: { x: 100, y: 120 }, out: { x: 200, y: 120 }, harmonised: true },
      ),
      node(ids.node(), { x: 300, y: 0 }, { in: { x: 260, y: 20 } }),
    ]);
    const chosen = selecting(withContours(held), 0);
    const pasted = parseClipboard(clipboardText(chosen)!, ids)!;
    expect(pasted[0]!.nodes[1]!.harmonised).toBe(true);
    expect(pasted[0]!.nodes[0]!.harmonised).toBe(false);
  });

  it("pastes an outline without a pen", () => {
    const chosen = selecting(withContours(stroke(0)), 0);
    const pasted = parseClipboard(clipboardText(chosen)!, ids)!;
    expect("nib" in pasted[0]!).toBe(false);
  });
});
