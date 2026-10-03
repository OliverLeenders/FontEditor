import {
  contour,
  contourBounds,
  counterIds,
  ellipseContour,
  fontDocument,
  glyph,
  insertNodeOnSegment,
  node,
  rectContour,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { offsetAt, simplifyAt } from "../src/commands/reshape.js";
import { selectedContourIds } from "../src/commands/overlap.js";
import { editorState } from "../src/state.js";

const ids = counterIds("reshape-cmd");
const VIEW = { scale: 1, tx: 0, ty: 0 };

/**
 * Offsetting and simplifying, as the interface asks for them.
 *
 * The geometry is tested in the model. What is asked here is the policy: the
 * selection scopes the work and leaves everything else alone, the union is taken
 * over what was offset so a fold does not survive as a crossing, and both say
 * plainly when there was nothing to do.
 */

const withContours = (...contours: ReturnType<typeof rectContour>[]) =>
  editorState({
    document: fontDocument([glyph("a", { advance: 600, contours })]),
    view: VIEW,
    currentGlyph: "a",
  });

describe("offsetting", () => {
  it("grows every contour when nothing is selected", () => {
    const state = withContours(
      rectContour(ids, { minX: 0, minY: 0, maxX: 100, maxY: 100 }),
      rectContour(ids, { minX: 300, minY: 0, maxX: 400, maxY: 100 }),
    );

    const { outcome, result } = offsetAt(state, "a", { x: 10, y: 10, join: "miter" }, null, ids);

    expect(outcome).toEqual({ kind: "offset", contours: 2 });
    const after = result.state.document.glyphs["a"]!;
    expect(contourBounds(after.contours[0]!)).toEqual({
      minX: -10,
      minY: -10,
      maxX: 110,
      maxY: 110,
    });
  });

  it("grows only what the selection named", () => {
    const first = rectContour(ids, { minX: 0, minY: 0, maxX: 100, maxY: 100 });
    const second = rectContour(ids, { minX: 300, minY: 0, maxX: 400, maxY: 100 });
    const state = withContours(first, second);
    const chosen = {
      ...state,
      selection: [{ contourId: second.id, nodeId: second.nodes[0]!.id, part: "point" as const }],
    };

    const { outcome, result } = offsetAt(
      chosen,
      "a",
      { x: 10, y: 10, join: "miter" },
      selectedContourIds(chosen),
      ids,
    );

    expect(outcome).toEqual({ kind: "offset", contours: 1 });
    const after = result.state.document.glyphs["a"]!;
    // The one nobody named is the very contour that was there.
    expect(after.contours[0]).toBe(first);
  });

  it("takes the union over what it offset, so a fold does not survive", () => {
    // A rectangle offset inwards by more than half its height has nowhere to go:
    // the sides pass through each other. What must not come back is a contour that
    // crosses itself.
    const thin = rectContour(ids, { minX: 0, minY: 0, maxX: 200, maxY: 30 });
    const state = withContours(thin);

    const { outcome, result } = offsetAt(state, "a", { x: -5, y: -5, join: "round" }, null, ids);

    expect(outcome).toMatchObject({ kind: "offset" });
    const after = result.state.document.glyphs["a"]!;
    const box = contourBounds(after.contours[0]!)!;
    expect(box.minY).toBeGreaterThanOrEqual(5 - 0.01);
    expect(box.maxY).toBeLessThanOrEqual(25 + 0.01);
  });

  it("is one undo step", () => {
    const state = withContours(rectContour(ids, { minX: 0, minY: 0, maxX: 100, maxY: 100 }));
    const { result } = offsetAt(state, "a", { x: 10, y: 10, join: "round" }, null, ids);

    expect(result.effects[0]).toMatchObject({ kind: "beginTransaction", label: "Offset" });
    expect(result.effects[1]).toEqual({ kind: "commitTransaction" });
  });

  it("says when there is nothing it can offset", () => {
    const state = withContours(rectContour(ids, { minX: 0, minY: 0, maxX: 100, maxY: 100 }));
    const { outcome, result } = offsetAt(state, "a", { x: 0, y: 0, join: "round" }, null, ids);

    expect(outcome).toBe("nothing");
    expect(result.state).toBe(state);
  });
});

describe("simplifying", () => {
  /** A circle with two points inserted along one of its quarters. */
  const withLitter = () => {
    const circle = ellipseContour(ids, { minX: 0, minY: 0, maxX: 200, maxY: 200 });
    let more = circle;
    for (const t of [0.35, 0.7]) {
      const next = insertNodeOnSegment(more, 0, t, ids);
      if (next !== null) more = next;
    }
    return editorState({
      document: fontDocument([glyph("a", { advance: 600, contours: [more] })]),
      view: VIEW,
      currentGlyph: "a",
    });
  };

  it("takes out the points that were not needed, and says how many", () => {
    const state = withLitter();
    const before = state.document.glyphs["a"]!.contours[0]!.nodes.length;

    const { outcome, result } = simplifyAt(state, "a", 1);

    expect(outcome).toEqual({ kind: "simplified", points: 2, extremes: 0 });
    expect(result.state.document.glyphs["a"]!.contours[0]!.nodes).toHaveLength(before - 2);
  });

  it("says so when every point is one the outline needs", () => {
    const state = withContours(rectContour(ids, { minX: 0, minY: 0, maxX: 100, maxY: 100 }));
    const { outcome, result } = simplifyAt(state, "a", 1);

    expect(outcome).toBe("nothing");
    expect(result.state).toBe(state);
  });

  it("lets go of a selection whose points it may have taken out", () => {
    const state = withLitter();
    const c = state.document.glyphs["a"]!.contours[0]!;
    const chosen = {
      ...state,
      selection: [{ contourId: c.id, nodeId: c.nodes[1]!.id, part: "point" as const }],
    };

    const { result } = simplifyAt(chosen, "a", 1, selectedContourIds(chosen));
    expect(result.state.selection).toEqual([]);
  });

  it("is one undo step, named for the operation", () => {
    const state = withLitter();
    const { result } = simplifyAt(state, "a", 1);

    expect(result.effects[0]).toMatchObject({ kind: "beginTransaction", label: "Simplify" });
  });
});

describe("tidying an outline", () => {
  it("takes out a point on top of another and adds the extreme a curve lacks, as one step", () => {
    const tidyIds = counterIds("tidy");
    // A D: an upright stem, and a bowl drawn as one curve whose furthest point
    // has no point of its own — and the top of the stem doubled.
    const d = contour(
      tidyIds.contour(),
      [
        node(tidyIds.node(), { x: 0, y: 0 }),
        node(tidyIds.node(), { x: 0, y: 400 }),
        node(tidyIds.node(), { x: 0, y: 400 }, { out: { x: 300, y: 400 } }),
        node(tidyIds.node(), { x: 0, y: 0 }, { in: { x: 300, y: 0 } }),
      ],
      true,
    );
    const state = editorState({
      document: fontDocument([glyph("D", { advance: 400, contours: [d] })]),
      view: { scale: 1, tx: 0, ty: 0 },
      currentGlyph: "D",
    });

    const { outcome, result: done } = simplifyAt(state, "D", 1, null, tidyIds);
    if (outcome === "nothing" || outcome.kind !== "simplified") throw new Error("nothing done");
    expect(outcome.extremes).toBe(1);
    expect(done.effects.map((e) => e.kind)).toEqual(["beginTransaction", "commitTransaction"]);

    const tidied = done.state.document.glyphs["D"]!.contours[0]!;
    const places = tidied.nodes.map((n) => `${String(n.pt.x)},${String(n.pt.y)}`);
    // No two points in one place, and one at the bowl's furthest reach.
    expect(new Set(places).size).toBe(places.length);
    const furthest = Math.max(...tidied.nodes.map((n) => n.pt.x));
    expect(furthest).toBeCloseTo(contourBounds(tidied)!.maxX, 3);
  });

  it("says nothing was done to an outline that is already tidy", () => {
    const state = editorState({
      document: fontDocument([
        glyph("o", {
          advance: 400,
          contours: [rectContour(counterIds("t"), { minX: 0, minY: 0, maxX: 100, maxY: 100 })],
        }),
      ]),
      view: { scale: 1, tx: 0, ty: 0 },
      currentGlyph: "o",
    });
    expect(simplifyAt(state, "o", 1).outcome).toBe("nothing");
  });
});
