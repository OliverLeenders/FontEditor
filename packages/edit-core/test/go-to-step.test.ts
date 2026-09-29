import {
  type FontDocument,
  fontDocument,
  glyph,
  putGlyph,
  removeGlyph,
} from "@typewright/font-model";
import { editorState } from "@typewright/tools";
import { describe, expect, it } from "vitest";

import { type HistoryEntry, glyphsChanged, history, push, stepTo } from "../src/history.js";
import { type EditSession, goToStep, redo, session, undo } from "../src/session.js";

/**
 * Going to any step of the history in one move, as the history list does, and
 * saying which glyphs each step changed.
 */

const start = fontDocument([
  glyph("a", { unicodes: [0x61], advance: 500 }),
  glyph("b", { unicodes: [0x62], advance: 520 }),
]);

function step(label: string, before: FontDocument, after: FontDocument, at: number): HistoryEntry {
  return { label, before, after, selectionBefore: [], selectionAfter: [], at };
}

/** Three steps, far enough apart not to merge: widen a, widen b, then add c. */
function threeSteps(): { s: EditSession; docs: FontDocument[] } {
  const d1 = putGlyph(start, { ...start.glyphs["a"]!, advance: 600 });
  const d2 = putGlyph(d1, { ...d1.glyphs["b"]!, advance: 620 });
  const d3 = putGlyph(d2, glyph("c", { unicodes: [0x63], advance: 480 }));
  let h = history();
  h = push(h, step("Width", start, d1, 0));
  h = push(h, step("Width", d1, d2, 10_000));
  h = push(h, step("Add glyph", d2, d3, 20_000));
  const base = session(editorState({ document: d3, view: { scale: 1, tx: 0, ty: 0 } }));
  return { s: { ...base, history: h }, docs: [start, d1, d2, d3] };
}

describe("goToStep", () => {
  it("lands where that many undos would", () => {
    const { s, docs } = threeSteps();
    const jumped = goToStep(s, 1);
    expect(jumped.editor.document).toBe(docs[1]);
    expect(jumped.history.index).toBe(1);
    expect(undo(undo(s)).editor.document).toBe(jumped.editor.document);
  });

  it("goes back to before the first step, and forward again", () => {
    const { s, docs } = threeSteps();
    const opened = goToStep(s, 0);
    expect(opened.editor.document).toBe(docs[0]);
    const again = goToStep(opened, 3);
    expect(again.editor.document).toBe(docs[3]);
    expect(redo(again)).toBe(again);
  });

  it("is held to the stack, and does nothing where it already is", () => {
    const { s } = threeSteps();
    expect(goToStep(s, 3)).toBe(s);
    expect(goToStep(s, 99)).toBe(s);
    expect(stepTo(s.history, -4).index).toBe(0);
  });
});

describe("glyphsChanged", () => {
  it("names the glyphs a step changed, added or removed", () => {
    const { s, docs } = threeSteps();
    const [first, second, third] = s.history.entries;
    expect(glyphsChanged(first!)).toEqual(["a"]);
    expect(glyphsChanged(second!)).toEqual(["b"]);
    expect(glyphsChanged(third!)).toEqual(["c"]);
    const removed = removeGlyph(docs[3]!, "c")!;
    expect(glyphsChanged(step("Delete", docs[3]!, removed, 0))).toEqual(["c"]);
  });

  it("is empty for a step that changed no glyph", () => {
    const kerned = { ...start, kerning: { ...start.kerning } };
    expect(glyphsChanged(step("Kern", start, kerned, 0))).toEqual([]);
  });
});
