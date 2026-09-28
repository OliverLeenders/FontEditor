import { vec } from "@typewright/geometry";
import {
  type Contour,
  addContour,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { clipboardText, parseClipboard } from "../src/clipboard.js";
import { changeContinuous, selectedContinuous, setContinuous } from "../src/commands/corners.js";
import { pointerInput } from "../src/input.js";
import { pointerDown, pointerMove, pointerUp } from "../src/select.js";
import { type EditorState, editorState } from "../src/state.js";

const ids = counterIds("corners");

/**
 * The commands behind the Point section's continuous corner, the clipboard, and
 * the drag that sets a corner's size on the canvas.
 */

/** A square 400 across, drawn from the origin. */
const square = (): Contour =>
  contour(
    ids.contour(),
    [
      node(ids.node(), vec(0, 0)),
      node(ids.node(), vec(400, 0)),
      node(ids.node(), vec(400, 400)),
      node(ids.node(), vec(0, 400)),
    ],
    true,
  );

function with_(c: Contour, ...selected: number[]): EditorState {
  return {
    ...editorState({
      document: fontDocument([addContour(glyph("o", { advance: 400 }), c)]),
      view: { scale: 1, tx: 0, ty: 0 },
    }),
    selection: selected.map((i) => ({
      contourId: c.id,
      nodeId: c.nodes[i]!.id,
      part: "point" as const,
    })),
  };
}

const drawn = (s: EditorState) => s.document.glyphs["o"]!.contours[0]!;

describe("making a corner continuous", () => {
  it("offers nothing where no selected point could be rounded", () => {
    const open = contour(ids.contour(), [
      node(ids.node(), vec(0, 0)),
      node(ids.node(), vec(100, 0)),
    ]);
    expect(selectedContinuous(with_(open, 0))).toBeNull();
  });

  it("rounds a corner a quarter of its shorter side, and makes it sharp again", () => {
    const state = with_(square(), 0);
    expect(selectedContinuous(state)).toEqual({ on: false, size: null, smoothness: null });

    const rounded = setContinuous(state, true).state;
    expect(drawn(rounded).nodes[0]!.continuous).toEqual({ size: 100, smoothness: 0.6 });
    expect(selectedContinuous(rounded)).toEqual({ on: true, size: 100, smoothness: 0.6 });

    const sharp = setContinuous(rounded, false).state;
    expect("continuous" in drawn(sharp).nodes[0]!).toBe(false);
  });

  it("changes the size or the smoothness on its own", () => {
    const rounded = setContinuous(with_(square(), 0, 1), true).state;
    const bigger = changeContinuous(rounded, { size: 150 }).state;
    expect(drawn(bigger).nodes[0]!.continuous).toEqual({ size: 150, smoothness: 0.6 });
    expect(drawn(bigger).nodes[1]!.continuous).toEqual({ size: 150, smoothness: 0.6 });
    const plain = changeContinuous(bigger, { smoothness: 0 }).state;
    expect(drawn(plain).nodes[0]!.continuous).toEqual({ size: 150, smoothness: 0 });
  });

  it("waits for a size above nothing and a smoothness between nought and one", () => {
    const rounded = setContinuous(with_(square(), 0), true).state;
    expect(changeContinuous(rounded, { size: 0 }).state).toBe(rounded);
    expect(changeContinuous(rounded, { smoothness: 1.5 }).state).toBe(rounded);
  });

  it("shows a mixture where the corners differ", () => {
    const rounded = setContinuous(with_(square(), 0), true).state;
    const both = { ...rounded, selection: with_(drawn(rounded), 0, 1).selection };
    expect(selectedContinuous(both)!.on).toBe("mixed");
  });

  it("is pasted still continuous", () => {
    const rounded = setContinuous(with_(square(), 0), true).state;
    const pasted = parseClipboard(clipboardText(rounded)!, ids)!;
    expect(pasted[0]!.nodes[0]!.continuous).toEqual({ size: 100, smoothness: 0.6 });
  });
});

describe("dragging a corner's size", () => {
  it("sets the size to where along the side the end is dragged", () => {
    const rounded = setContinuous(with_(square(), 0), true).state;
    // The round's end on the bottom side is 100 along it; drag it out to 160.
    let s = pointerDown(rounded, pointerInput(vec(100, 0))).state;
    expect(s.gesture?.kind).toBe("dragCornerSize");
    s = pointerMove(s, pointerInput(vec(160, 8))).state;
    s = pointerUp(s).state;
    expect(drawn(s).nodes[0]!.continuous!.size).toBe(160);
  });

  it("offers no end to drag on a corner that is not selected", () => {
    const rounded = setContinuous(with_(square(), 0), true).state;
    const none = { ...rounded, selection: [] };
    const s = pointerDown(none, pointerInput(vec(100, 0))).state;
    expect(s.gesture?.kind).not.toBe("dragCornerSize");
  });
});
