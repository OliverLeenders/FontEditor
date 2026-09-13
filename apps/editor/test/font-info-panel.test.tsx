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
    const em = screen.getByLabelText<HTMLInputElement>("Units per em");

    fireEvent.focus(em);
    fireEvent.change(em, { target: { value: "2048" } });
    fireEvent.blur(em);

    expect(store.editor.document.info.unitsPerEm).toBe(2048);
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
    const em = screen.getByLabelText<HTMLInputElement>("Units per em");
    const before = store.editor.document.info.unitsPerEm;

    fireEvent.focus(em);
    fireEvent.change(em, { target: { value: "2048" } });
    fireEvent.blur(em);
    // Outside React's own events, so the flush has to be asked for.
    act(() => {
      store.undo();
    });

    expect(screen.getByLabelText<HTMLInputElement>("Units per em").value).toBe(String(before));
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
