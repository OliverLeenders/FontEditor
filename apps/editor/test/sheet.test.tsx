// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { Sheet } = await import("../src/components/Sheet.js");
const { imageRef, putGlyph, setGlyphImage } = await import("@typewright/font-model");

/**
 * The picture whole, with a box round each letter found in it.
 *
 * There is no worker here to decode a picture, which is the state the panel has
 * to be honest about: it says it is reading rather than showing an empty frame.
 * The rest is what the panel is for — it exists only where the glyph is traced
 * from something, and it says which letter the box being drawn is for.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

/** A store whose current glyph is traced from a picture. */
function tracing() {
  const store = freshStore();
  const name = store.editor.currentGlyph;
  const found = store.editor.document.glyphs[name];
  if (found === undefined) throw new Error("the starter font has no glyph to trace");
  act(() => {
    store.setEditor({
      ...store.editor,
      document: putGlyph(store.editor.document, setGlyphImage(found, imageRef("sheet.png"))),
    });
  });
  return store;
}

describe("the sheet", () => {
  it("is not there at all for a glyph with no picture behind it", () => {
    const { container } = render(<Sheet />);
    expect(container.innerHTML).toBe("");
  });

  it("offers the picture whole for a glyph traced from one", () => {
    const store = tracing();
    render(<Sheet />, store);

    fireEvent.click(screen.getByRole("button", { name: "Sheet" }));

    expect(screen.getByRole("group", { name: "The picture whole" })).toBeTruthy();
    expect(screen.getByText("sheet.png")).toBeTruthy();
    expect(
      screen.getByText(new RegExp(`Drag a box round ${store.editor.currentGlyph}`)),
    ).toBeTruthy();
  });

  it("says it is reading the picture rather than showing an empty frame", () => {
    // Nothing decodes a picture in a test: there is no storage worker, so the
    // panel is in exactly the state it is in for a moment in the application.
    render(<Sheet />, tracing());
    fireEvent.click(screen.getByRole("button", { name: "Sheet" }));

    expect(screen.getAllByText(/Reading the picture…/).length).toBeGreaterThan(0);
  });

  it("closes when the panel says it is done", () => {
    render(<Sheet />, tracing());
    fireEvent.click(screen.getByRole("button", { name: "Sheet" }));

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.queryByRole("group", { name: "The picture whole" })).toBeNull();
  });
});
