import {
  DEFAULT_FONT_INFO,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { duplicateGlyph, duplicateName, infoProblem, setMarkColor } from "../src/commands/index.js";
import { type EditorState, editorState } from "../src/state.js";

/**
 * Duplicating a glyph, marking one with a colour, and the embedding flags —
 * the last three details of phase 16.
 */

const ids = counterIds("gm");

const drawn = () =>
  contour(
    ids.contour(),
    [
      node(ids.node(), { x: 0, y: 0 }),
      node(ids.node(), { x: 10, y: 0 }),
      node(ids.node(), { x: 5, y: 10 }),
    ],
    true,
  );

function start(): EditorState {
  return editorState({
    document: fontDocument([
      glyph("a", { unicodes: [0x61], advance: 500, contours: [drawn()], markColor: "1,0,0,1" }),
      glyph("b", { unicodes: [0x62], advance: 520, contours: [drawn()] }),
    ]),
    view: { scale: 1, tx: 0, ty: 0 },
  });
}

describe("duplicating a glyph", () => {
  it("names the copy with the first free number", () => {
    const state = start();
    expect(duplicateName(state, "a")).toBe("a.001");

    const once = duplicateGlyph(state, "a").state;
    expect(duplicateName(once, "a")).toBe("a.002");
    // Copying a copy numbers from the name, not from the copy's own number.
    expect(duplicateName(once, "a.001")).toBe("a.002");
  });

  it("copies the drawing, straight after the original, and opens the copy", () => {
    const out = duplicateGlyph(start(), "a");
    const copy = out.state.document.glyphs["a.001"]!;

    expect(copy.contours).toEqual(out.state.document.glyphs["a"]!.contours);
    expect(copy.advance).toBe(500);
    expect(out.state.document.glyphOrder).toEqual(["a", "a.001", "b"]);
    expect(out.state.currentGlyph).toBe("a.001");
    expect(out.effects[0]).toMatchObject({ label: "Duplicate a" });
  });

  it("leaves the copy unencoded and unmarked", () => {
    const copy = duplicateGlyph(start(), "a").state.document.glyphs["a.001"]!;
    expect(copy.unicodes).toEqual([]);
    expect(copy.markColor).toBeNull();
  });

  it("does nothing for a glyph that is not there", () => {
    const state = start();
    expect(duplicateGlyph(state, "missing").state).toBe(state);
  });
});

describe("marking a glyph with a colour", () => {
  it("marks a glyph, and clears the mark", () => {
    const marked = setMarkColor(start(), "b", "0,0,1,1");
    expect(marked.state.document.glyphs["b"]!.markColor).toBe("0,0,1,1");
    expect(marked.effects[0]).toMatchObject({ label: "Mark colour" });

    const cleared = setMarkColor(marked.state, "b", null);
    expect(cleared.state.document.glyphs["b"]!.markColor).toBeNull();
    expect(cleared.effects[0]).toMatchObject({ label: "Clear mark colour" });
  });

  it("records nothing when the mark is already that one", () => {
    const state = start();
    const out = setMarkColor(state, "a", "1,0,0,1");
    expect(out.state).toBe(state);
    expect(out.effects).toEqual([]);
  });
});

describe("the embedding flags in font info", () => {
  const info = (bits: readonly number[]) => ({ ...DEFAULT_FONT_INFO, openTypeOS2Type: bits });

  it("accepts a level with the two flags", () => {
    expect(infoProblem(info([2, 8, 9]))).toBeNull();
    expect(infoProblem(info([]))).toBeNull();
  });

  it("refuses a bit the format does not define", () => {
    expect(infoProblem(info([0]))).toMatch(/embedding flags/);
    expect(infoProblem(info([4]))).toMatch(/embedding flags/);
  });

  it("refuses two levels at once", () => {
    expect(infoProblem(info([1, 3]))).toMatch(/one embedding level/);
  });
});
