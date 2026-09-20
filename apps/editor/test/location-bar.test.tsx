// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { LocationBar } = await import("../src/components/LocationBar.js");
const { instanceDocument } = await import("../src/instance.js");
const { WEIGHT, master, project, setAxes, glyph, addContour, contour, node, fontDocument } =
  await import("@typewright/font-model");

/**
 * Where in the designspace the text is set.
 *
 * The same location the canvas has drawn a ghost weight at since the
 * designspace went in, now in the bars of the workspaces that set text: a
 * master is wrong about a stem or a sidebearing in ways that show in a line and
 * not in one letter.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

type Store = ReturnType<typeof freshStore>;

/** A square of the given width, so a weight can be read straight off a drawing. */
function box(id: string, wide: number) {
  return contour(
    id,
    [
      node(`${id}a`, { x: 0, y: 0 }),
      node(`${id}b`, { x: wide, y: 0 }),
      node(`${id}c`, { x: wide, y: 700 }),
      node(`${id}d`, { x: 0, y: 700 }),
    ],
    true,
  );
}

/** A store on a two-master family, with the other master already read in. */
function family(): Store {
  const store = freshStore();
  act(() => {
    const thin = fontDocument([addContour(glyph("a", { advance: 600 }), box("t", 100))]);
    const black = fontDocument([addContour(glyph("a", { advance: 600 }), box("b", 300))]);

    const one = setAxes(project(thin, { id: "m1" }), [WEIGHT]);
    store.setEditor({ ...store.editor, document: thin, currentGlyph: "a" });
    store.patch({
      project: {
        ...one,
        current: "m1",
        // The first sits at the axis default, which is where a designspace
        // measures everything else from.
        masters: [master("m1", "Regular", { wght: 400 }), master("m2", "Black", { wght: 900 })],
        sources: { m2: black },
      },
    });
  });
  return store;
}

describe("the control", () => {
  it("is not there for a font with one drawing of itself", () => {
    render(<LocationBar />);
    expect(screen.queryByLabelText("Set the text at a place between the masters")).toBeNull();
  });

  it("offers the axes once it is switched on", async () => {
    const store = family();
    render(<LocationBar />, store);

    expect(screen.queryByLabelText("Weight of the text")).toBeNull();
    fireEvent.click(screen.getByLabelText("Set the text at a place between the masters"));

    expect(await screen.findByLabelText("Weight of the text")).toBeTruthy();
  });

  it("sets the same location the canvas draws at, not one of its own", async () => {
    // Three places that could disagree about which weight is on screen would be
    // three answers to one question.
    const store = family();
    render(<LocationBar />, store);

    fireEvent.click(screen.getByLabelText("Set the text at a place between the masters"));
    const slider = await screen.findByLabelText("Weight of the text");
    await act(async () => {
      fireEvent.change(slider, { target: { value: "500" } });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(store.getState().preview).toEqual({ wght: 500 });
    });
  });
});

describe("the font the text is set with", () => {
  it("is the master being edited while no location is asked for", () => {
    expect(instanceDocument(family().getState())).toBeNull();
  });

  it("is worked out between the masters once one is", async () => {
    const store = family();
    await act(async () => {
      await store.setPreview({ wght: 900 });
    });

    const between = instanceDocument(store.getState());
    expect(between).not.toBeNull();
    // At the black master's own place, which is the black master's drawing:
    // three hundred units wide where the regular is one hundred.
    const wide = (d: typeof between) =>
      Math.max(...d!.glyphs["a"]!.contours[0]!.nodes.map((n) => n.pt.x));
    expect(wide(between)).toBeCloseTo(300, 6);
  });

  it("is worked out again when the master under it is edited, and not otherwise", async () => {
    const store = family();
    await act(async () => {
      await store.setPreview({ wght: 900 });
    });

    const first = instanceDocument(store.getState());
    expect(instanceDocument(store.getState())).toBe(first);

    act(() => {
      store.setEditor({
        ...store.editor,
        document: fontDocument([addContour(glyph("a", { advance: 600 }), box("t", 200))]),
      });
    });
    expect(instanceDocument(store.getState())).not.toBe(first);
  });
});
