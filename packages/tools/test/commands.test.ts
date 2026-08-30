import { cross, distance, vec } from "@fonteditor/geometry";
import {
  type Contour,
  type FontDocument,
  type Glyph,
  addContour,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
  orderedGlyphs,
  segmentAt,
  segmentCount,
  sidebearings,
} from "@fonteditor/font-model";
import type { ViewTransform } from "@fonteditor/view";
import { describe, expect, it } from "vitest";

import {
  balanceSegmentAt,
  clearSelection,
  convertSegment,
  deleteSelectedPoints,
  insertPointOnSegment,
  nudgeSidebearing,
  nodeHvLocked,
  retractHandle,
  reverseContourAt,
  reverseSelectedContour,
  segmentParameterAt,
  selectAllPoints,
  setNodeHvLock,
  setPointType,
} from "../src/commands.js";
import { keyInput } from "../src/input.js";
import { keyDown } from "../src/select.js";
import { type EditorState, editorState } from "../src/state.js";

const firstGlyph = (d: FontDocument): Glyph => orderedGlyphs(d)[0]!;
const VIEW: ViewTransform = { scale: 1, tx: 0, ty: 0 };

/** A ring of four smooth nodes, every segment a well-formed curve. */
function ring(): Contour {
  const ids = counterIds();
  const k = 140;
  return contour(
    ids.contour(),
    [
      node(ids.node(), vec(0, 250), { type: "smooth", in: vec(-k, 250), out: vec(k, 250) }),
      node(ids.node(), vec(250, 0), { type: "smooth", in: vec(250, k), out: vec(250, -k) }),
      node(ids.node(), vec(0, -250), { type: "smooth", in: vec(k, -250), out: vec(-k, -250) }),
      node(ids.node(), vec(-250, 0), { type: "smooth", in: vec(-250, -k), out: vec(-250, k) }),
    ],
    true,
  );
}

/** A closed triangle of straight lines. */
function triangle(): Contour {
  const ids = counterIds("t");
  return contour(
    ids.contour(),
    [node(ids.node(), vec(0, 0)), node(ids.node(), vec(300, 0)), node(ids.node(), vec(150, 260))],
    true,
  );
}

function start(c: Contour = ring()): { s: EditorState; c: Contour } {
  return {
    s: editorState({
      document: fontDocument([addContour(glyph("o", { advance: 600 }), c)]),
      view: VIEW,
    }),
    c,
  };
}

const only = (s: EditorState) => firstGlyph(s.document).contours[0]!;
const nodeAt = (s: EditorState, i: number) => only(s).nodes[i]!;

const selectPoint = (s: EditorState, c: Contour, i: number): EditorState => ({
  ...s,
  selection: [{ contourId: c.id, nodeId: c.nodes[i]!.id, part: "point" }],
});

describe("point type", () => {
  it("changes one named point without touching the selection", () => {
    const { s, c } = start();
    const next = setPointType(s, "corner", { contourId: c.id, nodeId: c.nodes[0]!.id }).state;
    expect(nodeAt(next, 0).type).toBe("corner");
    expect(nodeAt(next, 1).type).toBe("smooth");
  });

  it("changes every selected point when no target is named", () => {
    const { s, c } = start();
    const selected: EditorState = {
      ...s,
      selection: [
        { contourId: c.id, nodeId: c.nodes[0]!.id, part: "point" },
        { contourId: c.id, nodeId: c.nodes[2]!.id, part: "point" },
      ],
    };
    const next = setPointType(selected, "corner").state;
    expect(nodeAt(next, 0).type).toBe("corner");
    expect(nodeAt(next, 1).type).toBe("smooth");
    expect(nodeAt(next, 2).type).toBe("corner");
  });

  it("does nothing with nothing selected", () => {
    const { s } = start();
    expect(setPointType(s, "corner").state).toBe(s);
  });
});

