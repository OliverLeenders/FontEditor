import {
  EMPTY_KERNING,
  contour,
  counterIds,
  fontDocument,
  glyph,
  groupKey,
  node,
  setKern,
  setKernGroup,
  setKerning,
  sidebearings,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { kerningFor, setKernValue } from "../src/commands/kerning.js";
import { setMetricKey, spaceFromText, unlinkMetricKey } from "../src/commands/spacing.js";
import { type EditorState, editorState } from "../src/state.js";

/**
 * What the spacing view's fields write: a number, or `=` and a key, typed into
 * the same box; and the kerning between two letters, typed.
 */

const ids = counterIds("si");

/** A box glyph `left` in from the origin, `width` wide, with `right` after it. */
const box = (name: string, left: number, width: number, right: number) =>
  glyph(name, {
    advance: left + width + right,
    contours: [
      contour(
        ids.contour(),
        [
          node(ids.node(), { x: left, y: 0 }),
          node(ids.node(), { x: left + width, y: 0 }),
          node(ids.node(), { x: left + width, y: 700 }),
        ],
        true,
      ),
    ],
  });

function state(): EditorState {
  const document = fontDocument([
    box("n", 100, 300, 100),
    box("m", 10, 500, 10),
    box("o", 40, 300, 40),
  ]);
  return editorState({ document, view: { scale: 1, tx: 0, ty: 0 }, currentGlyph: "n" });
}

const keysOf = (s: EditorState, name: string) => s.document.glyphs[name]!.metricKeys;

describe("a key typed into a measurement", () => {
  it("is told from a number by the = in front of it, which is not stored", () => {
    const { state: next } = spaceFromText(state(), "m", "left", "=|n+10");
    expect(keysOf(next, "m").left).toBe("|n+10");
  });

  it("is refused where it names the same side of the glyph that holds it", () => {
    const before = state();
    expect(setMetricKey(before, "m", "left", "=m").state).toBe(before);
    // Its other side is a symmetrical letter, and is kept.
    expect(keysOf(setMetricKey(before, "o", "left", "=|").state, "o").left).toBe("|");
  });
});

describe("a number typed over a key", () => {
  it("drops the key and sets the number, in one undo step", () => {
    const keyed = spaceFromText(state(), "m", "left", "=n").state;
    const out = spaceFromText(keyed, "m", "left", "25");

    expect(keysOf(out.state, "m").left).toBe("");
    expect(sidebearings(out.state.document.glyphs["m"]!)?.left).toBe(25);
    expect(out.effects).toHaveLength(2);
  });

  it("ignores what is neither a number nor a key", () => {
    const before = state();
    expect(spaceFromText(before, "m", "left", "wide").state).toBe(before);
    expect(spaceFromText(before, "m", "left", "  ").state).toBe(before);
  });

  it("sets the advance for the width", () => {
    const { state: next } = spaceFromText(state(), "m", "width", "600");
    expect(next.document.glyphs["m"]!.advance).toBe(600);
  });
});

describe("dropping a key", () => {
  it("keeps the number the key came to, not the one last drawn", () => {
    const keyed = spaceFromText(state(), "m", "left", "=n").state;
    // Drawn at 10, taken from n at 100.
    expect(sidebearings(keyed.document.glyphs["m"]!)?.left).toBe(10);

    const out = unlinkMetricKey(keyed, "m", "left").state;
    expect(keysOf(out, "m").left).toBe("");
    expect(sidebearings(out.document.glyphs["m"]!)?.left).toBe(100);
  });

  it("does the same for a bare =", () => {
    const keyed = spaceFromText(state(), "m", "left", "=n").state;
    const out = spaceFromText(keyed, "m", "left", "=").state;
    expect(keysOf(out, "m").left).toBe("");
    expect(sidebearings(out.document.glyphs["m"]!)?.left).toBe(100);
  });

  it("leaves a glyph as drawn where its key could not be followed", () => {
    const keyed = setMetricKey(state(), "m", "left", "nowhere").state;
    const out = unlinkMetricKey(keyed, "m", "left").state;
    expect(keysOf(out, "m").left).toBe("");
    expect(sidebearings(out.document.glyphs["m"]!)?.left).toBe(10);
  });
});

describe("a kern typed", () => {
  it("sets the pair to the number, rounded", () => {
    const { state: next } = setKernValue(state(), "n", "o", -35.4);
    expect(kerningFor(next, "n", "o")?.value).toBe(-35);
  });

  it("writes to the class governing the pair, as a nudge does", () => {
    const base = state();
    let kerning = setKernGroup(EMPTY_KERNING, "first", "n_right", ["n", "m"]);
    const grouped = kerningFor({ ...base, document: setKerning(base.document, kerning) }, "n", "o");
    expect(grouped).toBeNull();

    kerning = setKern(kerning, groupKey("n_right"), "o", -10);
    const withClass = { ...base, document: setKerning(base.document, kerning) };
    const { state: next } = setKernValue(withClass, "n", "o", -30);

    expect(kerningFor(next, "m", "o")?.value).toBe(-30);
    expect(kerningFor(next, "n", "o")?.grouped).toBe(true);
  });

  it("refuses a number that is not one", () => {
    const before = state();
    expect(setKernValue(before, "n", "o", Number.NaN).state).toBe(before);
  });
});
