import { distance, vec } from "@fonteditor/geometry";
import {
  type Contour,
  addContour,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
  nodeById,
  segmentTunniPoint,
} from "@fonteditor/font-model";
import type { Selection, ViewTransform } from "@fonteditor/view";
import { describe, expect, it } from "vitest";

import { pointerInput, keyInput } from "../src/input.js";
import {
  cancel,
  doubleClick,
  keyDown,
  pointerDown,
  pointerLeave,
  pointerMove,
  pointerUp,
} from "../src/select.js";
import { type EditorState, editorState, marqueeRect, tunniSegments } from "../src/state.js";

const VIEW: ViewTransform = { scale: 1, tx: 0, ty: 0 };

/** An arch of two curve segments, roughly the shoulder of an 'n'. */
function arch(): Contour {
  const ids = counterIds();
  return contour(
    ids.contour(),
    [
      node(ids.node(), vec(100, 480), { type: "corner", out: vec(100, 632) }),
      node(ids.node(), vec(320, 700), { type: "smooth", in: vec(208, 700), out: vec(432, 700) }),
      node(ids.node(), vec(540, 480), { type: "corner", in: vec(540, 632) }),
    ],
    false,
  );
}

function start(c: Contour = arch()): { state: EditorState; contour: Contour } {
  return {
    state: editorState({
      document: fontDocument(addContour(glyph("n", { advance: 640 }), c)),
      view: VIEW,
    }),
    contour: c,
  };
}

/** Run a whole gesture as a list of points, the way the host would. */
function drag(
  state: EditorState,
  from: ReturnType<typeof vec>,
  through: ReturnType<typeof vec>[],
  mods: Parameters<typeof pointerInput>[1] = {},
): EditorState {
  let s = pointerDown(state, pointerInput(from, mods)).state;
  for (const p of through) s = pointerMove(s, pointerInput(p, mods)).state;
  return pointerUp(s).state;
}

const pointOf = (s: EditorState, c: Contour, i: number) =>
  nodeById(s.document.glyph.contours[0]!, c.nodes[i]!.id)!;

describe("hover", () => {
  it("wakes the segment under the cursor without changing anything else", () => {
    const { state } = start();
    const next = pointerMove(state, pointerInput(vec(150, 520))).state;
    expect(next.hoveredSegment).not.toBeNull();
    expect(next.hoveredSegment!.segmentIndex).toBe(0);
    expect(next.document).toBe(state.document);
    expect(next.selection).toEqual([]);
  });

  it("sleeps when the pointer leaves", () => {
    const { state } = start();
    const hovered = pointerMove(state, pointerInput(vec(150, 520))).state;
    expect(pointerLeave(hovered).state.hoveredSegment).toBeNull();
  });

  it("keeps the segment awake while a drag is in flight off-canvas", () => {
    const { state } = start();
    const hovered = pointerMove(state, pointerInput(vec(100, 480))).state;
    const down = pointerDown(hovered, pointerInput(vec(100, 480))).state;
    const left = pointerLeave(down).state;
    expect(left.hoveredSegment).toEqual(hovered.hoveredSegment);
    expect(left.gesture).not.toBeNull();
  });

  it("forgets hover but keeps focus when the pointer leaves", () => {
    const { state, contour: c } = start();
    const tunni = segmentTunniPoint(c, 0)!;
    let s = pointerMove(state, pointerInput(tunni)).state;
    s = pointerUp(pointerDown(s, pointerInput(tunni)).state).state;
    expect(s.focusedSegment).not.toBeNull();

    const left = pointerLeave(s).state;
    expect(left.hoveredSegment).toBeNull();
    expect(left.focusedSegment).toEqual(s.focusedSegment);
  });
});

