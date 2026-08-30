import { distance, vec } from "@fonteditor/geometry";
import { counterIds, fontDocument, glyph, segmentAt, segmentCount } from "@fonteditor/font-model";
import type { ViewTransform } from "@fonteditor/view";
import { describe, expect, it } from "vitest";

import { doubleClick, keyDown, pointerDown, pointerMove, pointerUp, setActiveTool } from "../src/dispatch.js";
import { keyInput, pointerInput } from "../src/input.js";
import { penPreview } from "../src/pen.js";
import { type EditorState, editorState } from "../src/state.js";

const VIEW: ViewTransform = { scale: 1, tx: 0, ty: 0 };

function blank(): EditorState {
  return editorState({
    document: fontDocument(glyph("a", { advance: 600 })),
    view: VIEW,
    activeTool: "pen",
  });
}

const ids = () => ({ ids: counterIds("p") });

/** Click without moving: places a corner. */
function click(state: EditorState, p: ReturnType<typeof vec>, o = ids()): EditorState {
  return pointerUp(pointerDown(state, pointerInput(p), o).state).state;
}

/** Press, drag, release: places a smooth point with handles pulled out. */
function pull(
  state: EditorState,
  at: ReturnType<typeof vec>,
  to: ReturnType<typeof vec>,
  mods: Parameters<typeof pointerInput>[1] = {},
  o = ids(),
): EditorState {
  let s = pointerDown(state, pointerInput(at, mods), o).state;
  s = pointerMove(s, pointerInput(to, mods), o).state;
  return pointerUp(s).state;
}

const only = (s: EditorState) => s.document.glyph.contours[0]!;

describe("drawing", () => {
  it("starts a contour on the first click", () => {
    const s = click(blank(), vec(100, 100));
    expect(s.document.glyph.contours).toHaveLength(1);
    expect(only(s).nodes).toHaveLength(1);
    expect(only(s).closed).toBe(false);
    expect(s.pen).not.toBeNull();
  });

  it("adds a point per click", () => {
    const o = ids();
    let s = click(blank(), vec(100, 100), o);
    s = click(s, vec(300, 100), o);
    s = click(s, vec(300, 300), o);
    expect(only(s).nodes).toHaveLength(3);
    expect(segmentCount(only(s))).toBe(2);
  });

  // Click for a corner, drag for a smooth point — one rule, applied to every
  // point including the first.
  it("leaves a plain click as a corner with no handles", () => {
    const s = click(blank(), vec(100, 100));
    const n = only(s).nodes[0]!;
    expect(n.type).toBe("corner");
    expect(n.in).toBeNull();
    expect(n.out).toBeNull();
  });

  it("pulls symmetric handles out of a dragged point", () => {
    const s = pull(blank(), vec(100, 100), vec(160, 100));
    const n = only(s).nodes[0]!;
    expect(n.type).toBe("smooth");
    expect(n.out).toEqual(vec(160, 100));
    expect(n.in).toEqual(vec(40, 100));
  });

  it("keeps a click a corner when the pointer barely moves", () => {
    // Below the drag threshold: a hand tremor is not a drag.
    const s = pull(blank(), vec(100, 100), vec(101, 100));
    expect(only(s).nodes[0]!.type).toBe("corner");
    expect(only(s).nodes[0]!.out).toBeNull();
  });

  // Alt means the same thing here as in the select tool: unlink a node's sides.
  it("gives only an outgoing handle when alt is held", () => {
    const s = pull(blank(), vec(100, 100), vec(160, 100), { alt: true });
    const n = only(s).nodes[0]!;
    expect(n.type).toBe("corner");
    expect(n.out).toEqual(vec(160, 100));
    expect(n.in).toBeNull();
  });

  it("makes a straight segment between two plain clicks", () => {
    const o = ids();
    let s = click(blank(), vec(100, 100), o);
    s = click(s, vec(300, 100), o);
    expect(segmentAt(only(s), 0)!.kind).toBe("line");
  });

  it("makes a curve when the previous point was dragged", () => {
    const o = ids();
    let s = pull(blank(), vec(100, 100), vec(160, 60), {}, o);
    s = click(s, vec(300, 100), o);
    expect(segmentAt(only(s), 0)!.kind).toBe("curve");
  });
});