describe("locking handles to an axis", () => {
  // A lock that visibly changed nothing would read as broken, so switching it on
  // straightens the handles there and then.
  it("snaps a corner node's handles onto their nearer axis", () => {
    const ids = counterIds("k");
    const skewed = contour(
      ids.contour(),
      [
        node(ids.node(), vec(0, 0), { type: "corner", in: vec(-90, 20), out: vec(15, 80) }),
        node(ids.node(), vec(300, 0), { type: "corner", in: vec(240, 40) }),
      ],
      false,
    );
    const { s, c } = start(skewed);
    const next = setNodeHvLock(s, c.id, c.nodes[0]!.id, true).state;
    const n = nodeAt(next, 0);

    // Rotated, not projected: the direction is corrected and the length kept.
    // `in` was mostly horizontal, `out` mostly vertical, so they land on
    // different axes — which a corner node is free to do.
    expect(n.in!.y).toBe(0);
    expect(n.in!.x).toBeLessThan(0);
    expect(distance(n.pt, n.in!)).toBeCloseTo(distance(vec(0, 0), vec(-90, 20)), 9);

    expect(n.out!.x).toBe(0);
    expect(n.out!.y).toBeGreaterThan(0);
    expect(distance(n.pt, n.out!)).toBeCloseTo(distance(vec(0, 0), vec(15, 80)), 9);

    expect(n.hvLock).toBe(true);
  });

  // The case worth getting right: snapping each handle to its own nearer axis
  // would leave one pointing north and the other east, quietly making "smooth" a
  // lie about the geometry.
  it("keeps a smooth node smooth, putting both handles on one axis", () => {
    const ids = counterIds("m");
    const skewed = contour(
      ids.contour(),
      [
        node(ids.node(), vec(0, 0), { type: "smooth", in: vec(-30, -85), out: vec(20, 60) }),
        node(ids.node(), vec(300, 0), { type: "corner", in: vec(240, 40) }),
      ],
      false,
    );
    const { s, c } = start(skewed);
    const next = setNodeHvLock(s, c.id, c.nodes[0]!.id, true).state;
    const n = nodeAt(next, 0);

    const toIn = { x: n.in!.x - n.pt.x, y: n.in!.y - n.pt.y };
    const toOut = { x: n.out!.x - n.pt.x, y: n.out!.y - n.pt.y };

    expect(Math.abs(cross(toIn, toOut))).toBeLessThan(1e-9);
    expect(toIn.x * toOut.x + toIn.y * toOut.y).toBeLessThan(0);
    // …and on an axis: one component of each is zero.
    expect(toIn.x === 0 || toIn.y === 0).toBe(true);
    expect(toOut.x === 0 || toOut.y === 0).toBe(true);
  });

  it("preserves each handle's length while straightening it", () => {
    const ids = counterIds("n");
    const skewed = contour(
      ids.contour(),
      [
        node(ids.node(), vec(0, 0), { type: "smooth", in: vec(-30, -85), out: vec(20, 60) }),
        node(ids.node(), vec(300, 0)),
      ],
      false,
    );
    const { s, c } = start(skewed);
    const before = distance(vec(0, 0), vec(-30, -85));
    const next = setNodeHvLock(s, c.id, c.nodes[0]!.id, true).state;
    expect(distance(nodeAt(next, 0).pt, nodeAt(next, 0).in!)).toBeCloseTo(before, 9);
  });

  it("unlocks without moving anything", () => {
    const { s, c } = start();
    const locked = setNodeHvLock(s, c.id, c.nodes[0]!.id, true).state;
    const unlocked = setNodeHvLock(locked, c.id, c.nodes[0]!.id, false).state;
    expect(nodeHvLocked(unlocked, c.id, c.nodes[0]!.id)).toBe(false);
    expect(nodeAt(unlocked, 0).in).toEqual(nodeAt(locked, 0).in);
    expect(nodeAt(unlocked, 0).out).toEqual(nodeAt(locked, 0).out);
  });

  it("reports whether a node is locked", () => {
    const { s, c } = start();
    expect(nodeHvLocked(s, c.id, c.nodes[0]!.id)).toBe(false);
    const locked = setNodeHvLock(s, c.id, c.nodes[0]!.id, true).state;
    expect(nodeHvLocked(locked, c.id, c.nodes[0]!.id)).toBe(true);
  });
});

