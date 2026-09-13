// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { GlyphBrowser } = await import("../src/components/GlyphBrowser.js");
const { DEFAULT_GRID } = await import("@typewright/view");

/**
 * The glyph browser: picking cells, and what the menu and the keyboard do to
 * the cells picked.
 *
 * The grid is a canvas, so a cell is reached the way a pointer reaches it: by
 * where it is. jsdom measures every element as zero wide, which lays the grid
 * out one column wide, so cell `i` is the `i`-th row down.
 */

beforeAll(() => {
  installDomStubs();
  // The surface refuses to exist without a context, and jsdom provides none.
  // One that accepts everything and draws nothing is enough, as in the proof's
  // tests: the cells are drawn and tested in the render package.
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

type Store = ReturnType<typeof freshStore>;

const grid = () => screen.getByRole("grid", { name: "Glyphs" });

/** Where to point at cell `index`, in the one-column layout jsdom produces. */
function at(index: number, modifiers: Partial<MouseEvent> = {}) {
  const { padding, cellHeight, gap } = DEFAULT_GRID;
  return {
    clientX: padding + 10,
    clientY: padding + index * (cellHeight + gap) + 20,
    ...modifiers,
  };
}

function browser(store: Store = freshStore()) {
  const onOpen = vi.fn();
  render(<GlyphBrowser onOpen={onOpen} />, store);
  // Font order, which is the browser's own until it is asked for another.
  const order = [...store.editor.document.glyphOrder];
  return { store, onOpen, order };
}

function menuItem(label: string | RegExp): HTMLButtonElement {
  return within(screen.getByRole("menu")).getByRole<HTMLButtonElement>("menuitemcheckbox", {
    name: label,
  });
}

const picked = () => /(\d+) picked/.exec(document.body.textContent)?.[1] ?? null;

describe("picking cells", () => {
  it("picks one cell with a click, and says nothing about a count", () => {
    browser();
    fireEvent.click(grid(), at(1));
    expect(picked()).toBeNull();
  });

  it("adds a cell with ctrl, and takes it away again", () => {
    browser();
    fireEvent.click(grid(), at(1));
    fireEvent.click(grid(), at(3, { ctrlKey: true }));
    expect(picked()).toBe("2");

    fireEvent.click(grid(), at(3, { ctrlKey: true }));
    expect(picked()).toBeNull();
  });

  it("takes the run from the last cell picked with shift", () => {
    browser();
    fireEvent.click(grid(), at(1));
    fireEvent.click(grid(), at(4, { shiftKey: true }));
    expect(picked()).toBe("4");
  });

  it("extends with shift and the arrows, and lets go with Escape", () => {
    browser();
    fireEvent.click(grid(), at(1));
    fireEvent.keyDown(grid(), { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(grid(), { key: "ArrowDown", shiftKey: true });
    expect(picked()).toBe("3");

    fireEvent.keyDown(grid(), { key: "Escape" });
    expect(picked()).toBeNull();
  });

  it("picks every glyph shown with ctrl and A", () => {
    const { order } = browser();
    fireEvent.keyDown(grid(), { key: "a", ctrlKey: true });
    expect(picked()).toBe(String(order.length));
  });
});

describe("what is done to the cells picked", () => {
  it("deletes them all with the Delete key, as one step", () => {
    const { store, order } = browser();
    fireEvent.click(grid(), at(1));
    fireEvent.click(grid(), at(2, { shiftKey: true }));

    fireEvent.keyDown(grid(), { key: "Delete" });

    expect(store.editor.document.glyphs[order[1]!]).toBeUndefined();
    expect(store.editor.document.glyphs[order[2]!]).toBeUndefined();
    act(() => {
      store.undo();
    });
    expect(store.editor.document.glyphs[order[1]!]).toBeDefined();
    expect(store.editor.document.glyphs[order[2]!]).toBeDefined();
  });

  it("offers the menu for all of them, and renaming for none", () => {
    browser();
    fireEvent.click(grid(), at(1));
    fireEvent.click(grid(), at(3, { shiftKey: true }));
    fireEvent.contextMenu(grid(), at(2));

    expect(menuItem("Delete 3 glyphs")).toBeTruthy();
    expect(menuItem("Rename…").disabled).toBe(true);
    expect(menuItem("Duplicate").disabled).toBe(true);
  });

  it("marks them all with a colour, and ticks it once every one has it", () => {
    const { store, order } = browser();
    fireEvent.click(grid(), at(1));
    fireEvent.click(grid(), at(2, { shiftKey: true }));

    fireEvent.contextMenu(grid(), at(1));
    // The first colour, found as the first item with no word of the others in it.
    const colour = within(screen.getByRole("menu"))
      .getAllByRole("menuitemcheckbox")
      .find((item) => !/Open|Rename|Duplicate|Round|No colour|Delete/.test(item.textContent));
    if (colour === undefined) throw new Error("no colour in the menu");
    const name = colour.textContent;
    fireEvent.click(colour);

    const marks = [order[1]!, order[2]!].map(
      (each) => store.editor.document.glyphs[each]?.markColor,
    );
    expect(marks[0]).not.toBeNull();
    expect(marks[1]).toBe(marks[0]);

    fireEvent.contextMenu(grid(), at(2));
    expect(menuItem(name).getAttribute("aria-checked")).toBe("true");
  });

  it("points the menu at the cell under it when that cell was not picked", () => {
    const { store, order } = browser();
    fireEvent.click(grid(), at(1));
    fireEvent.click(grid(), at(2, { shiftKey: true }));

    fireEvent.contextMenu(grid(), at(4));
    fireEvent.click(menuItem("Delete"));

    expect(store.editor.document.glyphs[order[4]!]).toBeUndefined();
    expect(store.editor.document.glyphs[order[1]!]).toBeDefined();
  });

  it("will not delete .notdef, alone or among others", () => {
    const { store, order } = browser();
    const notdef = order.indexOf(".notdef");
    const beside = notdef === 0 ? 1 : notdef - 1;

    fireEvent.contextMenu(grid(), at(notdef));
    expect(menuItem("Delete").disabled).toBe(true);
    fireEvent.keyDown(document.body, { key: "Escape" });

    fireEvent.click(grid(), at(notdef));
    fireEvent.click(grid(), at(beside, { shiftKey: true }));
    fireEvent.keyDown(grid(), { key: "Delete" });

    expect(store.editor.document.glyphs[".notdef"]).toBeDefined();
    expect(store.editor.document.glyphs[order[beside]!]).toBeUndefined();
  });
});

describe("opening and renaming", () => {
  it("opens the cell with the focus on Enter, and a cell with a double-click", () => {
    const { onOpen, order } = browser();
    fireEvent.click(grid(), at(2));
    fireEvent.keyDown(grid(), { key: "Enter" });
    expect(onOpen).toHaveBeenLastCalledWith(order[2]);

    fireEvent.doubleClick(grid(), at(3));
    expect(onOpen).toHaveBeenLastCalledWith(order[3]);
  });

  it("renames the focused cell with F2", () => {
    const { store, order } = browser();
    fireEvent.click(grid(), at(1));
    fireEvent.keyDown(grid(), { key: "F2" });

    const field = screen.getByLabelText("Rename glyph");
    fireEvent.change(field, { target: { value: "renamed" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(store.editor.document.glyphs["renamed"]).toBeDefined();
    expect(store.editor.document.glyphs[order[1]!]).toBeUndefined();
  });
});
