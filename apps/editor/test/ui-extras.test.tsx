// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { CommandPalette, commandsFor, glyphCommands, matching } =
  await import("../src/components/CommandPalette.js");
const { loadUnicodeNames } = await import("@typewright/catalog");
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
        onOpenGlyph={() => undefined}
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

describe("going to a glyph from the command palette", () => {
  it("puts the glyph typed in full above every command", () => {
    const store = freshStore();
    const name = store.editor.document.glyphOrder.find((n) => n.length === 1)!;
    const opened: string[] = [];
    const found = glyphCommands(store, name, (n) => opened.push(n));
    expect(found.exact.map((c) => c.label)).toEqual([name]);
    found.exact[0]!.run();
    expect(opened).toEqual([name]);
  });

  it("finds by what a character is called, and offers to make one the font has not got", async () => {
    await loadUnicodeNames();
    const store = freshStore();
    const found = glyphCommands(store, "dotless j", () => undefined);
    const make = [...found.exact, ...found.rest].find((c) => c.group === "Make");
    expect(make?.detail).toMatch(/dotless j/);
    act(() => {
      make!.run();
    });
    expect(store.editor.document.glyphs[make!.label]?.unicodes).toEqual([0x237]);
  });

  it("offers the next and previous glyph", () => {
    const labels = commandsFor(withSelection(), "glyph", () => undefined).map((c) => c.label);
    expect(labels).toContain("Next glyph");
    expect(labels).toContain("Previous glyph");
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
