// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { CommandPalette, commandsFor, matching } =
  await import("../src/components/CommandPalette.js");
const { WindowBar } = await import("../src/components/WindowBar.js");
const { StatusBar } = await import("../src/components/StatusBar.js");
const { Inspector } = await import("../src/components/Inspector.js");

/**
 * The pieces added to make the editor easier to find one's way in: the command
 * palette, where the font is kept in the window bar, the selection's size and
 * the pointer in the status bar, and the inspector leading with the selection.
 */

type Store = ReturnType<typeof freshStore>;

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

/** A store on a glyph with outlines, with its first contour's points selected. */
function withSelection(): Store {
  const store = freshStore();
  act(() => {
    for (const name of store.editor.document.glyphOrder) {
      const g = store.editor.document.glyphs[name];
      const c = g?.contours[0];
      if (c === undefined || c.nodes.length < 2) continue;
      store.setCurrentGlyph(name);
      store.setEditor({
        ...store.editor,
        selection: c.nodes.map((n) => ({ contourId: c.id, nodeId: n.id, part: "point" as const })),
      });
      return;
    }
    throw new Error("no glyph with a contour in the starter font");
  });
  return store;
}

describe("the command palette", () => {
  it("offers the workspaces, the tools, and what can be done to the selection", () => {
    const store = withSelection();
    const labels = commandsFor(store, "glyph", () => undefined).map(
      (c) => `${c.group}: ${c.label}`,
    );
    expect(labels).toContain("Go to: Spacing");
    expect(labels).toContain("Tool: Pen");
    expect(labels).toContain("Glyph: Corner");
    expect(labels).toContain("Edit: Undo");
    // A command that places something under the pointer means nothing from a list.
    expect(labels.some((l) => /here/.test(l))).toBe(false);
  });

  it("finds by name, the ones starting with it first", () => {
    const store = withSelection();
    const found = matching(
      commandsFor(store, "glyph", () => undefined),
      "sm",
    );
    expect(found[0]!.label).toBe("Smooth");
  });

  it("runs the one chosen, and closes", () => {
    const store = withSelection();
    let went: string | null = null;
    let closed = false;
    render(
      <CommandPalette
        workspace="glyph"
        onWorkspace={(id) => {
          went = id;
        }}
        onClose={() => {
          closed = true;
        }}
      />,
      store,
    );
    const input = screen.getByLabelText("Command");
    fireEvent.change(input, { target: { value: "proof" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(went).toBe("proof");
    expect(closed).toBe(true);
  });
});

describe("the window bar", () => {
  it("says a font is not saved to disk until it is", () => {
    render(<WindowBar />);
    expect(screen.getByText(/not saved to disk/)).toBeTruthy();
  });
});

describe("the status bar", () => {
  it("gives the size of what is selected", () => {
    const store = withSelection();
    render(<StatusBar workspace="glyph" onShortcuts={() => undefined} />, store);
    expect(screen.getByTitle("The size of what is selected, in units").textContent).toMatch(
      /\d+ × \d+/,
    );
  });

  it("gives where the pointer is, in units", () => {
    const store = withSelection();
    act(() => {
      store.setEditor({ ...store.editor, cursor: { x: 120.25, y: -40 } });
    });
    render(<StatusBar workspace="glyph" onShortcuts={() => undefined} />, store);
    expect(screen.getByTitle("Where the pointer is, in units").textContent).toBe("120.3, -40");
  });
});

describe("the inspector", () => {
  const order = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

  it("leads with the point's sections while points are selected", () => {
    render(<Inspector />, withSelection());
    const titles = order();
    const point = titles.findIndex((t) => t.startsWith("Point"));
    const glyph = titles.findIndex((t) => t.startsWith("Glyph"));
    expect(point).toBeGreaterThanOrEqual(0);
    expect(point).toBeLessThan(glyph);
  });

  it("keeps the glyph's own first with nothing selected", () => {
    const store = withSelection();
    act(() => {
      store.setEditor({ ...store.editor, selection: [] });
    });
    render(<Inspector />, store);
    const titles = order();
    expect(titles[0]).toMatch(/^Glyph/);
  });
});