describe("closing", () => {
  it("closes when the first point is clicked again", () => {
    const o = ids();
    let s = click(blank(), vec(100, 100), o);
    s = click(s, vec(300, 100), o);
    s = click(s, vec(300, 300), o);
    s = click(s, vec(100, 100), o);

    expect(only(s).closed).toBe(true);
    expect(only(s).nodes).toHaveLength(3);
    expect(segmentCount(only(s))).toBe(3);
  });

  it("ends the drawing session once closed", () => {
    const o = ids();
    let s = click(blank(), vec(100, 100), o);
    s = click(s, vec(300, 100), o);
    s = click(s, vec(300, 300), o);
    s = click(s, vec(100, 100), o);
    expect(s.pen).toBeNull();
  });

  it("does not treat the first click as closing its own contour", () => {
    const s = click(blank(), vec(100, 100));
    expect(only(s).closed).toBe(false);
    expect(only(s).nodes).toHaveLength(1);
  });

  it("closes on a click merely near the first point", () => {
    const o = ids();
    let s = click(blank(), vec(100, 100), o);
    s = click(s, vec(300, 100), o);
    s = click(s, vec(300, 300), o);
    // Within the close radius, not exactly on it.
    s = click(s, vec(104, 103), o);
    expect(only(s).closed).toBe(true);
  });
});

describe("finishing and taking back", () => {
  it("leaves the contour open on Enter", () => {
    const o = ids();
    let s = click(blank(), vec(100, 100), o);
    s = click(s, vec(300, 100), o);
    s = keyDown(s, keyInput("Enter")).state;

    expect(s.pen).toBeNull();
    expect(only(s).closed).toBe(false);
    expect(only(s).nodes).toHaveLength(2);
  });

  it("does the same on Escape", () => {
    const o = ids();
    let s = click(blank(), vec(100, 100), o);
    s = click(s, vec(300, 100), o);
    expect(keyDown(s, keyInput("Escape")).state.pen).toBeNull();
  });

  // A single point is not a shape, and leaving one behind would put an
  // invisible node in the glyph.
  it("discards a contour of one point", () => {
    const s = keyDown(click(blank(), vec(100, 100)), keyInput("Escape")).state;
    expect(s.document.glyph.contours).toHaveLength(0);
  });

  it("takes back the last point on Backspace", () => {
    const o = ids();
    let s = click(blank(), vec(100, 100), o);
    s = click(s, vec(300, 100), o);
    s = click(s, vec(300, 300), o);
    s = keyDown(s, keyInput("Backspace")).state;

    expect(only(s).nodes).toHaveLength(2);
    expect(s.pen).not.toBeNull();
  });

  it("removes the contour when the last point is taken back", () => {
    const s = keyDown(click(blank(), vec(100, 100)), keyInput("Backspace")).state;
    expect(s.document.glyph.contours).toHaveLength(0);
    expect(s.pen).toBeNull();
  });

  it("continues drawing after taking a point back", () => {
    const o = ids();
    let s = click(blank(), vec(100, 100), o);
    s = click(s, vec(300, 100), o);
    s = keyDown(s, keyInput("Backspace")).state;
    s = click(s, vec(200, 400), o);
    expect(only(s).nodes).toHaveLength(2);
    expect(only(s).nodes[1]!.pt).toEqual(vec(200, 400));
  });
});

describe("the rubber band", () => {
  it("runs from the last point to the cursor", () => {
    const o = ids();
    let s = click(blank(), vec(100, 100), o);
    s = pointerMove(s, pointerInput(vec(250, 180)), o).state;

    const preview = penPreview(s);
    expect(preview).not.toBeNull();
    expect(preview!.a).toEqual(vec(100, 100));
    expect(preview!.b).toEqual(vec(250, 180));
  });

  // It is a promise about the next click, not decoration: the handle it uses is
  // the one the real segment would use.
  it("uses the last point's outgoing handle", () => {
    const o = ids();
    let s = pull(blank(), vec(100, 100), vec(160, 60), {}, o);
    s = pointerMove(s, pointerInput(vec(300, 100)), o).state;
    expect(penPreview(s)!.c1).toEqual(vec(160, 60));
  });

  it("is absent before anything is drawn, and after finishing", () => {
    expect(penPreview(blank())).toBeNull();
    const s = keyDown(click(blank(), vec(100, 100)), keyInput("Escape")).state;
    expect(penPreview(s)).toBeNull();
  });

  it("is absent while handles are being pulled", () => {
    const o = ids();
    const down = pointerDown(blank(), pointerInput(vec(100, 100)), o).state;
    expect(penPreview(down)).toBeNull();
  });
});