describe("focus", () => {
  // The bug this exists to fix. Dragging a Tunni point away from its own segment
  // and towards another one means that, on release, the other segment is nearer.
  // With hover as the only rule the controls are handed over and the point just
  // released becomes unreachable.
  it("keeps a dragged segment's controls after the cursor moves nearer another", () => {
    const { state, contour: c } = start();
    const tunni = segmentTunniPoint(c, 0)!;

    let s = pointerMove(state, pointerInput(tunni)).state;
    s = pointerDown(s, pointerInput(tunni)).state;
    s = pointerMove(s, pointerInput(vec(tunni.x, tunni.y - 30))).state;
    s = pointerUp(s).state;

    // Now wander over to where segment 1 is the nearest thing.
    s = pointerMove(s, pointerInput(vec(540, 500))).state;
    expect(s.hoveredSegment!.segmentIndex).toBe(1);

    // Segment 0 is still focused, so its controls are still shown…
    expect(s.focusedSegment!.segmentIndex).toBe(0);
    expect(tunniSegments(s).map((ref) => ref.segmentIndex).sort()).toEqual([0, 1]);

    // …and, crucially, still grabbable.
    const stillThere = segmentTunniPoint(s.document.glyph.contours[0]!, 0)!;
    const grabbed = pointerDown(s, pointerInput(stillThere)).state;
    expect(grabbed.gesture?.kind).toBe("dragTunniPoint");
  });

  it("is taken by clicking a segment", () => {
    const { state, contour: c } = start();
    const s = pointerDown(state, pointerInput(vec(168, 647))).state;
    expect(s.focusedSegment).toEqual({ contourId: c.id, segmentIndex: 0 });
  });

  it("is taken by balancing", () => {
    const { state, contour: c } = start();
    const tunni = segmentTunniPoint(c, 0)!;
    const awake = pointerMove(state, pointerInput(tunni)).state;
    const balanced = doubleClick(awake, pointerInput(tunni)).state;
    expect(balanced.focusedSegment).toEqual({ contourId: c.id, segmentIndex: 0 });
  });

  it("is dropped by clicking empty canvas", () => {
    const { state, contour: c } = start();
    const tunni = segmentTunniPoint(c, 0)!;
    let s = pointerMove(state, pointerInput(tunni)).state;
    s = pointerUp(pointerDown(s, pointerInput(tunni)).state).state;
    expect(s.focusedSegment).not.toBeNull();

    s = pointerDown(s, pointerInput(vec(4000, 4000))).state;
    expect(s.focusedSegment).toBeNull();
  });

  it("survives a shift-click on empty canvas, which is an additive marquee", () => {
    const { state, contour: c } = start();
    const tunni = segmentTunniPoint(c, 0)!;
    let s = pointerMove(state, pointerInput(tunni)).state;
    s = pointerUp(pointerDown(s, pointerInput(tunni)).state).state;
    s = pointerDown(s, pointerInput(vec(4000, 4000), { shift: true })).state;
    expect(s.focusedSegment).not.toBeNull();
  });

  it("deduplicates when hover and focus are the same segment", () => {
    const { state, contour: c } = start();
    const tunni = segmentTunniPoint(c, 0)!;
    let s = pointerMove(state, pointerInput(tunni)).state;
    s = pointerUp(pointerDown(s, pointerInput(tunni)).state).state;
    expect(s.hoveredSegment!.segmentIndex).toBe(0);
    expect(s.focusedSegment!.segmentIndex).toBe(0);
    expect(tunniSegments(s)).toHaveLength(1);
  });
});

describe("selecting", () => {
  it("selects a node on click", () => {
    const { state, contour: c } = start();
    const next = pointerDown(state, pointerInput(vec(100, 480))).state;
    expect(next.selection).toEqual([
      { contourId: c.id, nodeId: c.nodes[0]!.id, part: "point" },
    ]);
  });

  // Handles are selectable in their own right, so they can be nudged and drawn
  // as active rather than riding along with their node.
  it("selects a handle as a thing in itself", () => {
    const { state, contour: c } = start();
    const next = pointerDown(state, pointerInput(vec(100, 632))).state;
    expect(next.selection).toEqual([
      { contourId: c.id, nodeId: c.nodes[0]!.id, part: "out" },
    ]);
  });

  it("replaces the selection on a plain click", () => {
    const { state } = start();
    const first = pointerUp(pointerDown(state, pointerInput(vec(100, 480))).state).state;
    const second = pointerDown(first, pointerInput(vec(540, 480))).state;
    expect(second.selection).toHaveLength(1);
  });

  it("extends with shift and removes on a second shift-click", () => {
    const { state } = start();
    let s = pointerUp(pointerDown(state, pointerInput(vec(100, 480))).state).state;
    s = pointerUp(pointerDown(s, pointerInput(vec(540, 480), { shift: true })).state).state;
    expect(s.selection).toHaveLength(2);

    s = pointerDown(s, pointerInput(vec(540, 480), { shift: true })).state;
    expect(s.selection).toHaveLength(1);
    // Shift-clicking something off must not then drag it.
    expect(s.gesture).toBeNull();
  });

  // Grabbing one member of a multi-selection to drag the group must not first
  // collapse the selection down to that member.
  it("keeps a multi-selection when one of its members is grabbed", () => {
    const { state } = start();
    let s = pointerUp(pointerDown(state, pointerInput(vec(100, 480))).state).state;
    s = pointerUp(pointerDown(s, pointerInput(vec(540, 480), { shift: true })).state).state;
    s = pointerDown(s, pointerInput(vec(100, 480))).state;
    expect(s.selection).toHaveLength(2);
  });

  it("clears the selection when clicking empty canvas", () => {
    const { state } = start();
    const selected = pointerUp(pointerDown(state, pointerInput(vec(100, 480))).state).state;
    const cleared = pointerDown(selected, pointerInput(vec(3000, 3000))).state;
    expect(cleared.selection).toEqual([]);
  });

  it("selects both ends when a segment is clicked", () => {
    const { state, contour: c } = start();
    // The midpoint of segment 0, worked out by hand:
    // B(1/2) = (a + 3c1 + 3c2 + b) / 8 = (168, 647).
    const next = pointerDown(state, pointerInput(vec(168, 647))).state;
    expect(next.selection).toEqual([
      { contourId: c.id, nodeId: c.nodes[0]!.id, part: "point" },
      { contourId: c.id, nodeId: c.nodes[1]!.id, part: "point" },
    ]);
  });
});

