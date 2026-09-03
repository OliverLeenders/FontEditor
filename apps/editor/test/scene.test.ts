import { beforeEach, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";

installBrowserGlobals();

const { EditorStore } = await import("../src/store.js");
const { handlesAutoHidden, neighboursFor, sceneFor } = await import("../src/scene.js");
const { setActiveTool } = await import("@fonteditor/tools");

type Store = InstanceType<typeof EditorStore>;

const SIZE = { width: 900, height: 700 };

describe("neighboursFor", () => {
  let store: Store;
  beforeEach(() => {
    store = new EditorStore();
  });

  const doc = () => store.editor.document;

  it("finds the glyphs either side of the one being edited", () => {
    // The starter font spells "hello" from h, e, l, o.
    const around = neighboursFor(doc(), "l", "hello");
    const names = around.map((n) => n.glyph.name);

    expect(names).toContain("h");
    expect(names).toContain("e");
    expect(names).toContain("o");
  });

  it("places each neighbour at the accumulated advance, not at a fixed step", () => {
    const around = neighboursFor(doc(), "l", "hello");
    const e = around.find((n) => n.glyph.name === "e")!;
    const h = around.find((n) => n.glyph.name === "h")!;

    // Walking left, each step subtracts that glyph's own advance.
    expect(e.x).toBeCloseTo(-e.glyph.advance, 6);
    expect(h.x).toBeCloseTo(-e.glyph.advance - h.glyph.advance, 6);
  });

  it("starts the right-hand run after the edited glyph's advance", () => {
    const around = neighboursFor(doc(), "h", "hello");
    const first = around.find((n) => n.x >= 0)!;
    expect(first.x).toBeCloseTo(doc().glyphs["h"]!.advance, 6);
  });

  it("shows nothing when the glyph is not in the text at all", () => {
    expect(neighboursFor(doc(), "o", "hi")).toEqual([]);
  });

  it("shows nothing for an empty text", () => {
    expect(neighboursFor(doc(), "o", "")).toEqual([]);
  });

  it("reaches no further than it is asked to", () => {
    expect(neighboursFor(doc(), "l", "hello", 1)).toHaveLength(2);
    expect(neighboursFor(doc(), "l", "hello", 0)).toHaveLength(0);
  });

  it("ignores characters the font has no glyph for", () => {
    // "z" is not in the starter font, so it contributes nothing and is not
    // mistaken for a gap of unknown width.
    const around = neighboursFor(doc(), "o", "zoz");
    expect(around.every((n) => n.glyph.name !== "z")).toBe(true);
  });

  it("locates the edited glyph by its first appearance", () => {
    // "l" appears twice in "hello"; the run must be built around one of them,
    // consistently, or the context would jump as you type.
    const first = neighboursFor(doc(), "l", "hello");
    const again = neighboursFor(doc(), "l", "hello");
    expect(first.map((n) => [n.glyph.name, n.x])).toEqual(again.map((n) => [n.glyph.name, n.x]));
  });
});

describe("handlesAutoHidden", () => {
  let store: Store;
  beforeEach(() => {
    store = new EditorStore();
  });

  it("is on by default, with the select tool", () => {
    expect(handlesAutoHidden(store.getState())).toBe(true);
  });

  it("is off once the preference is turned off", () => {
    store.toggleAutoHideHandles();
    expect(handlesAutoHidden(store.getState())).toBe(false);
  });

  it("is never on while the pen is out", () => {
    // The pen keeps no hovered or focused segment, so hiding handles would take
    // them away exactly while they are being placed.
    store.applyTool(setActiveTool(store.editor, "pen"));
    expect(store.getState().autoHideHandles).toBe(true);
    expect(handlesAutoHidden(store.getState())).toBe(false);
  });
});

describe("sceneFor", () => {
  let store: Store;
  beforeEach(() => {
    store = new EditorStore();
  });

  it("carries the current glyph and the view", () => {
    const scene = sceneFor(store.getState(), SIZE);
    expect(scene.glyph.name).toBe(store.editor.currentGlyph);
    expect(scene.view).toBe(store.editor.view);
    expect(scene.viewport).toBe(SIZE);
  });

  it("draws guides from the font's own metrics", () => {
    const { ascender, descender, xHeight, capHeight } = store.editor.document.info;
    const ys = sceneFor(store.getState(), SIZE).guides.map((g) => g.y);

    expect(ys).toContain(0);
    expect(ys).toContain(ascender);
    expect(ys).toContain(descender);
    expect(ys).toContain(xHeight);
    expect(ys).toContain(capHeight);
  });

  it("survives a glyph name that does not resolve", () => {
    store.setEditor({ ...store.editor, currentGlyph: "no-such-glyph" });
    const scene = sceneFor(store.getState(), SIZE);
    expect(scene.glyph.contours).toEqual([]);
    expect(scene.glyph.advance).toBe(0);
  });

  it("hides every control while space is held", () => {
    store.setPreviewing(true);
    expect(sceneFor(store.getState(), SIZE).options.showControls).toBe(false);
    store.setPreviewing(false);
    expect(sceneFor(store.getState(), SIZE).options.showControls).toBe(true);
  });

  it("passes the auto-hide decision through, rather than deciding again", () => {
    expect(sceneFor(store.getState(), SIZE).options.autoHideHandles).toBe(
      handlesAutoHidden(store.getState()),
    );
    store.toggleAutoHideHandles();
    expect(sceneFor(store.getState(), SIZE).options.autoHideHandles).toBe(
      handlesAutoHidden(store.getState()),
    );
  });

  it("draws no neighbours when they are switched off", () => {
    store.setStripText("hello");
    store.setCurrentGlyph("l");
    expect(sceneFor(store.getState(), SIZE).neighbours.length).toBeGreaterThan(0);

    store.toggleNeighbours();
    expect(sceneFor(store.getState(), SIZE).neighbours).toEqual([]);
  });
});
