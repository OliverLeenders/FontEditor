import { vec } from "@fonteditor/geometry";
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
} from "@fonteditor/font-model";
import {
  type EditorState,
  doubleClick,
  editorState,
  keyDown,
  keyInput,
  pointerDown,
  pointerInput,
  pointerMove,
  pointerUp,
} from "@fonteditor/tools";
import type { ViewTransform } from "@fonteditor/view";
import { describe, expect, it } from "vitest";

import { history, push } from "../src/history.js";
import {
  type EditSession,
  apply,
  canRedoSession,
  canUndoSession,
  redo,
  redoLabelOf,
  session,
  undo,
  undoLabelOf,
} from "../src/session.js";

/** The document holds many glyphs now; these tests each work with one. */
const firstGlyph = (d: FontDocument): Glyph => orderedGlyphs(d)[0]!;

const VIEW: ViewTransform = { scale: 1, tx: 0, ty: 0 };

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

function start(): { s: EditSession; c: Contour } {
  const c = arch();
  const editor = editorState({
    document: fontDocument([addContour(glyph("n", { advance: 640 }), c)]),
    view: VIEW,
  });
  return { s: session(editor), c };
}

const nodeAt = (s: EditSession, c: Contour, i: number) =>
  nodeById(firstGlyph(s.editor.document).contours[0]!, c.nodes[i]!.id)!;

/** Drive a whole drag through the session, the way the host does. */
function drag(
  s: EditSession,
  from: ReturnType<typeof vec>,
  through: ReturnType<typeof vec>[],
  now = 1000,
): EditSession {
  let next = apply(s, pointerDown(s.editor, pointerInput(from)), now);
  for (const p of through) {
    next = apply(next, pointerMove(next.editor, pointerInput(p)), now);
  }
  return apply(next, pointerUp(next.editor), now);
}

describe("transactions", () => {
  it("records a whole drag as one step", () => {
    const { s, c } = start();
    const after = drag(s, vec(100, 480), [vec(120, 500), vec(140, 520), vec(160, 540)]);

    expect(after.history.entries).toHaveLength(1);
    expect(after.history.index).toBe(1);
    expect(after.history.entries[0]!.label).toBe("Move node");
    expect(nodeAt(after, c, 0).pt).toEqual(vec(160, 540));
  });

  // The prototype pushed on every mouse-up, so a click that moved nothing left a
  // step behind that undid nothing.
  it("records nothing for a click that moved nothing", () => {
    const { s } = start();
    const down = apply(s, pointerDown(s.editor, pointerInput(vec(100, 480))));
    expect(down.pending).not.toBeNull();

    const up = apply(down, pointerUp(down.editor));
    expect(up.history.entries).toHaveLength(0);
    expect(up.pending).toBeNull();
  });

  it("records nothing when a drag is cancelled", () => {
    const { s, c } = start();
    let next = apply(s, pointerDown(s.editor, pointerInput(vec(100, 480))));
    next = apply(next, pointerMove(next.editor, pointerInput(vec(300, 300))));
    next = apply(next, keyDown(next.editor, keyInput("Escape")));

    expect(next.history.entries).toHaveLength(0);
    expect(next.pending).toBeNull();
    expect(nodeAt(next, c, 0).pt).toEqual(vec(100, 480));
  });

  // Captured from the state before the tool ran: by the time pointerDown
  // returns it has already changed the selection.
  it("captures the selection as it was before the gesture", () => {
    const { s } = start();
    expect(s.editor.selection).toHaveLength(0);
    const after = drag(s, vec(100, 480), [vec(140, 520)]);
    expect(after.history.entries[0]!.selectionBefore).toHaveLength(0);
    expect(after.history.entries[0]!.selectionAfter).toHaveLength(1);
  });

  it("records a nudge, which begins and commits in one go", () => {
    const { s, c } = start();
    const selected = apply(s, pointerUp(pointerDown(s.editor, pointerInput(vec(100, 480))).state));
    const nudged = apply(selected, keyDown(selected.editor, keyInput("ArrowRight")), 5000);

    expect(nudged.history.entries).toHaveLength(1);
    expect(nudged.history.entries[0]!.label).toBe("Nudge");
    expect(nodeAt(nudged, c, 0).pt).toEqual(vec(101, 480));
  });
});