describe("marquee", () => {
  it("selects everything inside the rectangle", () => {
    const { state } = start();
    let s = pointerDown(state, pointerInput(vec(0, 400))).state;
    s = pointerMove(s, pointerInput(vec(700, 800))).state;
    // Three nodes plus four handles.
    expect(s.selection).toHaveLength(7);
    expect(marqueeRect(s)).toEqual({ minX: 0, minY: 400, maxX: 700, maxY: 800 });
  });

  it("catches handles independently of their nodes", () => {
    const { state, contour: c } = start();
    let s = pointerDown(state, pointerInput(vec(60, 600))).state;
    s = pointerMove(s, pointerInput(vec(140, 680))).state;
    expect(s.selection).toEqual([
      { contourId: c.id, nodeId: c.nodes[0]!.id, part: "out" },
    ]);
  });

  it("adds to the existing selection when shift is held", () => {
    const { state } = start();
    let s = pointerUp(pointerDown(state, pointerInput(vec(540, 480))).state).state;
    expect(s.selection).toHaveLength(1);

    s = pointerDown(s, pointerInput(vec(60, 600), { shift: true })).state;
    s = pointerMove(s, pointerInput(vec(140, 680), { shift: true })).state;
    expect(s.selection).toHaveLength(2);
  });

  it("has no marquee rectangle when no marquee is running", () => {
    expect(marqueeRect(start().state)).toBeNull();
  });
});

describe("dragging", () => {
  it("moves a node and carries its handles", () => {
    const { state, contour: c } = start();
    const moved = drag(state, vec(100, 480), [vec(120, 500), vec(140, 520)]);
    const n = pointOf(moved, c, 0);
    expect(n.pt).toEqual(vec(140, 520));
    expect(n.out).toEqual(vec(140, 672));
  });

  // Recomputing from the gesture's starting snapshot plus the total offset,
  // rather than nudging the previous frame, is what keeps four hundred pointer
  // events from accumulating drift.
  it("gives the same result however many steps the drag took", () => {
    const { state, contour: c } = start();
    const coarse = drag(state, vec(100, 480), [vec(180, 560)]);
    const steps = Array.from({ length: 80 }, (_, i) => vec(100 + i + 1, 480 + i + 1));
    const fine = drag(state, vec(100, 480), steps);
    expect(distance(pointOf(coarse, c, 0).pt, pointOf(fine, c, 0).pt)).toBeLessThan(1e-12);
  });

  it("moves every selected item together", () => {
    const { state, contour: c } = start();
    let s = pointerUp(pointerDown(state, pointerInput(vec(100, 480))).state).state;
    s = pointerUp(pointerDown(s, pointerInput(vec(540, 480), { shift: true })).state).state;
    s = drag(s, vec(100, 480), [vec(110, 480)]);

    expect(pointOf(s, c, 0).pt).toEqual(vec(110, 480));
    expect(pointOf(s, c, 2).pt).toEqual(vec(550, 480));
  });

  it("keeps a smooth node smooth when one handle is dragged", () => {
    const { state, contour: c } = start();
    const moved = drag(state, vec(208, 700), [vec(180, 760)]);
    const n = pointOf(moved, c, 1);
    const toIn = { x: n.in!.x - n.pt.x, y: n.in!.y - n.pt.y };
    const toOut = { x: n.out!.x - n.pt.x, y: n.out!.y - n.pt.y };
    expect(Math.abs(toIn.x * toOut.y - toIn.y * toOut.x)).toBeLessThan(1e-6);
    expect(toIn.x * toOut.x + toIn.y * toOut.y).toBeLessThan(0);
  });

  it("breaks the smooth link when alt is held, and records the node as a corner", () => {
    const { state, contour: c } = start();
    const before = pointOf(state, c, 1).out;
    const moved = drag(state, vec(208, 700), [vec(180, 760)], { alt: true });
    const n = pointOf(moved, c, 1);
    expect(n.out).toEqual(before);
    expect(n.type).toBe("corner");
  });

  it("leaves the anchors alone when a handle is dragged", () => {
    const { state, contour: c } = start();
    const moved = drag(state, vec(100, 632), [vec(60, 700)]);
    expect(pointOf(moved, c, 0).pt).toEqual(vec(100, 480));
  });
});

