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

describe("an export on its way", () => {
  it("is said on the line in every workspace, counted where it is counted", () => {
    const store = freshStore();
    // The glyph view, where the Export menu is not.
    render(<StatusBar workspace="glyph" onShortcuts={() => undefined} />, store);
    expect(screen.queryByText(/^Exporting/)).toBeNull();

    act(() => {
      expect(store.beginExport()).toBe(true);
    });
    expect(screen.getByText("Exporting…")).toBeTruthy();

    act(() => {
      store.tellExport(1280, 4042);
    });
    expect(screen.getByText("Exporting… 1,280 of 4,042 glyphs")).toBeTruthy();
  });

  it("is one at a time", () => {
    const store = freshStore();
    expect(store.beginExport()).toBe(true);
    expect(store.beginExport()).toBe(false);
    store.endExport({ file: "Font-Regular.otf", warnings: [] });
    expect(store.beginExport()).toBe(true);
  });

  it("says what it made when it is over, and what it had to say about it", () => {
    const store = freshStore();
    render(<StatusBar workspace="glyph" onShortcuts={() => undefined} />, store);
    act(() => {
      store.beginExport();
      store.endExport({
        file: "Font-Regular.otf",
        warnings: ["a: overlap kept", "b: overlap kept"],
      });
    });

    expect(screen.queryByText(/^Exporting/)).toBeNull();
    const said = screen.getByRole("button", { name: /Exported Font-Regular\.otf · 2 warnings/ });
    expect(said.getAttribute("title")).toContain("a: overlap kept");
  });

  it("says what it failed with, as a warning", () => {
    const store = freshStore();
    render(<StatusBar workspace="glyph" onShortcuts={() => undefined} />, store);
    act(() => {
      store.beginExport();
      store.endExport({ failed: new Error("This font has no glyphs to export.") });
    });

    expect(screen.queryByText(/^Exporting/)).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("This font has no glyphs to export.");
  });
});

describe("something that failed with nobody waiting for it", () => {
  it("is said on the line, as a warning, until it is read", () => {
    const store = freshStore();
    render(<StatusBar workspace="font" onShortcuts={() => undefined} />, store);

    act(() => {
      store.reportFailure(new Error("Another style is already at that place."));
    });
    const said = screen.getByRole("alert");
    expect(said.textContent).toContain("Another style is already at that place.");
    expect(said.getAttribute("title")).toContain("This was not done.");

    act(() => {
      said.click();
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says something even of a failure that says nothing", () => {
    const store = freshStore();
    render(<StatusBar workspace="font" onShortcuts={() => undefined} />, store);
    act(() => {
      store.reportFailure(new Error(""));
    });
    expect(screen.getByRole("alert").textContent).toContain("That did not work");
  });
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
    expect(screen.getByText("points")).toBeTruthy();

    cleanup();
    render(<StatusBar workspace="font" onShortcuts={() => undefined} />);
    expect(screen.queryByText("points")).toBeNull();
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
