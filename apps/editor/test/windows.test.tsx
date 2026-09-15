// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { openWindow, requestIn, searchFor, takeWindowRequest } = await import("../src/windows.js");
const { Projects } = await import("../src/components/Projects.js");
const { FileMenu } = await import("../src/components/FileMenu.js");

/**
 * A second font beside this one, in a window of its own.
 *
 * What a window is asked to show travels in its address, in the browser and in
 * the desktop application alike, so the address is tested both ways round: what
 * a request is written as, and what an address is read back as. Then the two
 * ways in — the list of fonts and the File menu — and where each request goes:
 * to `window.open` in a browser, and to the desktop's `open_window` command.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  history.replaceState(null, "", "/");
});

/** Catch what a browser would open, instead of opening it. */
function catchOpened(): string[] {
  const opened: string[] = [];
  vi.spyOn(window, "open").mockImplementation((url) => {
    opened.push(String(url));
    return null;
  });
  return opened;
}

describe("what a window is asked to show", () => {
  it("is written into the address and read back out of it", () => {
    expect(requestIn(searchFor({ font: "a b/c" }))).toEqual({ font: "a b/c" });
    expect(requestIn(searchFor("fonts"))).toBe("fonts");
  });

  it("is nothing in an ordinary address", () => {
    expect(requestIn("")).toBeNull();
    expect(requestIn("?font=")).toBeNull();
    expect(requestIn("?something=else")).toBeNull();
  });

  it("is read once, and taken out of the address so a reload starts afresh", () => {
    history.replaceState(null, "", "/?font=chalk");

    expect(takeWindowRequest()).toEqual({ font: "chalk" });
    expect(location.search).toBe("");
    expect(takeWindowRequest()).toBeNull();
  });
});

describe("opening another window", () => {
  it("opens a tab on the font in a browser", () => {
    const opened = catchOpened();

    openWindow({ font: "chalk" });

    expect(opened).toEqual(["/?font=chalk"]);
  });

  it("asks the desktop application for a window of its own", () => {
    const opened = catchOpened();
    const sent: unknown[] = [];
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
      invoke: (command: string, payload: unknown) => {
        sent.push([command, payload]);
        return Promise.resolve(null);
      },
    };

    openWindow({ font: "chalk" });
    openWindow("fonts");

    expect(sent).toEqual([
      ["open_window", { font: "chalk" }],
      ["open_window", {}],
    ]);
    expect(opened).toEqual([]);
  });

  it("offers each other font in the list a window of its own", () => {
    const opened = catchOpened();
    const store = freshStore();
    store.patch({
      projects: {
        all: [
          { id: "open", name: "Open", folder: null, openedAt: 2, savedAt: null },
          { id: "other", name: "Other", folder: null, openedAt: 1, savedAt: null },
        ],
        current: "open",
        showing: true,
        arriving: false,
      },
    });
    render(<Projects />, store);

    expect(screen.queryByRole("button", { name: "Open Open in a new window" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Other in a new window" }));

    expect(opened).toEqual(["/?font=other"]);
    // The list was shown over a font, and this window stays on that font.
    expect(store.getState().projects.showing).toBe(false);
  });

  it("opens a window on the list of fonts from the File menu", () => {
    const opened = catchOpened();
    render(<FileMenu />, freshStore());

    fireEvent.click(screen.getByRole("button", { name: /^File/ }));
    fireEvent.click(screen.getByText("New window"));

    expect(opened).toEqual(["/?fonts"]);
  });
});