describe("Tunni gestures", () => {
  const wake = (s: EditorState, p: ReturnType<typeof vec>) =>
    pointerMove(s, pointerInput(p)).state;

  it("drags the Tunni point and leaves it where it was put", () => {
    const { state, contour: c } = start();
    const tunni = segmentTunniPoint(c, 0)!;
    const awake = wake(state, tunni);
    const target = vec(tunni.x - 10, tunni.y - 30);

    const moved = drag(awake, tunni, [target]);
    const landed = segmentTunniPoint(moved.document.glyph.contours[0]!, 0)!;
    expect(distance(landed, target)).toBeLessThan(1e-6);
  });

  it("does not touch the selection", () => {
    const { state, contour: c } = start();
    const tunni = segmentTunniPoint(c, 0)!;
    const awake = wake(state, tunni);
    const moved = drag(awake, tunni, [vec(tunni.x, tunni.y - 20)]);
    expect(moved.selection).toEqual([]);
  });

  // Only a visible control may be grabbed. With no segment hovered or focused
  // there is no Tunni target, so this is a click on empty canvas.
  it("cannot be grabbed while its segment is asleep", () => {
    const { state, contour: c } = start();
    const tunni = segmentTunniPoint(c, 0)!;
    const down = pointerDown(state, pointerInput(tunni)).state;
    expect(down.gesture?.kind).toBe("marquee");
  });

  it("balances the segment on double-click", () => {
    const { state, contour: c } = start();
    const tunni = segmentTunniPoint(c, 0)!;
    const awake = wake(state, tunni);
    const balanced = doubleClick(awake, pointerInput(tunni)).state;

    const seg = balanced.document.glyph.contours[0]!;
    const a = seg.nodes[0]!.pt;
    const b = seg.nodes[1]!.pt;
    const chord = { x: b.x - a.x, y: b.y - a.y };
    const line = { x: seg.nodes[1]!.in!.x - seg.nodes[0]!.out!.x, y: seg.nodes[1]!.in!.y - seg.nodes[0]!.out!.y };
    const scale = Math.hypot(chord.x, chord.y) * Math.hypot(line.x, line.y);
    expect(Math.abs(chord.x * line.y - chord.y * line.x) / scale).toBeLessThan(1e-9);
  });

  it("holds the last good geometry when a move is refused", () => {
    const { state, contour: c } = start();
    const tunni = segmentTunniPoint(c, 0)!;
    const awake = wake(state, tunni);
    let s = pointerDown(awake, pointerInput(tunni)).state;
    const good = pointerMove(s, pointerInput(vec(tunni.x, tunni.y - 20))).state;
    // Far below the chord would pull both handles through their anchors.
    s = pointerMove(good, pointerInput(vec(tunni.x, tunni.y - 40000))).state;
    expect(s.document).toBe(good.document);
  });
});

describe("keyboard", () => {
  it("nudges the selection by one unit", () => {
    const { state, contour: c } = start();
    const selected = pointerUp(pointerDown(state, pointerInput(vec(100, 480))).state).state;
    const nudged = keyDown(selected, keyInput("ArrowRight")).state;
    expect(pointOf(nudged, c, 0).pt).toEqual(vec(101, 480));
  });

  it("nudges further with shift", () => {
    const { state, contour: c } = start();
    const selected = pointerUp(pointerDown(state, pointerInput(vec(100, 480))).state).state;
    const nudged = keyDown(selected, keyInput("ArrowUp", { shift: true })).state;
    // Design space is y-up, so ArrowUp raises y.
    expect(pointOf(nudged, c, 0).pt).toEqual(vec(100, 490));
  });

  it("nudges a selected handle on its own", () => {
    const { state, contour: c } = start();
    const selected = pointerUp(pointerDown(state, pointerInput(vec(100, 632))).state).state;
    const nudged = keyDown(selected, keyInput("ArrowLeft")).state;
    const n = pointOf(nudged, c, 0);
    expect(n.out).toEqual(vec(99, 632));
    expect(n.pt).toEqual(vec(100, 480));
  });

  it("does nothing with an empty selection", () => {
    const { state } = start();
    expect(keyDown(state, keyInput("ArrowRight")).state.document).toBe(state.document);
  });

  it("ignores keys it does not handle", () => {
    const { state } = start();
    const selected = pointerUp(pointerDown(state, pointerInput(vec(100, 480))).state).state;
    expect(keyDown(selected, keyInput("q")).state).toBe(selected);
  });
});

