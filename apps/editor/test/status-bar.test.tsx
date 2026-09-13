// @vitest-environment jsdom
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { StatusBar } = await import("../src/components/StatusBar.js");

/**
 * The line along the bottom, which is the only place the editor tells anybody
 * what the keys do.
 *
 * A hint is either true of the workspace on screen or it is a lie, and this
 * used to be a lie in three of the five: everything that was not the glyph
 * canvas was told it was the glyph browser, and offered to open a letter by
 * double-clicking something that was not on screen.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

describe("what the status bar says the keys do", () => {
  it("names the canvas keys while drawing", () => {
    render(<StatusBar workspace="glyph" onShortcuts={() => undefined} />);
    expect(screen.getByText(/hold M to measure/)).toBeTruthy();
  });

  it("names the browser keys in the font view", () => {
    render(<StatusBar workspace="font" onShortcuts={() => undefined} />);
    expect(screen.getByText(/double-click a glyph/)).toBeTruthy();
  });

  it("says nothing where the workspace speaks for itself", () => {
    // Spacing has its own line of instructions under the strip; a second set
    // down here would be a repetition at best and a disagreement at worst.
    for (const workspace of ["spacing", "features", "proof"] as const) {
      render(<StatusBar workspace={workspace} onShortcuts={() => undefined} />);
      expect(screen.queryByText(/double-click a glyph/)).toBeNull();
      expect(screen.queryByText(/hold M to measure/)).toBeNull();
      cleanup();
    }
  });
});

describe("what the status bar counts", () => {
  it("counts the selection only where there is a canvas to select on", () => {
    render(<StatusBar workspace="glyph" onShortcuts={() => undefined} />);
    expect(screen.getByText("selected")).toBeTruthy();

    cleanup();
    render(<StatusBar workspace="font" onShortcuts={() => undefined} />);
    expect(screen.queryByText("selected")).toBeNull();
  });
});

/**
 * The line for writing a font to a folder.
 *
 * A different thing from the autosave above it: that one writes to the
 * browser's own store after a second's pause, this one writes a file per glyph
 * when somebody presses Ctrl-S. Only the first was reported here, so the one
 * that takes long enough to wonder about was the one that said nothing.
 */
describe("saving to a folder", () => {
  it("counts the files as they go", () => {
    const store = freshStore();
    act(() => {
      store.patch({
        folder: { ...store.getState().folder, busy: true, progress: { done: 12, total: 40 } },
      });
    });
    render(<StatusBar workspace="glyph" onShortcuts={() => undefined} />, store);

    expect(screen.getByText(/saving 12 of 40 files/)).toBeTruthy();
  });

  it("says only that it is saving until it knows how much there is", () => {
    // The total is not known until the writer has worked out which files
    // differ, and until then there is no number anybody can honestly give.
    const store = freshStore();
    act(() => {
      store.patch({
        folder: { ...store.getState().folder, busy: true, progress: { done: 0, total: 0 } },
      });
    });
    render(<StatusBar workspace="glyph" onShortcuts={() => undefined} />, store);

    expect(screen.getByText(/saving…/)).toBeTruthy();
  });

  it("goes back to the autosave's word for it when the writing is done", () => {
    const store = freshStore();
    render(<StatusBar workspace="glyph" onShortcuts={() => undefined} />, store);

    expect(screen.queryByText(/saving .* files/)).toBeNull();
  });

  /*
   * A save that fails has to say so here, and here is the only place left that
   * can. Ctrl-S used to live in the File menu's own component, which is mounted
   * only in the font view and showed the answer itself; the shortcut now works
   * in every workspace, so in four of the five there is no menu on screen to
   * say anything. A save failing in silence is worse than one that never
   * started — the work is not on disk and nothing on screen disagrees.
   */
  it("says what a failed save failed with, in every workspace", () => {
    for (const workspace of ["glyph", "font", "spacing", "features", "proof"] as const) {
      const store = freshStore();
      act(() => {
        store.patch({
          folder: { ...store.getState().folder, problem: "The folder is read-only" },
        });
      });
      render(<StatusBar workspace={workspace} onShortcuts={() => undefined} />, store);

      expect(screen.getByText("The folder is read-only")).toBeTruthy();
      cleanup();
    }
  });

  it("says nothing about a problem when there is none", () => {
    const store = freshStore();
    render(<StatusBar workspace="glyph" onShortcuts={() => undefined} />, store);

    expect(screen.queryByText(/read-only/)).toBeNull();
  });
});
