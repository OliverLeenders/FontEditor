// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { Snapshots } = await import("../src/components/Snapshots.js");
const { WEIGHT, master, project, setAxes } = await import("@typewright/font-model");

/**
 * The copies of the font, on screen.
 *
 * A history panel is one of the few places where being wrong is expensive: it
 * is read when something has gone wrong, and a list that says the wrong thing
 * about when a copy was kept sends somebody back to the wrong hour. So what
 * these ask is mostly about how a time is said, and about the one state that
 * must disable everything — another tab holding the project.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

const MINUTE = 60_000;

async function openPanel(
  store = freshStore(),
  // Which master a copy is of is left out where it does not matter: a font
  // drawn once does not say.
  copies: { at: number; glyphs: number; master?: string | null }[] = [],
) {
  const snapshots = copies.map((copy) => ({ master: null, ...copy }));
  const shown = render(<Snapshots />, store);
  fireEvent.click(screen.getByRole("button", { name: "History" }));

  // Opening reads the list from the store, which with no worker behind it
  // answers with nothing; the fixture goes in after that, as it would arrive.
  await act(async () => {
    await Promise.resolve();
  });
  if (snapshots.length > 0) act(() => store.patch({ snapshots }));

  return shown;
}

describe("the history panel", () => {
  it("explains itself when there is nothing kept yet", async () => {
    await openPanel();
    expect(screen.getByText(/One is kept every few minutes of work/)).toBeTruthy();
  });

  it("says how long ago each copy was kept, and how big the font was", async () => {
    const now = Date.now();
    await openPanel(freshStore(), [
      { at: now - 12 * MINUTE, glyphs: 40 },
      { at: now - 3 * 60 * MINUTE, glyphs: 38 },
    ]);

    expect(screen.getByText(/12 min ago/)).toBeTruthy();
    expect(screen.getByText(/3 h ago/)).toBeTruthy();
    expect(screen.getByText("40 glyphs")).toBeTruthy();
  });

  it("says just now for one kept a moment ago", async () => {
    await openPanel(freshStore(), [{ at: Date.now(), glyphs: 40 }]);
    expect(screen.getByText(/just now/)).toBeTruthy();
  });

  it("offers a way back for every copy", async () => {
    await openPanel(freshStore(), [
      { at: Date.now() - MINUTE, glyphs: 40 },
      { at: Date.now() - 2 * MINUTE, glyphs: 40 },
    ]);

    expect(screen.getAllByRole("button", { name: "Restore" })).toHaveLength(2);
  });

  it("says so when the copy asked for has gone", async () => {
    // No worker, so nothing can be read back: the panel has to say that rather
    // than appear to have done something.
    await openPanel(freshStore(), [{ at: Date.now() - MINUTE, glyphs: 40 }]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore" }));
      await Promise.resolve();
    });

    expect(screen.getByText("That copy has gone.")).toBeTruthy();
  });

  it("keeps its hands off while another tab is the one saving", async () => {
    const store = freshStore();
    act(() => {
      store.patch({ ownership: "reading" });
    });
    await openPanel(store, [{ at: Date.now() - MINUTE, glyphs: 40 }]);

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Restore" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Keep one now" }).disabled).toBe(
      true,
    );
  });
});

describe("a font drawn more than once", () => {
  /** A store drawing the bold of two masters. */
  function inBold() {
    const store = freshStore();
    act(() => {
      const one = setAxes(project(store.editor.document, { id: "regular" }), [WEIGHT]);
      store.patch({
        project: {
          ...one,
          masters: [
            master("regular", "Regular", { wght: 400 }),
            master("bold", "Bold", { wght: 900 }),
          ],
          current: "bold",
        },
      });
    });
    return store;
  }

  it("lists the copies of the master being drawn, and says whose they are", async () => {
    const now = Date.now();
    await openPanel(inBold(), [
      { at: now - 2 * MINUTE, glyphs: 41, master: "bold" },
      { at: now - 5 * MINUTE, glyphs: 42, master: "regular" },
      // From before they said, and of a master the font no longer has: either
      // may be this master's, and neither is another's.
      { at: now - 9 * MINUTE, glyphs: 43 },
      { at: now - 20 * MINUTE, glyphs: 44, master: "gone" },
    ]);

    expect(screen.getByText("Copies of Bold")).toBeTruthy();
    expect(screen.getByText("41 glyphs")).toBeTruthy();
    expect(screen.queryByText("42 glyphs")).toBeNull();
    expect(screen.getByText("43 glyphs")).toBeTruthy();
    expect(screen.getByText("44 glyphs")).toBeTruthy();
  });

  it("says there are none where the only copies are another master's", async () => {
    await openPanel(inBold(), [{ at: Date.now() - MINUTE, glyphs: 42, master: "regular" }]);

    expect(screen.getByText(/One is kept every few minutes of work/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  });
});
