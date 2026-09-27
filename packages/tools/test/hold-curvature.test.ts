import {
  contour,
  counterIds,
  curvatureAround,
  ellipseContour,
  fontDocument,
  glyph,
  node,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { holdCurvatureInSelection, selectionHoldsCurvature } from "../src/commands/points.js";
import { type EditorState, editorState } from "../src/state.js";

const ids = counterIds("hold-cmd");
const VIEW = { scale: 1, tx: 0, ty: 0 };

/**
 * The switch that makes harmonising stay, as the inspector and the menu use it.
 *
 * The geometry is the model's and is tested there. What is asked here is the
 * three states a switch over a selection has to be able to show, and that pressing
 * it acts on every join that can hold its curvature and passes over the rest.
 */

/** A bowl with two joins between curves, and a corner where a line comes in. */
function bowl(): EditorState {
  const c = contour(
    ids.contour(),
    [
      node(ids.node(), { x: 0, y: 0 }, { out: { x: 40, y: 80 } }),
      node(ids.node(), { x: 150, y: 120 }, { in: { x: 100, y: 120 }, out: { x: 200, y: 120 } }),
      node(ids.node(), { x: 300, y: 0 }, { in: { x: 260, y: 20 } }),
    ],
    true,
  );
  return editorState({
    document: fontDocument([glyph("o", { advance: 600, contours: [c] })]),
    view: VIEW,
    currentGlyph: "o",
  });
}

const selecting = (state: EditorState, which: readonly number[]): EditorState => {
  const c = state.document.glyphs["o"]!.contours[0]!;
  return {
    ...state,
    selection: which.map((i) => ({
      contourId: c.id,
      nodeId: c.nodes[i]!.id,
      part: "point" as const,
    })),
  };
};

describe("what the switch shows", () => {
  it("is off for a join that could hold its curvature and does not", () => {
    expect(selectionHoldsCurvature(selecting(bowl(), [1]))).toBe(false);
  });

  it("is on once it has been pressed", () => {
    const chosen = selecting(bowl(), [1]);
    const after = holdCurvatureInSelection(chosen, true).state;
    expect(selectionHoldsCurvature(after)).toBe(true);
  });

  it("is neither for a selection with nothing that could hold anything", () => {
    // The first node is where a straight line comes in: there is nothing on that
    // side to agree with.
    expect(selectionHoldsCurvature(selecting(bowl(), [0]))).toBeNull();
  });

  it("is neither for a mixture", () => {
    // A circle, where every join is between two curves and so every one could
    // hold its curvature. One held and one not is a selection the switch cannot
    // honestly show as either.
    const circle = ellipseContour(ids, { minX: 0, minY: 0, maxX: 200, maxY: 200 });
    const state = editorState({
      document: fontDocument([glyph("o", { advance: 600, contours: [circle] })]),
      view: VIEW,
      currentGlyph: "o",
    });
    const one = holdCurvatureInSelection(selecting(state, [0]), true).state;
    expect(selectionHoldsCurvature(selecting(one, [0, 1]))).toBeNull();
  });
});

describe("pressing it", () => {
  it("harmonises the join and keeps it that way", () => {
    const chosen = selecting(bowl(), [1]);
    const { state } = holdCurvatureInSelection(chosen, true);
    const c = state.document.glyphs["o"]!.contours[0]!;
    const around = curvatureAround(c, c.nodes[1]!.id)!;
    expect(Math.abs(around.before - around.after)).toBeLessThan(1e-9);
    expect(c.nodes[1]!.harmonised).toBe(true);
  });

  it("is one undo step, named for what it did", () => {
    const { effects } = holdCurvatureInSelection(selecting(bowl(), [1]), true);
    expect(effects[0]).toMatchObject({ kind: "beginTransaction", label: "Hold curvature" });
    expect(effects[1]).toEqual({ kind: "commitTransaction" });
  });

  it("lets go with its own name", () => {
    const held = holdCurvatureInSelection(selecting(bowl(), [1]), true).state;
    const { effects } = holdCurvatureInSelection(held, false);
    expect(effects[0]).toMatchObject({ label: "Let go of curvature" });
  });

  it("does nothing, and says so, where nothing can hold anything", () => {
    const chosen = selecting(bowl(), [0]);
    const { state, effects } = holdCurvatureInSelection(chosen, true);
    expect(state).toBe(chosen);
    expect(effects).toEqual([]);
  });
});