describe("tool switching", () => {
  it("swaps tools on p and v", () => {
    const s = editorState({ document: fontDocument(glyph("a")), view: VIEW });
    expect(s.activeTool).toBe("select");
    const withPen = keyDown(s, keyInput("p")).state;
    expect(withPen.activeTool).toBe("pen");
    expect(keyDown(withPen, keyInput("v")).state.activeTool).toBe("select");
  });

  // A shortcut with a modifier belongs to the application, not the toolbox.
  it("ignores p and v when a modifier is held", () => {
    const s = editorState({ document: fontDocument(glyph("a")), view: VIEW });
    expect(keyDown(s, keyInput("p", { ctrl: true })).state.activeTool).toBe("select");
    expect(keyDown(s, keyInput("p", { meta: true })).state.activeTool).toBe("select");
  });

  // Reaching for the select tool means you are done drawing; a half-built
  // contour left in the pen's memory would resume on the next `p`.
  it("finishes an unfinished contour when switching away", () => {
    const o = ids();
    let s = click(blank(), vec(100, 100), o);
    s = click(s, vec(300, 100), o);
    s = setActiveTool(s, "select").state;

    expect(s.activeTool).toBe("select");
    expect(s.pen).toBeNull();
    expect(only(s).nodes).toHaveLength(2);
  });

  it("refuses to switch mid-gesture", () => {
    const o = ids();
    const down = pointerDown(blank(), pointerInput(vec(100, 100)), o).state;
    // The pen is holding the button; switching now is never what was meant.
    const held = { ...down, gesture: null };
    expect(setActiveTool(held, "select").state.activeTool).toBe("select");
  });

  it("has no use for a double click", () => {
    const s = click(blank(), vec(100, 100));
    expect(doubleClick(s, pointerInput(vec(100, 100))).state).toBe(s);
  });
});

describe("transaction effects", () => {
  // Each point is its own undo. Two quick clicks collapsing into one would take
  // back a point the user never asked to lose.
  it("marks every placed point as its own step", () => {
    const o = ids();
    const first = pointerDown(blank(), pointerInput(vec(100, 100)), o);
    expect(first.effects).toEqual([
      { kind: "beginTransaction", label: "Start contour", coalesce: false },
    ]);

    const placed = pointerUp(first.state);
    expect(placed.effects).toEqual([{ kind: "commitTransaction" }]);

    const second = pointerDown(placed.state, pointerInput(vec(300, 100)), o);
    expect(second.effects).toEqual([
      { kind: "beginTransaction", label: "Add point", coalesce: false },
    ]);
  });

  it("labels closing distinctly", () => {
    const o = ids();
    let s = click(blank(), vec(100, 100), o);
    s = click(s, vec(300, 100), o);
    s = click(s, vec(300, 300), o);
    const closing = pointerDown(s, pointerInput(vec(100, 100)), o);
    expect(closing.effects).toEqual([
      { kind: "beginTransaction", label: "Close contour", coalesce: false },
    ]);
  });

  it("aborts when a one-point contour is thrown away", () => {
    const s = click(blank(), vec(100, 100));
    expect(keyDown(s, keyInput("Escape")).effects).toEqual([{ kind: "abortTransaction" }]);
  });
});

describe("purity", () => {
  it("never mutates the state it was given", () => {
    const s = blank();
    const snapshot = structuredClone(s);
    const o = ids();
    let next = pointerDown(s, pointerInput(vec(100, 100)), o).state;
    next = pointerMove(next, pointerInput(vec(160, 60)), o).state;
    pointerUp(next);
    expect(s).toEqual(snapshot);
  });

  it("produces a document that survives a JSON round-trip", () => {
    const o = ids();
    let s = pull(blank(), vec(100, 100), vec(160, 60), {}, o);
    s = click(s, vec(300, 100), o);
    expect(JSON.parse(JSON.stringify(s.document))).toEqual(s.document);
  });

  it("keeps the drawn geometry where it was put", () => {
    const o = ids();
    let s = click(blank(), vec(100, 100), o);
    s = click(s, vec(300, 100), o);
    expect(distance(only(s).nodes[0]!.pt, vec(100, 100))).toBe(0);
    expect(distance(only(s).nodes[1]!.pt, vec(300, 100))).toBe(0);
  });
});
