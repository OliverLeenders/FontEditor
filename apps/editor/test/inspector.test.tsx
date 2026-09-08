// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { Inspector } = await import("../src/components/Inspector.js");
const { addAnchor, addGuide, anchor, putGlyph, verticalGuide } =
  await import("@fonteditor/font-model");

/**
 * The inspector, which is where a shape is edited by number rather than by
 * hand.
 *
 * These are the rows that stand for something the canvas cannot do: naming an
 * anchor, giving a guide to the whole font, typing an exact coordinate. Each
 * one is a small amount of markup over a command that is tested where it lives,
 * so what is asked here is whether the row is wired to the right command and
 * shows what the model actually holds.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

/** The store, with something on the current glyph worth inspecting. */
function withFurniture() {
  const store = freshStore();
  act(() => {
    const editor = store.editor;
    const g = editor.document.glyphs[editor.currentGlyph];
    if (g === undefined) throw new Error("no current glyph");

    const dressed = addGuide(
      addAnchor(g, anchor("test-a", "top", { x: 100, y: 500 })),
      verticalGuide("test-g", 60, "stem"),
    );
    store.setEditor({ ...editor, document: putGlyph(editor.document, dressed) });
  });
  return store;
}

describe("anchors in the inspector", () => {
  it("lists them, with where they are", () => {
    const store = withFurniture();
    render(<Inspector />, store);

    expect(screen.getByLabelText<HTMLInputElement>("X of the anchor top").value).toBe("100");
    expect(screen.getByLabelText<HTMLInputElement>("Y of the anchor top").value).toBe("500");
  });

  it("renames one, which is what a panel is for", () => {
    const store = withFurniture();
    render(<Inspector />, store);

    fireEvent.change(screen.getByLabelText(/Name of the anchor/), {
      target: { value: "_top" },
    });

    const g = store.editor.document.glyphs[store.editor.currentGlyph];
    expect(g?.anchors[0]?.name).toBe("_top");
  });

  it("moves one to an exact place", () => {
    const store = withFurniture();
    render(<Inspector />, store);

    fireEvent.change(screen.getByLabelText("Y of the anchor top"), { target: { value: "640" } });

    const g = store.editor.document.glyphs[store.editor.currentGlyph];
    expect(g?.anchors[0]?.pt).toEqual({ x: 100, y: 640 });
  });

  it("takes one away", () => {
    const store = withFurniture();
    render(<Inspector />, store);

    fireEvent.click(screen.getByLabelText("Remove the anchor top"));

    expect(store.editor.document.glyphs[store.editor.currentGlyph]?.anchors).toEqual([]);
  });
});

describe("guides in the inspector", () => {
  it("shows the glyph's own, and says which scope it is in", () => {
    const store = withFurniture();
    render(<Inspector />, store);

    expect(screen.getByLabelText<HTMLInputElement>("X of the guide stem").value).toBe("60");
    expect(screen.getByLabelText<HTMLInputElement>("Angle of the guide stem").value).toBe("90");
    expect(screen.getByRole("button", { name: "glyph" })).toBeTruthy();
  });

  it("hands one to the whole font, and takes it back", () => {
    const store = withFurniture();
    render(<Inspector />, store);

    fireEvent.click(screen.getByRole("button", { name: "glyph" }));

    expect(store.editor.document.guides).toHaveLength(1);
    expect(store.editor.document.glyphs[store.editor.currentGlyph]?.guides).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "font" }));

    expect(store.editor.document.guides).toEqual([]);
    expect(store.editor.document.glyphs[store.editor.currentGlyph]?.guides).toHaveLength(1);
  });

  it("turns one to an angle typed in, brought into range", () => {
    const store = withFurniture();
    render(<Inspector />, store);

    fireEvent.change(screen.getByLabelText("Angle of the guide stem"), {
      target: { value: "-12" },
    });

    // A line has no direction, and −12 is said as 348 rather than kept as a
    // number nobody would write down.
    expect(store.editor.document.glyphs[store.editor.currentGlyph]?.guides[0]?.angle).toBe(348);
  });

  it("names one", () => {
    const store = withFurniture();
    render(<Inspector />, store);

    fireEvent.change(screen.getByLabelText(/Name of the guide/), {
      target: { value: "overshoot" },
    });

    expect(store.editor.document.glyphs[store.editor.currentGlyph]?.guides[0]?.name).toBe(
      "overshoot",
    );
  });

  it("takes one away", () => {
    const store = withFurniture();
    render(<Inspector />, store);

    fireEvent.click(screen.getByLabelText("Remove the guide stem"));

    expect(store.editor.document.glyphs[store.editor.currentGlyph]?.guides).toEqual([]);
  });
});

describe("what the inspector says when there is nothing to say", () => {
  it("points at the canvas rather than showing an empty list", () => {
    render(<Inspector />);
    expect(screen.getAllByText("Right-click the canvas to add one").length).toBeGreaterThan(0);
  });
});