describe("cancelling", () => {
  it("puts the geometry back exactly when Escape ends a drag", () => {
    const { state } = start();
    let s = pointerDown(state, pointerInput(vec(100, 480))).state;
    s = pointerMove(s, pointerInput(vec(300, 300))).state;
    expect(s.document).not.toBe(state.document);

    const cancelled = keyDown(s, keyInput("Escape")).state;
    expect(cancelled.document).toBe(state.document);
    expect(cancelled.gesture).toBeNull();
  });

  it("restores the selection a marquee replaced", () => {
    const { state } = start();
    const selected = pointerUp(pointerDown(state, pointerInput(vec(540, 480))).state).state;
    let s = pointerDown(selected, pointerInput(vec(0, 400))).state;
    s = pointerMove(s, pointerInput(vec(700, 800))).state;
    expect(s.selection).toHaveLength(7);

    const cancelled = cancel(s).state;
    expect(cancelled.selection).toEqual(selected.selection);
  });

  it("is a no-op when nothing is in progress", () => {
    const { state } = start();
    expect(cancel(state).state).toBe(state);
  });
});

describe("transaction effects", () => {
  it("emits one begin and one commit for a whole drag", () => {
    const { state } = start();
    const down = pointerDown(state, pointerInput(vec(100, 480)));
    expect(down.effects).toEqual([{ kind: "beginTransaction", label: "Move node" }]);

    let s = down.state;
    for (const p of [vec(110, 490), vec(120, 500), vec(130, 510)]) {
      const moved = pointerMove(s, pointerInput(p));
      expect(moved.effects).toEqual([]);
      s = moved.state;
    }

    expect(pointerUp(s).effects).toEqual([{ kind: "commitTransaction" }]);
  });

  // The prototype pushed a history entry on every mouse-up, so clicking without
  // moving filled the undo stack with steps that undo nothing.
  it("aborts rather than commits when nothing moved", () => {
    const { state } = start();
    const down = pointerDown(state, pointerInput(vec(100, 480))).state;
    const up = pointerUp(down);
    expect(up.effects).toEqual([{ kind: "abortTransaction" }]);
  });

  it("aborts on Escape", () => {
    const { state } = start();
    let s = pointerDown(state, pointerInput(vec(100, 480))).state;
    s = pointerMove(s, pointerInput(vec(300, 300))).state;
    expect(keyDown(s, keyInput("Escape")).effects).toEqual([{ kind: "abortTransaction" }]);
  });

  it("wraps a nudge in its own transaction", () => {
    const { state } = start();
    const selected = pointerUp(pointerDown(state, pointerInput(vec(100, 480))).state).state;
    expect(keyDown(selected, keyInput("ArrowRight")).effects).toEqual([
      { kind: "beginTransaction", label: "Nudge" },
      { kind: "commitTransaction" },
    ]);
  });

  it("labels a handle drag distinctly from a node drag", () => {
    const { state } = start();
    expect(pointerDown(state, pointerInput(vec(100, 632))).effects).toEqual([
      { kind: "beginTransaction", label: "Move handle" },
    ]);
  });
});

describe("purity", () => {
  it("never mutates the state it was given", () => {
    const { state } = start();
    const snapshot = structuredClone(state);
    let s = pointerDown(state, pointerInput(vec(100, 480))).state;
    s = pointerMove(s, pointerInput(vec(200, 600))).state;
    pointerUp(s);
    keyDown(state, keyInput("ArrowRight"));
    expect(state).toEqual(snapshot);
  });

  it("produces a selection that survives a JSON round-trip", () => {
    const { state } = start();
    let s = pointerDown(state, pointerInput(vec(0, 400))).state;
    s = pointerMove(s, pointerInput(vec(700, 800))).state;
    const selection: Selection = s.selection;
    expect(JSON.parse(JSON.stringify(selection))).toEqual(selection);
  });
});
