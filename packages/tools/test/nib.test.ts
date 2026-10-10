import {
  type Contour,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
  strokeCutHandle,
  withNib,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { parseClipboard, clipboardText } from "../src/clipboard.js";
import { keyDown, pointerDown, pointerMove, pointerUp } from "../src/dispatch.js";
import { keyInput, pointerInput } from "../src/input.js";
import {
  changePen,
  drawWithPen,
  selectedPenBlend,
  selectedPenValue,
  selectedStrokeEnd,
  selectedStrokeEndShape,
  selectionNib,
  setPenBlend,
  setStrokeEnd,
  setStrokeEndShape,
} from "../src/commands/nib.js";
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
      nodes: [
        { ...drawn.nodes[0]!, blend: { angle: "ease", shape: "step" } as const },
        { ...drawn.nodes[1]!, pen: { angle: 60, width: 40 } },
      ],
    };
    const chosen = selecting(withContours(penned), 0);
    const pasted = parseClipboard(clipboardText(chosen)!, ids)!;
    expect(pasted[0]!.nodes.map((n) => n.pen)).toEqual([undefined, { angle: 60, width: 40 }]);
    expect(pasted[0]!.nodes[0]!.blend).toEqual({ angle: "ease", shape: "step" });
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

describe("blending the pen along a segment", () => {
  const pens = () => selecting(withContours(withNib(stroke(0), { angle: 30, width: 80 })), 0);
  const blendOf = (state: EditorState) => state.document.glyphs["l"]!.contours[0]!.nodes[0]!.blend;

  it("is linear until it is set", () => {
    expect(selectedPenBlend(pens(), "angle")).toBe("linear");
    expect(selectedPenBlend(pens(), "shape")).toBe("linear");
  });

  it("sets the angle and the shape each on its own", () => {
    const eased = setPenBlend(pens(), "shape", "ease").state;
    expect(blendOf(eased)).toEqual({ angle: "linear", shape: "ease" });
    expect(selectedPenBlend(eased, "angle")).toBe("linear");
    expect(selectedPenBlend(eased, "shape")).toBe("ease");
  });

  it("stores nothing once both are linear again", () => {
    const eased = setPenBlend(pens(), "shape", "ease").state;
    const back = setPenBlend(eased, "shape", "linear").state;
    expect(blendOf(back)).toBeUndefined();
  });

  it("says nothing of the last point of an open stroke, which starts no segment", () => {
    const state = pens();
    const c = state.document.glyphs["l"]!.contours[0]!;
    const last = {
      ...state,
      selection: [{ contourId: c.id, nodeId: c.nodes[1]!.id, part: "point" as const }],
    };
    expect(selectedPenBlend(last, "angle")).toBeNull();
  });

  it("passes over an outline", () => {
    const outline = selecting(withContours(stroke(0)), 0);
    expect(selectedPenBlend(outline, "angle")).toBeNull();
    expect(setPenBlend(outline, "angle", "smooth").state).toBe(outline);
  });
});

