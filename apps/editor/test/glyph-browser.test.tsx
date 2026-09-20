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
  // In the font's own order: these tests reach a cell by where it is, and what
  // the list is sorted by is tested where the sorting is.
  act(() => {
    store.setCatalogQuery({ order: "font" });
  });
  render(<GlyphBrowser onOpen={onOpen} />, store);
  const order = [...store.editor.document.glyphOrder];
  return { store, onOpen, order };
}

function menuItem(label: string | RegExp): HTMLButtonElement {
  return within(screen.getByRole("menu")).getByRole<HTMLButtonElement>("menuitemcheckbox", {
    name: label,
  });
}

const picked = () => /(\d+) picked/.exec(document.body.textContent)?.[1] ?? null;

/**
 * The cells for code points the font has not got.
 *
 * Browsing a block is how somebody decides what to draw next, and a grid that
 * lists only what exists cannot show what is missing. These cells are offers,
 * not glyphs: nothing that acts on a glyph acts on them, and the gesture that
 * opens a glyph makes this one instead.
 */
describe("what the font has not got", () => {
  /** The browser on ASCII in code-point order, where the holes fall in place. */
  function ascii(): ReturnType<typeof browser> {
    // Asked for after the browser is up, since it opens the list in the font's
    // own order for the tests that reach a cell by where it is.
    const shown = browser();
    act(() => {
      shown.store.setCatalogQuery({ set: "ascii", order: "codePoint" });
    });
    return shown;
  }

  /** The index of the first cell for a code point the font has no glyph for. */
  function firstHole(store: Store): { index: number; codePoint: number } {
    const held = new Set(
      Object.values(store.editor.document.glyphs).flatMap((g) => [...g.unicodes]),
    );
    let index = 0;
    for (let code = 0x20; code <= 0x7e; code++) {
      if (!held.has(code)) return { index, codePoint: code };
      index++;
    }
    throw new Error("the starter font has all of ASCII");
  }

  it("counts them apart from the glyphs", () => {
    const { store } = ascii();
    const said = /(\d+) not in the font/.exec(document.body.textContent)?.[1];
    expect(said).toBeDefined();

    const held = new Set(
      Object.values(store.editor.document.glyphs).flatMap((g) => [...g.unicodes]),
    );
    let holes = 0;
    for (let code = 0x20; code <= 0x7e; code++) if (!held.has(code)) holes++;
    expect(Number(said)).toBe(holes);
  });

  it("makes the glyph and opens it when one is double-clicked", () => {
    const { store, onOpen } = ascii();
    const { index, codePoint } = firstHole(store);

    fireEvent.doubleClick(grid(), at(index));

    const made = Object.values(store.editor.document.glyphs).find((g) =>
      g.unicodes.includes(codePoint),
    );
    expect(made).toBeDefined();
    expect(onOpen).toHaveBeenCalledWith(made!.name);
    // Half the em, as every other way of making a glyph starts one.
    expect(made!.advance).toBe(Math.round(store.editor.document.info.unitsPerEm / 2));
  });

  it("makes it on Enter, which is what opens a glyph", () => {
    const { store } = ascii();
    const { index, codePoint } = firstHole(store);

    fireEvent.click(grid(), at(index));
    fireEvent.keyDown(grid(), { key: "Enter" });

    expect(
      Object.values(store.editor.document.glyphs).some((g) => g.unicodes.includes(codePoint)),
    ).toBe(true);
  });

  it("is not picked, so the count and the Delete key pass it by", () => {
    const { store } = ascii();
    const { index } = firstHole(store);
    const before = store.editor.document.glyphOrder.length;

    fireEvent.click(grid(), at(index));
    expect(picked()).toBeNull();

    fireEvent.keyDown(grid(), { key: "Delete" });
    expect(store.editor.document.glyphOrder).toHaveLength(before);
  });

  it("is left out when every glyph shown is picked", () => {
    const { store } = ascii();
    fireEvent.keyDown(grid(), { key: "a", ctrlKey: true });

    const held = new Set(
      Object.values(store.editor.document.glyphs).flatMap((g) => [...g.unicodes]),
    );
    let inAscii = 0;
    for (let code = 0x20; code <= 0x7e; code++) if (held.has(code)) inAscii++;
    expect(picked()).toBe(String(inAscii));
  });

  it("offers making it, and nothing that is about a glyph", () => {
    const { store } = ascii();
    const { index } = firstHole(store);
    fireEvent.contextMenu(grid(), at(index));

    expect(menuItem("Add to font")).toBeTruthy();
    expect(menuItem("Add and open")).toBeTruthy();
    expect(screen.queryByRole("menuitemcheckbox", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("menuitemcheckbox", { name: "Rename…" })).toBeNull();
  });

  it("offers a character searched for that the font has not got", () => {
    const store = freshStore();
    act(() => {
      store.setCatalogQuery({ set: "all", search: "U+01E7" });
    });
    browser(store);

    expect(/1 not in the font/.test(document.body.textContent)).toBe(true);
    fireEvent.doubleClick(grid(), at(0));
    expect(
      Object.values(store.editor.document.glyphs).some((g) => g.unicodes.includes(0x1e7)),
    ).toBe(true);
  });
});

/**
 * The bar over the list.
 *
 * Two fields side by side, one of which makes glyphs, and a control that says
 * what order the list is in. What is asked here is that they are told apart:
 * the search field is marked as one, and the order is a menu like every other
 * on the bar rather than a select with the browser's own arrow on it.
 */
describe("the bar", () => {
  it("opens in code-point order, which is the one order every reader knows", () => {
    const store = freshStore();
    render(<GlyphBrowser onOpen={vi.fn()} />, store);

    expect(store.getState().catalogQuery.order).toBe("codePoint");
    expect(screen.getByRole("button", { name: /Code point/ })).toBeTruthy();
  });

  it("says what the list is sorted by, and sorts it another way when asked", () => {
    const store = freshStore();
    render(<GlyphBrowser onOpen={vi.fn()} />, store);

    fireEvent.click(screen.getByRole("button", { name: /Code point/ }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Name" }));

    expect(store.getState().catalogQuery.order).toBe("name");
    expect(screen.getByRole("button", { name: /Name/ })).toBeTruthy();
  });

  it("ticks the order in force", () => {
    render(<GlyphBrowser onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Code point/ }));

    const ticked = screen.getByRole("menuitemcheckbox", { name: "Code point" });
    expect(ticked.getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Font order" }).getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("marks the search field, so it is not the field that makes glyphs", () => {
    render(<GlyphBrowser onOpen={vi.fn()} />);
    const search = screen.getByLabelText("Search glyphs");

    expect(search.parentElement?.querySelector("svg")).toBeTruthy();
    expect(screen.getByLabelText("New glyph name or character")).not.toBe(search);
  });
});

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
      .find(
        (item) =>
          !/Open|Rename|Duplicate|Round|No colour|Delete|Copy to|Swap with|Clear/.test(
            item.textContent,
          ),
      );
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
