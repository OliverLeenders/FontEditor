import { vec } from "@fonteditor/geometry";
import {
  type Contour,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
} from "@fonteditor/font-model";
import { describe, expect, it } from "vitest";

import {
  clipboardText,
  deleteSelectedContours,
  parseClipboard,
  pasteContours,
  selectedContours,
} from "../src/clipboard.js";
import { type EditorState, currentGlyph, editorState } from "../src/state.js";

const square = (id: string, x: number): Contour =>
  contour(
    id,
    [
      node(`${id}-a`, vec(x, 0), { type: "corner", out: vec(x + 40, 0) }),
      node(`${id}-b`, vec(x + 200, 0), { type: "smooth", in: vec(x + 160, 0) }),
      node(`${id}-c`, vec(x + 200, 300), { hvLock: true }),
    ],
    true,
  );

function start(): EditorState {
  const document = fontDocument([
    glyph("a", { unicodes: [0x61], advance: 500, contours: [square("c1", 0), square("c2", 300)] }),
    glyph("b", { unicodes: [0x62], advance: 500 }),
  ]);
  return editorState({ document, view: { scale: 1, tx: 0, ty: 0 }, currentGlyph: "a" });
}

const selectPoints = (state: EditorState, contourId: string): EditorState => {
  const c = currentGlyph(state)!.contours.find((x) => x.id === contourId)!;
  return {
    ...state,
    selection: c.nodes.map((n) => ({ contourId, nodeId: n.id, part: "point" as const })),
  };
};

describe("selectedContours", () => {
  it("takes a whole contour when any of its points is selected", () => {
    const state = start();
    const c = currentGlyph(state)!.contours[0]!;
    const one = {
      ...state,
      selection: [{ contourId: c.id, nodeId: c.nodes[1]!.id, part: "point" as const }],
    };
    expect(selectedContours(one).map((x) => x.id)).toEqual(["c1"]);
  });

  it("takes nothing when nothing is selected", () => {
    expect(selectedContours(start())).toEqual([]);
  });

  it("counts a selected handle as selecting its contour", () => {
    const state = start();
    const c = currentGlyph(state)!.contours[0]!;
    const viaHandle = {
      ...state,
      selection: [{ contourId: c.id, nodeId: c.nodes[0]!.id, part: "out" as const }],
    };
    expect(selectedContours(viaHandle).map((x) => x.id)).toEqual(["c1"]);
  });
});