describe("cutting a stroke's end", () => {
  const penned = () => withContours(withNib(stroke(0), { angle: 30, width: 80 }));
  const selectingNode = (state: EditorState, index: number): EditorState => {
    const c = state.document.glyphs["l"]!.contours[0]!;
    return {
      ...state,
      selection: [{ contourId: c.id, nodeId: c.nodes[index]!.id, part: "point" as const }],
    };
  };
  const endOf = (state: EditorState, index: number) =>
    state.document.glyphs["l"]!.contours[0]!.nodes[index]!.end;

  it("is as the pen leaves it until it is set", () => {
    expect(selectedStrokeEnd(selectingNode(penned(), 0))).toBe("pen");
  });

  it("cuts the end selected and leaves the other", () => {
    const cut = setStrokeEnd(selectingNode(penned(), 1), 0).state;
    expect(endOf(cut, 1)).toEqual({ cut: 0 });
    expect(endOf(cut, 0)).toBeUndefined();
    expect(selectedStrokeEnd(cut)).toBe(0);
  });

  it("is switched off again, and then stores nothing", () => {
    const cut = setStrokeEnd(selectingNode(penned(), 1), "square").state;
    expect(endOf(cut, 1)).toEqual({ cut: "square" });
    const back = setStrokeEnd(cut, "pen").state;
    expect("end" in back.document.glyphs["l"]!.contours[0]!.nodes[1]!).toBe(false);
  });

  it("is one step in the history, and none where nothing changed", () => {
    const state = selectingNode(penned(), 1);
    expect(setStrokeEnd(state, "pen").state).toBe(state);
    expect(setStrokeEnd(state, 90).state).not.toBe(state);
  });

  it("says mixed of two ends that end differently", () => {
    const cut = setStrokeEnd(selectingNode(penned(), 1), 0).state;
    const c = cut.document.glyphs["l"]!.contours[0]!;
    const both = {
      ...cut,
      selection: c.nodes.map((n) => ({ contourId: c.id, nodeId: n.id, part: "point" as const })),
    };
    expect(selectedStrokeEnd(both)).toBe("mixed");
    expect(selectedStrokeEnd(setStrokeEnd(both, "square").state)).toBe("square");
  });

  it("says nothing of a point that is not an end, of a closed stroke, or of an outline", () => {
    const three = withContours(
      withNib(
        contour(ids.contour(), [
          node(ids.node(), { x: 0, y: 0 }),
          node(ids.node(), { x: 0, y: 150 }),
          node(ids.node(), { x: 0, y: 300 }),
        ]),
        { angle: 30, width: 80 },
      ),
    );
    expect(selectedStrokeEnd(selectingNode(three, 1))).toBeNull();
    expect(setStrokeEnd(selectingNode(three, 1), 0).state.document).toBe(three.document);

    const outline = selectingNode(withContours(stroke(0)), 0);
    expect(selectedStrokeEnd(outline)).toBeNull();
  });

  it("goes with a stroke copied and pasted", () => {
    const cut = setStrokeEnd(selectingNode(penned(), 1), 30).state;
    const pasted = parseClipboard(clipboardText(cut)!, ids)!;
    expect(pasted[0]!.nodes[1]!.end).toEqual({ cut: 30 });
  });
});

