// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { PreferencesPanel } = await import("../src/components/PreferencesPanel.js");

/**
 * The settings that are about the reader rather than about the font.
 *
 * They are kept in the browser and not in the document, which is the thing
 * worth checking of every one of them: the panel changes what somebody sees and
 * leaves the font alone. The rest is what a popover has to do — open, close on
 * Escape, and put back what it started with when reset is pressed.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

/** The panel, open. */
function open(store = freshStore()) {
  const shown = render(<PreferencesPanel />, store);
  fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
  return shown;
}

describe("opening the panel", () => {
  it("is shut until it is asked for, and says which it is", () => {
    render(<PreferencesPanel />);
    const button = screen.getByRole("button", { name: "Preferences" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: "Preferences" })).toBeNull();

    fireEvent.click(button);

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("group", { name: "Preferences" })).toBeTruthy();
  });

  it("closes on Escape, which is how every popover here closes", () => {
    open();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Preferences" })).toBeNull();
  });

  it("closes when something outside it is pressed", () => {
    open();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("group", { name: "Preferences" })).toBeNull();
  });
});

describe("what the panel changes", () => {
  it("chooses the theme, and marks the one chosen", () => {
    const { store } = open();

    fireEvent.click(screen.getByRole("button", { name: "Dark" }));

    expect(store.getState().theme).toBe("dark");
    expect(screen.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "System" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("sets the outline weight, and says what it now is", () => {
    const { store } = open();

    fireEvent.change(screen.getByLabelText("Outline thickness"), { target: { value: "2.5" } });

    expect(store.getState().outlineWidth).toBe(2.5);
    expect(screen.getByText("2.50")).toBeTruthy();
  });

  it.each([
    ["Auto-hide handles", "autoHideHandles"],
    ["Snap to points", "snapPoints"],
    ["Show neighbours", "showNeighbours"],
    ["Show anchors", "showAnchors"],
    ["Curvature comb", "showCurvature"],
  ] as const)("turns %s on and off", (label, setting) => {
    const { store } = open();
    const before = store.getState()[setting];
    const box = screen.getByLabelText(label);
    expect((box as HTMLInputElement).checked).toBe(before);

    fireEvent.click(box);

    expect(store.getState()[setting]).toBe(!before);
  });

  it("leaves the font alone, since none of this is about the font", () => {
    const { store } = open();
    const document = store.editor.document;

    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    fireEvent.click(screen.getByLabelText("Show anchors"));

    expect(store.editor.document).toBe(document);
  });

  it("puts everything back as it was on Reset", () => {
    const { store } = open();
    const theme = store.getState().theme;

    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    fireEvent.change(screen.getByLabelText("Outline thickness"), { target: { value: "3" } });
    expect(store.getState().outlineWidth).toBe(3);

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(store.getState().theme).toBe(theme);
    expect(store.getState().outlineWidth).not.toBe(3);
  });
});
