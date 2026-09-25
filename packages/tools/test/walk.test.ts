import { vec } from "@typewright/geometry";
import {
  addContour,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
  orderedGlyphs,
} from "@typewright/font-model";
import type { ViewTransform } from "@typewright/view";
import { describe, expect, it } from "vitest";

import { stepSelection } from "../src/commands/walk.js";
import { keyInput } from "../src/input.js";
import { keyDown } from "../src/select.js";
import { type EditorState, editorState } from "../src/state.js";

/**
 * Walking a contour from the keyboard.
 *
 * The pointer is bad at going along a shape — points a few units apart, a handle
 * lying on its own point, a segment behind its Tunni controls — and this is the
 * keyboard being good at it. What is asked here is that a step lands on the
 * neighbour, that it comes round on a closed contour and stops on an open one,
 * and that stepping a segment keeps giving segments.
 */

const ids = counterIds("w");
const VIEW: ViewTransform = { scale: 1, tx: 0, ty: 0 };

/** A square, as four corners: four points and four segments. */
function square(closed = true) {
  return contour(
    ids.contour(),
    [
      node(ids.node(), vec(0, 0)),
      node(ids.node(), vec(100, 0)),
      node(ids.node(), vec(100, 100)),
      node(ids.node(), vec(0, 100)),
    ],
    closed,
  );
}

function start(closed = true): { s: EditorState; c: ReturnType<typeof square> } {
  const c = square(closed);
  return {
    s: editorState({
      document: fontDocument([addContour(glyph("a", { advance: 200 }), c)]),
      view: VIEW,
    }),
    c,
  };
}

const at = (s: EditorState, i: number): string =>
  orderedGlyphs(s.document)[0]!.contours[0]!.nodes[i]!.id;

const pickedId = (s: EditorState): string | undefined => s.selection[0]?.nodeId;

describe("stepping from a point", () => {
  it("lands on the next point along the contour", () => {
    const { s, c } = start();
    const picked: EditorState = {
      ...s,
      selection: [{ contourId: c.id, nodeId: at(s, 0), part: "point" }],
    };

    expect(pickedId(stepSelection(picked, 1).state)).toBe(at(s, 1));
  });

  it("goes back the other way", () => {
    const { s, c } = start();
    const picked: EditorState = {
      ...s,
      selection: [{ contourId: c.id, nodeId: at(s, 2), part: "point" }],
    };

    expect(pickedId(stepSelection(picked, -1).state)).toBe(at(s, 1));
  });

  it("comes round the end of a closed contour", () => {
    const { s, c } = start();
    const last: EditorState = {
      ...s,
      selection: [{ contourId: c.id, nodeId: at(s, 3), part: "point" }],
    };
    expect(pickedId(stepSelection(last, 1).state)).toBe(at(s, 0));

    const first: EditorState = {
      ...s,
      selection: [{ contourId: c.id, nodeId: at(s, 0), part: "point" }],
    };
    expect(pickedId(stepSelection(first, -1).state)).toBe(at(s, 3));
  });

  it("stops at the end of an open one", () => {
    // Coming round would read as having gone the other way, on a path that has
    // two ends and no way between them.
    const { s, c } = start(false);
    const last: EditorState = {
      ...s,
      selection: [{ contourId: c.id, nodeId: at(s, 3), part: "point" }],
    };

    expect(stepSelection(last, 1).state).toBe(last);
  });

  it("replaces the selection rather than adding to it", () => {
    const { s, c } = start();
    const picked: EditorState = {
      ...s,
      selection: [{ contourId: c.id, nodeId: at(s, 0), part: "point" }],
    };

    expect(stepSelection(picked, 1).state.selection).toHaveLength(1);
  });

  it("leaves a gathered selection alone", () => {
    // Several points is a set somebody made on purpose, and the arrows are not
    // where the decision to throw it away belongs.
    const { s, c } = start();
    const two: EditorState = {
      ...s,
      selection: [
        { contourId: c.id, nodeId: at(s, 0), part: "point" },
        { contourId: c.id, nodeId: at(s, 1), part: "point" },
      ],
    };

    expect(stepSelection(two, 1).state.selection).toEqual(two.selection);
  });

  it("starts at the first point when nothing is selected", () => {
    const { s } = start();
    expect(pickedId(stepSelection(s, 1).state)).toBe(at(s, 0));
  });
});

describe("stepping from a segment", () => {
  it("moves to the next segment and keeps its ends selected", () => {
    const { s, c } = start();
    const focused: EditorState = { ...s, focusedSegment: { contourId: c.id, segmentIndex: 0 } };

    const next = stepSelection(focused, 1).state;
    expect(next.focusedSegment).toEqual({ contourId: c.id, segmentIndex: 1 });
    expect(next.selection.map((item) => item.nodeId)).toEqual([at(s, 1), at(s, 2)]);
  });

  it("comes round the closed contour", () => {
    const { s, c } = start();
    const last: EditorState = { ...s, focusedSegment: { contourId: c.id, segmentIndex: 3 } };
    expect(stepSelection(last, 1).state.focusedSegment?.segmentIndex).toBe(0);
  });

  it("gives way to a single point that is selected", () => {
    // Clicking a point after clicking a curve leaves the segment focused; the
    // point is the newer answer to what the walk is on.
    const { s, c } = start();
    const both: EditorState = {
      ...s,
      focusedSegment: { contourId: c.id, segmentIndex: 0 },
      selection: [{ contourId: c.id, nodeId: at(s, 2), part: "point" }],
    };

    const next = stepSelection(both, 1).state;
    expect(pickedId(next)).toBe(at(s, 3));
    expect(next.focusedSegment).toBeNull();
  });
});

describe("the keys that do it", () => {
  it("walks on alt and an arrow, and nudges without it", () => {
    const { s, c } = start();
    const picked: EditorState = {
      ...s,
      selection: [{ contourId: c.id, nodeId: at(s, 0), part: "point" }],
    };

    const walked = keyDown(picked, keyInput("ArrowRight", { alt: true })).state;
    expect(pickedId(walked)).toBe(at(s, 1));
    expect(orderedGlyphs(walked.document)[0]!.contours[0]!.nodes[0]!.pt).toEqual(vec(0, 0));

    const nudged = keyDown(picked, keyInput("ArrowRight")).state;
    expect(pickedId(nudged)).toBe(at(s, 0));
    expect(orderedGlyphs(nudged.document)[0]!.contours[0]!.nodes[0]!.pt).toEqual(vec(1, 0));
  });

  it("still nudges up and down with alt, there being nowhere else to walk", () => {
    const { s, c } = start();
    const picked: EditorState = {
      ...s,
      selection: [{ contourId: c.id, nodeId: at(s, 0), part: "point" }],
    };

    const nudged = keyDown(picked, keyInput("ArrowUp", { alt: true })).state;
    expect(orderedGlyphs(nudged.document)[0]!.contours[0]!.nodes[0]!.pt).toEqual(vec(0, 1));
  });
});
