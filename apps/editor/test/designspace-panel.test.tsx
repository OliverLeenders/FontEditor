// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { Designspace } = await import("../src/components/Designspace.js");
const { Masters } = await import("../src/components/Masters.js");
const { GlyphBrowser } = await import("../src/components/GlyphBrowser.js");
const { WEIGHT, addContour, contour, fontDocument, glyph, master, node, project, setAxes, toUser } =
  await import("@typewright/font-model");

/**
 * The axes as a menu offers them, and the glyphs swapped along them.
 *
 * Every field here commits when it is left, so each test changes a field and
 * leaves it, and then asks the project — which is what the variable font, the
 * instances and the designspace file are all written from.
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

/** A store with a regular and a black along the weight axis. */
function family() {
  const store = freshStore();
  act(() => {
    const one = setAxes(project(store.editor.document, { id: "m1" }), [WEIGHT]);
    store.patch({
      project: {
        ...one,
        masters: [master("m1", "Regular", { wght: 400 }), master("m2", "Black", { wght: 900 })],
      },
    });
  });
  return store;
}

const open = (store = family()) => {
  render(<Designspace />, store);
  fireEvent.click(screen.getByRole("button", { name: "Designspace" }));
  return store;
};

/** Type into a field and leave it, which is what commits. */
function enter(field: HTMLElement, value: string): void {
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

const axis = (store: ReturnType<typeof family>) => store.getState().project.axes[0]!;

describe("a font with no axes", () => {
  it("says where axes come from", () => {
    open(freshStore());
    expect(screen.getByText(/arrive with a second master/)).toBeTruthy();
  });
});

describe("an axis", () => {
  it("is renamed in place", () => {
    const store = open();
    enter(screen.getByLabelText("Name of the axis wght"), "Stem");
    expect(axis(store).name).toBe("Stem");
  });

  it("takes a new range on the menu's scale", () => {
    const store = open();
    enter(screen.getByLabelText("Minimum"), "200");
    expect(axis(store).min).toBe(200);
  });

  it("refuses a default outside the range, and says why", () => {
    const store = open();
    enter(screen.getByLabelText("Default"), "950");
    expect(axis(store).default).toBe(400);
    expect(screen.getByRole("alert").textContent).toMatch(/within the range/);
  });

  it("is mapped without changing anything until a pair is moved", () => {
    const store = open();
    fireEvent.click(screen.getByRole("button", { name: "Map it" }));
    expect(axis(store).map).toEqual([
      [100, 100],
      [400, 400],
      [900, 900],
    ]);

    // The menu's 400 drawn at 300: the default moves on the design scale, and
    // the menu still offers 100 to 900.
    enter(screen.getByLabelText("Drawn at, pair 2"), "300");
    expect(axis(store)).toMatchObject({ min: 100, default: 300, max: 900 });
    expect(toUser(axis(store), 300)).toBe(400);
  });

  it("does not move a master when the map moves the range, and says it is outside", () => {
    const store = open();
    fireEvent.click(screen.getByRole("button", { name: "Map it" }));
    enter(screen.getByLabelText("Drawn at, pair 3"), "800");

    expect(store.getState().project.masters.map((m) => m.location["wght"])).toEqual([400, 900]);
    expect(screen.getByText(/Drawn outside the range/).textContent).toMatch(/Black at 900/);
  });

  it("refuses a map that does not rise", () => {
    const store = open();
    fireEvent.click(screen.getByRole("button", { name: "Map it" }));
    enter(screen.getByLabelText("Drawn at, pair 2"), "950");
    expect(axis(store).map?.[1]).toEqual([400, 400]);
    expect(screen.getByRole("alert").textContent).toMatch(/has to rise/);
  });

  it("warns when no whole master is left at the default", () => {
    open();
    enter(screen.getByLabelText("Default"), "500");
    expect(screen.getByText(/No whole master is drawn at the default/)).toBeTruthy();
  });
});

describe("a rule", () => {
  it("is added applying from the default up, with nothing yet to swap", () => {
    const store = open();
    fireEvent.click(screen.getByRole("button", { name: "Add a rule" }));

    const [added] = store.getState().project.rules;
    expect(added?.conditionSets).toEqual([[{ tag: "wght", min: 400, max: null }]]);
    expect(added?.swaps).toEqual([]);
  });

  it("is given a swap, a range and another place, each where it is typed", () => {
    const store = open();
    fireEvent.click(screen.getByRole("button", { name: "Add a rule" }));
    const rule = () => store.getState().project.rules[0]!;

    fireEvent.click(screen.getByRole("button", { name: "Add a swap" }));
    enter(screen.getByLabelText("Swapped out, 1"), "a");
    enter(screen.getByLabelText("Put in its place, 1"), "a.alt");
    expect(rule().swaps).toEqual([["a", "a.alt"]]);

    enter(screen.getByLabelText("At least, on Weight"), "600");
    enter(screen.getByLabelText("At most, on Weight"), "800");
    expect(rule().conditionSets).toEqual([[{ tag: "wght", min: 600, max: 800 }]]);

    // Emptied, an end is open again.
    enter(screen.getByLabelText("At most, on Weight"), "");
    expect(rule().conditionSets[0]?.[0]?.max).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "or somewhere else…" }));
    expect(rule().conditionSets).toHaveLength(2);
  });

  it("offers the font's glyph names while a swap is typed", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Add a rule" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a swap" }));

    const field = screen.getByLabelText("Swapped out, 1");
    const list = document.getElementById(field.getAttribute("list") ?? "");
    expect(list?.querySelectorAll("option").length).toBeGreaterThan(0);
  });

  it("is removed, and the order of what is applied is chosen", () => {
    const store = open();
    fireEvent.click(screen.getByRole("button", { name: "Add a rule" }));
    fireEvent.change(screen.getByRole("combobox", { name: /Applied/ }), {
      target: { value: "last" },
    });
    expect(store.getState().project.rulesProcessing).toBe("last");

    fireEvent.click(screen.getByRole("button", { name: "Remove the rule Rule 1" }));
    expect(store.getState().project.rules).toEqual([]);
  });

  it("says when taking its last range away leaves it nowhere to apply", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Add a rule" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove the range on Weight" }));
    expect(screen.getByText(/applies nowhere/)).toBeTruthy();
  });
});

