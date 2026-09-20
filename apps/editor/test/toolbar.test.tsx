// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { Toolbar } = await import("../src/components/Toolbar.js");

/**
 * The row above the canvas.
 *
 * Every button here is a thin thing over the store, so the questions are
 * whether pressing one changes what it says it changes, and whether the row
 * tells the truth about the state it is showing: which tool is in hand, whether
 * there is anything to undo and what it would undo, and how far the view is
 * zoomed.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

const pressed = (name: string): string | null =>
  screen.getByRole("button", { name }).getAttribute("aria-pressed");

describe("choosing a tool", () => {
  it("marks the tool in hand, and puts another one in hand when pressed", () => {
    const { store } = render(<Toolbar />);
    expect(pressed("Select")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Pen" }));

    expect(store.editor.activeTool).toBe("pen");
    expect(pressed("Pen")).toBe("true");
    expect(pressed("Select")).toBe("false");
  });

  it("names the key for each tool where the tooltip can be read", () => {
    render(<Toolbar />);
    expect(screen.getByRole("button", { name: "Knife" }).getAttribute("title")).toContain("(K)");
    expect(screen.getByRole("button", { name: "Ruler" }).getAttribute("title")).toContain(
      "hold M to measure one stem",
    );
  });
});

describe("undo and redo", () => {
  it("has nothing to undo in a font nobody has edited", () => {
    render(<Toolbar />);
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo.hasAttribute("disabled")).toBe(true);
    expect(undo.getAttribute("title")).toBe("Nothing to undo");
  });

  it("names the step it would undo, and takes it back", () => {
    const store = freshStore();
    act(() => store.setFeatures("feature liga { sub f i by f_i; } liga;"));
    render(<Toolbar />, store);

    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo.getAttribute("title")).toContain("Edit features");

    fireEvent.click(undo);
    expect(store.editor.document.features).toBe("");

    const redo = screen.getByRole("button", { name: "Redo" });
    expect(redo.getAttribute("title")).toContain("Edit features");
    fireEvent.click(redo);
    expect(store.editor.document.features).not.toBe("");
  });
});

describe("the toggles the toolbar keeps", () => {
  it("shows and changes whether handles hide themselves", () => {
    const { store } = render(<Toolbar />);
    const before = store.getState().views[0].autoHideHandles;
    expect(pressed("Handles")).toBe(String(before));

    fireEvent.click(screen.getByRole("button", { name: "Handles" }));

    expect(store.getState().views[0].autoHideHandles).toBe(!before);
    expect(pressed("Handles")).toBe(String(!before));
  });

  it("shows and changes whether drags snap to the glyph's own points", () => {
    const { store } = render(<Toolbar />);
    const before = store.getState().views[0].snapPoints;

    fireEvent.click(screen.getByRole("button", { name: "Snap" }));

    expect(store.getState().views[0].snapPoints).toBe(!before);
    expect(pressed("Snap")).toBe(String(!before));
  });
});

describe("the view", () => {
  it("says how far the glyph is zoomed", () => {
    const store = freshStore();
    act(() => store.setView({ ...store.editor.view, scale: 0.435 }));
    render(<Toolbar />, store);

    expect(screen.getByText("44%")).toBeTruthy();
  });

  it("offers fitting the glyph, and names the key for it", () => {
    // What fitting works out is the framing, which is tested where the
    // arithmetic is; here there is no window with a size for it to fit into.
    const store = freshStore();
    act(() => store.setView({ scale: 4, tx: 300, ty: 300 }));
    render(<Toolbar />, store);

    const fit = screen.getByRole("button", { name: "Fit" });
    expect(fit.getAttribute("title")).toContain("(Ctrl-0)");

    fireEvent.click(fit);
    expect(store.editor.view.scale).toBeGreaterThan(0);
  });
});
