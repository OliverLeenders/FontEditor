import {
  IDENTITY_AFFINE,
  cross,
  distance,
  rotation,
  scaling,
  skewing,
  translation,
  vec,
} from "@fonteditor/geometry";
import {
  type Contour,
  type FontDocument,
  type Kerning,
  EMPTY_KERNING,
  type Glyph,
  addContour,
  contour,
  counterIds,
  fontDocument,
  groupKey,
  kernPairCount,
  setKern,
  setKernGroup,
  setKerning,
  glyph,
  node,
  orderedGlyphs,
  segmentAt,
  addAnchor,
  anchor,
  rectContour,
  segmentCount,
  sidebearings,
  component,
} from "@fonteditor/font-model";
import { type ViewTransform, boxHandlePoint } from "@fonteditor/view";
import { describe, expect, it } from "vitest";

import {
  BOX_CENTRE,
  addKernGroup,
  breakOutKern,
  nudgeKern,
  addAnchorAt,
  addComponent,
  harmoniseSelection,
  nodeCanHarmonise,
  selectedCurvature,
  attachComponent,
  attachmentFor,
  balanceSegmentAt,
  decomposeCurrentGlyph,
  deleteSelectedComponent,
  moveComponentTo,
  removeComponent,
  deleteSelectedAnchor,
  freeAnchorName,
  moveAnchorToPoint,
  removeAnchorAt,
  renameAnchorTo,
  focusedSegmentScales,
  focusedSegmentStatus,
  holdSegmentTension,
  selectedNode,
  setSegmentTension,
  deleteKernGroup,
  kernGroupHolding,
  kernGroupPairs,
  kernGroupProblem,
  kerningFor,
  putGlyphInKernGroup,
  renameKernGroupTo,
  takeGlyphFromKernGroup,
  clearSelection,
  convertSegment,
  deleteSelectedPoints,
  createGlyphs,
  deleteGlyph,
  insertPointOnSegment,
  moveCoordinateTo,
  nudgeSidebearing,
  nodeHvLocked,
  renameCurrentGlyph,
  renameRefusal,
  retractHandle,
  reverseContourAt,
  infoProblem,
  overlapAt,
  roundCoordinates,
  setInfo,
  roundGlyphAt,
  roundSelection,
  unroundedSelected,
  reverseSelectedContour,
  segmentParameterAt,
  selectAllPoints,
  selectedCoordinate,
  setNodeHvLock,
  setPointType,
  transformOriginPoint,
  transformSelection,
  unroundedCount,
} from "../src/commands/index.js";
import { keyInput } from "../src/input.js";
import { keyDown, selectionBox } from "../src/select.js";
import { type EditorState, boxAngle, editorState } from "../src/state.js";

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
    const next = setNodeHvLock(s, c.id, c.nodes[0]!.id, "both", true).state;
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

    expect(n.hvLock).toEqual({ in: true, out: true });
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
    const next = setNodeHvLock(s, c.id, c.nodes[0]!.id, "both", true).state;
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
    const next = setNodeHvLock(s, c.id, c.nodes[0]!.id, "both", true).state;
    expect(distance(nodeAt(next, 0).pt, nodeAt(next, 0).in!)).toBeCloseTo(before, 9);
  });

  it("unlocks without moving anything", () => {
    const { s, c } = start();
    const locked = setNodeHvLock(s, c.id, c.nodes[0]!.id, "both", true).state;
    const unlocked = setNodeHvLock(locked, c.id, c.nodes[0]!.id, "both", false).state;
    expect(nodeHvLocked(unlocked, c.id, c.nodes[0]!.id)).toEqual({ in: false, out: false });
    expect(nodeAt(unlocked, 0).in).toEqual(nodeAt(locked, 0).in);
    expect(nodeAt(unlocked, 0).out).toEqual(nodeAt(locked, 0).out);
  });

  it("reports which handles are locked", () => {
    const { s, c } = start();
    expect(nodeHvLocked(s, c.id, c.nodes[0]!.id)).toEqual({ in: false, out: false });
    const locked = setNodeHvLock(s, c.id, c.nodes[0]!.id, "both", true).state;
    expect(nodeHvLocked(locked, c.id, c.nodes[0]!.id)).toEqual({ in: true, out: true });
  });

  it("locks one handle without locking the other", () => {
    const { s, c } = start();
    const locked = setNodeHvLock(s, c.id, c.nodes[0]!.id, "out", true).state;
    expect(nodeHvLocked(locked, c.id, c.nodes[0]!.id)).toEqual({ in: false, out: true });
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
      setNodeHvLock(s, c.id, c.nodes[0]!.id, "both", true),
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

describe("createGlyphs", () => {
  const start = () =>
    editorState({
      document: fontDocument([glyph("a", { unicodes: [0x61], advance: 500 })]),
      view: { scale: 1, tx: 0, ty: 0 },
      currentGlyph: "a",
    });

  it("adds a glyph and opens it", () => {
    const { state } = createGlyphs(start(), [{ name: "b", unicodes: [0x62] }], 500);
    expect(state.document.glyphOrder).toEqual(["a", "b"]);
    expect(state.document.glyphs["b"]?.unicodes).toEqual([0x62]);
    expect(state.currentGlyph).toBe("b");
  });

  it("gives a new glyph the advance it was told, and no outline", () => {
    const { state } = createGlyphs(start(), [{ name: "b" }], 512);
    expect(state.document.glyphs["b"]?.advance).toBe(512);
    expect(state.document.glyphs["b"]?.contours).toEqual([]);
  });

  it("never overwrites a glyph that is already there", () => {
    const before = start();
    const { state } = createGlyphs(before, [{ name: "a", unicodes: [0x41] }], 500);
    // Same document object: nothing was created, so nothing changed.
    expect(state.document).toBe(before.document);
    expect(state.document.glyphs["a"]?.unicodes).toEqual([0x61]);
  });

  it("skips the ones that exist and adds the rest", () => {
    const { state } = createGlyphs(start(), [{ name: "a" }, { name: "b" }, { name: "c" }], 500);
    expect(state.document.glyphOrder).toEqual(["a", "b", "c"]);
  });

  it("commits a whole set as one entry, so it can be taken back in one", () => {
    const many = Array.from({ length: 95 }, (_, i) => ({
      name: `g${String(i)}`,
      unicodes: [0x20 + i],
    }));
    const out = createGlyphs(start(), many, 500);
    expect(out.effects.map((e) => e.kind)).toEqual(["beginTransaction", "commitTransaction"]);
    expect(out.effects[0]).toMatchObject({ label: "Add 95 glyphs" });
  });

  it("names a single addition after the glyph", () => {
    expect(createGlyphs(start(), [{ name: "b" }], 500).effects[0]).toMatchObject({
      label: "Add b",
    });
  });

  it("does nothing for an empty request or a nameless glyph", () => {
    const before = start();
    expect(createGlyphs(before, [], 500).state).toBe(before);
    expect(createGlyphs(before, [{ name: "" }], 500).state).toBe(before);
  });
});

describe("deleteGlyph", () => {
  const start = () =>
    editorState({
      document: fontDocument([
        glyph("a", { unicodes: [0x61], advance: 500 }),
        glyph("b", { unicodes: [0x62], advance: 500 }),
      ]),
      view: { scale: 1, tx: 0, ty: 0 },
      currentGlyph: "b",
    });

  it("removes the glyph", () => {
    const { state } = deleteGlyph(start(), "a");
    expect(state.document.glyphOrder).toEqual(["b"]);
    expect(state.document.glyphs["a"]).toBeUndefined();
  });

  it("moves off a glyph it just deleted", () => {
    const { state } = deleteGlyph(start(), "b");
    expect(state.currentGlyph).toBe("a");
  });

  it("leaves the open glyph alone when another is deleted", () => {
    const { state } = deleteGlyph(start(), "a");
    expect(state.currentGlyph).toBe("b");
  });

  it("does nothing for a glyph that is not there", () => {
    const before = start();
    const out = deleteGlyph(before, "nope");
    expect(out.state).toBe(before);
    expect(out.effects).toEqual([]);
  });

  it("leaves components pointing at it rather than rewriting other glyphs", () => {
    const ids = counterIds("k");
    const withComponent = editorState({
      document: fontDocument([
        glyph("a", { advance: 500 }),
        glyph("b", { advance: 500, components: [component(ids.component(), "a")] }),
      ]),
      view: { scale: 1, tx: 0, ty: 0 },
      currentGlyph: "b",
    });

    const { state } = deleteGlyph(withComponent, "a");
    // The reference survives and simply draws nothing; undo brings the glyph
    // back and the composite with it.
    expect(state.document.glyphs["b"]?.components).toHaveLength(1);
    expect(state.document.glyphs["b"]?.components[0]?.base).toBe("a");
  });
});

describe("roundCoordinates", () => {
  it("puts the whole font on whole units in one undo step", () => {
    const ids = counterIds("round");
    const c = contour(
      ids.contour(),
      [node(ids.node(), vec(100.4, 200.6)), node(ids.node(), vec(300.5, 0))],
      false,
    );
    const state = editorState({
      document: fontDocument([addContour(glyph("a", { advance: 500.4 }), c)]),
      view: VIEW,
    });

    const out = roundCoordinates(state);
    const g = firstGlyph(out.state.document);

    expect(g.contours[0]!.nodes[0]!.pt).toEqual({ x: 100, y: 201 });
    expect(g.advance).toBe(500);
    // One begin and one commit: a partial undo of this would be worse than none.
    expect(out.effects.filter((e) => e.kind === "beginTransaction")).toHaveLength(1);
  });

  it("does nothing, and records nothing, when everything is already whole", () => {
    const ids = counterIds("done");
    const c = contour(ids.contour(), [node(ids.node(), vec(100, 200))], false);
    const state = editorState({
      document: fontDocument([addContour(glyph("a", { advance: 500 }), c)]),
      view: VIEW,
    });

    const out = roundCoordinates(state);
    expect(out.state).toBe(state);
    expect(out.effects).toHaveLength(0);
  });

  it("counts the glyphs it would change before changing them", () => {
    const ids = counterIds("count");
    const c = contour(ids.contour(), [node(ids.node(), vec(100.4, 200))], false);
    const state = editorState({
      document: fontDocument([addContour(glyph("a"), c), glyph("b", { advance: 500 })]),
      view: VIEW,
    });
    expect(unroundedCount(state)).toBe(1);
  });
});

describe("setting a coordinate", () => {
  /** A smooth node with both handles, and one loose point to select instead. */
  function withNode() {
    const ids = counterIds("coord");
    const c = contour(
      ids.contour(),
      [
        node(ids.node(), vec(100, 200), {
          type: "smooth",
          in: vec(60, 200),
          out: vec(140, 200),
        }),
        node(ids.node(), vec(400, 200), { type: "corner", in: vec(360, 200) }),
      ],
      false,
    );
    const state = editorState({
      document: fontDocument([addContour(glyph("a", { advance: 500 }), c)]),
      view: VIEW,
    });
    return { state, contour: c };
  }

  it("reports the one selected item and where it is", () => {
    const { state, contour: c } = withNode();
    const item = { contourId: c.id, nodeId: c.nodes[0]!.id, part: "point" as const };

    const found = selectedCoordinate({ ...state, selection: [item] });
    expect(found?.point).toEqual({ x: 100, y: 200 });
    expect(found?.item.part).toBe("point");
  });

  it("reports nothing for an empty or a multiple selection", () => {
    const { state, contour: c } = withNode();
    const items = c.nodes.map((n) => ({ contourId: c.id, nodeId: n.id, part: "point" as const }));

    expect(selectedCoordinate(state)).toBeNull();
    expect(selectedCoordinate({ ...state, selection: items })).toBeNull();
  });

  it("moves a point, carrying its handles with it", () => {
    const { state, contour: c } = withNode();
    const item = { contourId: c.id, nodeId: c.nodes[0]!.id, part: "point" as const };

    const out = moveCoordinateTo({ ...state, selection: [item] }, item, { x: 120, y: 260 });
    const n = firstGlyph(out.state.document).contours[0]!.nodes[0]!;

    expect(n.pt).toEqual({ x: 120, y: 260 });
    expect(n.in).toEqual({ x: 80, y: 260 });
    expect(n.out).toEqual({ x: 160, y: 260 });
  });

  it("keeps a smooth node smooth when a handle is typed in", () => {
    const { state, contour: c } = withNode();
    const item = { contourId: c.id, nodeId: c.nodes[0]!.id, part: "out" as const };

    const out = moveCoordinateTo({ ...state, selection: [item] }, item, { x: 140, y: 240 });
    const n = firstGlyph(out.state.document).contours[0]!.nodes[0]!;

    expect(n.out).toEqual({ x: 140, y: 240 });
    // The other side swings to stay opposite, exactly as a drag would leave it.
    const across = { x: n.pt.x - (n.out!.x - n.pt.x), y: n.pt.y - (n.out!.y - n.pt.y) };
    const alongX = (n.in!.x - n.pt.x) * (across.y - n.pt.y);
    const alongY = (n.in!.y - n.pt.y) * (across.x - n.pt.x);
    expect(alongX - alongY).toBeCloseTo(0, 6);
  });

  it("does nothing when the point is already there", () => {
    const { state, contour: c } = withNode();
    const item = { contourId: c.id, nodeId: c.nodes[0]!.id, part: "point" as const };
    const selected = { ...state, selection: [item] };

    expect(moveCoordinateTo(selected, item, { x: 100, y: 200 }).state).toBe(selected);
  });

  it("does nothing for an item that is no longer there", () => {
    const { state, contour: c } = withNode();
    const gone = { contourId: c.id, nodeId: "vanished", part: "point" as const };
    expect(moveCoordinateTo(state, gone, { x: 0, y: 0 }).state).toBe(state);
  });
});

describe("renaming the open glyph", () => {
  const twoGlyphs = () =>
    editorState({
      document: fontDocument([
        glyph("a", { unicodes: [0x61], advance: 500 }),
        glyph("v", { unicodes: [0x76], advance: 480 }),
      ]),
      view: VIEW,
    });

  it("renames it and follows it, so the editor is not left on a name that has gone", () => {
    const out = renameCurrentGlyph(twoGlyphs(), "alpha");

    expect(out.state.document.glyphs["alpha"]?.advance).toBe(500);
    expect(out.state.currentGlyph).toBe("alpha");
  });

  it("is one undo step", () => {
    const out = renameCurrentGlyph(twoGlyphs(), "alpha");
    expect(out.effects.filter((e) => e.kind === "beginTransaction")).toHaveLength(1);
  });

  it("trims what was typed, since a leading space is never meant", () => {
    expect(renameCurrentGlyph(twoGlyphs(), "  alpha  ").state.currentGlyph).toBe("alpha");
  });

  it("does nothing at all when the name is refused", () => {
    const state = twoGlyphs();
    expect(renameCurrentGlyph(state, "v").state).toBe(state);
    expect(renameCurrentGlyph(state, "").state).toBe(state);
  });

  it("says why it would be refused, before anyone commits", () => {
    const state = twoGlyphs();
    expect(renameRefusal(state, "v")).toBe("taken");
    expect(renameRefusal(state, "   ")).toBe("empty");
    expect(renameRefusal(state, "alpha")).toBeNull();
    // Its own name is not a collision with itself.
    expect(renameRefusal(state, "a")).toBeNull();
  });
});

describe("font info", () => {
  const start = () =>
    editorState({
      document: fontDocument([glyph("a", { advance: 500 })]),
      view: VIEW,
    });

  it("changes one field and leaves the rest alone", () => {
    const out = setInfo(start(), { familyName: "Cormorant" }).state;
    expect(out.document.info.familyName).toBe("Cormorant");
    expect(out.document.info.unitsPerEm).toBe(1000);
  });

  it("is one undo step, and a no-op when nothing changed", () => {
    const s = start();
    const named = setInfo(s, { styleName: "Italic" });
    expect(named.state).not.toBe(s);
    expect(named.effects.length).toBeGreaterThan(0);

    // The same value again is not an edit, and must not land in the history.
    expect(setInfo(named.state, { styleName: "Italic" }).state).toBe(named.state);
  });

  it("refuses an em of zero rather than dividing by it later", () => {
    const s = start();
    expect(setInfo(s, { unitsPerEm: 0 }).state).toBe(s);
    expect(infoProblem({ ...s.document.info, unitsPerEm: 0 })).not.toBeNull();
  });

  it("refuses an ascender below its descender", () => {
    const s = start();
    expect(setInfo(s, { ascender: -400 }).state).toBe(s);
  });

  it("refuses a font with no family name", () => {
    const s = start();
    expect(setInfo(s, { familyName: "   " }).state).toBe(s);
  });

  it("does not move the drawings when the em changes", () => {
    // Changing the em changes what the numbers mean, not where the outlines
    // are. Rescaling a font is a different operation.
    const s = editorState({
      document: fontDocument([addContour(glyph("a", { advance: 500 }), ring())]),
      view: VIEW,
    });
    const out = setInfo(s, { unitsPerEm: 2048 }).state;
    expect(out.document.glyphs["a"]?.contours).toEqual(s.document.glyphs["a"]?.contours);
    expect(out.document.glyphs["a"]?.advance).toBe(500);
  });

  it("takes an x-height of zero, which is a font with no lower case", () => {
    expect(setInfo(start(), { xHeight: 0 }).state.document.info.xHeight).toBe(0);
  });
});

describe("removing overlap", () => {
  const ids = counterIds("ov-cmd");
  const withContours = (...boxes: { minX: number; minY: number; maxX: number; maxY: number }[]) =>
    editorState({
      document: fontDocument([
        glyph("a", { advance: 600, contours: boxes.map((b) => rectContour(ids, b)) }),
      ]),
      view: VIEW,
      currentGlyph: "a",
    });

  it("unions the contours and says how many crossings it resolved", () => {
    const s = withContours(
      { minX: 0, minY: 0, maxX: 300, maxY: 300 },
      { minX: 200, minY: 200, maxX: 500, maxY: 500 },
    );
    const { outcome, result } = overlapAt(s, "a", ids);

    expect(outcome).toBe(2);
    expect(result.state.document.glyphs["a"]!.contours).toHaveLength(1);
  });

  it("calls a glyph with nothing overlapping clean, and leaves it be", () => {
    const s = withContours(
      { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      { minX: 300, minY: 300, maxX: 400, maxY: 400 },
    );
    const { outcome, result } = overlapAt(s, "a", ids);

    expect(outcome).toBe("clean");
    // The very same state, so nothing lands in the undo stack.
    expect(result.state).toBe(s);
  });

  it("resolves two rectangles that share their edges rather than crossing them", () => {
    // Two rectangles from the same corner: they overlap, and every edge of the
    // overlap lies along an edge of one of them. There is no crossing to split
    // at, so the ends of the shared stretch are used — this used to be refused.
    const s = withContours(
      { minX: 0, minY: 0, maxX: 400, maxY: 150 },
      { minX: 0, minY: 0, maxX: 150, maxY: 400 },
    );
    const { outcome, result } = overlapAt(s, "a", ids);

    expect(outcome).not.toBe("refused");
    expect(result.state.document.glyphs["a"]!.contours).toHaveLength(1);
  });

  it("calls a glyph that is not there clean rather than refusing", () => {
    expect(overlapAt(withContours(), "nope", ids).outcome).toBe("clean");
  });
});

describe("rounding a glyph and a selection", () => {
  const ids = counterIds("round2");
  const fractional = () =>
    contour(
      ids.contour(),
      [
        node(ids.node(), vec(10.4, 20.6), {
          type: "corner",
          in: vec(5.5, 20.6),
          out: vec(15.7, 20.6),
        }),
        node(ids.node(), vec(200.5, 300.5)),
      ],
      false,
    );

  const start = () => {
    const c = fractional();
    return {
      c,
      s: editorState({
        document: fontDocument([
          addContour(glyph("a", { advance: 500.4 }), c),
          glyph("b", { advance: 300.7 }),
        ]),
        view: VIEW,
      }),
    };
  };

  it("rounds one glyph without touching the rest of the font", () => {
    const { s } = start();
    const out = roundGlyphAt(s, "a").state;

    expect(firstGlyph(out.document).advance).toBe(500);
    // The other glyph is the font's business, not this command's.
    expect(out.document.glyphs["b"]?.advance).toBe(300.7);
  });

  it("does nothing for a glyph that is already whole, or is not there", () => {
    const { s } = start();
    const once = roundGlyphAt(s, "b").state;
    expect(once).not.toBe(s);

    // Returning the very same state is what keeps a no-op out of the undo stack.
    expect(roundGlyphAt(once, "b").state).toBe(once);
    expect(roundGlyphAt(s, "nope").state).toBe(s);
  });

  it("rounds exactly the selected point, and not its handles", () => {
    // Literally what was selected. Handles are positions in their own right and
    // can be selected in their own right; rounding ones nobody picked is how a
    // command like this stops being predictable.
    const { s, c } = start();
    const selected = {
      ...s,
      selection: [{ contourId: c.id, nodeId: c.nodes[0]!.id, part: "point" as const }],
    };
    const n = nodeAt(roundSelection(selected).state, 0);

    expect(n.pt).toEqual({ x: 10, y: 21 });
    expect(n.in).toEqual({ x: 5.5, y: 20.6 });
  });

  it("rounds a selected handle on its own", () => {
    const { s, c } = start();
    const selected = {
      ...s,
      selection: [{ contourId: c.id, nodeId: c.nodes[0]!.id, part: "out" as const }],
    };
    const n = nodeAt(roundSelection(selected).state, 0);

    expect(n.out).toEqual({ x: 16, y: 21 });
    expect(n.pt).toEqual({ x: 10.4, y: 20.6 });
  });

  it("leaves a glyph alone when nothing is selected", () => {
    const { s } = start();
    expect(roundSelection(s).state).toBe(s);
  });

  it("counts what it would move, so a caller can say", () => {
    const { s, c } = start();
    const selected = {
      ...s,
      selection: [
        { contourId: c.id, nodeId: c.nodes[0]!.id, part: "point" as const },
        { contourId: c.id, nodeId: c.nodes[1]!.id, part: "point" as const },
      ],
    };
    expect(unroundedSelected(selected)).toBe(2);
    expect(unroundedSelected(roundSelection(selected).state)).toBe(0);
  });

  it("refuses to rename .notdef through the tool as well", () => {
    const s = editorState({
      document: fontDocument([glyph(".notdef", { advance: 500 }), glyph("a", { advance: 400 })]),
      view: VIEW,
    });
    expect(renameRefusal(s, "notdef")).toBe("reserved");
    expect(renameCurrentGlyph(s, "notdef").state).toBe(s);
  });
});

describe("kerning groups", () => {
  /** Four letters, two groups on the first side, one pair between classes. */
  const spaced = (): EditorState => {
    let kerning: Kerning = EMPTY_KERNING;
    kerning = setKernGroup(kerning, "first", "O", ["O", "Q"]);
    kerning = setKernGroup(kerning, "first", "T", ["T"]);
    kerning = setKernGroup(kerning, "second", "A", ["A"]);
    kerning = setKern(kerning, groupKey("O"), groupKey("A"), -40);
    kerning = setKern(kerning, groupKey("T"), groupKey("A"), -80);

    const document = setKerning(
      fontDocument([
        glyph("O", { unicodes: [0x4f], advance: 500 }),
        glyph("Q", { unicodes: [0x51], advance: 500 }),
        glyph("T", { unicodes: [0x54], advance: 500 }),
        glyph("A", { unicodes: [0x41], advance: 500 }),
      ]),
      kerning,
    );
    return editorState({ document, view: VIEW, currentGlyph: "O" });
  };

  const groups = (s: EditorState, side: "first" | "second") =>
    side === "first" ? s.document.kerning.firstGroups : s.document.kerning.secondGroups;

  describe("naming", () => {
    it("wants a name", () => {
      expect(kernGroupProblem(spaced().document.kerning, "first", "  ")).not.toBeNull();
    });

    it("refuses characters a UFO group key should not carry", () => {
      const k = spaced().document.kerning;
      expect(kernGroupProblem(k, "first", "round shapes")).not.toBeNull();
      expect(kernGroupProblem(k, "first", ".hidden")).not.toBeNull();
      expect(kernGroupProblem(k, "first", "O.alt-1_2")).toBeNull();
    });

    it("refuses a name taken on the same side, but not on the other", () => {
      const k = spaced().document.kerning;
      expect(kernGroupProblem(k, "first", "O")).not.toBeNull();
      expect(kernGroupProblem(k, "second", "O")).toBeNull();
    });

    it("lets a group keep its own name while being renamed", () => {
      const k = spaced().document.kerning;
      expect(kernGroupProblem(k, "first", "O", "O")).toBeNull();
    });
  });

  it("starts a group with no members", () => {
    const after = addKernGroup(spaced(), "first", "H").state;
    expect(groups(after, "first")["H"]).toEqual([]);
  });

  it("refuses to start one whose name is no good", () => {
    const s = spaced();
    expect(addKernGroup(s, "first", "O").state).toBe(s);
    expect(addKernGroup(s, "first", "").state).toBe(s);
  });

  it("moves a glyph out of the group that held it", () => {
    const after = putGlyphInKernGroup(spaced(), "first", "O", "T").state;
    expect(groups(after, "first")["O"]).toContain("T");
    expect(groups(after, "first")["T"]).toEqual([]);
    expect(kernGroupHolding(after, "first", "T")).toBe("O");
  });

  it("will not put a glyph that does not exist into a group", () => {
    // The panel takes a typed name, and a typo should not become a member that
    // no file can ever write.
    const s = spaced();
    expect(putGlyphInKernGroup(s, "first", "O", "Omega").state).toBe(s);
  });

  it("takes a glyph back out", () => {
    const after = takeGlyphFromKernGroup(spaced(), "first", "O", "Q").state;
    expect(groups(after, "first")["O"]).toEqual(["O"]);
    expect(kernGroupHolding(after, "first", "Q")).toBeNull();
  });

  it("renames a group and keeps its kerning", () => {
    const after = renameKernGroupTo(spaced(), "first", "O", "round").state;
    expect(kerningFor(after, "Q", "A")?.value).toBe(-40);
    expect(groups(after, "first")["O"]).toBeUndefined();
  });

  it("refuses a rename onto a name already in use", () => {
    const s = spaced();
    expect(renameKernGroupTo(s, "first", "O", "T").state).toBe(s);
  });

  it("says how many pairs a delete would take with it", () => {
    const s = spaced();
    expect(kernGroupPairs(s, "first", "O")).toBe(1);
    expect(kernGroupPairs(s, "second", "A")).toBe(2);

    const after = deleteKernGroup(s, "second", "A").state;
    expect(kerningFor(after, "O", "A")).toBeNull();
    expect(kerningFor(after, "T", "A")).toBeNull();
  });

  it("puts every change on the undo stack under its own name", () => {
    const s = spaced();
    for (const effects of [
      addKernGroup(s, "first", "H").effects,
      putGlyphInKernGroup(s, "first", "O", "T").effects,
      renameKernGroupTo(s, "first", "O", "round").effects,
      deleteKernGroup(s, "first", "O").effects,
    ]) {
      expect(effects.map((e) => e.kind)).toEqual(["beginTransaction", "commitTransaction"]);
    }
  });

  it("does nothing, and says so, when there is nothing to do", () => {
    const s = spaced();
    expect(takeGlyphFromKernGroup(s, "first", "O", "A").state).toBe(s);
    expect(deleteKernGroup(s, "first", "nope").state).toBe(s);
    expect(putGlyphInKernGroup(s, "first", "O", "Q").state).toBe(s);
  });
});

describe("nudging a pair once there are classes", () => {
  /** Two classes and no pairs at all: a font whose kerning is about to start. */
  const font = (): EditorState => {
    let kerning: Kerning = EMPTY_KERNING;
    kerning = setKernGroup(kerning, "first", "O", ["O", "Q"]);
    kerning = setKernGroup(kerning, "second", "A", ["A", "Aacute"]);

    const document = setKerning(
      fontDocument([
        glyph("O", { unicodes: [0x4f], advance: 500 }),
        glyph("Q", { unicodes: [0x51], advance: 500 }),
        glyph("A", { unicodes: [0x41], advance: 500 }),
        glyph("Aacute", { unicodes: [0xc1], advance: 500 }),
        glyph("T", { unicodes: [0x54], advance: 500 }),
      ]),
      kerning,
    );
    return editorState({ document, view: VIEW, currentGlyph: "O" });
  };

  it("writes a new pair between the classes the two sides are in", () => {
    // The point of putting a letter in a class: correcting this gap corrects it
    // for every letter that behaves the same way.
    const after = nudgeKern(font(), "O", "A", -10).state;
    const pair = kerningFor(after, "O", "A");
    expect(pair?.first).toBe("@O");
    expect(pair?.second).toBe("@A");
    expect(kerningFor(after, "Q", "Aacute")?.value).toBe(-10);
  });

  it("names the glyph on a side that is in no class", () => {
    const after = nudgeKern(font(), "O", "T", -10).state;
    const pair = kerningFor(after, "O", "T");
    expect(pair?.first).toBe("@O");
    expect(pair?.second).toBe("T");
  });

  it("writes a plain pair when neither side is in one", () => {
    const after = nudgeKern(font(), "T", "T", -10).state;
    expect(kerningFor(after, "T", "T")?.grouped).toBe(false);
  });

  it("goes on adjusting the class it wrote", () => {
    let state = nudgeKern(font(), "O", "A", -10).state;
    // A different member of the same two classes: the same rule, not a new one.
    state = nudgeKern(state, "Q", "A", -5).state;
    expect(kerningFor(state, "O", "A")?.value).toBe(-15);
    expect(kernPairCount(state.document.kerning)).toBe(1);
  });

  it("still adjusts an exception rather than the class behind it", () => {
    let state = nudgeKern(font(), "O", "A", -10).state;
    state = breakOutKern(state, "Q", "A").state;
    state = nudgeKern(state, "Q", "A", -5).state;
    expect(kerningFor(state, "Q", "A")?.value).toBe(-15);
    expect(kerningFor(state, "O", "A")?.value).toBe(-10);
  });
});

describe("transforming a selection", () => {
  /** A square of four corners, so every coordinate is easy to read. */
  const square = () => {
    const ids = counterIds("tf");
    const c = contour(
      ids.contour(),
      [
        node("p0", vec(0, 0)),
        node("p1", vec(100, 0)),
        node("p2", vec(100, 100), { out: vec(120, 100) }),
        node("p3", vec(0, 100)),
      ],
      true,
    );
    const document = fontDocument([glyph("a", { advance: 200, contours: [c] })]);
    return editorState({ document, view: VIEW, currentGlyph: "a" });
  };

  const pick = (s: EditorState, ...ids: string[]): EditorState => ({
    ...s,
    selection: ids.map((nodeId) => ({
      contourId: s.document.glyphs["a"]!.contours[0]!.id,
      nodeId,
      part: "point" as const,
    })),
  });

  const at = (s: EditorState, id: string) =>
    s.document.glyphs["a"]!.contours[0]!.nodes.find((n) => n.id === id)!;

  it("moves the selected points and leaves the rest", () => {
    const before = pick(square(), "p0", "p1");
    const after = transformSelection(before, translation(10, 20), BOX_CENTRE, "Move").state;

    expect(at(after, "p0").pt).toEqual(vec(10, 20));
    expect(at(after, "p1").pt).toEqual(vec(110, 20));
    expect(at(after, "p2").pt).toEqual(vec(100, 100));
  });

  it("carries a selected point's handles with it", () => {
    // A handle belongs to the point that owns it, which is the same rule the
    // arrow keys follow.
    const after = transformSelection(
      pick(square(), "p2"),
      translation(10, 0),
      BOX_CENTRE,
      "Move",
    ).state;
    expect(at(after, "p2").out).toEqual(vec(130, 100));
  });

  it("does nothing for a selection of handles alone", () => {
    const s = square();
    const handles: EditorState = {
      ...s,
      selection: [
        { contourId: s.document.glyphs["a"]!.contours[0]!.id, nodeId: "p2", part: "out" },
      ],
    };
    expect(transformSelection(handles, translation(10, 0), BOX_CENTRE, "Move").state).toBe(handles);
  });

  it("costs no undo entry for a transform that changes nothing", () => {
    const s = pick(square(), "p0");
    expect(transformSelection(s, IDENTITY_AFFINE, BOX_CENTRE, "Move").state).toBe(s);
  });

  it("scales about the middle of what is selected", () => {
    const after = transformSelection(
      pick(square(), "p0", "p1", "p2", "p3"),
      scaling(2, 2),
      BOX_CENTRE,
      "Scale",
    ).state;
    expect(at(after, "p0").pt).toEqual(vec(-50, -50));
    expect(at(after, "p2").pt).toEqual(vec(150, 150));
  });

  it("scales about a corner of the box when asked", () => {
    const after = transformSelection(
      pick(square(), "p0", "p1", "p2", "p3"),
      scaling(2, 2),
      { kind: "box", x: "left", y: "bottom" },
      "Scale",
    ).state;
    expect(at(after, "p0").pt).toEqual(vec(0, 0));
    expect(at(after, "p2").pt).toEqual(vec(200, 200));
  });

  it("leans about the glyph's own origin, which is what an italic needs", () => {
    // Turning about the selection instead would shift every glyph sideways by a
    // different amount and the spacing would be gone.
    const after = transformSelection(
      pick(square(), "p0", "p1", "p2", "p3"),
      skewing(Math.atan(0.25), 0),
      { kind: "origin" },
      "Slant",
    ).state;
    expect(at(after, "p0").pt.x).toBeCloseTo(0, 6);
    expect(at(after, "p3").pt.x).toBeCloseTo(25, 6);
  });

  it("grows from the baseline under the selection without moving it along", () => {
    const after = transformSelection(
      pick(square(), "p0", "p1", "p2", "p3"),
      scaling(1, 2),
      { kind: "baseline" },
      "Scale",
    ).state;
    expect(at(after, "p0").pt).toEqual(vec(0, 0));
    expect(at(after, "p3").pt).toEqual(vec(0, 200));
  });

  it("keeps a smooth node smooth, because a straight line stays straight", () => {
    const ids = counterIds("sm");
    const c = contour(
      ids.contour(),
      [
        node("a", vec(0, 0), { out: vec(40, 0) }),
        node("b", vec(100, 0), { type: "smooth", in: vec(60, 0), out: vec(140, 0) }),
        node("c", vec(200, 0), { in: vec(160, 0) }),
      ],
      false,
    );
    const document = fontDocument([glyph("a", { advance: 200, contours: [c] })]);
    const s = editorState({ document, view: VIEW, currentGlyph: "a" });
    const chosen: EditorState = {
      ...s,
      selection: ["a", "b", "c"].map((nodeId) => ({ contourId: c.id, nodeId, part: "point" })),
    };

    const after = transformSelection(chosen, rotation(0.4), BOX_CENTRE, "Rotate").state;
    const n = after.document.glyphs["a"]!.contours[0]!.nodes[1]!;
    expect(n.type).toBe("smooth");
    // Still one straight line through the node: the cross product vanishes.
    const left = { x: n.in!.x - n.pt.x, y: n.in!.y - n.pt.y };
    const right = { x: n.out!.x - n.pt.x, y: n.out!.y - n.pt.y };
    expect(left.x * right.y - left.y * right.x).toBeCloseTo(0, 6);
  });

  it("turns the box with the points, so the two go on agreeing", () => {
    // The complaint this answers: a rotation typed into the panel turned the
    // selection and left the box standing upright round it.
    const chosen = pick(square(), "p0", "p1", "p2", "p3");
    const after = transformSelection(chosen, rotation(0.4), BOX_CENTRE, "Rotate", 0.4).state;

    expect(boxAngle(after)).toBeCloseTo(0.4, 12);
    expect(selectionBox(after)?.angle).toBeCloseTo(0.4, 12);
  });

  it("adds one turn to the next, rather than starting again from upright", () => {
    const chosen = pick(square(), "p0", "p1", "p2", "p3");
    const once = transformSelection(chosen, rotation(0.4), BOX_CENTRE, "Rotate", 0.4).state;
    const twice = transformSelection(once, rotation(0.2), BOX_CENTRE, "Rotate", 0.2).state;
    expect(boxAngle(twice)).toBeCloseTo(0.6, 12);
  });

  it("leaves the box upright for a transform that is not a turn", () => {
    const chosen = pick(square(), "p0", "p1", "p2", "p3");
    const after = transformSelection(chosen, scaling(2, 2), BOX_CENTRE, "Scale").state;
    expect(boxAngle(after)).toBe(0);
  });

  it("forgets the angle when something else is selected", () => {
    // The angle belongs to the points that were turned. Another selection has
    // not been turned, and its box is upright.
    const chosen = pick(square(), "p0", "p1", "p2", "p3");
    const after = transformSelection(chosen, rotation(0.4), BOX_CENTRE, "Rotate", 0.4).state;
    expect(boxAngle(pick(after, "p0", "p1"))).toBe(0);
  });

  it("fits the box to the turned shape rather than round its shadow", () => {
    // A square turned an eighth: measured in the plane the box would be wider by
    // root two, and measured in the frame it is the square it always was.
    const chosen = pick(square(), "p0", "p1", "p2", "p3");
    const eighth = Math.PI / 4;
    const after = transformSelection(chosen, rotation(eighth), BOX_CENTRE, "Rotate", eighth).state;
    const box = selectionBox(after)!;
    expect(box.rect.maxX - box.rect.minX).toBeCloseTo(box.rect.maxY - box.rect.minY, 6);
  });

  it("anchors a transform at the corner of the box that is drawn", () => {
    // "The bottom left of the selection" has to mean the corner the user can
    // see, which after a turn is not the corner of an upright rectangle.
    const chosen = pick(square(), "p0", "p1", "p2", "p3");
    const quarter = Math.PI / 2;
    const after = transformSelection(
      chosen,
      rotation(quarter),
      BOX_CENTRE,
      "Rotate",
      quarter,
    ).state;

    // A square turned a quarter is the same square, and its frame's bottom left
    // is the plane's bottom right: (100, 0), not the (0, 0) an upright reading
    // would give. The drawn box stands the outset further out, so this is the
    // same corner rather than the same point.
    const corner = transformOriginPoint(after, { kind: "box", x: "left", y: "bottom" })!;
    expect(corner.x).toBeCloseTo(100, 6);
    expect(corner.y).toBeCloseTo(0, 6);

    const box = selectionBox(after)!;
    const drawn = boxHandlePoint(box, "bottomLeft");
    expect(drawn.x).toBeGreaterThan(corner.x);
    expect(drawn.y).toBeLessThan(corner.y);
  });

  it("lets an axis lock go when the transform stops it holding", () => {
    const ids = counterIds("lk");
    const c = contour(
      ids.contour(),
      [node("a", vec(0, 0), { out: vec(40, 0), hvLock: true }), node("b", vec(100, 0))],
      false,
    );
    const document = fontDocument([glyph("a", { advance: 200, contours: [c] })]);
    const s = editorState({ document, view: VIEW, currentGlyph: "a" });
    const chosen: EditorState = {
      ...s,
      selection: [{ contourId: c.id, nodeId: "a", part: "point" }],
    };

    const turned = transformSelection(chosen, rotation(0.4), BOX_CENTRE, "Rotate").state;
    expect(turned.document.glyphs["a"]!.contours[0]!.nodes[0]!.hvLock).toEqual({
      in: false,
      out: false,
    });

    // A scale keeps level level, so the lock still holds and is kept.
    const scaled = transformSelection(chosen, scaling(2, 3), BOX_CENTRE, "Scale").state;
    expect(scaled.document.glyphs["a"]!.contours[0]!.nodes[0]!.hvLock.out).toBe(true);
  });

  it("names the entry it puts on the undo stack", () => {
    const out = transformSelection(pick(square(), "p0"), translation(1, 0), BOX_CENTRE, "Move");
    expect(out.effects.map((e) => e.kind)).toEqual(["beginTransaction", "commitTransaction"]);
  });
});

describe("tension", () => {
  /** The ring with one segment picked out, as clicking a curve leaves it. */
  const onSegment = (index = 0): { s: EditorState; c: Contour } => {
    const { s, c } = start();
    return { s: { ...s, focusedSegment: { contourId: c.id, segmentIndex: index } }, c };
  };

  it("reads the focused segment's handle scales, and nothing when none is focused", () => {
    const { s } = onSegment();
    const scales = focusedSegmentScales(s)!;
    expect(scales.lambda1).toBeCloseTo(scales.lambda2, 9);
    expect(focusedSegmentStatus(s)).toBe("ok");

    expect(focusedSegmentScales(start().s)).toBeNull();
    expect(focusedSegmentStatus(start().s)).toBeNull();
  });

  it("has nothing to read on a straight segment, and says why", () => {
    const { s, c } = start(triangle());
    const flat = { ...s, focusedSegment: { contourId: c.id, segmentIndex: 0 } };
    expect(focusedSegmentScales(flat)).toBeNull();
    expect(focusedSegmentStatus(flat)).toBe("flat");
  });

  it("sets both handle scales as one coalescing step", () => {
    const { s } = onSegment();
    const out = setSegmentTension(s, s.focusedSegment!, { lambda1: 0.4, lambda2: 0.8 });

    const after = focusedSegmentScales(out.state)!;
    expect(after.lambda1).toBeCloseTo(0.4, 9);
    expect(after.lambda2).toBeCloseTo(0.8, 9);
    // Typing "40" is two calls and should leave one step behind, so the step
    // may merge with the one before it.
    expect(out.effects).toEqual([
      { kind: "beginTransaction", label: "Set tension" },
      { kind: "commitTransaction" },
    ]);
  });

  it("leaves the state alone when the scales cannot be had", () => {
    const { s } = onSegment();
    const out = setSegmentTension(s, s.focusedSegment!, { lambda1: 0, lambda2: 0.5 });
    expect(out.state).toBe(s);
    expect(out.effects).toEqual([]);
  });

  it("declares no transaction while a control is being dragged", () => {
    const { s } = onSegment();
    const out = holdSegmentTension(s, s.focusedSegment!, { lambda1: 0.4, lambda2: 0.8 });
    expect(out.effects).toEqual([]);
    expect(focusedSegmentScales(out.state)!.lambda1).toBeCloseTo(0.4, 9);
  });

  it("cannot compound, because every value is absolute", () => {
    // What the pan slider depends on: the panel recomputes the scales from the
    // ones the drag began with, so passing through the same value twice lands
    // in the same place rather than drifting a little further each time.
    const { s } = onSegment();
    const segment = s.focusedSegment!;

    const once = holdSegmentTension(s, segment, { lambda1: 0.4, lambda2: 0.8 }).state;
    const wandered = holdSegmentTension(once, segment, { lambda1: 0.9, lambda2: 0.3 }).state;
    const back = holdSegmentTension(wandered, segment, { lambda1: 0.4, lambda2: 0.8 }).state;

    const there = focusedSegmentScales(back)!;
    expect(there.lambda1).toBeCloseTo(0.4, 9);
    expect(there.lambda2).toBeCloseTo(0.8, 9);
  });
});

describe("the node the handle fields act on", () => {
  it("is the selected point, or the node a selected handle hangs off", () => {
    const { s, c } = start();
    const point = selectedNode(selectPoint(s, c, 1))!;
    expect(point.nodeId).toBe(c.nodes[1]!.id);
    expect(point.node.pt).toEqual(vec(250, 0));

    const onHandle: EditorState = {
      ...s,
      selection: [{ contourId: c.id, nodeId: c.nodes[1]!.id, part: "in" }],
    };
    expect(selectedNode(onHandle)!.nodeId).toBe(c.nodes[1]!.id);
  });

  it("is nothing for an empty selection, or for several", () => {
    const { s, c } = start();
    expect(selectedNode(s)).toBeNull();

    const two: EditorState = {
      ...s,
      selection: [
        { contourId: c.id, nodeId: c.nodes[0]!.id, part: "point" },
        { contourId: c.id, nodeId: c.nodes[1]!.id, part: "point" },
      ],
    };
    expect(selectedNode(two)).toBeNull();
  });
});

describe("anchors", () => {
  const withAnchor = (): { s: EditorState; id: string } => {
    const { s } = start();
    const out = addAnchorAt(s, vec(120, 700), counterIds("q"));
    return { s: out.state, id: out.state.selectedAnchor! };
  };

  it("puts one where it was asked for, named for what it probably is", () => {
    const { s, id } = withAnchor();
    const only = firstGlyph(s.document).anchors[0]!;

    expect(only.id).toBe(id);
    expect(only.name).toBe("top");
    expect(only.pt).toEqual(vec(120, 700));
    // Selected as it lands, and the point selection put down: only one of the
    // two can be what the next key means.
    expect(s.selectedAnchor).toBe(id);
    expect(s.selection).toEqual([]);
  });

  it("names the next ones without collision", () => {
    const { s } = withAnchor();
    const second = addAnchorAt(s, vec(120, 0), counterIds("r")).state;
    expect(firstGlyph(second.document).anchors[1]!.name).toBe("bottom");
    expect(freeAnchorName(firstGlyph(second.document))).toBe("center");
  });

  it("moves one to an exact place, as one coalescing step", () => {
    const { s, id } = withAnchor();
    const out = moveAnchorToPoint(s, id, vec(130, 690));

    expect(firstGlyph(out.state.document).anchors[0]!.pt).toEqual(vec(130, 690));
    expect(out.effects).toEqual([
      { kind: "beginTransaction", label: "Move anchor" },
      { kind: "commitTransaction" },
    ]);
  });

  it("renames one, and refuses a name the glyph already uses", () => {
    const { s, id } = withAnchor();
    const two = addAnchorAt(s, vec(120, 0), counterIds("r")).state;

    expect(firstGlyph(renameAnchorTo(two, id, "hat").state.document).anchors[0]!.name).toBe("hat");
    // "bottom" is the second one's name, so the first cannot take it.
    const refused = renameAnchorTo(two, id, "bottom");
    expect(refused.state).toBe(two);
    expect(refused.effects).toEqual([]);
  });

  it("removes one, and forgets it was selected", () => {
    const { s, id } = withAnchor();
    const out = removeAnchorAt(s, id);

    expect(firstGlyph(out.state.document).anchors).toHaveLength(0);
    expect(out.state.selectedAnchor).toBeNull();
    expect(removeAnchorAt(out.state, id).state).toBe(out.state);
  });

  it("is what Backspace takes away while one is selected", () => {
    const { s } = withAnchor();
    const out = deleteSelectedAnchor(s);
    expect(firstGlyph(out.state.document).anchors).toHaveLength(0);
    expect(deleteSelectedAnchor(out.state).state).toBe(out.state);
  });
});

describe("components", () => {
  /** An `aacute` waiting to be built, beside the two glyphs it is built from. */
  const parts = (): EditorState => {
    const letter = addAnchor(
      glyph("a", {
        advance: 500,
        contours: [rectContour(counterIds("a"), { minX: 0, minY: 0, maxX: 400, maxY: 600 })],
      }),
      anchor("k1", "top", vec(250, 700)),
    );
    const accent = addAnchor(
      glyph("acute", {
        advance: 0,
        contours: [rectContour(counterIds("b"), { minX: 0, minY: 0, maxX: 80, maxY: 60 })],
      }),
      anchor("k2", "_top", vec(40, 690)),
    );
    const composite = addAnchor(
      glyph("aacute", { advance: 500 }),
      anchor("k3", "top", vec(250, 900)),
    );

    return editorState({
      document: fontDocument([letter, accent, composite]),
      view: { scale: 1, tx: 0, ty: 0 },
      currentGlyph: "aacute",
    });
  };

  const placed = (s: EditorState) => s.document.glyphs["aacute"]!.components;

  it("lands a new one on its anchors", () => {
    const out = addComponent(parts(), "acute", counterIds("c"));
    const only = placed(out.state)[0]!;

    // `_top` at (40, 690) has to reach `top` at (250, 900).
    expect(only.transform.xOffset).toBe(210);
    expect(only.transform.yOffset).toBe(210);
    expect(out.state.selectedComponent).toBe(only.id);
  });

  it("lands one with nothing to line up by at the origin", () => {
    const s = parts();
    const out = addComponent(s, "a", counterIds("c"));
    const only = placed(out.state)[0]!;

    expect(only.base).toBe("a");
    expect(only.transform.xOffset).toBe(0);
    expect(only.transform.yOffset).toBe(0);
  });

  it("refuses a placement that would close a loop", () => {
    const s = parts();
    const out = addComponent(s, "aacute", counterIds("c"));
    expect(out.state).toBe(s);
  });

  it("moves one to an exact offset, as one coalescing step", () => {
    const s = addComponent(parts(), "acute", counterIds("c")).state;
    const id = placed(s)[0]!.id;

    const out = moveComponentTo(s, id, vec(100, 20));
    expect(placed(out.state)[0]!.transform).toMatchObject({ xOffset: 100, yOffset: 20 });
    expect(out.effects).toEqual([
      { kind: "beginTransaction", label: "Move component" },
      { kind: "commitTransaction" },
    ]);
  });

  it("puts a nudged one back where the anchors say", () => {
    const s = addComponent(parts(), "acute", counterIds("c")).state;
    const id = placed(s)[0]!.id;
    const nudged = moveComponentTo(s, id, vec(0, 0)).state;

    expect(attachmentFor(nudged, id)).toEqual(vec(210, 210));
    const back = attachComponent(nudged, id).state;
    expect(placed(back)[0]!.transform).toMatchObject({ xOffset: 210, yOffset: 210 });
  });

  it("has nothing to align by where the pair is missing", () => {
    const s = addComponent(parts(), "a", counterIds("c")).state;
    const id = placed(s)[0]!.id;

    expect(attachmentFor(s, id)).toBeNull();
    expect(attachComponent(s, id).state).toBe(s);
  });

  it("takes one away, and forgets it was selected", () => {
    const s = addComponent(parts(), "acute", counterIds("c")).state;
    const id = placed(s)[0]!.id;

    const out = removeComponent(s, id);
    expect(placed(out.state)).toHaveLength(0);
    expect(out.state.selectedComponent).toBeNull();
    expect(deleteSelectedComponent(out.state).state).toBe(out.state);
  });

  it("is what Backspace takes away while one is selected", () => {
    const s = addComponent(parts(), "acute", counterIds("c")).state;
    const out = deleteSelectedComponent(s);
    expect(placed(out.state)).toHaveLength(0);
  });

  it("decomposes into contours of its own, and stops referring", () => {
    const s = addComponent(parts(), "acute", counterIds("c")).state;
    const out = decomposeCurrentGlyph(s, counterIds("d"));
    const g = out.state.document.glyphs["aacute"]!;

    expect(g.components).toHaveLength(0);
    // The accent's rectangle, placed: four nodes at the offset it sat at.
    expect(g.contours).toHaveLength(1);
    expect(g.contours[0]!.nodes[0]!.pt).toEqual(vec(210, 210));
    // The anchors are the glyph's own and stay exactly where they were.
    expect(g.anchors).toHaveLength(1);
  });

  it("does nothing to a glyph with no components", () => {
    const s = parts();
    expect(decomposeCurrentGlyph(s, counterIds("d")).state).toBe(s);
  });
});

describe("harmonising", () => {
  /** An arch whose apex sits off the point where the two curvatures agree. */
  const arch = (): { s: EditorState; c: Contour } => {
    const ids = counterIds("hz");
    const c = contour(
      ids.contour(),
      [
        node(ids.node(), vec(0, 0), { type: "corner", out: vec(0, 90) }),
        node(ids.node(), vec(120, 150), { type: "smooth", in: vec(40, 140), out: vec(220, 165) }),
        node(ids.node(), vec(320, 0), { type: "corner", in: vec(320, 90) }),
      ],
      false,
    );
    return { s: start(c).s, c };
  };

  const pointOf = (s: EditorState, i: number) => firstGlyph(s.document).contours[0]!.nodes[i]!.pt;

  it("reads the curvature either side of the selected node, as radii", () => {
    const { s, c } = arch();
    const chosen = selectPoint(s, c, 1);
    const reading = selectedCurvature(chosen)!;

    expect(reading).not.toBeNull();
    // Off the harmonious point, so the two radii differ and the ratio says so.
    expect(reading.ratio).toBeGreaterThan(1.2);
    expect(reading.before).toBeGreaterThan(0);
  });

  it("moves the selected node until they agree, in one step", () => {
    const { s, c } = arch();
    const out = harmoniseSelection(selectPoint(s, c, 1));

    expect(pointOf(out.state, 1)).not.toEqual(vec(120, 150));
    expect(selectedCurvature(out.state)!.ratio).toBeCloseTo(1, 6);
    expect(out.effects).toEqual([
      { kind: "beginTransaction", label: "Harmonise", coalesce: false },
      { kind: "commitTransaction" },
    ]);
  });

  it("passes over what it cannot harmonise rather than refusing the lot", () => {
    const { s, c } = arch();
    // The whole contour: two corners with a straight side and the apex.
    const all: EditorState = {
      ...s,
      selection: c.nodes.map((n) => ({ contourId: c.id, nodeId: n.id, part: "point" as const })),
    };

    const out = harmoniseSelection(all);
    expect(pointOf(out.state, 1)).not.toEqual(vec(120, 150));
    // The ends are untouched: neither has two curves to reconcile.
    expect(pointOf(out.state, 0)).toEqual(vec(0, 0));
    expect(pointOf(out.state, 2)).toEqual(vec(320, 0));
  });

  it("does nothing at all when there is nothing to move", () => {
    const { s, c } = arch();
    const once = harmoniseSelection(selectPoint(s, c, 1)).state;
    const again = selectPoint(once, c, 1);
    const twice = harmoniseSelection(again);

    // The very same state back, and no step in the history: a node already
    // where it belongs is not an edit.
    expect(twice.state).toBe(again);
    expect(twice.effects).toEqual([]);
  });

  it("offers itself only where it would move the point", () => {
    const { s, c } = arch();
    expect(nodeCanHarmonise(s, c.id, c.nodes[1]!.id)).toBe(true);
    expect(nodeCanHarmonise(s, c.id, c.nodes[0]!.id)).toBe(false);
  });
});
