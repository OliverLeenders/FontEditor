// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { CleanUpMenu } = await import("../src/components/CleanUpMenu.js");
const { begin, commit, result, roundCoordinates } = await import("@typewright/tools");
const { contour, counterIds, glyph, node, putGlyph, updateGlyph } =
  await import("@typewright/font-model");

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

describe("a font read from a font file, brought up to date", () => {
  const ids = counterIds("menu");
  const at = (x: number, y: number) => node(ids.node(), { x, y });
  const square = (left: number, bottom: number, size: number) =>
    contour(
      ids.contour(),
      [
        at(left, bottom),
        at(left + size, bottom),
        at(left + size, bottom + size),
        at(left, bottom + size),
      ],
      true,
    );

  /** Chosen by how its name begins: these two say more about themselves after it. */
  function pick(label: RegExp): void {
    fireEvent.click(screen.getByRole("button", { name: /Clean up/ }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: label }));
  }

  /** The starter font with a glyph as an old import left one, and one of ink inside ink. */
  function imported() {
    const store = freshStore();
    let document = store.editor.document;
    // A point on the point before it.
    const doubled = contour(
      ids.contour(),
      [at(0, 0), at(200, 0), at(200, 0), at(200, 200), at(0, 200)],
      true,
    );
    document = putGlyph(document, glyph("doubled", { advance: 500, contours: [doubled] }));
    // Two shapes the same way round, one inside the other: ink to a font file.
    document = putGlyph(
      document,
      glyph("buried", { advance: 500, contours: [square(0, 0, 400), square(100, 100, 200)] }),
    );
    store.applyTool(result({ ...store.editor, document }, [begin("Import", false), commit]));
    return store;
  }

  it("tidies what draws nothing, says how many glyphs, and takes it back in one step", () => {
    const store = imported();
    render(<CleanUpMenu />, store);

    pick(/^Tidy imported outlines/);
    expect(screen.getByRole("status").textContent).toBe("Tidied 1 glyph.");
    expect(store.editor.document.glyphs["doubled"]?.contours[0]?.nodes).toHaveLength(4);

    act(() => {
      store.undo();
    });
    expect(store.editor.document.glyphs["doubled"]?.contours[0]?.nodes).toHaveLength(5);
  });

  it("says so when there was nothing to tidy", () => {
    const store = freshStore();
    const before = store.editor.document;
    render(<CleanUpMenu />, store);

    pick(/^Tidy imported outlines/);
    expect(screen.getByRole("status").textContent).toBe("There was nothing to tidy.");
    expect(store.editor.document).toBe(before);
  });

  it("says what filling as the file did would change, and changes nothing until told to", () => {
    const store = imported();
    const before = store.editor.document;
    render(<CleanUpMenu />, store);

    pick(/^Fill as the font file did/);
    const asked = screen.getByRole("group", { name: "Fill as the font file did?" });
    expect(asked.textContent).toContain("1 glyph would be redrawn: buried");
    expect(store.editor.document).toBe(before);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Fill as the font file did?" })).toBeNull();
    expect(store.editor.document).toBe(before);
  });

  it("redraws them when told to, as one step", () => {
    const store = imported();
    render(<CleanUpMenu />, store);

    pick(/^Fill as the font file did/);
    fireEvent.click(screen.getByRole("button", { name: "Redraw them" }));

    expect(screen.getByRole("status").textContent).toBe("Redrew 1 glyph.");
    expect(store.editor.document.glyphs["buried"]?.contours).toHaveLength(1);
    expect(store.editor.document.glyphs["doubled"]?.contours[0]?.nodes).toHaveLength(5);

    act(() => {
      store.undo();
    });
    expect(store.editor.document.glyphs["buried"]?.contours).toHaveLength(2);
  });

  it("says so when every glyph already fills as its file did", () => {
    render(<CleanUpMenu />, freshStore());
    pick(/^Fill as the font file did/);
    expect(screen.getByRole("status").textContent).toBe(
      "Every glyph already fills as its file did.",
    );
  });
});