describe("turning a cut by its knob", () => {
  // A stem from the baseline up to 300, its top cut level and selected: the
  // line of the cut runs level through the top, and its knob is at the right
  // end of it, a little past the pen.
  const cutTop = (): EditorState => {
    const state = withContours(withNib(stroke(0), { angle: 30, width: 80 }));
    const c = state.document.glyphs["l"]!.contours[0]!;
    const top = {
      ...state,
      selection: [{ contourId: c.id, nodeId: c.nodes[1]!.id, part: "point" as const }],
    };
    return setStrokeEnd(top, 0).state;
  };
  const stemOf = (state: EditorState) => state.document.glyphs["l"]!.contours[0]!;
  const endOf = (state: EditorState) => stemOf(state).nodes[1]!.end;
  const dragKnobTo = (state: EditorState, x: number, y: number): EditorState => {
    const knob = strokeCutHandle(stemOf(state), "end")!.knob;
    const held = pointerDown(state, pointerInput(knob), { ids }).state;
    return pointerUp(pointerMove(held, pointerInput({ x, y }), { ids }).state).state;
  };

  it("has a knob beside the ink, on the line of the cut", () => {
    const handle = strokeCutHandle(stemOf(cutTop()), "end")!;
    expect(handle.through).toEqual({ x: 0, y: 300 });
    expect(handle.knob.y).toBeCloseTo(300, 9);
    // Half the pen and a little more.
    expect(handle.knob.x).toBeCloseTo(64, 9);
    // And none where the end is as the pen leaves it.
    expect(strokeCutHandle(stemOf(cutTop()), "start")).toBeNull();
  });

  it("turns the cut to where the knob is dragged, in whole degrees", () => {
    const turned = dragKnobTo(cutTop(), 60, 340);
    expect(endOf(turned)).toEqual({ cut: 34 });
    // The point itself has not moved, and is still what is selected.
    expect(stemOf(turned).nodes[1]!.pt).toEqual({ x: 0, y: 300 });
    expect(selectedStrokeEnd(turned)).toBe(34);
  });

  it("settles on level and upright when it is within a few degrees of them", () => {
    expect(endOf(dragKnobTo(dragKnobTo(cutTop(), 60, 340), 100, 303))).toEqual({ cut: 0 });
    expect(endOf(dragKnobTo(cutTop(), 3, 400))).toEqual({ cut: 90 });
  });

  it("settles on square where the path leans", () => {
    // Up and to the right at forty-five degrees: square is a hundred and thirty-five.
    const leaning = withContours(
      withNib(
        contour(ids.contour(), [
          node(ids.node(), { x: 0, y: 0 }),
          node(ids.node(), { x: 300, y: 300 }, { end: { cut: 0 } }),
        ]),
        { angle: 30, width: 80 },
      ),
    );
    const c = stemOf(leaning);
    const chosen = {
      ...leaning,
      selection: [{ contourId: c.id, nodeId: c.nodes[1]!.id, part: "point" as const }],
    };
    expect(endOf(dragKnobTo(chosen, 300 - 50, 300 + 52))).toEqual({ cut: "square" });
  });

  it("is one step in the history", () => {
    const before = cutTop();
    const held = pointerDown(before, pointerInput(strokeCutHandle(stemOf(before), "end")!.knob), {
      ids,
    });
    expect(held.state.gesture?.kind).toBe("dragStrokeCut");
  });

  it("has no knob to take hold of while the end is not selected", () => {
    const state = cutTop();
    const knob = strokeCutHandle(stemOf(state), "end")!.knob;
    const unselected = { ...state, selection: [] };
    expect(pointerDown(unselected, pointerInput(knob), { ids }).state.gesture?.kind).not.toBe(
      "dragStrokeCut",
    );
  });
});

describe("a pen's squareness", () => {
  const oval = () =>
    selecting(withContours(withNib(stroke(0), { angle: 30, width: 80, thickness: 20 })), 0);
  const all = (state: EditorState): EditorState => {
    const c = state.document.glyphs["l"]!.contours[0]!;
    return {
      ...state,
      selection: c.nodes.map((n) => ({ contourId: c.id, nodeId: n.id, part: "point" as const })),
    };
  };

  it("is none until it is set, and is then the stroke's when every point is selected", () => {
    expect(selectedPenValue(oval(), "squareness")).toBe(0);
    const boxed = changePen(all(oval()), { squareness: 0.5 }).state;
    expect(penOf(boxed, 0)).toEqual({ angle: 30, width: 80, thickness: 20, squareness: 0.5 });
    expect(selectedPenValue(boxed, "squareness")).toBe(0.5);
  });

  it("is not kept at nothing, an oval being written as it always was", () => {
    const boxed = changePen(all(oval()), { squareness: 0.5 }).state;
    const back = changePen(boxed, { squareness: 0 }).state;
    expect(penOf(back, 0)).toEqual({ angle: 30, width: 80, thickness: 20 });
  });

  it("is refused outside nought to one, and means nothing to a broad edge", () => {
    const state = all(oval());
    expect(changePen(state, { squareness: 1.5 }).state).toBe(state);
    expect(changePen(state, { squareness: -0.1 }).state).toBe(state);

    const broad = all(withContours(withNib(stroke(0), { angle: 30, width: 80 })));
    expect(penOf(changePen(broad, { squareness: 0.5 }).state, 0)).toEqual({ angle: 30, width: 80 });
  });

  it("goes with a stroke copied and pasted", () => {
    const boxed = changePen(all(oval()), { squareness: 0.75 }).state;
    const pasted = parseClipboard(clipboardText(boxed)!, ids)!;
    expect(pasted[0]!.nib).toEqual({ angle: 30, width: 80, thickness: 20, squareness: 0.75 });
  });
});

