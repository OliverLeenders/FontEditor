import { describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";

installBrowserGlobals();

const { runView } = await import("../src/components/SpacingView.js");
const { EditorStore } = await import("../src/store/index.js");
const { glyphAtX, layoutRun } = await import("@typewright/view");

const VIEWPORT = { width: 1000, height: 600 };

describe("runView", () => {
  it("scales by the type size against the em, like a font size", () => {
    expect(runView(0, 128, 1000, VIEWPORT).scale).toBeCloseTo(0.128, 10);
    expect(runView(0, 256, 1000, VIEWPORT).scale).toBeCloseTo(0.256, 10);
    // A 2048-unit font at the same type size draws the same size on screen.
    expect(runView(0, 128, 2048, VIEWPORT).scale).toBeCloseTo(128 / 2048, 10);
  });

  it("centres a line that fits", () => {
    // 2000 units at 0.1 scale is 200px in a 1000px viewport.
    const view = runView(2000, 100, 1000, VIEWPORT);
    expect(view.tx).toBe((1000 - 200) / 2);
  });

  it("insets a line too wide to centre, rather than losing both ends", () => {
    // 20000 units at 0.1 is 2000px, twice the viewport.
    expect(runView(20000, 100, 1000, VIEWPORT).tx).toBe(40);
  });

  it("puts the baseline in the lower part of the viewport", () => {
    const view = runView(0, 128, 1000, VIEWPORT);
    expect(view.ty).toBeGreaterThan(VIEWPORT.height / 2);
    expect(view.ty).toBeLessThan(VIEWPORT.height);
  });
});

describe("clicking a spacing line", () => {
  /** Screen x back to a run index, exactly as the view does it. */
  const hit = (runWidth: number, run: ReturnType<typeof layoutRun>, screenX: number) => {
    const view = runView(runWidth, 128, 1000, VIEWPORT);
    return glyphAtX(run, (screenX - view.tx) / view.scale)?.index ?? null;
  };

  it("resolves a click to the glyph that was drawn there", () => {
    const store = new EditorStore();
    const run = layoutRun(store.editor.document, "nonno");
    expect(run.glyphs.length).toBe(5);

    const view = runView(run.width, 128, 1000, VIEWPORT);

    // Take the middle of each glyph's advance, convert to screen, convert back.
    for (const placed of run.glyphs) {
      const middle = placed.x + placed.glyph.advance / 2;
      const screenX = middle * view.scale + view.tx;
      expect(hit(run.width, run, screenX)).toBe(placed.index);
    }
  });

  it("misses cleanly outside the line", () => {
    const store = new EditorStore();
    const run = layoutRun(store.editor.document, "no");
    expect(hit(run.width, run, 0)).toBeNull();
    expect(hit(run.width, run, VIEWPORT.width)).toBeNull();
  });
});
