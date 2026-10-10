import {
  type Contour,
  type SerifStyle,
  DEFAULT_SERIF,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
  strokeCutHandle,
  withNib,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { clipboardText, parseClipboard } from "../src/clipboard.js";
import { addSerifStyle, changeSerifStyle, removeSerifStyle } from "../src/commands/font.js";
import {
  selectedEndSerif,
  selectedEndSerifsDiffer,
  selectedStrokeEndShape,
  setEndSerifNumber,
  setEndSerifStyle,
  setStrokeEnd,
  setStrokeEndShape,
} from "../src/commands/nib.js";
import { pointerDown, pointerMove, pointerUp } from "../src/dispatch.js";
import { pointerInput } from "../src/input.js";
import { type EditorState, editorState } from "../src/state.js";

/**
 * A serif on a stroke's end, as the Pen section and Font info set it.
 *
 * How it is drawn is the model's business and tested there. What is asked
 * here is that a cut end can be closed with one, that its numbers are set on
 * the ends selected and on no others, that an end with one of the font's
 * styles follows that style but for the numbers set on it — and that changing
 * a style is one step that reaches every glyph.
 */

const ids = counterIds("serif-cmd");
const VIEW = { scale: 1, tx: 0, ty: 0 };
const FOOT: SerifStyle = { ...DEFAULT_SERIF, name: "Foot", left: 50, right: 50, height: 20 };

const stem = (x: number): Contour =>
  withNib(
    contour(ids.contour(), [node(ids.node(), { x, y: 600 }), node(ids.node(), { x, y: 0 })], false),
    { angle: 30, width: 80, thickness: 20 },
  );

/** Two glyphs with a stem each, the foot of the first one's selected. */
function twoStems(): EditorState {
  const state = editorState({
    document: fontDocument([
      glyph("l", { advance: 600, contours: [stem(200), stem(400)] }),
      glyph("i", { advance: 300, contours: [stem(150)] }),
    ]),
    view: VIEW,
    currentGlyph: "l",
  });
  return atFeet(state, 0);
}

const atFeet = (state: EditorState, ...which: number[]): EditorState => {
  const contours = state.document.glyphs[state.currentGlyph]!.contours;
  return {
    ...state,
    selection: which.map((i) => ({
      contourId: contours[i]!.id,
      nodeId: contours[i]!.nodes[1]!.id,
      part: "point" as const,
    })),
  };
};
const footOf = (state: EditorState, name = "l", index = 0) =>
  state.document.glyphs[name]!.contours[index]!.nodes[1]!.end;
const serifed = (state: EditorState): EditorState =>
  setStrokeEndShape(setStrokeEnd(state, 0).state, "serif").state;

describe("closing a cut end with a serif", () => {
  it("is not offered to an end that is not cut", () => {
    const state = twoStems();
    expect(setStrokeEndShape(state, "serif").state).toBe(state);
  });

  it("starts as a plain slab of its own numbers where the font has no style", () => {
    const state = serifed(twoStems());
    expect(selectedStrokeEndShape(state)).toBe("serif");
    expect(footOf(state)).toEqual({ cut: 0, serif: DEFAULT_SERIF });
    // And the other stem's foot is as it was.
    expect(footOf(state, "l", 1)).toBeUndefined();
  });

  it("starts as the font's first style where it has one", () => {
    const state = serifed(addSerifStyle(twoStems(), FOOT).state);
    expect(footOf(state)!.serif).toEqual({
      ...DEFAULT_SERIF,
      left: 50,
      right: 50,
      height: 20,
      style: "Foot",
    });
  });

  it("goes when the end is closed with something else, and with the cut", () => {
    const state = serifed(twoStems());
    expect(footOf(setStrokeEndShape(state, "straight").state)).toEqual({ cut: 0 });
    expect(footOf(setStrokeEndShape(state, "nib").state)).toEqual({ cut: 0, shape: "nib" });
    expect(footOf(setStrokeEnd(state, "pen").state)).toBeUndefined();
  });

  it("stays when the cut is turned, by the row or by the knob", () => {
    const state = serifed(twoStems());
    expect(footOf(setStrokeEnd(state, "square").state)!.serif).toEqual(DEFAULT_SERIF);

    const c = state.document.glyphs["l"]!.contours[0]!;
    const knob = strokeCutHandle(c, "end")!.knob;
    const held = pointerDown(state, pointerInput(knob), { ids }).state;
    const turned = pointerUp(
      pointerMove(held, pointerInput({ x: knob.x, y: 30 }), { ids }).state,
    ).state;
    expect(footOf(turned)!.cut).not.toBe(0);
    expect(footOf(turned)!.serif).toEqual(DEFAULT_SERIF);
  });

  it("is copied and pasted with the stroke", () => {
    const state = serifed(twoStems());
    const pasted = parseClipboard(clipboardText(state)!, ids)!;
    expect(pasted[0]!.nodes[1]!.end).toEqual({ cut: 0, serif: DEFAULT_SERIF });
  });
});

describe("a serif's numbers on the selected ends", () => {
  it("are set one at a time, on those ends and no others", () => {
    let state = serifed(twoStems());
    state = serifed(atFeet(state, 1));
    state = setEndSerifNumber(atFeet(state, 0), "left", 90).state;
    expect(footOf(state, "l", 0)!.serif!.left).toBe(90);
    expect(footOf(state, "l", 0)!.serif!.right).toBe(60);
    expect(footOf(state, "l", 1)!.serif!.left).toBe(60);
    expect(selectedEndSerifsDiffer(atFeet(state, 0, 1))).toBe(true);
    expect(selectedEndSerifsDiffer(atFeet(state, 0))).toBe(false);
  });

  it("are kept sound: no reach below nothing, no share over the whole", () => {
    let state = serifed(twoStems());
    state = setEndSerifNumber(state, "right", -20).state;
    state = setEndSerifNumber(state, "bracket", 4).state;
    expect(footOf(state)!.serif!.right).toBe(0);
    expect(footOf(state)!.serif!.bracket).toBe(1);
  });

  it("change nothing, and are no step, where the number is the one it has", () => {
    const state = serifed(twoStems());
    expect(setEndSerifNumber(state, "left", 60).state).toBe(state);
  });

  it("are the same serif to a panel until the serif changes", () => {
    const state = serifed(twoStems());
    expect(selectedEndSerif(state)).toBe(selectedEndSerif(state));
    expect(selectedEndSerif(atFeet(state, 1))).toBeNull();
  });
});

describe("a serif style of the font", () => {
  const styled = (): EditorState => {
    let state = addSerifStyle(twoStems(), FOOT).state;
    state = serifed(state);
    state = serifed(atFeet(state, 1));
    state = serifed(atFeet({ ...state, currentGlyph: "i" }, 0));
    return atFeet({ ...state, currentGlyph: "l" }, 0);
  };

  it("is added under its name, or the name with a number where it is taken", () => {
    const state = addSerifStyle(addSerifStyle(twoStems(), FOOT).state, FOOT).state;
    expect(state.document.serifs.map((s) => s.name)).toEqual(["Foot", "Foot 2"]);
  });

  it("changes every end that has it, in every glyph", () => {
    const after = changeSerifStyle(styled(), "Foot", { ...FOOT, left: 80, bracket: 0.5 }).state;
    for (const [name, index] of [
      ["l", 0],
      ["l", 1],
      ["i", 0],
    ] as const) {
      expect(footOf(after, name, index)!.serif).toMatchObject({
        left: 80,
        bracket: 0.5,
        style: "Foot",
      });
    }
    expect(after.document.serifs[0]!.left).toBe(80);
  });

  it("leaves a number that was set on an end, until the end follows the style again", () => {
    let state = setEndSerifNumber(styled(), "right", 10).state;
    expect(footOf(state)!.serif!.own).toEqual(["right"]);
    state = changeSerifStyle(state, "Foot", { ...FOOT, left: 80, right: 80 }).state;
    expect(footOf(state)!.serif).toMatchObject({ left: 80, right: 10 });
    expect(footOf(state, "l", 1)!.serif).toMatchObject({ left: 80, right: 80 });

    state = setEndSerifStyle(state, "Foot").state;
    expect(footOf(state)!.serif).toEqual({
      ...DEFAULT_SERIF,
      left: 80,
      right: 80,
      height: 20,
      style: "Foot",
    });
  });

  it("is renamed on the ends that have it, and not to a name another style has", () => {
    let state = addSerifStyle(styled(), { ...FOOT, name: "Head" }).state;
    expect(changeSerifStyle(state, "Foot", { ...FOOT, name: "Head" }).state).toBe(state);
    state = changeSerifStyle(state, "Foot", { ...FOOT, name: "Base" }).state;
    expect(state.document.serifs.map((s) => s.name)).toEqual(["Base", "Head"]);
    expect(footOf(state, "i")!.serif!.style).toBe("Base");
  });

  it("is given to an end, and taken off it leaving the numbers", () => {
    let state = addSerifStyle(styled(), { ...FOOT, name: "Head", height: 44 }).state;
    state = setEndSerifStyle(state, "Head").state;
    expect(footOf(state)!.serif).toMatchObject({ height: 44, style: "Head" });
    state = setEndSerifStyle(state, null).state;
    expect(footOf(state)!.serif).toEqual({ ...DEFAULT_SERIF, left: 50, right: 50, height: 44 });
    // A style the font has not got is not given.
    expect(setEndSerifStyle(state, "Nowhere").state).toBe(state);
  });

  it("is removed from the font and the letters keep their serifs", () => {
    const state = removeSerifStyle(styled(), "Foot").state;
    expect(state.document.serifs).toEqual([]);
    expect(footOf(state, "i")!.serif).toEqual({
      ...DEFAULT_SERIF,
      left: 50,
      right: 50,
      height: 20,
    });
  });
});