describe("reversing a contour", () => {
  it("walks the same points the other way", () => {
    const { s, c } = start();
    const next = reverseContourAt(s, c.id).state;
    expect(only(next).nodes.map((n) => n.id)).toEqual([
      c.nodes[0]!.id,
      c.nodes[3]!.id,
      c.nodes[2]!.id,
      c.nodes[1]!.id,
    ]);
  });

  // Node ids survive, so what was selected stays selected.
  it("leaves the selection intact", () => {
    const { s, c } = start();
    const selected = selectPoint(s, c, 1);
    const next = reverseContourAt(selected, c.id).state;
    expect(next.selection).toEqual(selected.selection);
  });

  it("finds the contour from the selection", () => {
    const { s, c } = start();
    const next = reverseSelectedContour(selectPoint(s, c, 2)).state;
    expect(only(next).nodes[1]!.id).toBe(c.nodes[3]!.id);
  });

  it("does nothing with nothing selected or focused", () => {
    const { s } = start();
    expect(reverseSelectedContour(s).state).toBe(s);
  });

  it("is its own inverse", () => {
    const { s, c } = start();
    const twice = reverseContourAt(reverseContourAt(s, c.id).state, c.id).state;
    expect(only(twice)).toEqual(only(s));
  });

  it("is reachable from the keyboard", () => {
    const { s, c } = start();
    const next = keyDown(selectPoint(s, c, 0), keyInput("r")).state;
    expect(only(next).nodes[1]!.id).toBe(c.nodes[3]!.id);
  });
});

describe("deleting points", () => {
  it("removes the selected ones", () => {
    const { s, c } = start();
    const next = deleteSelectedPoints(selectPoint(s, c, 1)).state;
    expect(only(next).nodes).toHaveLength(3);
    expect(next.selection).toEqual([]);
  });

  // Backspace on a handle should not remove the point carrying it, which is a
  // much larger edit than the one asked for.
  it("ignores handles in the selection", () => {
    const { s, c } = start();
    const handleSelected: EditorState = {
      ...s,
      selection: [{ contourId: c.id, nodeId: c.nodes[0]!.id, part: "out" }],
    };
    expect(deleteSelectedPoints(handleSelected).state).toBe(handleSelected);
  });

  it("is reachable from the keyboard", () => {
    const { s, c } = start();
    const next = keyDown(selectPoint(s, c, 1), keyInput("Backspace")).state;
    expect(only(next).nodes).toHaveLength(3);
  });
});

describe("handles and segments", () => {
  it("retracts one handle, leaving the other alone", () => {
    const { s, c } = start();
    const next = retractHandle(s, c.id, c.nodes[0]!.id, "out").state;
    expect(nodeAt(next, 0).out).toBeNull();
    expect(nodeAt(next, 0).in).not.toBeNull();
  });

  it("turns a curve into a line and back to the same shape", () => {
    const { s, c } = start();
    const ref = { contourId: c.id, segmentIndex: 0 };
    const asLine = convertSegment(s, ref, "line").state;
    expect(segmentAt(only(asLine), 0)!.kind).toBe("line");

    const asCurve = convertSegment(asLine, ref, "curve").state;
    expect(segmentAt(only(asCurve), 0)!.kind).toBe("curve");
    // Handles at the thirds: converting back does not invent a bulge.
    const restored = segmentAt(only(asCurve), 0)!;
    expect(distance(restored.out!, vec(250 / 3, 250 - 250 / 3))).toBeLessThan(1e-9);
  });

  it("inserts a point without changing the shape", () => {
    const { s, c } = start();
    const ref = { contourId: c.id, segmentIndex: 0 };
    const next = insertPointOnSegment(s, ref, 0.5, counterIds("x")).state;
    expect(only(next).nodes).toHaveLength(5);
    expect(segmentCount(only(next))).toBe(5);
  });

  it("finds where along a segment a click landed", () => {
    const { s, c } = start();
    const ref = { contourId: c.id, segmentIndex: 0 };
    const t = segmentParameterAt(s, ref, vec(180, 180));
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThan(0);
    expect(t!).toBeLessThan(1);
  });

  // Inserting at an end would duplicate a point rather than add one.
  it("refuses a parameter at the very ends", () => {
    const { s, c } = start();
    const ref = { contourId: c.id, segmentIndex: 0 };
    expect(segmentParameterAt(s, ref, vec(0, 250))).toBeNull();
    expect(segmentParameterAt(s, ref, vec(250, 0))).toBeNull();
  });

  it("balances a segment", () => {
    const { s, c } = start(triangle());
    // A straight segment has nothing to balance.
    expect(balanceSegmentAt(s, { contourId: c.id, segmentIndex: 0 }).state).toBe(s);
  });
});

