import { beforeEach, describe, expect, it } from "vitest";

import { clearStoredSettings, installBrowserGlobals } from "./browser-globals.js";

installBrowserGlobals();

const { MAX_OUTLINE_WIDTH, MIN_PROOF_SIZE } = await import("../src/limits.js");
const {
  DEFAULT_PLACEMENT,
  DEFAULT_PREFERENCES,
  DEFAULT_SPLIT,
  DEFAULT_VIEW,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  loadPreferences,
  savePreferences,
} = await import("../src/preferences.js");
const { EditorStore } = await import("../src/store/index.js");

describe("reading preferences", () => {
  beforeEach(() => {
    clearStoredSettings();
  });

  it("gives the defaults when nothing has been stored", () => {
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("reads back what was written", () => {
    savePreferences({
      ...DEFAULT_PREFERENCES,
      theme: "dark",
      views: [{ ...DEFAULT_VIEW, outlineWidth: 3.5 }, DEFAULT_VIEW],
    });
    const read = loadPreferences();
    expect(read.theme).toBe("dark");
    expect(read.views[0].outlineWidth).toBe(3.5);
    expect(read.views[1].outlineWidth).toBe(DEFAULT_VIEW.outlineWidth);
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
    expect(read.views[0].outlineWidth).toBe(DEFAULT_VIEW.outlineWidth);
    expect(read.views[0].snapPoints).toBe(false);
  });

  it("keeps how big each canvas draws its points", () => {
    savePreferences({
      ...DEFAULT_PREFERENCES,
      views: [{ ...DEFAULT_VIEW, controlSize: "big" }, DEFAULT_VIEW],
    });
    const read = loadPreferences();

    expect(read.views[0].controlSize).toBe("big");
    expect(read.views[1].controlSize).toBe("normal");
  });

  it("drops a size that is not one of the three", () => {
    localStorage.setItem(
      "typewright.preferences",
      JSON.stringify({ views: [{ controlSize: "enormous" }, {}] }),
    );
    expect(loadPreferences().views[0].controlSize).toBe(DEFAULT_VIEW.controlSize);
  });

  it("keeps the features a line was last set with", () => {
    savePreferences({
      ...DEFAULT_PREFERENCES,
      proofTextSettings: { ...DEFAULT_PREFERENCES.proofTextSettings, features: { ss01: true } },
    });
    expect(loadPreferences().proofTextSettings.features).toEqual({ ss01: true });
  });

  it("drops a switched feature that is not one", () => {
    // A hand-edited entry, or one from a version that wrote something else
    // here. A tag is four characters and a switch is on or off.
    localStorage.setItem(
      "typewright.preferences",
      JSON.stringify({
        proofTextSettings: { features: { ss01: true, toolong: true, calt: "off" } },
      }),
    );
    expect(loadPreferences().proofTextSettings.features).toEqual({ ss01: true });
  });

  it("hands what one window was set to to both panes", () => {
    // Written before the canvas settings were per pane, when there was one set
    // of them for the window. Somebody who chose a heavier outline meant it,
    // and meant it for whatever they were looking at.
    localStorage.setItem(
      "typewright.preferences",
      JSON.stringify({ outlineWidth: 3, showCurvature: true }),
    );
    const read = loadPreferences();
    expect(read.views[0]).toEqual({ ...DEFAULT_VIEW, outlineWidth: 3, showCurvature: true });
    expect(read.views[1]).toEqual(read.views[0]);
  });

  it("gives each pane its own settings once they have been set apart", () => {
    localStorage.setItem(
      "typewright.preferences",
      JSON.stringify({ views: [{ showCurvature: true }, { outlineWidth: 4 }] }),
    );
    const read = loadPreferences();
    expect(read.views[0].showCurvature).toBe(true);
    expect(read.views[1].showCurvature).toBe(false);
    expect(read.views[1].outlineWidth).toBe(4);
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
    expect(read.views[0].outlineWidth).toBe(MAX_OUTLINE_WIDTH);
    expect(read.proofSize).toBe(MIN_PROOF_SIZE);
  });

  it("reads a split it can make sense of, and defaults what it cannot", () => {
    // A divider dragged past where this version allows would leave a pane too
    // narrow to find; a shape it has never heard of is no shape at all.
    localStorage.setItem(
      "typewright.preferences",
      JSON.stringify({ split: { orientation: "diagonal", ratio: 0.05 } }),
    );
    expect(loadPreferences().split).toEqual({
      orientation: DEFAULT_SPLIT.orientation,
      ratio: MIN_SPLIT_RATIO,
    });
  });

  it("adopts what was saved before the editor was named", () => {
    localStorage.setItem(
      "fonteditor.preferences",
      JSON.stringify({ theme: "dark", outlineWidth: 3.5 }),
    );
    const read = loadPreferences();
    expect(read.theme).toBe("dark");
    expect(read.views[0].outlineWidth).toBe(3.5);
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
    expect(second.getState().views[0].outlineWidth).toBe(4);
    expect(second.getState().views[0].snapPoints).toBe(first.getState().views[0].snapPoints);
  });

  it("remembers the two panes apart", () => {
    const first = new EditorStore();
    first.setOutlineWidth(4, 0);
    first.toggleCurvature(1);

    const second = new EditorStore();
    expect(second.getState().views[0].outlineWidth).toBe(4);
    expect(second.getState().views[1].outlineWidth).toBe(DEFAULT_VIEW.outlineWidth);
    expect(second.getState().views[1].showCurvature).toBe(true);
    expect(second.getState().views[0].showCurvature).toBe(false);
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
    expect(store.getState().views[0].outlineWidth).toBe(DEFAULT_VIEW.outlineWidth);
    expect(new EditorStore().getState().views[0].outlineWidth).toBe(DEFAULT_VIEW.outlineWidth);
  });

  it("resets one pane's canvas and leaves the other alone", () => {
    const store = new EditorStore();
    store.setOutlineWidth(5, 0);
    store.setOutlineWidth(4, 1);
    store.resetView(0);

    expect(store.getState().views[0].outlineWidth).toBe(DEFAULT_VIEW.outlineWidth);
    expect(store.getState().views[1].outlineWidth).toBe(4);
  });

  it("keeps the inspector where it was put", () => {
    const first = new EditorStore();
    first.moveInspector(200, 150);
    const placed = first.getState().inspector;

    expect(new EditorStore().getState().inspector).toEqual(placed);
  });

  it("remembers how the window is split, inside the divider's limits", () => {
    const first = new EditorStore();
    first.placeSplit({ orientation: "column" });
    first.placeSplit({ ratio: 0.95 });

    expect(new EditorStore().getState().split).toEqual({
      orientation: "column",
      ratio: MAX_SPLIT_RATIO,
    });
  });

  it("remembers the size the feature source is set at, inside its limits", () => {
    const first = new EditorStore();
    first.setFeatureSize(18);
    expect(new EditorStore().getState().featureSize).toBe(18);

    first.setFeatureSize(400);
    expect(new EditorStore().getState().featureSize).toBe(32);
  });

  it("ignores a divider position that is not a number", () => {
    // jsdom, or a pane measured before it had a size, reports 0 / 0.
    const store = new EditorStore();
    store.placeSplit({ ratio: Number.NaN });

    expect(store.getState().split).toEqual(DEFAULT_SPLIT);
  });
});
