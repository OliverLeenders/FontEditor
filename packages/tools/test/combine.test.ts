import {
  type Contour,
  component,
  counterIds,
  fontDocument,
  glyph,
  placedComponent,
  rectContour,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { combineAt } from "../src/commands/combine.js";
import { selectedContourIds } from "../src/commands/overlap.js";
import { type EditorState, editorState } from "../src/state.js";

const ids = counterIds("set-cmd");
const VIEW = { scale: 1, tx: 0, ty: 0 };

/**
 * The three set operations as the interface asks for them.
 *
 * The geometry is tested in the model. What is asked here is the policy: the
 * selection is the tool, the rest is what it is applied to, the three ways of
 * doing nothing are told apart, and a component is never quietly drawn in — the
 * same rule the scoped union follows.
 */

/** A glyph of boxes, with a selection standing on the last of them. */
function withBoxes(...boxes: { minX: number; minY: number; maxX: number; maxY: number }[]) {
  const contours = boxes.map((b) => rectContour(ids, b));
  const state = editorState({
    document: fontDocument([glyph("a", { advance: 600, contours })]),
    view: VIEW,
    currentGlyph: "a",
  });
  return { state, contours };
}

const choosing = (state: EditorState, contours: readonly Contour[], chosen: number) => ({
  ...state,
  selection: [
    {
      contourId: contours[chosen]!.id,
      nodeId: contours[chosen]!.nodes[0]!.id,
      part: "point" as const,
    },
  ],
});

describe("subtracting the selection", () => {
  it("takes the selected shape out of the others", () => {
    const { state, contours } = withBoxes(
      { minX: 0, minY: 0, maxX: 300, maxY: 300 },
      { minX: 200, minY: 100, maxX: 500, maxY: 200 },
    );
    const chosen = choosing(state, contours, 1);

    const { outcome, result } = combineAt(
      chosen,
      "a",
      "subtract",
      selectedContourIds(chosen)!,
      ids,
    );

    expect(outcome).toMatchObject({ operation: "subtract" });
    const after = result.state.document.glyphs["a"]!;
    expect(after.contours).toHaveLength(1);
    // The tool is gone with the bite it took.
    expect(after.contours[0]!.nodes).toHaveLength(8);
  });

  it("is one undo step, named for the operation", () => {
    const { state, contours } = withBoxes(
      { minX: 0, minY: 0, maxX: 300, maxY: 300 },
      { minX: 200, minY: 100, maxX: 500, maxY: 200 },
    );
    const chosen = choosing(state, contours, 1);

    const { result } = combineAt(chosen, "a", "subtract", selectedContourIds(chosen)!, ids);

    expect(result.effects[0]).toMatchObject({ kind: "beginTransaction", label: "Subtract" });
    expect(result.effects[1]).toEqual({ kind: "commitTransaction" });
  });

  it("lets go of the selection it has replaced", () => {
    const { state, contours } = withBoxes(
      { minX: 0, minY: 0, maxX: 300, maxY: 300 },
      { minX: 200, minY: 100, maxX: 500, maxY: 200 },
    );
    const chosen = choosing(state, contours, 1);

    const { result } = combineAt(chosen, "a", "subtract", selectedContourIds(chosen)!, ids);

    expect(result.state.selection).toEqual([]);
  });
});

describe("the other two", () => {
  const overlapping = () => {
    const { state, contours } = withBoxes(
      { minX: 0, minY: 0, maxX: 300, maxY: 300 },
      { minX: 200, minY: 100, maxX: 500, maxY: 200 },
    );
    return choosing(state, contours, 1);
  };

  it("keeps what both cover", () => {
    const chosen = overlapping();
    const { outcome, result } = combineAt(
      chosen,
      "a",
      "intersect",
      selectedContourIds(chosen)!,
      ids,
    );

    expect(outcome).toMatchObject({ operation: "intersect" });
    expect(result.state.document.glyphs["a"]!.contours).toHaveLength(1);
  });

  it("keeps what only one covers", () => {
    const chosen = overlapping();
    const { outcome } = combineAt(chosen, "a", "exclude", selectedContourIds(chosen)!, ids);

    expect(outcome).toMatchObject({ operation: "exclude" });
  });
});

describe("the ways of doing nothing", () => {
  it("says shapes nowhere near each other are apart", () => {
    const { state, contours } = withBoxes(
      { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      { minX: 300, minY: 300, maxX: 400, maxY: 400 },
    );
    const chosen = choosing(state, contours, 1);

    const { outcome, result } = combineAt(
      chosen,
      "a",
      "subtract",
      selectedContourIds(chosen)!,
      ids,
    );

    expect(outcome).toBe("apart");
    expect(result.state).toBe(chosen);
  });

  it("declines rather than leaving an empty glyph", () => {
    const { state, contours } = withBoxes(
      { minX: 100, minY: 100, maxX: 200, maxY: 200 },
      { minX: 0, minY: 0, maxX: 400, maxY: 400 },
    );
    const chosen = choosing(state, contours, 1);

    const { outcome, result } = combineAt(
      chosen,
      "a",
      "subtract",
      selectedContourIds(chosen)!,
      ids,
    );

    expect(outcome).toBe("empty");
    expect(result.state).toBe(chosen);
  });

  it("says apart when the whole glyph was selected as the tool", () => {
    const { state, contours } = withBoxes(
      { minX: 0, minY: 0, maxX: 300, maxY: 300 },
      { minX: 200, minY: 100, maxX: 500, maxY: 200 },
    );
    const everything = {
      ...state,
      selection: contours.map((c) => ({
        contourId: c.id,
        nodeId: c.nodes[0]!.id,
        part: "point" as const,
      })),
    };

    expect(
      combineAt(everything, "a", "subtract", selectedContourIds(everything)!, ids).outcome,
    ).toBe("apart");
  });
});

describe("components", () => {
  it("are left alone, the way the scoped union leaves them", () => {
    // A bar drawn by reference, right across both shapes. A selection names
    // contours; turning a reference into outlines because something was drawn
    // over it is the whole-glyph union's decision to take, and it says so.
    const stem = rectContour(ids, { minX: 0, minY: 0, maxX: 300, maxY: 300 });
    const knife = rectContour(ids, { minX: 200, minY: 100, maxX: 500, maxY: 200 });
    const state = editorState({
      document: fontDocument([
        glyph("a", {
          advance: 600,
          contours: [stem, knife],
          components: [placedComponent(component(ids.component(), "bar.set"), 0, 120)],
        }),
        glyph("bar.set", {
          advance: 600,
          contours: [rectContour(ids, { minX: 0, minY: 0, maxX: 400, maxY: 60 })],
        }),
      ]),
      view: VIEW,
      currentGlyph: "a",
    });
    const chosen = {
      ...state,
      selection: [{ contourId: knife.id, nodeId: knife.nodes[0]!.id, part: "point" as const }],
    };

    const { result } = combineAt(chosen, "a", "subtract", selectedContourIds(chosen)!, ids);

    const after = result.state.document.glyphs["a"]!;
    expect(after.components).toHaveLength(1);
    expect(after.components[0]!.base).toBe("bar.set");
  });
});
