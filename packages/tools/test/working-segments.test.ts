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

import {
  setWorkingPan,
  setWorkingTension,
  workingPan,
  workingSegmentCount,
  workingSegments,
  workingStatus,
  workingTension,
} from "../src/commands/contours.js";
import { type EditorState, editorState } from "../src/state.js";

/**
 * The segments the curve panel speaks for.
 *
 * One clicked curve is the old behaviour and still is; several selected curves
 * are the new one. What is asked here is which segments a selection covers, what
 * a field shows when they disagree, and that typing reaches all of them in one
 * step.
 */

const ids = counterIds("ws");
const VIEW: ViewTransform = { scale: 1, tx: 0, ty: 0 };

/**
 * One quarter turn, with handles of the given reach.
 *
 * The two handle lines have to cross for λ to mean anything — see
 * `TunniStatus` — so this leaves flat and arrives upright, crossing at the
 * corner. The reach over a hundred is the tension.
 */
function arc(reach: number, atY: number) {
  return contour(
    ids.contour(),
    [
      node(ids.node(), vec(0, atY), { out: vec(reach, atY) }),
      node(ids.node(), vec(100, atY + 100), { in: vec(100, atY + 100 - reach) }),
    ],
    false,
  );
}

/** A glyph with two curves in it, drawn with different tensions. */
function two(): { s: EditorState; a: ReturnType<typeof arc>; b: ReturnType<typeof arc> } {
  const a = arc(60, 0);
  const b = arc(30, 500);
  const drawn = addContour(addContour(glyph("s", { advance: 600 }), a), b);
  return { s: editorState({ document: fontDocument([drawn]), view: VIEW }), a, b };
}

/** Every point of the glyph, as a selection. */
function everything(s: EditorState): EditorState {
  const g = orderedGlyphs(s.document)[0]!;
  return {
    ...s,
    selection: g.contours.flatMap((c) =>
      c.nodes.map((n) => ({ contourId: c.id, nodeId: n.id, part: "point" as const })),
    ),
  };
}

describe("which segments the panel is about", () => {
  it("is the one that was clicked, when nothing is selected", () => {
    const { s, a } = two();
    const focused: EditorState = { ...s, focusedSegment: { contourId: a.id, segmentIndex: 0 } };

    expect(workingSegments(focused)).toEqual([{ contourId: a.id, segmentIndex: 0 }]);
  });

  it("is every segment the selection covers", () => {
    const { s, a, b } = two();
    expect(workingSegments(everything(s))).toEqual([
      { contourId: a.id, segmentIndex: 0 },
      { contourId: b.id, segmentIndex: 0 },
    ]);
  });

  it("leaves out a segment with only one end picked", () => {
    // Half a segment is not a segment: both ends have to be in the selection
    // before a field can claim to speak for it.
    const { s, a } = two();
    const half: EditorState = {
      ...s,
      selection: [{ contourId: a.id, nodeId: a.nodes[0]!.id, part: "point" }],
    };
    expect(workingSegments(half)).toEqual([]);
  });

  it("prefers the selection to a segment focused earlier", () => {
    const { s, a, b } = two();
    const both: EditorState = {
      ...everything(s),
      focusedSegment: { contourId: a.id, segmentIndex: 0 },
    };
    expect(workingSegmentCount(both)).toBe(2);
    expect(workingSegments(both)).toHaveLength(2);
    expect(workingSegments(both)[1]).toEqual({ contourId: b.id, segmentIndex: 0 });
  });
});

describe("what the fields show for several", () => {
  it("shows nothing where the segments disagree", () => {
    // Showing one of them would be picking a winner; an average would be a
    // number none of them has.
    const picked = everything(two().s);
    expect(workingSegmentCount(picked)).toBe(2);
    expect(workingTension(picked)).toBeNull();
  });

  it("shows the number where they all have it", () => {
    const picked = everything(two().s);
    const same = setWorkingTension(picked, 0.5).state;

    expect(workingTension({ ...same, selection: picked.selection })).toBeCloseTo(0.5, 9);
  });

  it("says the set is workable only when every one of them is", () => {
    // A straight segment has no tension, and a set holding one is not a set a
    // number can be typed into.
    const { a } = two();
    const line = contour(
      ids.contour(),
      [node(ids.node(), vec(0, 900)), node(ids.node(), vec(300, 900))],
      false,
    );
    const withLine = editorState({
      document: fontDocument([addContour(addContour(glyph("t", { advance: 600 }), a), line)]),
      view: VIEW,
    });

    expect(workingStatus(everything(withLine))).toBe("flat");
  });
});

describe("typing a number for several", () => {
  it("gives every one of them the same tension, in one step", () => {
    const picked = everything(two().s);
    const done = setWorkingTension(picked, 0.4);

    expect(workingTension({ ...done.state, selection: picked.selection })).toBeCloseTo(0.4, 9);
    // One transaction: begin and commit, not one pair per segment.
    expect(done.effects.filter((e) => e.kind === "beginTransaction")).toHaveLength(1);
  });

  it("leaves each one's lean alone while the tension changes", () => {
    const picked = everything(two().s);
    const leaning = setWorkingPan(picked, 0.3).state;
    const after = setWorkingTension({ ...leaning, selection: picked.selection }, 0.6).state;

    expect(workingPan({ ...after, selection: picked.selection })).toBeCloseTo(0.3, 6);
    expect(workingTension({ ...after, selection: picked.selection })).toBeCloseTo(0.6, 6);
  });

  it("gives every one of them the same pan", () => {
    const picked = everything(two().s);
    const panned = setWorkingPan(picked, -0.2).state;

    expect(workingPan({ ...panned, selection: picked.selection })).toBeCloseTo(-0.2, 6);
  });

  it("does nothing where there is nothing to work on", () => {
    const { s } = two();
    expect(setWorkingTension(s, 0.5).state).toBe(s);
    expect(workingTension(s)).toBeNull();
    expect(workingStatus(s)).toBeNull();
  });
});
