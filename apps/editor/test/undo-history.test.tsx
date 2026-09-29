// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { createGlyphs } from "@typewright/tools";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { UndoHistory, ago } = await import("../src/components/UndoHistory.js");

/**
 * The undo history: every step undo and redo can reach, named, with the glyph
 * it changed, and a press on one going straight there.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type Store = ReturnType<typeof freshStore>;

/** Two glyphs added a minute apart, so the steps stand alone rather than merge. */
function twoSteps(): Store {
  const store = freshStore();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_000_000);
  act(() => {
    store.applyTool(createGlyphs(store.editor, [{ name: "first.alt" }], 500));
  });
  vi.setSystemTime(1_060_000);
  act(() => {
    store.applyTool(createGlyphs(store.editor, [{ name: "second.alt" }], 500));
  });
  return store;
}

function show(store: Store, opened: string[] = []): void {
  render(
    <UndoHistory open onOpen={() => undefined} onOpenGlyph={(name) => opened.push(name)} />,
    store,
  );
}

describe("the undo history", () => {
  it("lists the steps newest first, each with the glyph it changed, above the font as opened", () => {
    const store = twoSteps();
    show(store);
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("second.alt");
    expect(rows[0]).toContain("now");
    expect(rows[1]).toContain("first.alt");
    expect(rows[1]).toContain("1m");
    expect(rows[2]).toBe("As opened");
  });

  it("goes straight to a step, and opens the glyph it changed", () => {
    const store = twoSteps();
    const opened: string[] = [];
    show(store, opened);
    const rows = screen.getAllByRole("button").filter((b) => b.closest("li") !== null);

    fireEvent.click(rows[1]!);
    expect(store.getState().session.history.index).toBe(1);
    expect(store.editor.document.glyphs["second.alt"]).toBeUndefined();
    expect(store.editor.document.glyphs["first.alt"]).toBeDefined();
    expect(opened).toEqual(["first.alt"]);
    expect(rows[1]!.getAttribute("aria-current")).toBe("step");
    expect(rows[0]!.getAttribute("data-undone")).toBe("true");

    fireEvent.click(rows[2]!);
    expect(store.getState().session.history.index).toBe(0);
    expect(store.editor.document.glyphs["first.alt"]).toBeUndefined();

    fireEvent.click(rows[0]!);
    expect(store.getState().session.history.index).toBe(2);
    expect(store.editor.document.glyphs["second.alt"]).toBeDefined();
  });

  it("says so when there is nothing to undo", () => {
    show(freshStore());
    expect(screen.getByText("Nothing to undo yet.")).toBeTruthy();
  });
});

describe("ago", () => {
  it("says how long ago in the fewest characters", () => {
    expect(ago(0, 4_000)).toBe("now");
    expect(ago(0, 42_000)).toBe("42s");
    expect(ago(0, 5 * 60_000)).toBe("5m");
    expect(ago(0, 3 * 3_600_000)).toBe("3h");
  });
});
