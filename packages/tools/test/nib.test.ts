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
import { keyDown, pointerDown, pointerUp } from "../src/dispatch.js";
import { keyInput, pointerInput } from "../src/input.js";
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

/** Every point of the given contours selected: the whole of each stroke. */
const everyPoint = (state: EditorState, ...which: number[]): EditorState => {
  const contours = state.document.glyphs["l"]!.contours;
  return {
    ...state,
    selection: which.flatMap((i) =>
      contours[i]!.nodes.map((n) => ({
        contourId: contours[i]!.id,
        nodeId: n.id,
        part: "point" as const,
      })),
    ),
  };
};

/** The pen at each point of a contour: its own, or the stroke's. */
const pensAt = (state: EditorState, i: number) => {
  const c = state.document.glyphs["l"]!.contours[i]!;
  return c.nodes.map((n) => n.pen ?? c.nib);
};

describe("changing the pen", () => {
  it("changes the thing typed at every selected point and leaves the other", () => {
    // Two strokes with different widths: a typed angle gives every point of both
    // that angle and leaves each its own width.
    const chosen = everyPoint(
      withContours(
        withNib(stroke(0), { angle: 30, width: 80 }),
        withNib(stroke(200), { angle: 30, width: 20 }),
      ),
      0,
      1,
    );
    const { state, effects } = changePen(chosen, { angle: 60 });

    expect(pensAt(state, 0)).toEqual([
      { angle: 60, width: 80 },
      { angle: 60, width: 80 },
    ]);
    expect(pensAt(state, 1)).toEqual([
      { angle: 60, width: 20 },
      { angle: 60, width: 20 },
    ]);
    expect(effects[0]).toMatchObject({ label: "Pen angle" });
  });

  it("changes only the points selected, so the pen blends along the stroke", () => {
    // The end of a stroke widened and the start left: the pen is set point by point
    // and changes from one to the other along the segment between them.
    const base = withContours(withNib(stroke(0), { angle: 30, width: 40 }));
    const c = base.document.glyphs["l"]!.contours[0]!;
    const end = {
      ...base,
      selection: [{ contourId: c.id, nodeId: c.nodes[1]!.id, part: "point" as const }],
    };
    const { state } = changePen(end, { width: 90 });

    expect(pensAt(state, 0)).toEqual([
      { angle: 30, width: 40 },
      { angle: 30, width: 90 },
    ]);
  });

  it("stores nothing at a point set back to its stroke's pen", () => {
    const base = withContours(withNib(stroke(0), { angle: 30, width: 40 }));
    const c = base.document.glyphs["l"]!.contours[0]!;
    const end = {
      ...base,
      selection: [{ contourId: c.id, nodeId: c.nodes[1]!.id, part: "point" as const }],
    };
    const widened = changePen(end, { width: 90 }).state;
    const back = changePen(widened, { width: 40 }).state;

    expect("pen" in back.document.glyphs["l"]!.contours[0]!.nodes[1]!).toBe(false);
  });

  it("remembers the pen set, for the next stroke drawn", () => {
    const chosen = everyPoint(withContours(withNib(stroke(0), { angle: 30, width: 80 })), 0);
    const { state } = changePen(chosen, { angle: 45 });
    expect(state.strokePen).toEqual({ angle: 45, width: 80 });
  });

  it("changes the thickness on its own, and says so", () => {
    const chosen = everyPoint(withContours(withNib(stroke(0), { angle: 30, width: 80 })), 0);
    const { state, effects } = changePen(chosen, { thickness: 20 });
    expect(pensAt(state, 0)).toEqual([
      { angle: 30, width: 80, thickness: 20 },
      { angle: 30, width: 80, thickness: 20 },
    ]);
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

  it("pastes the pens set at points", () => {
    const drawn = withNib(stroke(0), { angle: 30, width: 80 });
    const penned = {
      ...drawn,
      nodes: [drawn.nodes[0]!, { ...drawn.nodes[1]!, pen: { angle: 60, width: 40 } }],
    };
    const chosen = selecting(withContours(penned), 0);
    const pasted = parseClipboard(clipboardText(chosen)!, ids)!;
    expect(pasted[0]!.nodes.map((n) => n.pen)).toEqual([undefined, { angle: 60, width: 40 }]);
  });

  it("pastes an outline without a pen", () => {
    const chosen = selecting(withContours(stroke(0)), 0);
    const pasted = parseClipboard(clipboardText(chosen)!, ids)!;
    expect("nib" in pasted[0]!).toBe(false);
  });
});

describe("the stroke tool", () => {
  const click = (state: EditorState, x: number, y: number) =>
    pointerUp(pointerDown(state, pointerInput({ x, y }), { ids }).state).state;
  const drawn = (state: EditorState) => state.document.glyphs["l"]!.contours;

  it("is in hand on N", () => {
    expect(keyDown(withContours(), keyInput("n")).state.activeTool).toBe("stroke");
  });

  it("draws a stroke with the last pen set", () => {
    const start = { ...withContours(), activeTool: "stroke" as const };
    const set = { ...start, strokePen: { angle: 45, width: 50, thickness: 10 } };
    const after = click(click(set, 100, 0), 100, 300);

    expect(drawn(after)).toHaveLength(1);
    expect(drawn(after)[0]!.nib).toEqual({ angle: 45, width: 50, thickness: 10 });
    expect(drawn(after)[0]!.nodes).toHaveLength(2);
  });

  it("starts with the default pen before any is set", () => {
    const start = { ...withContours(), activeTool: "stroke" as const };
    expect(drawn(click(start, 100, 0))[0]!.nib).toEqual({ angle: 30, width: 80 });
  });

  it("leaves the pen tool drawing outlines", () => {
    const start = { ...withContours(), activeTool: "pen" as const };
    expect("nib" in drawn(click(start, 100, 0))[0]!).toBe(false);
  });
});
