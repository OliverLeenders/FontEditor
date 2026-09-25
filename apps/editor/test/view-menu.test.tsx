// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { ViewMenu } = await import("../src/components/ViewMenu.js");
const { PaneContext } = await import("../src/pane.js");

/**
 * What one canvas shows: the menu at the end of the drawing toolbar.
 *
 * Everything in it is about the reader rather than about the font, which is the
 * thing worth checking of every one of them: the menu changes what somebody
 * sees and leaves the font alone. It is also per pane, so the same menu in the
 * second pane must change that pane and not the first. The rest is what a
 * popover has to do — open, close on Escape, and put back what it started with
 * when Reset is pressed.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

/** The menu, open. */
function open(store = freshStore()) {
  const shown = render(<ViewMenu />, store);
  fireEvent.click(screen.getByRole("button", { name: "View" }));
  return shown;
}

describe("opening the menu", () => {
  it("is shut until it is asked for, and says which it is", () => {
    render(<ViewMenu />);
    const button = screen.getByRole("button", { name: "View" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: "View" })).toBeNull();

    fireEvent.click(button);

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("group", { name: "View" })).toBeTruthy();
  });

  it("closes on Escape, which is how every popover here closes", () => {
    open();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "View" })).toBeNull();
  });

  it("closes when something outside it is pressed", () => {
    open();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("group", { name: "View" })).toBeNull();
  });
});

describe("what the menu changes", () => {
  it("sets the outline weight, and says what it now is", () => {
    const { store } = open();

    fireEvent.change(screen.getByLabelText("Outline thickness"), { target: { value: "2.5" } });

    expect(store.getState().views[0].outlineWidth).toBe(2.5);
    expect(screen.getByText("2.50")).toBeTruthy();
  });

  it.each([
    ["Auto-hide handles", "autoHideHandles"],
    ["Snap to points", "snapPoints"],
    ["Show neighbours", "showNeighbours"],
    ["Show anchors", "showAnchors"],
    ["Curvature comb", "showCurvature"],
    ["Point numbers", "showPointNumbers"],
  ] as const)("turns %s on and off", (label, setting) => {
    const { store } = open();
    const before = store.getState().views[0][setting];
    const box = screen.getByLabelText(label);
    expect((box as HTMLInputElement).checked).toBe(before);

    fireEvent.click(box);

    expect(store.getState().views[0][setting]).toBe(!before);
  });

  it("sets how big the points and handles are drawn", () => {
    const { store } = open();
    expect(store.getState().views[0].controlSize).toBe("normal");

    fireEvent.click(screen.getByRole("button", { name: "Big" }));
    expect(store.getState().views[0].controlSize).toBe("big");

    fireEvent.click(screen.getByRole("button", { name: "Small" }));
    expect(store.getState().views[0].controlSize).toBe("small");
  });

  it("shows which size is in force", () => {
    const { store } = open();
    fireEvent.click(screen.getByRole("button", { name: "Small" }));

    expect(screen.getByRole("button", { name: "Small" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Normal" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(store.getState().views[1].controlSize).toBe("normal");
  });

  it("leaves the font alone, since none of this is about the font", () => {
    const { store } = open();
    const document = store.editor.document;

    fireEvent.click(screen.getByLabelText("Show anchors"));
    fireEvent.change(screen.getByLabelText("Outline thickness"), { target: { value: "3" } });

    expect(store.editor.document).toBe(document);
  });

  it("puts this canvas back as it was on Reset", () => {
    const { store } = open();

    fireEvent.change(screen.getByLabelText("Outline thickness"), { target: { value: "3" } });
    expect(store.getState().views[0].outlineWidth).toBe(3);

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(store.getState().views[0].outlineWidth).not.toBe(3);
  });
});

/**
 * The second pane's copy of the menu.
 *
 * A split window is two views of one font, and the reason for opening one is
 * usually that they should differ: the comb on the letter being drawn and off
 * the copy beside it.
 */
describe("the menu in the second pane", () => {
  it("changes its own pane and leaves the first alone", () => {
    const store = freshStore();
    render(
      <PaneContext.Provider value={1}>
        <ViewMenu />
      </PaneContext.Provider>,
      store,
    );
    fireEvent.click(screen.getByRole("button", { name: "View" }));

    fireEvent.click(screen.getByLabelText("Curvature comb"));

    expect(store.getState().views[1].showCurvature).toBe(true);
    expect(store.getState().views[0].showCurvature).toBe(false);
  });
});
