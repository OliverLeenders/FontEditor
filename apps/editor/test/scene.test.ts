import { beforeEach, describe, expect, it } from "vitest";

import { clearStoredSettings, installBrowserGlobals } from "./browser-globals.js";

installBrowserGlobals();

const { EditorStore } = await import("../src/store/index.js");
const { handlesAutoHidden, neighbourAt, neighboursFor, sceneFor, withinGlyph } =
  await import("../src/scene.js");
const { setActiveTool } = await import("@typewright/tools");
const { WEIGHT, glyphBounds, master, updateGlyph } = await import("@typewright/font-model");

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

  it("finds the neighbour a point falls in, by its advance", () => {
    const around = neighboursFor(doc(), "l", "hello");
    const e = around.find((n) => n.glyph.name === "e")!;

    // Anywhere in the band the letter occupies in the line, at any height: a
    // comma should be as easy to reach as an `m`.
    expect(neighbourAt(around, { x: e.x + 1, y: 0 })?.glyph.name).toBe("e");
    expect(neighbourAt(around, { x: e.x + e.glyph.advance - 1, y: 900 })?.glyph.name).toBe("e");
    expect(neighbourAt(around, { x: e.x - 1, y: 0 })?.glyph.name).not.toBe("e");
  });

  it("finds nothing in the band of the glyph being edited", () => {
    const around = neighboursFor(doc(), "l", "hello");
    expect(neighbourAt(around, { x: 10, y: 100 })).toBeNull();
    expect(neighbourAt([], { x: 10, y: 100 })).toBeNull();
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
    // Preferences outlive a store now, and these tests share one page: without
    // this, the toggle in one test is still in force in the next.
    clearStoredSettings();
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
    clearStoredSettings();
    store = new EditorStore();
  });

  it("carries the current glyph and the view", () => {
    const scene = sceneFor(store.getState(), SIZE);
    expect(scene.glyph.name).toBe(store.editor.currentGlyph);
    expect(scene.view).toBe(store.editor.view);
    expect(scene.viewport).toBe(SIZE);
  });

  it("draws the lines the font's own metrics define", () => {
    const { ascender, descender, xHeight, capHeight } = store.editor.document.info;
    const ys = sceneFor(store.getState(), SIZE).metricLines.map((g) => g.y);

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

describe("what belongs to the glyph being edited", () => {
  let store: Store;
  beforeEach(() => {
    store = new EditorStore();
  });

  it("counts the box round its drawing, which is not its advance", () => {
    const glyph = store.editor.document.glyphs["o"]!;
    const box = glyphBounds(glyph)!;

    expect(withinGlyph(glyph, { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 })).toBe(
      true,
    );
    // Above the drawing but inside the advance: not the glyph.
    expect(withinGlyph(glyph, { x: (box.minX + box.maxX) / 2, y: box.maxY + 50 })).toBe(false);
  });

  it("counts an overshoot outside the sidebearings", () => {
    // The part of a drawing that hangs over the next letter is still this
    // letter, and a second click there means what it means anywhere on it.
    const glyph = store.editor.document.glyphs["o"]!;
    const wide = {
      ...glyph,
      contours: glyph.contours.map((c) => ({
        ...c,
        nodes: c.nodes.map((n) => ({ ...n, pt: { ...n.pt, x: n.pt.x + glyph.advance } })),
      })),
    };
    expect(withinGlyph(wide, { x: glyph.advance + 100, y: 200 })).toBe(true);
  });

  it("says no for a glyph with nothing drawn in it", () => {
    const empty = { ...store.editor.document.glyphs["o"]!, contours: [] };
    expect(withinGlyph(empty, { x: 0, y: 0 })).toBe(false);
  });
});

describe("an instance between the masters", () => {
  /** The store, with two masters and both their documents in memory. */
  const withMasters = () => {
    const store = new EditorStore();
    const light = store.editor.document;
    const black = updateGlyph(light, "o", (g) => ({ ...g, advance: g.advance + 200 }));
    if (black === null) throw new Error("no o");

    store.patch({
      project: {
        axes: [WEIGHT],
        masters: [master("m1", "Regular", { wght: 400 }), master("m2", "Black", { wght: 900 })],
        sources: { m1: light, m2: black },
        current: "m1",
        instances: [],
      },
    });
    store.setCurrentGlyph("o");
    return store;
  };

  it("draws nothing until one is asked for", () => {
    const store = withMasters();
    expect(sceneFor(store.getState(), SIZE).instance).toEqual([]);
  });

  it("draws the letter worked out at the place asked for", () => {
    const store = withMasters();
    store.patch({ preview: { wght: 650 } });

    // Something to draw, and closed contours: an instance is filled.
    const shown = sceneFor(store.getState(), SIZE).instance;
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((c) => c.closed)).toBe(true);
  });

  it("draws nothing for a font with one master, wherever it is asked", () => {
    const store = new EditorStore();
    store.patch({ preview: { wght: 650 } });
    expect(sceneFor(store.getState(), SIZE).instance).toEqual([]);
  });

  it("draws nothing while space is held", () => {
    const store = withMasters();
    store.patch({ preview: { wght: 650 }, previewing: true });

    // Previewing the shape means the shape by itself.
    expect(sceneFor(store.getState(), SIZE).instance).toEqual([]);
  });

  it("draws nothing for a glyph the masters disagree about", () => {
    const store = withMasters();
    const project = store.getState().project;
    const black = project.sources["m2"]!;

    // A contour in one master and not the other: nothing honest to draw.
    const broken = updateGlyph(black, "o", (g) => ({ ...g, contours: [] }));
    if (broken === null) throw new Error("no o");
    store.patch({
      project: { ...project, sources: { ...project.sources, m2: broken } },
      preview: { wght: 650 },
    });

    expect(sceneFor(store.getState(), SIZE).instance).toEqual([]);
  });
});
