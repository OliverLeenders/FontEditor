import { describe, expect, it } from "vitest";

import {
  type Panes,
  SINGLE_PANE,
  activeView,
  choosePane,
  closeSecondPane,
  focusPane,
  openGlyphBeside,
  openGlyphFrom,
  openSecondPane,
} from "../src/layout.js";

describe("a glyph opened from feature source", () => {
  it("is drawn in the other pane of a split window, whatever it showed", () => {
    expect(openGlyphBeside(split("features", "proof"), 0)).toEqual(split("features", "glyph", 1));
    expect(openGlyphBeside(split("spacing", "features", 1), 1)).toEqual(
      split("glyph", "features", 0),
    );
  });

  it("turns a window of one to the drawing", () => {
    expect(openGlyphBeside(split("features", null), 0)).toEqual(split("glyph", null));
  });
});

/**
 * Which workspaces a split window shows, and which one the keyboard is in.
 *
 * The rules are small and easy to get subtly wrong — a workspace shown twice, a
 * keyboard left in a pane that has closed — so they are plain functions, and
 * tested here without a window.
 */

const split = (first: Panes["first"], second: Panes["second"], active: 0 | 1 = 0): Panes => ({
  first,
  second,
  active,
});

describe("one pane", () => {
  it("opens on the font", () => {
    expect(SINGLE_PANE).toEqual({ first: "font", second: null, active: 0 });
    expect(activeView(SINGLE_PANE)).toBe("font");
  });

  it("changes workspace as a window of one always has", () => {
    expect(choosePane(SINGLE_PANE, 0, "proof")).toEqual(split("proof", null));
  });

  it("has no second pane to choose for or to focus", () => {
    expect(choosePane(SINGLE_PANE, 1, "proof")).toBe(SINGLE_PANE);
    expect(focusPane(SINGLE_PANE, 1)).toBe(SINGLE_PANE);
  });
});

describe("splitting", () => {
  it("opens the drawing beside what was showing, and moves the keyboard into it", () => {
    expect(openSecondPane(split("spacing", null))).toEqual(split("spacing", "glyph", 1));
  });

  it("opens the spacing line beside the drawing", () => {
    expect(openSecondPane(split("glyph", null))).toEqual(split("glyph", "spacing", 1));
  });

  it("does nothing to a window already split", () => {
    const panes = split("font", "glyph");
    expect(openSecondPane(panes)).toBe(panes);
  });

  it("closes back to the first pane, with the keyboard in it", () => {
    expect(closeSecondPane(split("glyph", "proof", 1))).toEqual(split("glyph", null));
  });
});

describe("choosing a workspace in a split window", () => {
  it("shows it in that pane and makes that pane active", () => {
    expect(choosePane(split("glyph", "spacing", 0), 1, "proof")).toEqual(
      split("glyph", "proof", 1),
    );
  });

  it("swaps the panes rather than show one workspace twice", () => {
    // The drawing exists once, so asking for it on the left moves it there.
    expect(choosePane(split("font", "glyph", 0), 0, "glyph")).toEqual(split("glyph", "font", 0));
    expect(choosePane(split("font", "glyph", 0), 1, "font")).toEqual(split("glyph", "font", 1));
  });

  it("only moves the keyboard when the pane already shows it", () => {
    expect(choosePane(split("font", "glyph", 0), 1, "glyph")).toEqual(split("font", "glyph", 1));
  });

  it("follows the keyboard into the pane it is in", () => {
    const panes = split("font", "glyph", 0);
    expect(activeView(panes)).toBe("font");
    expect(activeView(focusPane(panes, 1))).toBe("glyph");
  });

  it("gives back the same panes when focusing the active one", () => {
    const panes = split("font", "glyph", 1);
    expect(focusPane(panes, 1)).toBe(panes);
  });
});

describe("opening a glyph", () => {
  it("draws it in the other pane when that pane is drawing, and leaves this one alone", () => {
    const panes = split("font", "glyph", 0);
    expect(openGlyphFrom(panes, 0)).toBe(panes);
  });

  it("turns this pane to the drawing when no pane is drawing", () => {
    expect(openGlyphFrom(split("font", "proof", 0), 0)).toEqual(split("glyph", "proof", 0));
    expect(openGlyphFrom(split("font", null), 0)).toEqual(split("glyph", null));
  });
});