describe("clipboardText", () => {
  it("is null when there is nothing to copy", () => {
    expect(clipboardText(start())).toBeNull();
  });

  it("carries the geometry, and never the ids", () => {
    const text = clipboardText(selectPoints(start(), "c1"))!;
    expect(text).toContain("fonteditor/contours");
    // Ids identify a node in a document, not a shape; carrying them would let a
    // paste collide with the contour it came from.
    expect(text).not.toContain("c1-a");
    expect(text).not.toContain('"id"');
    expect(text).toContain('"hvLock"');
    expect(JSON.parse(text).contours[0].nodes[2].hvLock).toEqual({ in: true, out: true });
  });

  it("is readable JSON, so a paste elsewhere shows something sensible", () => {
    const text = clipboardText(selectPoints(start(), "c1"))!;
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

describe("parseClipboard", () => {
  const roundTrip = (state: EditorState) =>
    parseClipboard(clipboardText(state)!, counterIds());

  it("reads back what was written", () => {
    const contours = roundTrip(selectPoints(start(), "c1"))!;
    expect(contours).toHaveLength(1);
    expect(contours[0]?.closed).toBe(true);
    expect(contours[0]?.nodes.map((n) => n.pt)).toEqual([
      vec(0, 0),
      vec(200, 0),
      vec(200, 300),
    ]);
    expect(contours[0]?.nodes[1]?.type).toBe("smooth");
    expect(contours[0]?.nodes[0]?.out).toEqual(vec(40, 0));
    expect(contours[0]?.nodes[2]?.hvLock).toEqual({ in: true, out: true });
  });

  it("mints fresh ids", () => {
    // A prefixed factory, as the application uses, so a fresh id cannot
    // coincidentally equal one already in the document.
    const contours = parseClipboard(
      clipboardText(selectPoints(start(), "c1"))!,
      counterIds("paste-"),
    )!;
    expect(contours[0]?.id).not.toBe("c1");
    expect(contours[0]?.nodes[0]?.id).not.toBe("c1-a");
    expect(contours[0]?.id).toMatch(/^paste-/);
  });

  it("refuses anything that is not ours", () => {
    for (const junk of [
      "",
      "not json at all",
      "{}",
      '{"kind":"something/else","version":1,"contours":[]}',
      '{"kind":"fonteditor/contours"}',
      '{"kind":"fonteditor/contours","version":1}',
    ]) {
      expect(parseClipboard(junk, counterIds())).toBeNull();
    }
  });

  it("refuses a payload from a later version it cannot understand", () => {
    const text = '{"kind":"fonteditor/contours","version":99,"contours":[]}';
    expect(parseClipboard(text, counterIds())).toBeNull();
  });

  it("refuses a node whose point is missing or not finite", () => {
    const bad = (pt: string) =>
      `{"kind":"fonteditor/contours","version":1,"contours":[{"closed":true,"nodes":[{"pt":${pt}},{"pt":{"x":1,"y":1}}]}]}`;
    expect(parseClipboard(bad("null"), counterIds())).toBeNull();
    expect(parseClipboard(bad('{"x":"a","y":0}'), counterIds())).toBeNull();
    expect(parseClipboard(bad('{"x":null,"y":0}'), counterIds())).toBeNull();
  });

  it("drops a contour too small to draw anything", () => {
    const text =
      '{"kind":"fonteditor/contours","version":1,"contours":[{"closed":true,"nodes":[{"pt":{"x":0,"y":0}}]}]}';
    expect(parseClipboard(text, counterIds())).toBeNull();
  });
});

describe("pasteContours", () => {
  const copyOne = () => clipboardText(selectPoints(start(), "c1"))!;

  it("adds the contour and selects what arrived", () => {
    const text = copyOne();
    const { state } = pasteContours(start(), text, counterIds());

    expect(currentGlyph(state)!.contours).toHaveLength(3);
    // Ready to be moved, rather than needing to be found first.
    expect(state.selection).toHaveLength(3);
    expect(state.selection.every((item) => item.part === "point")).toBe(true);
  });

  it("pastes at the coordinates it was copied from", () => {
    const { state } = pasteContours(start(), copyOne(), counterIds());
    const pasted = currentGlyph(state)!.contours[2]!;
    expect(pasted.nodes[0]?.pt).toEqual(vec(0, 0));
  });

  it("pastes into a different glyph", () => {
    const text = copyOne();
    const inB: EditorState = { ...start(), currentGlyph: "b" };
    const { state } = pasteContours(inB, text, counterIds());

    expect(state.document.glyphs["b"]?.contours).toHaveLength(1);
    // The glyph it came from is untouched.
    expect(state.document.glyphs["a"]?.contours).toHaveLength(2);
  });

  it("is one undoable step", () => {
    const out = pasteContours(start(), copyOne(), counterIds());
    expect(out.effects.map((e) => e.kind)).toEqual(["beginTransaction", "commitTransaction"]);
  });

  it("does nothing at all for a payload it cannot read", () => {
    const state = start();
    const out = pasteContours(state, "nonsense", counterIds());
    expect(out.state).toBe(state);
    expect(out.effects).toEqual([]);
  });
});

describe("deleteSelectedContours", () => {
  it("removes the whole contour, not just the selected points", () => {
    const { state } = deleteSelectedContours(selectPoints(start(), "c1"));
    expect(currentGlyph(state)!.contours.map((c) => c.id)).toEqual(["c2"]);
  });

  it("clears the selection and any lingering focus", () => {
    const before = {
      ...selectPoints(start(), "c1"),
      focusedSegment: { contourId: "c1", segmentIndex: 0 },
    };
    const { state } = deleteSelectedContours(before);
    expect(state.selection).toEqual([]);
    expect(state.focusedSegment).toBeNull();
  });

  it("does nothing when nothing is selected", () => {
    const state = start();
    const out = deleteSelectedContours(state);
    expect(out.state).toBe(state);
    expect(out.effects).toEqual([]);
  });

  it("cut then paste puts the shape back where it was", () => {
    const selected = selectPoints(start(), "c1");
    const text = clipboardText(selected)!;
    const { state: afterCut } = deleteSelectedContours(selected);
    const { state: afterPaste } = pasteContours(afterCut, text, counterIds());

    const restored = currentGlyph(afterPaste)!.contours.find(
      (c) => c.nodes[0]?.pt.x === 0,
    );
    expect(restored).toBeDefined();
    expect(restored?.nodes.map((n) => n.pt)).toEqual([vec(0, 0), vec(200, 0), vec(200, 300)]);
  });
});
