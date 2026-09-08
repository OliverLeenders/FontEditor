// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { Tracing } = await import("../src/components/Tracing.js");
const { imageRef, putGlyph, setGlyphImage } = await import("@fonteditor/font-model");

/**
 * The list of pictures a font is traced from.
 *
 * The arrangement being tested is the one the whole feature rests on: the
 * pictures belong to the *font*, and a row's button puts one behind the *glyph*
 * in front of you. So the questions are whether the list is of the right thing,
 * whether the button changes the right thing, and whether the row knows how
 * many letters are already using it.
 *
 * There is no storage worker here, so nothing is really written; a picture is
 * put into the state directly, which is what the store would have done once the
 * worker answered.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

const PICTURES = [
  { name: "sheet.png", bytes: 4096 },
  { name: "sketch.png", bytes: 128 },
];

/**
 * Open the panel, and give the font some pictures.
 *
 * In that order, and the order is the point: opening the panel reads the list
 * from the store, and with no worker behind it that answers with nothing. So
 * the fixture is put in afterwards, which is also what happens in the
 * application — the list arrives after the panel is up.
 */
async function openPanel(store = freshStore(), images: typeof PICTURES = []) {
  const shown = render(<Tracing />, store);
  fireEvent.click(screen.getByRole("button", { name: "Tracing" }));

  await act(async () => {
    await Promise.resolve();
  });
  if (images.length > 0) act(() => store.patch({ images }));

  return shown;
}

describe("the tracing panel", () => {
  it("says how to start when the font has no pictures", async () => {
    await openPanel();
    expect(screen.getByText(/A scan of a whole alphabet is one picture/)).toBeTruthy();
  });

  it("lists the font's pictures, not this glyph's", async () => {
    await openPanel(freshStore(), PICTURES);

    expect(screen.getByText("sheet.png")).toBeTruthy();
    expect(screen.getByText("sketch.png")).toBeTruthy();
  });

  it("says a picture nothing is using is unused", async () => {
    await openPanel(freshStore(), PICTURES);
    expect(screen.getAllByText("unused")).toHaveLength(2);
  });

  it("counts the letters tracing from each one", async () => {
    const store = freshStore();
    act(() => {
      const { document } = store.editor;
      let next = document;
      for (const name of ["o", "e"]) {
        const g = next.glyphs[name];
        if (g !== undefined) next = putGlyph(next, setGlyphImage(g, imageRef("sheet.png")));
      }
      store.setEditor({ ...store.editor, document: next });
    });
    await openPanel(store, PICTURES);

    expect(screen.getByText("2 glyphs")).toBeTruthy();
    expect(screen.getByText("unused")).toBeTruthy();
  });

  it("puts a picture behind the glyph in front of you", async () => {
    const store = freshStore();
    await openPanel(store, PICTURES);

    fireEvent.click(screen.getAllByRole("button", { name: "Use here" })[0]!);

    const glyph = store.editor.document.glyphs[store.editor.currentGlyph];
    expect(glyph?.image?.name).toBe("sheet.png");
    // Placed as it comes: where it goes is the next decision, not this one.
    expect(glyph?.image?.transform.xScale).toBe(1);
    expect(glyph?.image?.transform.xOffset).toBe(0);
  });

  it("offers to take it away again once it is there", async () => {
    const store = freshStore();
    await openPanel(store, PICTURES);
    fireEvent.click(screen.getAllByRole("button", { name: "Use here" })[0]!);

    const off = screen.getByRole("button", { name: "Remove" });
    fireEvent.click(off);

    expect(store.editor.document.glyphs[store.editor.currentGlyph]?.image).toBeNull();
  });

  it("changes the glyph, and not the other glyphs", async () => {
    const store = freshStore();
    await openPanel(store, PICTURES);
    const before = store.editor.document.glyphs["e"];

    fireEvent.click(screen.getAllByRole("button", { name: "Use here" })[0]!);

    expect(store.editor.document.glyphs["e"]).toBe(before);
  });

  it("is an undoable step, being an edit to the font", async () => {
    const store = freshStore();
    await openPanel(store, PICTURES);
    fireEvent.click(screen.getAllByRole("button", { name: "Use here" })[0]!);

    act(() => {
      store.undo();
    });

    expect(store.editor.document.glyphs[store.editor.currentGlyph]?.image).toBeNull();
  });

  it("turns the picture off and on without touching the font", async () => {
    const store = freshStore();
    await openPanel(store, PICTURES);
    const before = store.editor.document;

    fireEvent.click(screen.getByLabelText("Show the picture behind the glyph"));

    expect(store.getState().showImage).toBe(false);
    // A preference, not an edit: the font is the same font.
    expect(store.editor.document).toBe(before);
  });

  it("sets how strongly it shows through", async () => {
    const store = freshStore();
    await openPanel(store, PICTURES);

    fireEvent.change(screen.getByLabelText("How strongly the picture shows through"), {
      target: { value: "0.25" },
    });

    expect(store.getState().imageOpacity).toBe(0.25);
    expect(screen.getByText("25%")).toBeTruthy();
  });

  it("will not write while another tab is the one saving", async () => {
    const store = freshStore();
    act(() => {
      store.patch({ ownership: "reading" });
    });
    await openPanel(store, PICTURES);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add…" })).toBeTruthy();
    });
    for (const button of screen.getAllByRole("button", { name: "Use here" })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