describe("undo and redo", () => {
  it("puts the geometry back and takes it forward again", () => {
    const { s, c } = start();
    const moved = drag(s, vec(100, 480), [vec(160, 540)]);

    const back = undo(moved);
    expect(nodeAt(back, c, 0).pt).toEqual(vec(100, 480));
    expect(back.history.index).toBe(0);

    const forward = redo(back);
    expect(nodeAt(forward, c, 0).pt).toEqual(vec(160, 540));
    expect(forward.history.index).toBe(1);
  });

  it("restores the selection too", () => {
    const { s } = start();
    const moved = drag(s, vec(100, 480), [vec(160, 540)]);
    expect(moved.editor.selection).toHaveLength(1);

    const back = undo(moved);
    expect(back.editor.selection).toHaveLength(0);
    expect(redo(back).editor.selection).toHaveLength(1);
  });

  it("stands the selection's box upright again", () => {
    // How far the points were turned is not in the history, so after stepping
    // through it the angle is no longer known — and a box still at an angle
    // would be drawn round a shape that is not at that angle any more.
    const { s } = start();
    const moved = drag(s, vec(100, 480), [vec(160, 540)]);
    const turned = {
      ...moved,
      editor: { ...moved.editor, boxFrame: { angle: 0.4, of: moved.editor.selection } },
    };

    expect(undo(turned).editor.boxFrame).toBeNull();
    expect(redo(undo(turned)).editor.boxFrame).toBeNull();
  });

  // Being teleported across the canvas by an undo is disorienting, and nobody
  // asked for it.
  it("leaves the camera exactly where it was", () => {
    const { s } = start();
    const zoomed: EditorState = { ...s.editor, view: { scale: 3, tx: 40, ty: -20 } };
    const moved = drag({ ...s, editor: zoomed }, vec(100, 480), [vec(160, 540)]);

    expect(undo(moved).editor.view).toEqual(zoomed.view);
    expect(redo(undo(moved)).editor.view).toEqual(zoomed.view);
  });

  it("does nothing at the ends of the stack", () => {
    const { s } = start();
    expect(undo(s)).toBe(s);
    expect(canUndoSession(s)).toBe(false);

    const moved = drag(s, vec(100, 480), [vec(160, 540)]);
    expect(redo(moved)).toBe(moved);
    expect(canRedoSession(moved)).toBe(false);
  });

  // Undoing out from under a drag would leave the gesture holding a snapshot of
  // a document that no longer exists. Escape abandons the drag; that is its job.
  it("refuses while a gesture is in flight", () => {
    const { s } = start();
    const moved = drag(s, vec(100, 480), [vec(160, 540)]);
    const mid = apply(moved, pointerDown(moved.editor, pointerInput(vec(540, 480))));

    expect(mid.pending).not.toBeNull();
    expect(undo(mid)).toBe(mid);
    expect(canUndoSession(mid)).toBe(false);
  });

  it("discards the redo branch once you edit again", () => {
    const { s, c } = start();
    let next = drag(s, vec(100, 480), [vec(160, 540)]);
    next = undo(next);
    expect(canRedoSession(next)).toBe(true);

    next = drag(next, vec(540, 480), [vec(560, 500)], 9000);
    expect(canRedoSession(next)).toBe(false);
    expect(next.history.entries).toHaveLength(1);
    expect(nodeAt(next, c, 2).pt).toEqual(vec(560, 500));
  });

  it("names what would be undone and redone", () => {
    const { s } = start();
    const moved = drag(s, vec(100, 632), [vec(60, 700)]);
    expect(undoLabelOf(moved)).toBe("Move handle");
    expect(redoLabelOf(moved)).toBeNull();
    expect(redoLabelOf(undo(moved))).toBe("Move handle");
  });

  it("survives several steps in a row", () => {
    const { s, c } = start();
    let next = drag(s, vec(100, 480), [vec(110, 490)], 1000);
    next = drag(next, vec(540, 480), [vec(550, 490)], 9000);
    next = drag(next, vec(110, 490), [vec(130, 510)], 20000);
    expect(next.history.entries).toHaveLength(3);

    next = undo(undo(undo(next)));
    expect(nodeAt(next, c, 0).pt).toEqual(vec(100, 480));
    expect(nodeAt(next, c, 2).pt).toEqual(vec(540, 480));
    expect(next.history.index).toBe(0);
  });
});

