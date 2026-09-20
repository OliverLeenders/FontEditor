// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { WindowBar } = await import("../src/components/WindowBar.js");

/**
 * The strip along the top of the window.
 *
 * It exists because a pane's bars belong to a pane: the theme lived in the
 * drawing toolbar, so it could only be reached while a glyph was open, and a
 * split window offered it twice. What is here is true of the application.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

describe("what the bar says", () => {
  it("names the font, which was visible in one workspace before", () => {
    const store = freshStore();
    render(<WindowBar />, store);
    const { familyName, styleName } = store.editor.document.info;

    expect(screen.getByText(`${familyName} ${styleName}`)).toBeTruthy();
  });
});

describe("the preferences", () => {
  const open = (store = freshStore()) => {
    const shown = render(<WindowBar />, store);
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    return shown;
  };

  it("is shut until it is asked for", () => {
    render(<WindowBar />);
    const button = screen.getByRole("button", { name: "Preferences" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: "Preferences" })).toBeNull();

    fireEvent.click(button);
    expect(screen.getByRole("group", { name: "Preferences" })).toBeTruthy();
  });

  it("opens and closes on Ctrl-comma, as everywhere else does", () => {
    render(<WindowBar />);

    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    expect(screen.getByRole("group", { name: "Preferences" })).toBeTruthy();

    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    expect(screen.queryByRole("group", { name: "Preferences" })).toBeNull();
  });

  it("closes on Escape", () => {
    open();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Preferences" })).toBeNull();
  });

  it("closes when something outside it is pressed", () => {
    open();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("group", { name: "Preferences" })).toBeNull();
  });

  it("chooses the theme, marks it, and puts it back on Reset", () => {
    const { store } = open();

    fireEvent.click(screen.getByRole("button", { name: "Dark" }));

    expect(store.getState().theme).toBe("dark");
    expect(screen.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "System" }).getAttribute("aria-pressed")).toBe(
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(store.getState().theme).toBe("system");
  });

  it("holds nothing about a canvas, which belongs to a pane", () => {
    open();
    expect(screen.queryByLabelText("Outline thickness")).toBeNull();
    expect(screen.queryByLabelText("Curvature comb")).toBeNull();
  });

  it("leaves the font alone", () => {
    const { store } = open();
    const document = store.editor.document;

    fireEvent.click(screen.getByRole("button", { name: "Light" }));

    expect(store.editor.document).toBe(document);
  });
});
