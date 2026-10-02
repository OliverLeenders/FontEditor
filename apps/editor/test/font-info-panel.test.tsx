// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { FontInfoPanel } = await import("../src/components/FontInfoPanel.js");

/**
 * The font's own facts, edited in a panel.
 *
 * The interesting behaviour here is not what it draws but when it commits. Each
 * field holds a draft so a half-typed number never reaches the model: "7" on
 * the way to "750" would otherwise land in the undo stack and move the canvas
 * rulers under a number nobody finished typing. That, and the fields that
 * refuse a value outright, is what these ask about.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

/** Open the panel, which every test needs and none of them is about. */
function openPanel() {
  const shown = render(<FontInfoPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Font info" }));
  return shown;
}

describe("the font info panel", () => {
  it("stays shut until it is asked for", () => {
    render(<FontInfoPanel />);
    expect(screen.queryByLabelText("Family")).toBeNull();
  });

  it("shows the font's own values", () => {
    const { store } = openPanel();
    const family = screen.getByLabelText<HTMLInputElement>("Family");

    expect(family.value).toBe(store.editor.document.info.familyName);
  });

  it("does not change the font while a number is half typed", () => {
    const { store } = openPanel();
    const em = screen.getByLabelText<HTMLInputElement>("Units per em");
    const before = store.editor.document.info.unitsPerEm;

    fireEvent.focus(em);
    fireEvent.change(em, { target: { value: "2" } });

    // The box shows it; the font has not heard of it.
    expect(em.value).toBe("2");
    expect(store.editor.document.info.unitsPerEm).toBe(before);
  });

  it("commits when the field is left", () => {
    const { store } = openPanel();
    const x = screen.getByLabelText<HTMLInputElement>("x-height");

    fireEvent.focus(x);
    fireEvent.change(x, { target: { value: "512" } });
    fireEvent.blur(x);

    expect(store.editor.document.info.xHeight).toBe(512);
  });

  it("commits on Enter, without waiting to be left", () => {
    const { store } = openPanel();
    const family = screen.getByLabelText<HTMLInputElement>("Family");

    fireEvent.focus(family);
    fireEvent.change(family, { target: { value: "Chalk" } });
    fireEvent.keyDown(family, { key: "Enter" });

    expect(store.editor.document.info.familyName).toBe("Chalk");
  });

  it("puts the box back on Escape, and leaves the font alone", () => {
    const { store } = openPanel();
    const family = screen.getByLabelText<HTMLInputElement>("Family");
    const before = store.editor.document.info.familyName;

    fireEvent.focus(family);
    fireEvent.change(family, { target: { value: "Nonsense" } });
    fireEvent.keyDown(family, { key: "Escape" });

    expect(family.value).toBe(before);
    expect(store.editor.document.info.familyName).toBe(before);
  });

  it("refuses a value the font could not hold, and says so", () => {
    const { store } = openPanel();
    const em = screen.getByLabelText<HTMLInputElement>("Units per em");
    const before = store.editor.document.info.unitsPerEm;

    fireEvent.focus(em);
    fireEvent.change(em, { target: { value: "0" } });

    // An em of zero makes every scale in the editor a division by zero, so the
    // field says so before it is committed rather than after.
    expect(screen.getByRole("alert").textContent).toMatch(/more than zero/);

    fireEvent.blur(em);
    expect(store.editor.document.info.unitsPerEm).toBe(before);
  });

  it("refuses a family name of nothing", () => {
    const { store } = openPanel();
    const family = screen.getByLabelText<HTMLInputElement>("Family");
    const before = store.editor.document.info.familyName;

    fireEvent.focus(family);
    fireEvent.change(family, { target: { value: "" } });
    fireEvent.blur(family);

    expect(store.editor.document.info.familyName).toBe(before);
  });

  it("writes the style-map style straight through, having no draft to protect", () => {
    const { store } = openPanel();
    const menu = screen.getByLabelText<HTMLSelectElement>("Menu style");

    fireEvent.change(menu, { target: { value: "bold italic" } });

    expect(store.editor.document.info.styleMapStyleName).toBe("bold italic");
  });

  it("shows what an undo did, rather than the number that was typed", () => {
    const { store } = openPanel();
    const x = screen.getByLabelText<HTMLInputElement>("x-height");
    const before = store.editor.document.info.xHeight;

    fireEvent.focus(x);
    fireEvent.change(x, { target: { value: "512" } });
    fireEvent.blur(x);
    // Outside React's own events, so the flush has to be asked for.
    act(() => {
      store.undo();
    });

    expect(screen.getByLabelText<HTMLInputElement>("x-height").value).toBe(String(before));
  });
});

/**
 * A new em, which means one of two things, so the panel asks which: the whole
 * font scaled to it, or the numbers kept and every glyph set at a new size.
 */
describe("changing the em", () => {
  const typeEm = (value: string) => {
    const em = screen.getByLabelText<HTMLInputElement>("Units per em");
    fireEvent.focus(em);
    fireEvent.change(em, { target: { value } });
    fireEvent.blur(em);
  };

  it("asks before it changes anything", () => {
    const { store } = openPanel();
    const before = store.editor.document.info.unitsPerEm;
    typeEm("2000");

    expect(store.editor.document.info.unitsPerEm).toBe(before);
    expect(screen.getByRole("group", { name: "Change the em" })).toBeTruthy();
    // The box holds the em being asked about until it is answered.
    expect(screen.getByLabelText<HTMLInputElement>("Units per em").value).toBe("2000");
  });

  it("scales the font when asked to, so the drawing keeps its size", () => {
    const { store } = openPanel();
    const ascender = store.editor.document.info.ascender;
    typeEm("2000");
    fireEvent.click(screen.getByRole("button", { name: "Scale the font" }));

    expect(store.editor.document.info.unitsPerEm).toBe(2000);
    expect(store.editor.document.info.ascender).toBe(ascender * 2);
    expect(screen.queryByRole("group", { name: "Change the em" })).toBeNull();
  });

  it("keeps the numbers when asked to", () => {
    const { store } = openPanel();
    const ascender = store.editor.document.info.ascender;
    typeEm("2000");
    fireEvent.click(screen.getByRole("button", { name: "Keep the numbers" }));

    expect(store.editor.document.info.unitsPerEm).toBe(2000);
    expect(store.editor.document.info.ascender).toBe(ascender);
  });

  it("changes nothing on Cancel, and puts the box back", () => {
    const { store } = openPanel();
    const before = store.editor.document.info.unitsPerEm;
    typeEm("2000");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(store.editor.document.info.unitsPerEm).toBe(before);
    expect(screen.getByLabelText<HTMLInputElement>("Units per em").value).toBe(String(before));
  });
});

/** A fixed width, said and then fitted to. */
describe("a fixed width", () => {
  it("is off until it is ticked, and then takes the width typed", () => {
    const { store } = openPanel();
    const width = screen.getByLabelText<HTMLInputElement>("Width");
    expect(width.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText<HTMLInputElement>("Fixed width"));
    expect(store.editor.document.info.postscriptIsFixedPitch).toBe(true);

    fireEvent.focus(width);
    fireEvent.change(width, { target: { value: "640" } });
    fireEvent.keyDown(width, { key: "Enter" });
    expect(store.editor.document.fixedWidth).toBe(640);
  });

  it("offers to fit the glyphs that are another width, and fits them", () => {
    const { store } = openPanel();
    fireEvent.click(screen.getByLabelText<HTMLInputElement>("Fixed width"));
    const width = screen.getByLabelText<HTMLInputElement>("Width");
    fireEvent.focus(width);
    fireEvent.change(width, { target: { value: "777" } });
    fireEvent.keyDown(width, { key: "Enter" });

    fireEvent.click(screen.getByRole("button", { name: "Fit to 777" }));
    const advances = Object.values(store.editor.document.glyphs).map((g) => g.advance);
    expect(advances.every((a) => a === 0 || a === 777 || a === 1554)).toBe(true);
    expect(screen.queryByRole("button", { name: "Fit to 777" })).toBeNull();
  });
});

/** Icons' names as ligatures: a switch, and a line saying what it will do. */
describe("names as ligatures", () => {
  it("is off until ticked, and says when no glyph is an icon yet", () => {
    const { store } = openPanel();
    const box = screen.getByLabelText<HTMLInputElement>("Names as ligatures");
    expect(box.checked).toBe(false);

    fireEvent.click(box);
    expect(store.editor.document.nameLigatures).toBe(true);
    // The starter font has letters and no icons.
    expect(screen.getByText(/No glyph has a private-use code point yet/)).toBeTruthy();
  });
});

/** The grid: a preset, or a step and a major spacing typed in. */
describe("the grid", () => {
  it("sets an icon grid from a preset, and offers an em it divides into whole units", () => {
    const { store } = openPanel();
    fireEvent.change(screen.getByLabelText<HTMLSelectElement>("Grid preset"), {
      target: { value: "24" },
    });
    const step = store.editor.document.grid.step;
    expect(step).toBeCloseTo(store.editor.document.info.unitsPerEm / 24, 9);

    if (!Number.isInteger(step)) {
      fireEvent.click(screen.getByRole("button", { name: /^Scale the font to \d+$/ }));
      expect(Number.isInteger(store.editor.document.grid.step)).toBe(true);
      expect(store.editor.document.info.unitsPerEm % 24).toBe(0);
    }
  });

  it("takes a step and a major spacing typed in, and refuses a step of nothing", () => {
    const { store } = openPanel();
    const step = screen.getByLabelText<HTMLInputElement>("Step");
    fireEvent.focus(step);
    fireEvent.change(step, { target: { value: "25" } });
    fireEvent.keyDown(step, { key: "Enter" });
    const major = screen.getByLabelText<HTMLInputElement>("Major every");
    fireEvent.focus(major);
    fireEvent.change(major, { target: { value: "4" } });
    fireEvent.keyDown(major, { key: "Enter" });
    expect(store.editor.document.grid).toEqual({ step: 25, major: 4 });

    fireEvent.focus(step);
    fireEvent.change(step, { target: { value: "0" } });
    fireEvent.keyDown(step, { key: "Enter" });
    expect(store.editor.document.grid).toEqual({ step: 25, major: 4 });
    expect(step.value).toBe("25");
  });
});

/**
 * The line spacing section: numbers that may be left empty.
 *
 * Empty is a value here, not a half-typed one. It means "work it out", and the
 * box shows what that comes to, greyed — so the two things these ask are that
 * the greyed number is there, and that emptying a box sets it back to it.
 */
describe("the line spacing overrides", () => {
  it("shows what an unset metric would come out as", () => {
    openPanel();
    const gap = screen.getByLabelText<HTMLInputElement>("Typo line gap");

    expect(gap.value).toBe("");
    expect(gap.placeholder).toBe("0");
  });

  it("sets an override, and empties back to derived", () => {
    const { store } = openPanel();
    const gap = screen.getByLabelText<HTMLInputElement>("hhea line gap");

    fireEvent.focus(gap);
    fireEvent.change(gap, { target: { value: "120" } });
    fireEvent.keyDown(gap, { key: "Enter" });
    expect(store.editor.document.info.openTypeHheaLineGap).toBe(120);

    fireEvent.focus(gap);
    fireEvent.change(gap, { target: { value: "" } });
    fireEvent.keyDown(gap, { key: "Enter" });
    expect(store.editor.document.info.openTypeHheaLineGap).toBeNull();
  });

  it("refuses a descender above the baseline, and leaves the font alone", () => {
    const { store } = openPanel();
    const descender = screen.getByLabelText<HTMLInputElement>("Typo descender");

    fireEvent.focus(descender);
    fireEvent.change(descender, { target: { value: "200" } });
    fireEvent.keyDown(descender, { key: "Enter" });

    expect(store.editor.document.info.openTypeOS2TypoDescender).toBeNull();
  });

  it("turns the typo metrics flag on and off", () => {
    const { store } = openPanel();
    const flag = screen.getByLabelText<HTMLInputElement>("Use typo metrics");

    fireEvent.click(flag);
    expect(store.editor.document.info.openTypeOS2Selection).toEqual([7]);

    fireEvent.click(flag);
    expect(store.editor.document.info.openTypeOS2Selection).toEqual([]);
  });
});

/**
 * The embedding permissions: a level, and two flags beside it.
 *
 * One level at most, stored as a bit; the flags kept as they are when the level
 * changes, and the level kept as it is when a flag does.
 */
describe("the embedding permissions", () => {
  it("sets the level and the flags without disturbing each other", () => {
    const { store } = openPanel();

    fireEvent.change(screen.getByLabelText<HTMLSelectElement>("Embedding"), {
      target: { value: "Preview and print" },
    });
    expect(store.editor.document.info.openTypeOS2Type).toEqual([2]);

    fireEvent.click(screen.getByLabelText<HTMLInputElement>("No subsetting"));
    expect(store.editor.document.info.openTypeOS2Type).toEqual([2, 8]);

    fireEvent.change(screen.getByLabelText<HTMLSelectElement>("Embedding"), {
      target: { value: "Installable" },
    });
    expect(store.editor.document.info.openTypeOS2Type).toEqual([8]);
  });
});
