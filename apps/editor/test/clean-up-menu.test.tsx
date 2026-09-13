// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { CleanUpMenu } = await import("../src/components/CleanUpMenu.js");
const { begin, commit, result, roundCoordinates } = await import("@typewright/tools");
const { updateGlyph } = await import("@typewright/font-model");

/**
 * The whole-font tidies.
 *
 * What the menu decides beyond calling a command is what it says afterwards:
 * how many glyphs the step changed, or that there was nothing to do — which is
 * the only way to tell a tidy that did nothing from one that did not run — and
 * that the note goes away again.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function choose(label: string): void {
  fireEvent.click(screen.getByRole("button", { name: /Clean up/ }));
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: label }));
}

/** The starter font rounded, so that it starts with nothing to do. */
function whole() {
  const store = freshStore();
  store.applyTool(roundCoordinates(store.editor));
  return store;
}

/** The starter font rounded, then two glyphs given advances off the grid. */
function unrounded() {
  const store = whole();
  const [first, second] = store.editor.document.glyphOrder.filter((n) => n !== ".notdef");
  let document = store.editor.document;
  for (const name of [first!, second!]) {
    document = updateGlyph(document, name, (g) => ({ ...g, advance: g.advance + 0.4 })) ?? document;
  }
  store.applyTool(result({ ...store.editor, document }, [begin("Unround", false), commit]));
  return store;
}

describe("rounding the whole font", () => {
  it("says how many glyphs it rounded, and rounds them in one step", () => {
    const store = unrounded();
    render(<CleanUpMenu />, store);

    choose("Round coordinates");

    expect(screen.getByRole("status").textContent).toBe("Rounded 2 glyphs.");
    const advances = Object.values(store.editor.document.glyphs).map((g) => g.advance);
    expect(advances.every((a) => Number.isInteger(a))).toBe(true);

    act(() => {
      store.undo();
    });
    expect(
      Object.values(store.editor.document.glyphs).some((g) => !Number.isInteger(g.advance)),
    ).toBe(true);
  });

  it("says so, and makes no step, when every coordinate was whole already", () => {
    const store = whole();
    const before = store.editor.document;
    render(<CleanUpMenu />, store);

    choose("Round coordinates");

    expect(screen.getByRole("status").textContent).toBe("Every coordinate was already whole.");
    expect(store.editor.document).toBe(before);
  });

  it("takes the note away after a few seconds", () => {
    vi.useFakeTimers();
    render(<CleanUpMenu />, freshStore());

    choose("Round coordinates");
    expect(screen.queryByRole("status")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("re-attaching accents", () => {
  it("says so when every accent is already on its anchors", () => {
    render(<CleanUpMenu />, freshStore());
    choose("Re-attach accents");
    expect(screen.getByRole("status").textContent).toBe("Every accent was already on its anchors.");
  });
});
