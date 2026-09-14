import {
  DEFAULT_FONT_INFO,
  type FontDocument,
  type Glyph,
  anchor,
  contour,
  counterIds,
  fontDocument,
  glyph,
  moveAnchorTo,
  node,
  putGlyph,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import {
  buildComposites,
  detachedComposites,
  infoProblem,
  reattachComposites,
  setInfo,
} from "../src/commands/index.js";
import { type EditorState, editorState } from "../src/state.js";

const ids = counterIds("k");

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

const letter = (name: string, code: number, anchors: readonly [string, number, number][]): Glyph =>
  glyph(name, {
    unicodes: [code],
    advance: 500,
    contours: [drawn()],
    anchors: anchors.map(([n, x, y]) => anchor(ids.anchor(), n, { x, y })),
  });

function start(document?: FontDocument): EditorState {
  return editorState({
    document:
      document ??
      fontDocument([
        letter("e", 0x65, [["top", 250, 520]]),
        letter("a", 0x61, [["top", 260, 520]]),
        letter("acutecomb", 0x301, [["_top", 100, 480]]),
      ]),
    view: { scale: 1, tx: 0, ty: 0 },
  });
}

describe("building accented glyphs", () => {
  it("builds every one the font can, as one undo step", () => {
    const state = start();
    const out = buildComposites(state, [0xe9, 0xe1], counterIds("b"));

    expect(out.state.document.glyphs["eacute"]?.components.map((c) => c.base)).toEqual([
      "e",
      "acutecomb",
    ]);
    expect(out.state.document.glyphs["aacute"]).toBeDefined();
    expect(out.effects[0]).toMatchObject({ label: "Build 2 accented glyphs" });
  });

  it("does nothing, and records nothing, when there is nothing to build", () => {
    const state = start();
    const out = buildComposites(state, [0x65, 0xe8], counterIds("b"));

    expect(out.state).toBe(state);
    expect(out.effects).toEqual([]);
  });
});

describe("re-attaching accents", () => {
  const built = (): EditorState => buildComposites(start(), [0xe9], counterIds("b")).state;

  it("finds nothing to do on composites that are where their anchors say", () => {
    const state = built();
    expect(detachedComposites(state)).toEqual([]);

    const out = reattachComposites(state);
    expect(out.state).toBe(state);
    expect(out.effects).toEqual([]);
  });

  it("moves the accent after the letter's anchor has moved", () => {
    const state = built();
    const e = state.document.glyphs["e"]!;
    const moved = {
      ...state,
      document: putGlyph(state.document, moveAnchorTo(e, e.anchors[0]!.id, { x: 250, y: 560 })!),
    };

    // Left where it was until asked: nothing follows an anchor by itself.
    expect(moved.document.glyphs["eacute"]!.components[1]!.transform.yOffset).toBe(40);
    expect(detachedComposites(moved)).toEqual(["eacute"]);

    const out = reattachComposites(moved);
    expect(out.state.document.glyphs["eacute"]!.components[1]!.transform.yOffset).toBe(80);
    expect(out.effects[0]).toMatchObject({ label: "Re-attach accents" });
  });
});

describe("the vertical metrics in font info", () => {
  const info = (patch: Partial<typeof DEFAULT_FONT_INFO>) => ({ ...DEFAULT_FONT_INFO, ...patch });

  it("accepts every override left unset", () => {
    expect(infoProblem(DEFAULT_FONT_INFO)).toBeNull();
  });

  it("wants whole units", () => {
    expect(infoProblem(info({ openTypeOS2TypoAscender: 750.5 }))).toMatch(/whole/);
  });

  it("refuses a descender above the baseline", () => {
    expect(infoProblem(info({ openTypeHheaDescender: 200 }))).toMatch(/descender/);
    expect(infoProblem(info({ openTypeOS2TypoDescender: 1 }))).toMatch(/descender/);
  });

  it("refuses a Windows value written as a coordinate rather than a distance", () => {
    expect(infoProblem(info({ openTypeOS2WinDescent: -250 }))).toMatch(/distances/);
  });

  it("allows a negative line gap, which is legal and turns up in real fonts", () => {
    expect(infoProblem(info({ openTypeOS2TypoLineGap: -20 }))).toBeNull();
  });

  it("refuses a selection bit that is not one", () => {
    expect(infoProblem(info({ openTypeOS2Selection: [16] }))).toMatch(/bit/);
  });

  it("clears an override back to derived", () => {
    const state = start();
    const set = setInfo(state, { openTypeHheaLineGap: 100 }).state;
    expect(set.document.info.openTypeHheaLineGap).toBe(100);

    const cleared = setInfo(set, { openTypeHheaLineGap: null }).state;
    expect(cleared.document.info.openTypeHheaLineGap).toBeNull();
  });
});