describe("the way here from the masters", () => {
  it("opens this panel", () => {
    const store = family();
    render(
      <>
        <Masters />
        <Designspace />
      </>,
      store,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Masters/ }));
    fireEvent.click(screen.getByRole("button", { name: "Axes, maps and rules…" }));

    expect(screen.getByRole("group", { name: "Designspace" })).toBeTruthy();
  });
});

describe("the glyphs of a master that draws only some", () => {
  let ids = 0;
  const id = () => `sp${String(++ids)}`;
  const stem = (name: string, width: number) =>
    addContour(
      glyph(name, { advance: 500 + width }),
      contour(id(), [node(id(), { x: 0, y: 0 }), node(id(), { x: width, y: 700 })], true),
    );

  /** A regular and a black, and a middle master drawn as a layer with the `n` alone. */
  function sparse() {
    const store = freshStore();
    const regular = fontDocument([stem("n", 60), stem("o", 60)]);
    const black = fontDocument([stem("n", 200), stem("o", 200)]);
    const middle = fontDocument([stem("n", 170)]);
    act(() => {
      store.patch({
        project: {
          ...setAxes(project(regular, { id: "m1" }), [WEIGHT]),
          masters: [
            master("m1", "Regular", { wght: 400 }),
            master("m2", "Black", { wght: 900 }),
            { ...master("m3", "Mid", { wght: 650 }), sparse: { of: "m1", layer: "{650}" } },
          ],
          sources: { m1: regular, m2: black, m3: middle },
          current: "m3",
        },
      });
      store.patch({
        session: {
          ...store.getState().session,
          editor: { ...store.editor, document: middle, currentGlyph: "n" },
        },
      });
    });
    return store;
  }

  it("shows the whole font, and asks before drawing one it does not have", async () => {
    const store = sparse();
    const onOpen = vi.fn();
    render(<GlyphBrowser onOpen={onOpen} />, store);

    // Every glyph of the whole master is listed, the Mid's own and the rest.
    expect(screen.getByText("2 glyphs")).toBeTruthy();

    const grid = screen.getByRole("grid", { name: "Glyphs" });
    fireEvent.keyDown(grid, { key: "End" });
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(onOpen).not.toHaveBeenCalled();

    const offer = screen.getByRole("alertdialog", { name: "Draw o here" });
    expect(offer.textContent).toMatch(/Mid does not draw o/);

    await act(async () => {
      fireEvent.click(within(offer).getByRole("button", { name: "Draw it here" }));
      await new Promise((settle) => setTimeout(settle, 0));
    });

    // Begun from the family at 650: halfway between 60 and 200.
    const drawn = store.editor.document.glyphs["o"];
    expect(drawn?.contours[0]?.nodes[1]?.pt.x).toBeCloseTo(130, 6);
    expect(onOpen).toHaveBeenCalledWith("o");
  });

  it("opens one it does draw without asking", () => {
    const store = sparse();
    const onOpen = vi.fn();
    render(<GlyphBrowser onOpen={onOpen} />, store);

    fireEvent.keyDown(screen.getByRole("grid", { name: "Glyphs" }), { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith("n");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