describe("Tunni edits", () => {
  it("undoes a Tunni drag as a single step", () => {
    const { s, c } = start();
    const tunni = segmentTunniPoint(c, 0)!;
    const awake = apply(s, pointerMove(s.editor, pointerInput(tunni)));
    const dragged = drag(awake, tunni, [
      vec(tunni.x - 10, tunni.y - 20),
      vec(tunni.x - 20, tunni.y - 40),
    ]);

    expect(dragged.history.entries).toHaveLength(1);
    expect(dragged.history.entries[0]!.label).toBe("Move Tunni point");

    const back = undo(dragged);
    const restored = segmentTunniPoint(firstGlyph(back.editor.document).contours[0]!, 0)!;
    expect(Math.hypot(restored.x - tunni.x, restored.y - tunni.y)).toBeLessThan(1e-9);
  });

  it("undoes a balance", () => {
    const { s, c } = start();
    const tunni = segmentTunniPoint(c, 0)!;
    const awake = apply(s, pointerMove(s.editor, pointerInput(tunni)));

    // Skew it first, so balancing has something to undo.
    const lopsided = drag(awake, tunni, [vec(tunni.x - 25, tunni.y - 45)], 1000);
    const skewed = segmentTunniPoint(firstGlyph(lopsided.editor.document).contours[0]!, 0)!;

    const balanced = apply(lopsided, doubleClick(lopsided.editor, pointerInput(skewed)), 50000);
    expect(balanced.history.entries).toHaveLength(2);
    expect(balanced.history.entries[1]!.label).toBe("Balance segment");

    const back = undo(balanced);
    const restored = segmentTunniPoint(firstGlyph(back.editor.document).contours[0]!, 0)!;
    expect(Math.hypot(restored.x - skewed.x, restored.y - skewed.y)).toBeLessThan(1e-9);
  });
});

describe("coalescing", () => {
  it("merges rapid steps of the same kind into one", () => {
    const { s, c } = start();
    const selected = apply(s, pointerUp(pointerDown(s.editor, pointerInput(vec(100, 480))).state));

    let next = selected;
    for (let i = 0; i < 5; i++) {
      next = apply(next, keyDown(next.editor, keyInput("ArrowRight")), 1000 + i * 50);
    }

    expect(next.history.entries).toHaveLength(1);
    expect(nodeAt(next, c, 0).pt).toEqual(vec(105, 480));

    // …and one undo takes all five back.
    expect(nodeAt(undo(next), c, 0).pt).toEqual(vec(100, 480));
  });

  it("keeps steps separate once the pause is long enough", () => {
    const { s } = start();
    const selected = apply(s, pointerUp(pointerDown(s.editor, pointerInput(vec(100, 480))).state));

    let next = apply(selected, keyDown(selected.editor, keyInput("ArrowRight")), 1000);
    next = apply(next, keyDown(next.editor, keyInput("ArrowRight")), 9000);

    expect(next.history.entries).toHaveLength(2);
  });

  it("does not merge steps of different kinds", () => {
    const { s } = start();
    const selected = apply(s, pointerUp(pointerDown(s.editor, pointerInput(vec(100, 480))).state));
    let next = apply(selected, keyDown(selected.editor, keyInput("ArrowRight")), 1000);
    next = drag(next, vec(101, 480), [vec(120, 500)], 1050);
    expect(next.history.entries).toHaveLength(2);
  });
});

describe("the stack limit", () => {
  // The prototype shifted its array without moving the cursor with it, so undo
  // skipped a state once the stack passed a hundred entries.
  it("drops the oldest entries and keeps the cursor in step", () => {
    const doc = fontDocument([addContour(glyph("x"), arch())]);
    let h = history(3);
    for (let i = 0; i < 5; i++) {
      h = push(
        h,
        {
          label: `step ${i}`,
          before: doc,
          after: doc,
          selectionBefore: [],
          selectionAfter: [],
          at: i * 10000,
        },
        { coalesceMs: 0 },
      );
    }
    expect(h.entries).toHaveLength(3);
    expect(h.index).toBe(3);
    expect(h.entries[0]!.label).toBe("step 2");
    expect(h.entries[2]!.label).toBe("step 4");
  });
});
