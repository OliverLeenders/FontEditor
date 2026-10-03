// @vitest-environment jsdom
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { threeGlyphFont } from "./fonts.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { Opening } = await import("../src/components/Opening.js");

/**
 * The pane over the editor while a font is on its way in.
 *
 * A large font takes seconds to read and draw, and a page that only sat there
 * for them read as one that had stopped. These ask that the pane says which
 * font and how far, that it is there while a font is being opened, and that it
 * is gone afterwards whether or not the font arrived.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

describe("a font on its way in", () => {
  it("is not there when nothing is being opened", () => {
    render(<Opening />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names the font and counts what has been read", () => {
    const store = freshStore();
    render(<Opening />, store);

    act(() => {
      store.patch({ opening: { name: "Icons Regular", step: "glyphs", done: 1280, total: 4042 } });
    });

    expect(screen.getByRole("heading", { name: "Icons Regular" })).toBeTruthy();
    expect(screen.getByText("Reading glyphs · 1,280 of 4,042")).toBeTruthy();
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("1280");
    expect(bar.getAttribute("aria-valuemax")).toBe("4042");
  });

  it("only says what it is doing for a step that cannot be counted", () => {
    const store = freshStore();
    render(<Opening />, store);

    act(() => {
      store.patch({ opening: { name: "Icons.ttf", step: "drawing", done: 0, total: 0 } });
    });

    expect(screen.getByText("Drawing the glyphs…")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBeNull();
  });
});

describe("opening a font file", () => {
  it("says so while it is read, and stops once the font is shown", async () => {
    const store = freshStore();
    const said: string[] = [];
    store.subscribe(() => {
      const opening = store.getState().opening;
      if (opening !== null) said.push(`${opening.name}: ${opening.step}`);
    });

    await store.importFont(threeGlyphFont(), "Three.ttf");

    expect(said).toContain("Three.ttf: parsing");
    expect(said).toContain("Three.ttf: drawing");
    expect(store.getState().opening).toBeNull();
    expect(store.editor.document.info.familyName).toBe("Imported");
  });

  it("shows the font before any copy of it is written down", async () => {
    const { Persistence } = await import("../src/persistence.js");
    const store = freshStore();
    // What was on screen when each write was asked for.
    const seen: string[] = [];
    const at = (what: string) => (): Promise<never[]> => {
      const { opening, session } = store.getState();
      const pane = opening === null ? "no pane" : "pane";
      seen.push(`${what}: ${session.editor.document.info.familyName}, ${pane}`);
      return Promise.resolve([]);
    };
    const spies = [
      vi.spyOn(Persistence.prototype, "snapshot").mockImplementation(at("snapshot")),
      vi.spyOn(Persistence.prototype, "putMaster").mockImplementation(at("master") as never),
      vi.spyOn(Persistence.prototype, "replaceAll").mockImplementation(at("font") as never),
    ];
    onTestFinished(() => {
      for (const spy of spies) spy.mockRestore();
    });

    await store.importFont(threeGlyphFont(), "Three.ttf");

    // Parking a large font's master is seconds: none of them behind the pane.
    expect(seen).toEqual(["master: Imported, no pane", "font: Imported, no pane"]);
  });

  it("stops saying so for a file that could not be opened", async () => {
    const store = freshStore();
    await expect(store.importFont(new Uint8Array(8).buffer, "junk.ttf")).rejects.toThrow();
    expect(store.getState().opening).toBeNull();
  });
});
