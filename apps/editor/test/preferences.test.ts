import { beforeEach, describe, expect, it } from "vitest";

import { clearStoredSettings, installBrowserGlobals } from "./browser-globals.js";

installBrowserGlobals();

const { MAX_OUTLINE_WIDTH, MIN_PROOF_SIZE } = await import("../src/limits.js");
const { DEFAULT_PLACEMENT, DEFAULT_PREFERENCES, loadPreferences, savePreferences } =
  await import("../src/preferences.js");
const { EditorStore } = await import("../src/store/index.js");

describe("reading preferences", () => {
  beforeEach(() => {
    clearStoredSettings();
  });

  it("gives the defaults when nothing has been stored", () => {
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("reads back what was written", () => {
    savePreferences({ ...DEFAULT_PREFERENCES, theme: "dark", outlineWidth: 3.5 });
    const read = loadPreferences();
    expect(read.theme).toBe("dark");
    expect(read.outlineWidth).toBe(3.5);
  });

  it("survives a storage entry that is not JSON", () => {
    localStorage.setItem("typewright.preferences", "{ not json");
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("survives one that is JSON but not an object", () => {
    localStorage.setItem("typewright.preferences", "42");
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps the fields it understands and defaults the rest", () => {
    // What an older version wrote, or a hand-edited entry. One bad field must
    // not take the others down with it.
    localStorage.setItem(
      "typewright.preferences",
      JSON.stringify({ theme: "light", outlineWidth: "thick", snapPoints: false }),
    );
    const read = loadPreferences();
    expect(read.theme).toBe("light");
    expect(read.outlineWidth).toBe(DEFAULT_PREFERENCES.outlineWidth);
    expect(read.snapPoints).toBe(false);
  });

  it("refuses a theme it does not have", () => {
    localStorage.setItem("typewright.preferences", JSON.stringify({ theme: "sepia" }));
    expect(loadPreferences().theme).toBe("system");
  });

  it("pulls a stored number inside the range the control offers", () => {
    // A weight from a version whose slider went further would otherwise pin the
    // handle at one end while drawing something else.
    localStorage.setItem(
      "typewright.preferences",
      JSON.stringify({ outlineWidth: 99, proofSize: 1 }),
    );
    const read = loadPreferences();
    expect(read.outlineWidth).toBe(MAX_OUTLINE_WIDTH);
    expect(read.proofSize).toBe(MIN_PROOF_SIZE);
  });

  it("adopts what was saved before the editor was named", () => {
    localStorage.setItem(
      "fonteditor.preferences",
      JSON.stringify({ theme: "dark", outlineWidth: 3.5 }),
    );
    const read = loadPreferences();
    expect(read.theme).toBe("dark");
    expect(read.outlineWidth).toBe(3.5);
  });

  it("prefers what is under the new name when both are there", () => {
    localStorage.setItem("fonteditor.preferences", JSON.stringify({ theme: "dark" }));
    localStorage.setItem("typewright.preferences", JSON.stringify({ theme: "light" }));
    expect(loadPreferences().theme).toBe("light");
  });

  it("adopts an inspector position left by the version before this one", () => {
    localStorage.setItem("fonteditor.inspector", JSON.stringify({ x: 120, y: 90, open: false }));
    const read = loadPreferences();
    expect(read.inspector).toEqual({ ...DEFAULT_PLACEMENT, x: 120, y: 90, open: false });
  });
});

describe("preferences and the store", () => {
  beforeEach(() => {
    clearStoredSettings();
  });

  it("remembers a setting across a reload", () => {
    const first = new EditorStore();
    first.setTheme("dark");
    first.setOutlineWidth(4);
    first.toggleSnapPoints();

    // A second store is what the next visit gets.
    const second = new EditorStore();
    expect(second.getState().theme).toBe("dark");
    expect(second.getState().outlineWidth).toBe(4);
    expect(second.getState().snapPoints).toBe(first.getState().snapPoints);
  });

  it("remembers the type sizes the two workspaces are set at", () => {
    const first = new EditorStore();
    first.setSpacingSize(200);
    first.setProofSize(64);

    const second = new EditorStore();
    expect(second.getState().spacingSize).toBe(200);
    expect(second.getState().proofSize).toBe(64);
  });

  it("does not remember the text being worked on", () => {
    // Content, not a setting: a proof that reopens holding yesterday's paragraph
    // has stopped being the one you just typed.
    const first = new EditorStore();
    first.setProofText("something else entirely");
    expect(new EditorStore().getState().proofText).not.toBe("something else entirely");
  });

  it("puts everything back with a reset", () => {
    const store = new EditorStore();
    store.setTheme("light");
    store.setOutlineWidth(5);
    store.resetPreferences();

    expect(store.getState().theme).toBe(DEFAULT_PREFERENCES.theme);
    expect(store.getState().outlineWidth).toBe(DEFAULT_PREFERENCES.outlineWidth);
    expect(new EditorStore().getState().outlineWidth).toBe(DEFAULT_PREFERENCES.outlineWidth);
  });

  it("keeps the inspector where it was put", () => {
    const first = new EditorStore();
    first.moveInspector(200, 150);
    const placed = first.getState().inspector;

    expect(new EditorStore().getState().inspector).toEqual(placed);
  });
});
