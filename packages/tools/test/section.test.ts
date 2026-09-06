import { vec } from "@fonteditor/geometry";
import {
  type Contour,
  addContour,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
} from "@fonteditor/font-model";
import { describe, expect, it } from "vitest";

import {
  keyDown,
  keyUp,
  pointerDown,
  pointerMove,
  pointerUp,
  setActiveTool,
} from "../src/dispatch.js";
import { keyInput, pointerInput } from "../src/input.js";
import { shownSection } from "../src/section.js";
import { type EditorState, editorState } from "../src/state.js";

/**
 * The two rulers: the one held down while drawing, and the one laid across the
 * letter and worked under.
 */

const ids = counterIds("s");

/** Two upright bars, 100 wide, with a 100-wide gap between them: an `n` in kit form. */
function bars(): Contour[] {
  const bar = (left: number): Contour =>
    contour(
      ids.contour(),
      [
        node(ids.node(), vec(left, 0)),
        node(ids.node(), vec(left + 100, 0)),
        node(ids.node(), vec(left + 100, 700)),
        node(ids.node(), vec(left, 700)),
      ],
      true,
    );
  return [bar(0), bar(200)];
}

function start(): EditorState {
  const [first, second] = bars();
  const g = addContour(addContour(glyph("n", { advance: 400 }), first!), second!);
  return editorState({
    document: fontDocument([g]),
    view: { scale: 1, tx: 0, ty: 0 },
    activeTool: "section",
  });
}

const drag = (state: EditorState, from: ReturnType<typeof vec>, to: ReturnType<typeof vec>) => {
  let s = pointerDown(state, pointerInput(from)).state;
  s = pointerMove(s, pointerInput(to)).state;
  return pointerUp(s).state;
};

describe("the section ruler", () => {
  it("reads every width along the line, and says which are ink", () => {
    const s = drag(start(), vec(-50, 350), vec(350, 350));
    const section = shownSection(s)!;

    expect(section.crossings).toHaveLength(4);
    expect(section.spans.map((span) => [Math.round(span.distance), span.ink])).toEqual([
      [100, true],
      [100, false],
      [100, true],
    ]);
  });

  it("stays where it was put, so it can be read", () => {
    const s = drag(start(), vec(-50, 350), vec(350, 350));
    // The pointer moves away — to reach the numbers, or anything else — and the
    // line does not follow it.
    const later = pointerMove(s, pointerInput(vec(120, 600))).state;
    expect(later.section).toEqual(s.section);
  });

  it("holds the angle with shift, so a level cut is level", () => {
    let s = pointerDown(start(), pointerInput(vec(0, 350))).state;
    s = pointerMove(s, pointerInput(vec(300, 362), { shift: true })).state;

    // Twelve units off level over three hundred is under three degrees, which
    // snaps to the horizontal — and the line keeps the length it was dragged.
    expect(s.section!.to.y).toBeCloseTo(350, 6);
    expect(s.section!.to.x).toBeCloseTo(0 + Math.hypot(300, 12), 6);
  });

  it("forgets a click that drew no line", () => {
    const s = drag(start(), vec(10, 10), vec(10, 10));
    expect(s.section).toBeNull();
  });

  it("is cleared by Escape, and survives being left for another tool", () => {
    const s = drag(start(), vec(-50, 350), vec(350, 350));
    expect(keyDown(s, keyInput("Escape")).state.section).toBeNull();

    // A ruler is worked under: holding M to check one stem, or reaching for the
    // pen, must not sweep the line away. It is drawn only under its own tool.
    const away = setActiveTool(s, "select").state;
    expect(away.section).toEqual(s.section);
    expect(setActiveTool(away, "section").state.section).toEqual(s.section);
  });

  it("reads nothing where the line crosses nothing", () => {
    const s = drag(start(), vec(-50, 900), vec(350, 900));
    expect(shownSection(s)!.spans).toEqual([]);
  });
});

describe("measuring by holding the key", () => {
  it("borrows the tool while M is down and gives it back on release", () => {
    const drawing: EditorState = { ...start(), activeTool: "pen" };

    const held = keyDown(drawing, keyInput("m")).state;
    expect(held.activeTool).toBe("measure");
    expect(held.heldFrom).toBe("pen");

    const back = keyUp(held, keyInput("m")).state;
    expect(back.activeTool).toBe("pen");
    expect(back.heldFrom).toBeNull();
  });

  it("does not lose the tool to a repeating key", () => {
    // A held key repeats. The second event must not record `measure` as the
    // tool to go back to, or letting go would leave you where you were borrowed.
    let s = keyDown({ ...start(), activeTool: "select" }, keyInput("m")).state;
    s = keyDown(s, keyInput("m")).state;
    expect(keyUp(s, keyInput("m")).state.activeTool).toBe("select");
  });

  it("leaves a tool chosen with a letter alone", () => {
    // `L` is a switch, not a hold: releasing it changes nothing.
    const s = keyDown({ ...start(), activeTool: "select" }, keyInput("l")).state;
    expect(s.activeTool).toBe("section");
    expect(keyUp(s, keyInput("l")).state.activeTool).toBe("section");
  });

  it("is not borrowed mid-drag", () => {
    let s = pointerDown(start(), pointerInput(vec(-50, 350))).state;
    s = keyDown(s, keyInput("m")).state;
    expect(s.activeTool).toBe("section");
  });
});
