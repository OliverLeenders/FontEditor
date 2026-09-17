// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { LayersSection } = await import("../src/components/inspector/LayersSection.js");
const { GlyphBrowser } = await import("../src/components/GlyphBrowser.js");
const { sceneFor } = await import("../src/scene.js");
const { BACKGROUND } = await import("@typewright/font-model");
const { DEFAULT_GRID } = await import("@typewright/view");

/**
 * The glyph's layers, in the inspector and in the grid's menu.
 *
 * Asked of the font rather than of the markup: pressing a button here has to
 * point the tools at a layer, or move a drawing, or add a layer to every
 * glyph — and the canvas has to show what is behind.
 */

beforeAll(() => {
  installDomStubs();
  const canvas = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  canvas["getContext"] = (): unknown =>
    new Proxy(
      {
        measureText: () => ({ width: 0 }),
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      },
      {
        get: (target, key) =>
          key in target ? target[key as keyof typeof target] : () => undefined,
      },
    );
  const globals = globalThis as unknown as Record<string, unknown>;
  if (typeof globals["requestAnimationFrame"] !== "function") {
    globals["requestAnimationFrame"] = (run: () => void): number =>
      setTimeout(run, 16) as unknown as number;
    globals["cancelAnimationFrame"] = (id: number): void => clearTimeout(id);
  }
});

afterEach(() => {
  cleanup();
});

const button = (name: string | RegExp) => screen.getByRole("button", { name });

function section() {
  const store = freshStore();
  render(<LayersSection />, store);
  // Folded until the font has a layer, since nothing in it is relevant before.
  const toggle = screen.getByRole("button", { name: /Layers/ });
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
  return store;
}

describe("the layers section", () => {
  it("adds the background, and draws in it and back in the letter", () => {
    const store = section();
    fireEvent.click(button("Add background"));
    expect(store.editor.document.layers.map((l) => l.name)).toEqual([BACKGROUND]);

    fireEvent.click(button("Draw in background"));
    expect(store.editor.layer).toBe(BACKGROUND);
    fireEvent.click(button("Draw in the letter itself"));
    expect(store.editor.layer).toBeNull();
  });

  it("copies the open glyph into a layer, trades them, and clears it", () => {
    const store = section();
    fireEvent.click(button("Add background"));
    const name = store.editor.currentGlyph;
    const drawing = store.editor.document.glyphs[name]!.contours;

    fireEvent.click(button(`Copy ${name} into background`));
    expect(store.editor.document.glyphs[name]?.layers[BACKGROUND]?.contours).toBe(drawing);

    fireEvent.click(button(`Clear background in ${name}`));
    expect(store.editor.document.glyphs[name]?.layers).toEqual({});

    fireEvent.click(button(`Swap ${name} with background`));
    // Traded with an empty background: the letter is empty, the background has it.
    expect(store.editor.document.glyphs[name]?.contours).toEqual([]);
    expect(store.editor.document.glyphs[name]?.layers[BACKGROUND]?.contours).toBe(drawing);
    act(() => {
      store.undo();
    });
    expect(store.editor.document.glyphs[name]?.contours).toBe(drawing);
  });

  it("adds a named layer, and refuses one of a name the font has", () => {
    const store = section();
    const field = screen.getByLabelText("Name of a new layer");
    fireEvent.change(field, { target: { value: "sketch" } });
    fireEvent.click(button("Add"));
    expect(store.editor.document.layers.map((l) => l.name)).toEqual(["sketch"]);

    fireEvent.change(screen.getByLabelText("Name of a new layer"), {
      target: { value: "sketch" },
    });
    expect(screen.getByRole("status").textContent).toMatch(/already a layer/);
    expect((button("Add") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows and hides a layer behind the drawing", () => {
    const store = section();
    fireEvent.click(button("Add background"));
    expect(store.getState().shownLayers).toContain(BACKGROUND);
    fireEvent.click(button("Hide background behind the drawing"));
    expect(store.getState().shownLayers).not.toContain(BACKGROUND);
  });

  it("removes a layer from the font", () => {
    const store = section();
    fireEvent.click(button("Add background"));
    fireEvent.click(screen.getByText("Remove a layer from the font"));
    fireEvent.click(button("Remove background"));
    expect(store.editor.document.layers).toEqual([]);
  });
});

describe("what the canvas shows behind", () => {
  it("draws a shown layer, and the letter while a layer is drawn in", () => {
    const store = freshStore();
    const name = store.editor.currentGlyph;
    act(() => {
      store.copyToLayer([name], BACKGROUND);
    });
    const letter = store.editor.document.glyphs[name]!.contours.length;
    const size = { width: 800, height: 600 };

    // The background, shown behind the letter.
    expect(sceneFor(store.getState(), size).behind.length).toBe(letter);

    act(() => {
      store.toggleLayerShown(BACKGROUND);
    });
    expect(sceneFor(store.getState(), size).behind).toEqual([]);

    // Drawing in the background: the letter behind it, and the background is
    // the drawing itself rather than something behind.
    act(() => {
      store.drawInLayer(BACKGROUND);
      store.toggleLayerShown(BACKGROUND);
    });
    const scene = sceneFor(store.getState(), size);
    expect(scene.behind.length).toBe(letter);
    expect(scene.glyph.contours.length).toBe(letter);
  });

  it("is where B points the tools, and back again", () => {
    const store = freshStore();
    act(() => {
      store.toggleBackground();
    });
    expect(store.editor.layer).toBe(BACKGROUND);
    expect(store.editor.document.layers.map((l) => l.name)).toEqual([BACKGROUND]);
    act(() => {
      store.toggleBackground();
    });
    expect(store.editor.layer).toBeNull();
  });
});

describe("the glyph grid's menu", () => {
  it("copies every glyph picked into the background, adding it", () => {
    const store = freshStore();
    render(<GlyphBrowser onOpen={() => undefined} />, store);
    const grid = screen.getByRole("grid", { name: "Glyphs" });
    const { padding, cellHeight, gap } = DEFAULT_GRID;
    const at = (index: number, extra: Partial<MouseEvent> = {}) => ({
      clientX: padding + 10,
      clientY: padding + index * (cellHeight + gap) + 20,
      ...extra,
    });

    fireEvent.click(grid, at(1));
    fireEvent.click(grid, at(2, { shiftKey: true }));
    fireEvent.contextMenu(grid, at(1));
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitemcheckbox", {
        name: "Copy to background",
      }),
    );

    const [, first, second] = store.editor.document.glyphOrder;
    expect(store.editor.document.layers.map((l) => l.name)).toEqual([BACKGROUND]);
    expect(store.editor.document.glyphs[first!]?.layers[BACKGROUND]).toBeDefined();
    expect(store.editor.document.glyphs[second!]?.layers[BACKGROUND]).toBeDefined();
  });
});