describe("selection commands", () => {
  it("selects every on-curve point, and no handles", () => {
    const { s } = start();
    const next = selectAllPoints(s).state;
    expect(next.selection).toHaveLength(4);
    expect(next.selection.every((item) => item.part === "point")).toBe(true);
  });

  it("clears the selection", () => {
    const { s, c } = start();
    expect(clearSelection(selectPoint(s, c, 0)).state.selection).toEqual([]);
  });

  it("leaves an already-empty selection alone", () => {
    const { s } = start();
    expect(clearSelection(s).state).toBe(s);
  });
});

describe("transactions", () => {
  // Each is a single edit, so each opens and closes its own transaction, and
  // none of them coalesce — two reversals in a row should be two undos.
  it("wraps every command in one non-coalescing step", () => {
    const { s, c } = start();
    for (const outcome of [
      setPointType(s, "corner", { contourId: c.id, nodeId: c.nodes[0]!.id }),
      setNodeHvLock(s, c.id, c.nodes[0]!.id, true),
      reverseContourAt(s, c.id),
      retractHandle(s, c.id, c.nodes[0]!.id, "out"),
      convertSegment(s, { contourId: c.id, segmentIndex: 0 }, "line"),
    ]) {
      expect(outcome.effects).toHaveLength(2);
      expect(outcome.effects[0]).toMatchObject({ kind: "beginTransaction", coalesce: false });
      expect(outcome.effects[1]).toEqual({ kind: "commitTransaction" });
    }
  });

  it("emits nothing when a command declines", () => {
    const { s } = start();
    expect(setPointType(s, "corner").effects).toEqual([]);
    expect(reverseSelectedContour(s).effects).toEqual([]);
  });

  // Selection is not an edit, so it leaves no history behind.
  it("does not record a selection change", () => {
    const { s } = start();
    expect(selectAllPoints(s).effects).toEqual([]);
  });
});

describe("nudgeSidebearing", () => {
  const named = () => {
    const ids = counterIds();
    const c = contour(
      ids.contour(),
      [
        node(ids.node(), vec(100, 0)),
        node(ids.node(), vec(400, 0)),
        node(ids.node(), vec(400, 700)),
      ],
      true,
    );
    const document = fontDocument([
      glyph("n", { unicodes: [0x6e], advance: 500, contours: [c] }),
      glyph("space", { unicodes: [0x20], advance: 250 }),
    ]);
    return editorState({ document, view: { scale: 1, tx: 0, ty: 0 }, currentGlyph: "space" });
  };

  const bearings = (s: EditorState, name: string) => sidebearings(s.document.glyphs[name]!)!;

  it("moves the left bearing of a glyph that is not the current one", () => {
    const state = named();
    expect(state.currentGlyph).toBe("space");

    const { state: next } = nudgeSidebearing(state, "n", "left", 12);
    expect(bearings(next, "n").left).toBe(112);
    // The right bearing is held, so the advance moved with it.
    expect(bearings(next, "n").right).toBe(bearings(state, "n").right);
    expect(next.document.glyphs["n"]!.advance).toBe(512);
  });

  it("moves the right bearing by changing the advance alone", () => {
    const state = named();
    const { state: next } = nudgeSidebearing(state, "n", "right", -20);
    expect(bearings(next, "n").right).toBe(80);
    expect(bearings(next, "n").left).toBe(100);
    expect(next.document.glyphs["n"]!.advance).toBe(480);
  });

  it("accepts a negative bearing rather than clamping at zero", () => {
    const state = named();
    const { state: next } = nudgeSidebearing(state, "n", "left", -150);
    expect(bearings(next, "n").left).toBe(-50);
  });

  it("does nothing for a step of zero, and records no transaction", () => {
    const state = named();
    const out = nudgeSidebearing(state, "n", "left", 0);
    expect(out.state).toBe(state);
    expect(out.effects).toEqual([]);
  });

  it("declines on a glyph with no outline, leaving the document alone", () => {
    const state = named();
    const out = nudgeSidebearing(state, "space", "left", 10);
    expect(out.state.document).toBe(state.document);
  });

  it("declines on a glyph that is not there", () => {
    const state = named();
    expect(nudgeSidebearing(state, "missing", "left", 10).state.document).toBe(state.document);
  });

  it("labels the entry by side and glyph, so repeats coalesce and others do not", () => {
    const state = named();
    const left = nudgeSidebearing(state, "n", "left", 1).effects[0];
    const right = nudgeSidebearing(state, "n", "right", 1).effects[0];
    expect(left).toMatchObject({ label: "Left sidebearing of n" });
    expect(right).toMatchObject({ label: "Right sidebearing of n" });
  });
});
