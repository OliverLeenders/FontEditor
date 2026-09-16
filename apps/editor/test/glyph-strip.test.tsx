// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { GlyphStrip } = await import("../src/components/GlyphStrip.js");

/**
 * The row of letters under the canvas, and the text that decides what is in it.
 *
 * The strip is typed rather than picked from, which is what makes it a spacing
 * check as well as a way to move about: the letter being drawn is shown beside
 * the ones it will stand next to. So what is asked here is that what was typed
 * and what is shown stay in step — including a character the font has nothing
 * for, which is a gap rather than a letter quietly left out — and that pressing
 * a letter goes to it.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

/** The strip on some text; the starter font has h, e, l, o, c, i, n and space. */
function strip(text?: string) {
  const store = freshStore();
  if (text !== undefined) store.setStripText(text);
  const shown = render(<GlyphStrip />, store);
  return { store, shown, field: screen.getByLabelText("Glyphs to show") };
}

const cells = (): string[] => screen.getAllByRole("button").map((button) => button.textContent);

describe("what the strip shows", () => {
  it("shows a cell for each letter of the text it is given", () => {
    strip("hello");
    expect(cells()).toEqual(["h", "e", "l", "l", "o"]);
  });

  it("follows the text as it is typed, and remembers it", () => {
    const { store, field } = strip();

    fireEvent.change(field, { target: { value: "one" } });

    expect(store.getState().stripText).toBe("one");
    expect(cells()).toEqual(["o", "n", "e"]);
  });

  it("leaves a gap for a character the font has nothing for", () => {
    // A letter quietly left out would put what was typed and what is shown out
    // of step, which is the one thing the strip cannot do.
    const { shown } = strip("hz");

    expect(cells()).toEqual(["h"]);
    expect(shown.container.querySelector('[title="No glyph for “z”"]')).toBeTruthy();
  });

  it("reaches a glyph with no key to type it by, after a slash", () => {
    strip("h/space");
    expect(cells()).toEqual(["h", "space"]);
  });
});

describe("moving about with the strip", () => {
  it("marks the letter being drawn", () => {
    const { store } = strip("hello");
    store.setCurrentGlyph("e");
    cleanup();
    render(<GlyphStrip />, store);

    const marked = screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-pressed") === "true")
      .map((button) => button.textContent);
    expect(marked).toEqual(["e"]);
  });

  it("opens the letter that is pressed", () => {
    const { store } = strip("hello");

    fireEvent.click(screen.getAllByRole("button")[4]!);

    expect(store.editor.currentGlyph).toBe("o");
  });
});
