import { distance, vec } from "@fonteditor/geometry";
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
  nodeById,
  orderedGlyphs,
  segmentTunniPoint,
  sidebearings,
} from "@fonteditor/font-model";
import { type Selection, type ViewTransform, boxHandlePoint, boxPivot } from "@fonteditor/view";
import { describe, expect, it } from "vitest";

import { selectContour } from "../src/commands.js";
import { pointerInput, keyInput } from "../src/input.js";
import {
  cancel,
  doubleClick,
  selectionBox,
  keyDown,
  pointerDown,
  pointerLeave,
  pointerMove,
  pointerUp,
} from "../src/select.js";
import {
  type EditorState,
  currentGlyph,
  editorState,
  marqueeRect,
  tunniSegments,
} from "../src/state.js";

/** The document holds many glyphs now; these tests each work with one. */
const firstGlyph = (d: FontDocument): Glyph => orderedGlyphs(d)[0]!;

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
      document: fontDocument([addContour(glyph("n", { advance: 640 }), c)]),
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
  nodeById(firstGlyph(s.document).contours[0]!, c.nodes[i]!.id)!;

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
    expect(
      tunniSegments(s)
        .map((ref) => ref.segmentIndex)
        .sort(),
    ).toEqual([0, 1]);

    // …and, crucially, still grabbable.
    const stillThere = segmentTunniPoint(firstGlyph(s.document).contours[0]!, 0)!;
    const grabbed = pointerDown(s, pointerInput(stillThere)).state;
    expect(grabbed.gesture?.kind).toBe("dragTunniPoint");
  });

  // Dragging a Tunni control changed focus but dragging a handle did not, which
  // is the same class of problem: the segment you are shaping loses its controls
  // to whatever the cursor happens to be nearest.
  it("is taken by grabbing a handle, which shapes exactly one segment", () => {
    const { state, contour: c } = start();

    // The out handle of node 0 shapes segment 0.
    const out = pointerDown(state, pointerInput(vec(100, 632))).state;
    expect(out.focusedSegment).toEqual({ contourId: c.id, segmentIndex: 0 });

    // The out handle of node 1 shapes segment 1.
    const next = pointerDown(state, pointerInput(vec(432, 700))).state;
    expect(next.focusedSegment).toEqual({ contourId: c.id, segmentIndex: 1 });
  });

  it("follows the in handle to the segment arriving at its node", () => {
    const { state, contour: c } = start();
    const s = pointerDown(state, pointerInput(vec(208, 700))).state;
    expect(s.focusedSegment).toEqual({ contourId: c.id, segmentIndex: 0 });
  });

  // A node sits between two segments and names neither, so guessing one would be
  // arbitrary. Leaving focus alone also means dragging a node never confiscates
  // the controls you were just using.
  it("is left alone by dragging a node", () => {
    const { state, contour: c } = start();
    const onHandle = pointerUp(pointerDown(state, pointerInput(vec(432, 700))).state).state;
    expect(onHandle.focusedSegment).toEqual({ contourId: c.id, segmentIndex: 1 });

    const onNode = pointerDown(onHandle, pointerInput(vec(100, 480))).state;
    expect(onNode.focusedSegment).toEqual({ contourId: c.id, segmentIndex: 1 });
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
    expect(next.selection).toEqual([{ contourId: c.id, nodeId: c.nodes[0]!.id, part: "point" }]);
  });

  // Handles are selectable in their own right, so they can be nudged and drawn
  // as active rather than riding along with their node.
  it("selects a handle as a thing in itself", () => {
    const { state, contour: c } = start();
    const next = pointerDown(state, pointerInput(vec(100, 632))).state;
    expect(next.selection).toEqual([{ contourId: c.id, nodeId: c.nodes[0]!.id, part: "out" }]);
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
    // Started clear of x = 0, which is the origin line and grabbable now.
    let s = pointerDown(state, pointerInput(vec(-40, 400))).state;
    s = pointerMove(s, pointerInput(vec(700, 800))).state;
    // Three nodes plus four handles.
    expect(s.selection).toHaveLength(7);
    expect(marqueeRect(s)).toEqual({ minX: -40, minY: 400, maxX: 700, maxY: 800 });
  });

  it("catches handles independently of their nodes", () => {
    const { state, contour: c } = start();
    let s = pointerDown(state, pointerInput(vec(60, 600))).state;
    s = pointerMove(s, pointerInput(vec(140, 680))).state;
    expect(s.selection).toEqual([{ contourId: c.id, nodeId: c.nodes[0]!.id, part: "out" }]);
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
  const wake = (s: EditorState, p: ReturnType<typeof vec>) => pointerMove(s, pointerInput(p)).state;

  it("drags the Tunni point and leaves it where it was put", () => {
    const { state, contour: c } = start();
    const tunni = segmentTunniPoint(c, 0)!;
    const awake = wake(state, tunni);
    const target = vec(tunni.x - 10, tunni.y - 30);

    const moved = drag(awake, tunni, [target]);
    const landed = segmentTunniPoint(firstGlyph(moved.document).contours[0]!, 0)!;
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

    const seg = firstGlyph(balanced.document).contours[0]!;
    const a = seg.nodes[0]!.pt;
    const b = seg.nodes[1]!.pt;
    const chord = { x: b.x - a.x, y: b.y - a.y };
    const line = {
      x: seg.nodes[1]!.in!.x - seg.nodes[0]!.out!.x,
      y: seg.nodes[1]!.in!.y - seg.nodes[0]!.out!.y,
    };
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
    // Clear of x = 0, which the origin line now occupies.
    let s = pointerDown(selected, pointerInput(vec(-40, 400))).state;
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

describe("margin lines", () => {
  it("starts a margin drag when pressed on, not a marquee", () => {
    const { state } = start();
    const s = pointerDown(state, pointerInput(vec(0, 400))).state;
    expect(s.gesture?.kind).toBe("dragMargin");
  });

  it("dragging the advance line changes the advance and nothing else", () => {
    const { state } = start();
    const before = currentGlyph(state)!;

    let s = pointerDown(state, pointerInput(vec(before.advance, 300))).state;
    s = pointerMove(s, pointerInput(vec(before.advance + 120, 300))).state;
    const after = currentGlyph(s)!;

    expect(after.advance).toBe(before.advance + 120);
    expect(after.contours).toEqual(before.contours);
  });

  it("never drives the advance negative", () => {
    const { state } = start();
    const before = currentGlyph(state)!;

    let s = pointerDown(state, pointerInput(vec(before.advance, 300))).state;
    s = pointerMove(s, pointerInput(vec(before.advance - 99999, 300))).state;
    expect(currentGlyph(s)!.advance).toBe(0);
  });

  it("dragging the origin line moves the outline and holds the right sidebearing", () => {
    const { state } = start();
    const before = currentGlyph(state)!;
    const rightBefore = sidebearings(before)!.right;

    let s = pointerDown(state, pointerInput(vec(0, 400))).state;
    s = pointerMove(s, pointerInput(vec(75, 400))).state;
    const after = currentGlyph(s)!;

    expect(sidebearings(after)!.left).toBeCloseTo(sidebearings(before)!.left + 75, 6);
    expect(sidebearings(after)!.right).toBeCloseTo(rightBefore, 6);
    expect(after.advance).toBe(before.advance + 75);
  });

  it("clears the selection, so a later nudge does not move points instead", () => {
    const { state } = start();
    const selected = pointerUp(pointerDown(state, pointerInput(vec(540, 480))).state).state;
    expect(selected.selection.length).toBeGreaterThan(0);

    const s = pointerDown(selected, pointerInput(vec(0, 400))).state;
    expect(s.selection).toEqual([]);
  });

  it("commits once the drag has moved, and aborts when it has not", () => {
    const { state } = start();
    const pressed = pointerDown(state, pointerInput(vec(0, 400))).state;
    expect(pointerUp(pressed).effects.map((e) => e.kind)).toContain("abortTransaction");

    const moved = pointerMove(pressed, pointerInput(vec(60, 400))).state;
    expect(pointerUp(moved).effects.map((e) => e.kind)).toContain("commitTransaction");
  });

  it("is not offered when the surface does not draw margins", () => {
    const { state } = start();
    const s = pointerDown(state, pointerInput(vec(0, 400)), { margins: false }).state;
    expect(s.gesture?.kind).toBe("marquee");
  });
});

describe("snapping", () => {
  /** A single free-standing node, so a drag has nothing else to interfere with. */
  function loneNode(): { state: EditorState; contour: Contour } {
    const ids = counterIds("snap");
    const c = contour(ids.contour(), [node(ids.node(), vec(100, 300))], false);
    return start(c);
  }

  /** Select that node and drag it by the given offset, ending the gesture. */
  function dragBy(
    state: EditorState,
    from: { x: number; y: number },
    by: { x: number; y: number },
  ) {
    let s = pointerDown(state, pointerInput(vec(from.x, from.y))).state;
    s = pointerMove(s, pointerInput(vec(from.x + by.x, from.y + by.y))).state;
    return pointerUp(s).state;
  }

  it("rounds a drag to whole units", () => {
    const { state, contour: c } = loneNode();
    const moved = dragBy(state, { x: 100, y: 300 }, { x: 40.7, y: -20.4 });

    const n = nodeById(firstGlyph(moved.document).contours[0]!, c.nodes[0]!.id)!;
    expect(n.pt).toEqual({ x: 141, y: 280 });
  });

  it("catches the x-height rather than the whole unit beside it", () => {
    const { state, contour: c } = loneNode();
    // Landing at y = 497, three units under the 500 x-height and inside the
    // six-pixel catch radius at scale 1.
    const moved = dragBy(state, { x: 100, y: 300 }, { x: 0, y: 197 });

    const n = nodeById(firstGlyph(moved.document).contours[0]!, c.nodes[0]!.id)!;
    expect(n.pt.y).toBe(500);
  });

  it("catches the origin, which is a line the canvas draws", () => {
    const { state, contour: c } = loneNode();
    const moved = dragBy(state, { x: 100, y: 300 }, { x: -96, y: 0 });

    const n = nodeById(firstGlyph(moved.document).contours[0]!, c.nodes[0]!.id)!;
    expect(n.pt.x).toBe(0);
  });

  it("leaves the coordinate exactly where the cursor is when ctrl is held", () => {
    const { state, contour: c } = loneNode();
    let s = pointerDown(state, pointerInput(vec(100, 300))).state;
    s = pointerMove(s, pointerInput(vec(140.7, 279.6), { ctrl: true })).state;
    s = pointerUp(s).state;

    const n = nodeById(firstGlyph(s.document).contours[0]!, c.nodes[0]!.id)!;
    expect(n.pt).toEqual({ x: 140.7, y: 279.6 });
  });

  it("obeys a caller that turns snapping off", () => {
    const { state, contour: c } = loneNode();
    let s = pointerDown(state, pointerInput(vec(100, 300))).state;
    s = pointerMove(s, pointerInput(vec(140.7, 279.6)), { snap: false }).state;

    const n = nodeById(firstGlyph(s.document).contours[0]!, c.nodes[0]!.id)!;
    expect(n.pt).toEqual({ x: 140.7, y: 279.6 });
  });

  it("moves a multi-point selection as one body", () => {
    const ids = counterIds("body");
    const c = contour(
      ids.contour(),
      [node(ids.node(), vec(100, 300)), node(ids.node(), vec(200, 495))],
      false,
    );
    const { state } = start(c);

    const selection: Selection = c.nodes.map((n) => ({
      contourId: c.id,
      nodeId: n.id,
      part: "point" as const,
    }));
    let s: EditorState = { ...state, selection };

    // Grab the lower node and nudge upward. The *upper* node is the one that
    // finds the x-height, and both must move by its correction.
    s = pointerDown(s, pointerInput(vec(100, 300))).state;
    s = pointerMove(s, pointerInput(vec(100, 302.3))).state;

    const nodes = firstGlyph(s.document).contours[0]!.nodes;
    expect(nodes[1]!.pt.y).toBe(500);
    expect(nodes[0]!.pt.y).toBe(305);
  });

  it("keeps a dragged advance whole", () => {
    const { state } = loneNode();
    // The advance line is grabbable, and lands the advance on a whole number.
    let s = pointerDown(state, pointerInput(vec(640, 200))).state;
    s = pointerMove(s, pointerInput(vec(700.4, 200))).state;

    expect(firstGlyph(s.document).advance).toBe(700);
  });
});

describe("point-to-point snapping", () => {
  /**
   * Two upright stems, the left one at x = 100 and the right at x = 400, plus a
   * loose node to drag around between them.
   */
  function stems() {
    const ids = counterIds("stem");
    const left = contour(
      ids.contour(),
      [
        node(ids.node(), vec(100, 0)),
        node(ids.node(), vec(180, 0)),
        node(ids.node(), vec(180, 700)),
        node(ids.node(), vec(100, 700)),
      ],
      true,
    );
    const loose = contour(ids.contour(), [node(ids.node(), vec(300, 300))], false);
    return {
      state: editorState({
        document: fontDocument([addContour(addContour(glyph("n", { advance: 640 }), left), loose)]),
        view: VIEW,
      }),
      loose,
    };
  }

  const dragTo = (
    state: EditorState,
    from: { x: number; y: number },
    to: { x: number; y: number },
    options: Parameters<typeof pointerMove>[2],
  ) => {
    const down = pointerDown(state, pointerInput(vec(from.x, from.y)), options).state;
    return pointerMove(down, pointerInput(vec(to.x, to.y)), options).state;
  };

  it("ignores other points unless asked", () => {
    const { state, loose } = stems();
    // Landing at x = 104, four units from the stem edge — well inside the catch
    // radius, and deliberately not caught.
    const moved = dragTo(state, { x: 300, y: 300 }, { x: 104, y: 300 }, {});
    const n = nodeById(firstGlyph(moved.document).contours[1]!, loose.nodes[0]!.id)!;
    expect(n.pt.x).toBe(104);
  });

  it("lines up with a stem edge across the glyph when asked", () => {
    const { state, loose } = stems();
    const moved = dragTo(state, { x: 300, y: 300 }, { x: 104, y: 300 }, { snapExtremes: true });
    const n = nodeById(firstGlyph(moved.document).contours[1]!, loose.nodes[0]!.id)!;
    expect(n.pt.x).toBe(100);
  });

  it("lines up with the node next to it along its own contour", () => {
    const ids = counterIds("neigh");
    // An open run of three: dragging the middle one onto its neighbour's x makes
    // that segment exactly upright.
    const c = contour(
      ids.contour(),
      [
        node(ids.node(), vec(200, 0)),
        node(ids.node(), vec(300, 350)),
        node(ids.node(), vec(500, 700)),
      ],
      false,
    );
    const state = editorState({
      document: fontDocument([addContour(glyph("v", { advance: 640 }), c)]),
      view: VIEW,
    });

    const moved = dragTo(state, { x: 300, y: 350 }, { x: 203, y: 350 }, { snapNeighbours: true });
    const n = nodeById(firstGlyph(moved.document).contours[0]!, c.nodes[1]!.id)!;
    expect(n.pt.x).toBe(200);
  });

  it("never catches on the node it is dragging", () => {
    const { state, loose } = stems();
    // Dragging by two units. Its own coordinate is the nearest of all, and
    // catching it would pin the point where it started.
    const moved = dragTo(state, { x: 300, y: 300 }, { x: 302, y: 300 }, { snapExtremes: true });
    const n = nodeById(firstGlyph(moved.document).contours[1]!, loose.nodes[0]!.id)!;
    expect(n.pt.x).toBe(302);
  });

  it("holds a line it has caught past the radius that caught it", () => {
    const { state, loose } = stems();
    let s = pointerDown(state, pointerInput(vec(300, 300)), { snapExtremes: true }).state;
    // In, to catch the stem at 100 …
    s = pointerMove(s, pointerInput(vec(102, 300)), { snapExtremes: true }).state;
    // … then out to 108, which is too far to catch afresh but not to hold.
    s = pointerMove(s, pointerInput(vec(108, 300)), { snapExtremes: true }).state;

    const n = nodeById(firstGlyph(s.document).contours[1]!, loose.nodes[0]!.id)!;
    expect(n.pt.x).toBe(100);
  });

  it("lets go once the pointer is clearly done with it", () => {
    const { state, loose } = stems();
    let s = pointerDown(state, pointerInput(vec(300, 300)), { snapExtremes: true }).state;
    s = pointerMove(s, pointerInput(vec(102, 300)), { snapExtremes: true }).state;
    s = pointerMove(s, pointerInput(vec(140, 300)), { snapExtremes: true }).state;

    const n = nodeById(firstGlyph(s.document).contours[1]!, loose.nodes[0]!.id)!;
    expect(n.pt.x).toBe(140);
  });

  it("forgets what it was holding when the drag ends", () => {
    const { state } = stems();
    let s = pointerDown(state, pointerInput(vec(300, 300)), { snapExtremes: true }).state;
    s = pointerMove(s, pointerInput(vec(102, 300)), { snapExtremes: true }).state;
    s = pointerUp(s).state;
    // The hold lives on the gesture, so there is nowhere for a stale one to sit.
    expect(s.gesture).toBeNull();
  });

  it("still gives way to a metric line, which is the one you can see", () => {
    const { state, loose } = stems();
    // The stem's corners sit on the baseline too. Landing at y = 3 catches the
    // baseline rather than the corner, and the guide would say "baseline".
    const moved = dragTo(state, { x: 300, y: 300 }, { x: 300, y: 3 }, { snapExtremes: true });
    const n = nodeById(firstGlyph(moved.document).contours[1]!, loose.nodes[0]!.id)!;
    expect(n.pt.y).toBe(0);
  });
});

describe("the box round a selection", () => {
  /** A square of four corners, and every one of them selected. */
  const chosen = (): EditorState => {
    const ids = counterIds("bx");
    const c = contour(
      ids.contour(),
      [
        node("p0", vec(0, 0)),
        node("p1", vec(100, 0)),
        node("p2", vec(100, 100)),
        node("p3", vec(0, 100)),
      ],
      true,
    );
    const document = fontDocument([glyph("a", { advance: 200, contours: [c] })]);
    const state = editorState({ document, view: VIEW, currentGlyph: "a" });
    return {
      ...state,
      selection: ["p0", "p1", "p2", "p3"].map((nodeId) => ({
        contourId: c.id,
        nodeId,
        part: "point" as const,
      })),
    };
  };

  const where = (s: EditorState, id: string) =>
    firstGlyph(s.document).contours[0]!.nodes.find((n) => n.id === id)!.pt;

  it("stands off from the selection so its handles miss the points", () => {
    // A corner point sits exactly on the corner of its own bounds, and a box
    // drawn tight against it would put a handle where the point is.
    const box = selectionBox(chosen())!.rect;
    expect(box.minX).toBeLessThan(0);
    expect(box.maxY).toBeGreaterThan(100);
  });

  it("is absent for one point, which has no shape to scale", () => {
    const one = chosen();
    expect(selectionBox({ ...one, selection: [one.selection[0]!] })).toBeNull();
  });

  it("is absent when nothing is selected", () => {
    expect(selectionBox({ ...chosen(), selection: [] })).toBeNull();
  });

  it("still drags a point that sits under the box", () => {
    // The whole reason the box stands off: pressing on a selected corner has to
    // go on meaning that corner.
    const out = pointerDown(chosen(), pointerInput(vec(0, 0)));
    expect(out.state.gesture?.kind).toBe("dragSelection");
  });

  it("takes a handle and scales what is selected", () => {
    const start = chosen();
    const box = selectionBox(start)!.rect;
    const grabbed = pointerDown(start, pointerInput(vec(box.maxX, box.maxY)));
    expect(grabbed.state.gesture?.kind).toBe("transformBox");

    // Twice as far from the opposite corner in both directions.
    const span = { x: box.maxX - box.minX, y: box.maxY - box.minY };
    const moved = pointerMove(
      grabbed.state,
      pointerInput(vec(box.minX + span.x * 2, box.minY + span.y * 2)),
    );

    expect(where(moved.state, "p0").x).toBeCloseTo(box.minX + (0 - box.minX) * 2, 6);
    expect(where(moved.state, "p2").x).toBeCloseTo(box.minX + (100 - box.minX) * 2, 6);
  });

  it("measures from where the drag began, not from where it has got to", () => {
    // Two moves to the same place as one: a drag that compounded would land
    // somewhere else entirely.
    const start = chosen();
    const box = selectionBox(start)!.rect;
    const grabbed = pointerDown(start, pointerInput(vec(box.maxX, box.maxY))).state;

    const once = pointerMove(grabbed, pointerInput(vec(300, 300))).state;
    const twice = pointerMove(
      pointerMove(grabbed, pointerInput(vec(180, 180))).state,
      pointerInput(vec(300, 300)),
    ).state;

    expect(where(twice, "p2")).toEqual(where(once, "p2"));
  });

  it("holds the middle still when alt is down", () => {
    const start = chosen();
    const box = selectionBox(start)!.rect;
    const grabbed = pointerDown(start, pointerInput(vec(box.maxX, box.maxY), { alt: true })).state;
    const moved = pointerMove(
      grabbed,
      pointerInput(vec(box.maxX + 50, box.maxY + 50), { alt: true }),
    ).state;

    // The box's middle is the square's middle, so the two ends move apart by
    // the same amount in opposite directions.
    expect(where(moved, "p0").x + where(moved, "p2").x).toBeCloseTo(100, 6);
  });

  it("turns from just outside a corner", () => {
    const start = chosen();
    const box = selectionBox(start)!.rect;
    const grabbed = pointerDown(start, pointerInput(vec(box.maxX + 9, box.maxY + 9)));
    expect(grabbed.state.gesture).toMatchObject({
      kind: "transformBox",
      handle: { at: "topRight", action: "rotate" },
    });
  });

  it("takes the knob standing above the box, and takes it as a turn", () => {
    // The box runs -10..110 at this zoom, so the top edge is at 110 and the knob
    // 22 further up. A drawn handle rather than the invisible ring: the ring is
    // still there, but nothing about the box said it was.
    const grabbed = pointerDown(chosen(), pointerInput(vec(50, 132)));
    expect(grabbed.state.gesture).toMatchObject({
      kind: "transformBox",
      handle: { at: "top", action: "rotate" },
    });
  });

  it("turns the box along with the points", () => {
    const start = chosen();
    const grabbed = pointerDown(start, pointerInput(vec(50, 132))).state;
    // Straight out to the left of the middle, which is a quarter turn from
    // straight up.
    const moved = pointerMove(grabbed, pointerInput(vec(-100, 50))).state;

    expect(moved.boxFrame?.angle).toBeCloseTo(Math.PI / 2, 6);
    expect(selectionBox(moved)?.angle).toBeCloseTo(Math.PI / 2, 6);
    // And the points went with it: the corner at (0, 0) is now at (100, 0).
    expect(where(moved, "p0").x).toBeCloseTo(100, 6);
    expect(where(moved, "p0").y).toBeCloseTo(0, 6);
  });

  it("stands the box up again when the turn is abandoned", () => {
    const start = chosen();
    const grabbed = pointerDown(start, pointerInput(vec(50, 132))).state;
    const moved = pointerMove(grabbed, pointerInput(vec(-100, 50))).state;

    const back = cancel(moved).state;
    expect(back.boxFrame).toBeNull();
    expect(back.document).toBe(start.document);
  });

  it("scales a turned box along its own axes", () => {
    // The handle has to pull the way it points, or a box at an angle would
    // stretch the selection sideways to itself.
    const start = chosen();
    const turned = pointerMove(
      pointerDown(start, pointerInput(vec(50, 132))).state,
      pointerInput(vec(-100, 50)),
    ).state;
    const up = pointerUp(turned).state;

    const box = selectionBox(up)!;
    const handle = { at: "top", action: "scale" } as const;
    const top = boxHandlePoint(box, handle.at);
    const pivot = boxPivot(box, handle, false);
    // Twice as far from the opposite edge, along the box's own up.
    const pulled = vec(pivot.x + (top.x - pivot.x) * 2, pivot.y + (top.y - pivot.y) * 2);
    const scaled = pointerMove(
      pointerDown(up, pointerInput(top)).state,
      pointerInput(pulled),
    ).state;

    // The square was turned a quarter, so the box's up is the plane's −x: what
    // doubles is the width on screen, and the height is untouched.
    const xs = ["p0", "p1", "p2", "p3"].map((id) => where(scaled, id).x);
    const ys = ["p0", "p1", "p2", "p3"].map((id) => where(scaled, id).y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(200, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(100, 6);
  });

  it("puts one entry on the undo stack for the whole drag", () => {
    const start = chosen();
    const box = selectionBox(start)!.rect;
    const grabbed = pointerDown(start, pointerInput(vec(box.maxX, box.maxY)));
    expect(grabbed.effects.map((e) => e.kind)).toEqual(["beginTransaction"]);

    const moved = pointerMove(grabbed.state, pointerInput(vec(300, 300))).state;
    expect(pointerUp(moved, pointerInput(vec(300, 300))).effects.map((e) => e.kind)).toEqual([
      "commitTransaction",
    ]);
  });

  it("leaves the selection alone: the box moves what was already chosen", () => {
    const start = chosen();
    const box = selectionBox(start)!.rect;
    const grabbed = pointerDown(start, pointerInput(vec(box.maxX, box.maxY))).state;
    expect(grabbed.selection).toEqual(start.selection);
  });
});

describe("selecting a whole contour", () => {
  /** Two contours, so gathering one does not gather the other. */
  const two = (): EditorState => {
    const ids = counterIds("sc");
    const outer = contour(
      ids.contour(),
      [node("o0", vec(0, 0)), node("o1", vec(100, 0)), node("o2", vec(100, 100))],
      true,
    );
    const inner = contour(
      ids.contour(),
      [node("i0", vec(20, 20)), node("i1", vec(60, 20)), node("i2", vec(60, 60))],
      true,
    );
    const document = fontDocument([glyph("a", { advance: 200, contours: [outer, inner] })]);
    return editorState({ document, view: VIEW, currentGlyph: "a" });
  };

  const ids = (s: EditorState) => s.selection.map((i) => i.nodeId);
  const contourIdOf = (s: EditorState, at: number) => firstGlyph(s.document).contours[at]!.id;

  it("takes every on-curve point and no handles", () => {
    const s = two();
    const out = selectContour(s, contourIdOf(s, 0)).state;
    expect(ids(out)).toEqual(["o0", "o1", "o2"]);
    expect(out.selection.every((i) => i.part === "point")).toBe(true);
  });

  it("replaces what was selected", () => {
    const s = two();
    const first = selectContour(s, contourIdOf(s, 1)).state;
    const second = selectContour(first, contourIdOf(s, 0)).state;
    expect(ids(second)).toEqual(["o0", "o1", "o2"]);
  });

  it("adds to it when asked, so a shape of several contours can be gathered", () => {
    const s = two();
    const first = selectContour(s, contourIdOf(s, 0)).state;
    const both = selectContour(first, contourIdOf(s, 1), true).state;
    expect(ids(both)).toEqual(["o0", "o1", "o2", "i0", "i1", "i2"]);
  });

  it("is not a change when the same contour is already the selection", () => {
    // A new array every time would mark the session dirty and set the autosave
    // going for nothing.
    const once = selectContour(two(), contourIdOf(two(), 0)).state;
    expect(selectContour(once, contourIdOf(once, 0)).state).toBe(once);
  });

  it("does nothing for a contour that is not there", () => {
    const s = two();
    expect(selectContour(s, "nope").state).toBe(s);
  });

  it("comes from a second click on the contour", () => {
    const s = two();
    // On a segment of the outer contour, between its first two points.
    const out = doubleClick(s, pointerInput(vec(50, 0)));
    expect(ids(out.state)).toEqual(["o0", "o1", "o2"]);
  });

  it("comes from a second click on one of its points too", () => {
    const s = two();
    expect(ids(doubleClick(s, pointerInput(vec(100, 100))).state)).toEqual(["o0", "o1", "o2"]);
  });

  it("gathers a second contour when shift is held", () => {
    const s = two();
    const first = doubleClick(s, pointerInput(vec(50, 0))).state;
    const both = doubleClick(first, pointerInput(vec(40, 20), { shift: true })).state;
    expect(ids(both)).toEqual(["o0", "o1", "o2", "i0", "i1", "i2"]);
  });

  it("leaves a second click on empty canvas alone", () => {
    const s = two();
    expect(doubleClick(s, pointerInput(vec(900, 900))).state).toBe(s);
  });
});
