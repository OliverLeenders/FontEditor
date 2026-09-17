// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { GlyphBrowser } = await import("../src/components/GlyphBrowser.js");
const { DEFAULT_GRID } = await import("@typewright/view");

/**
 * What a cell cannot say for itself.
 *
 * A cell has room for a glyph name and a code point, and for a combining mark
 * those are `uni0308` and `U+0308` — which say nothing about which mark it is.
 * The tip is where the standard's own name goes, along with the block and
 * whether the glyph has been drawn.
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

/** Where to point at cell `index`, in the one-column layout jsdom produces. */
function at(index: number) {
  const { padding, cellHeight, gap } = DEFAULT_GRID;
  return {
    clientX: padding + 10,
    clientY: padding + index * (cellHeight + gap) + 20,
    pointerType: "mouse",
  };
}

function browser() {
  const store = freshStore();
  render(<GlyphBrowser onOpen={vi.fn()} />, store);
  return { store, grid: screen.getByRole("grid", { name: "Glyphs" }) };
}

describe("the tip beside a cell", () => {
  it("names the character the standard's way, and says where it is from", async () => {
    const { store, grid } = browser();
    const name = store.editor.document.glyphOrder[1]!;
    const code = store.editor.document.glyphs[name]?.unicodes[0];

    fireEvent.pointerMove(grid, at(1));

    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent).toContain(name);
    if (code !== undefined) {
      expect(tip.textContent).toContain(`U+${code.toString(16).toUpperCase().padStart(4, "0")}`);
      // The table is unpacked on the first hover, so the name arrives after it.
      await waitFor(() => {
        expect(screen.getByRole("tooltip").textContent.toUpperCase()).toMatch(/LETTER|DIGIT|SIGN/);
      });
    }
  });

  it("says a glyph has not been drawn yet, which is why the cell is empty", async () => {
    const { store, grid } = browser();
    // The first cell with nothing in it, which is the one the tip has to
    // account for: a row of them is what "Add missing" leaves behind.
    const index = store.editor.document.glyphOrder.findIndex((each) => {
      const g = store.editor.document.glyphs[each];
      return g !== undefined && g.contours.length === 0 && g.components.length === 0;
    });
    expect(index).toBeGreaterThanOrEqual(0);

    fireEvent.pointerMove(grid, at(index));
    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent).toContain("not yet drawn");
  });

  it("goes away when the pointer leaves the grid", async () => {
    const { grid } = browser();
    fireEvent.pointerMove(grid, at(2));
    await screen.findByRole("tooltip");

    fireEvent.pointerLeave(grid);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("stays out of the way of the menu", async () => {
    const { grid } = browser();
    fireEvent.pointerMove(grid, at(1));
    await screen.findByRole("tooltip");

    fireEvent.contextMenu(grid, at(1));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