describe("changing the pen of a point that says other things", () => {
  it("leaves how the stroke ends there, and how the pen blends from it", () => {
    // A width typed for a whole stroke took the cut off its ends, and the
    // blend off its segments: both went with the point's own pen.
    const start = withContours(
      withNib(
        contour(ids.contour(), [
          node(ids.node(), { x: 0, y: 0 }, { blend: { angle: "linear", shape: "ease" } }),
          node(ids.node(), { x: 0, y: 300 }, { end: { cut: 0 } }),
        ]),
        { angle: 30, width: 80 },
      ),
    );
    const c = start.document.glyphs["l"]!.contours[0]!;
    const whole = {
      ...start,
      selection: c.nodes.map((n) => ({ contourId: c.id, nodeId: n.id, part: "point" as const })),
    };
    // One point given a pen of its own, then the whole stroke one pen again.
    const one = changePen({ ...whole, selection: [whole.selection[1]!] }, { width: 40 }).state;
    const after = changePen({ ...one, selection: whole.selection }, { width: 60 }).state;
    const nodes = after.document.glyphs["l"]!.contours[0]!.nodes;

    expect(penOf(after, 0)).toEqual({ angle: 30, width: 60 });
    expect(nodes.map((n) => n.pen)).toEqual([undefined, undefined]);
    expect(nodes[1]!.end).toEqual({ cut: 0 });
    expect(nodes[0]!.blend).toEqual({ angle: "linear", shape: "ease" });
  });
});

describe("what a cut end is closed with", () => {
  const stemState = () => withContours(withNib(stroke(0), { angle: 30, width: 80, thickness: 20 }));
  const atTop = (state: EditorState): EditorState => {
    const c = state.document.glyphs["l"]!.contours[0]!;
    return {
      ...state,
      selection: [{ contourId: c.id, nodeId: c.nodes[1]!.id, part: "point" as const }],
    };
  };
  const endOf = (state: EditorState) => state.document.glyphs["l"]!.contours[0]!.nodes[1]!.end;

  it("is nothing to say of an end that is not cut", () => {
    const state = atTop(stemState());
    expect(selectedStrokeEndShape(state)).toBeNull();
    expect(setStrokeEndShape(state, "nib").state).toBe(state);
  });

  it("is the cut itself until the pen's shape is asked for, and can be again", () => {
    const cut = setStrokeEnd(atTop(stemState()), 0).state;
    expect(selectedStrokeEndShape(cut)).toBe("straight");

    const shaped = setStrokeEndShape(cut, "nib").state;
    expect(endOf(shaped)).toEqual({ cut: 0, shape: "nib" });
    expect(selectedStrokeEndShape(shaped)).toBe("nib");

    const back = setStrokeEndShape(shaped, "straight").state;
    expect(endOf(back)).toEqual({ cut: 0 });
  });

  it("is kept when the cut is turned, by the row or by the knob", () => {
    const shaped = setStrokeEndShape(setStrokeEnd(atTop(stemState()), 0).state, "nib").state;
    expect(endOf(setStrokeEnd(shaped, "square").state)).toEqual({ cut: "square", shape: "nib" });

    const c = shaped.document.glyphs["l"]!.contours[0]!;
    const knob = strokeCutHandle(c, "end")!.knob;
    const held = pointerDown(shaped, pointerInput(knob), { ids }).state;
    const turned = pointerUp(
      pointerMove(held, pointerInput({ x: 60, y: 340 }), { ids }).state,
    ).state;
    expect(endOf(turned)).toEqual({ cut: 34, shape: "nib" });
  });

  it("goes with the cut when the cut is taken off", () => {
    const shaped = setStrokeEndShape(setStrokeEnd(atTop(stemState()), 0).state, "nib").state;
    expect(endOf(setStrokeEnd(shaped, "pen").state)).toBeUndefined();
  });
});
