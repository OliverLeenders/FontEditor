// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { FeaturesView } = await import("../src/components/FeaturesView.js");

/**
 * Writing feature source in the Features workspace.
 *
 * What is asked is what somebody typing a feature file would notice: that Tab
 * indents instead of leaving, and can still be made to leave; that Enter and `}`
 * keep the indentation where it belongs; that the file is coloured; and that a
 * problem the compiler reports can be found, by its mark beside the line and by
 * pressing it in the list.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

type Store = ReturnType<typeof freshStore>;

/** The workspace on a file, with the cursor or a selection placed in it. */
function open(
  text: string,
  start: number,
  end = start,
): { store: Store; box: HTMLTextAreaElement } {
  const store = freshStore();
  store.setFeatures(text);
  render(<FeaturesView />, store);
  const box = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Feature source" });
  box.focus();
  box.setSelectionRange(start, end);
  return { store, box };
}

const features = (store: Store): string => store.editor.document.features;

describe("typing feature source", () => {
  it("indents with four spaces on Tab, and keeps the key", () => {
    const { store, box } = open("sub a by b;", 0);

    // `false` is a key whose default action was stopped: focus did not move on.
    expect(fireEvent.keyDown(box, { key: "Tab" })).toBe(false);

    expect(features(store)).toBe("    sub a by b;");
    expect(box.selectionStart).toBe(4);
  });

  it("takes a level off every selected line on Shift+Tab", () => {
    const { store, box } = open("    one\n    two", 0, 15);

    fireEvent.keyDown(box, { key: "Tab", shiftKey: true });

    expect(features(store)).toBe("one\ntwo");
  });

  it("lets Tab leave after Escape, so the source is not a trap", () => {
    const { store, box } = open("x", 0);

    fireEvent.keyDown(box, { key: "Escape" });

    expect(fireEvent.keyDown(box, { key: "Tab" })).toBe(true);
    expect(features(store)).toBe("x");
  });

  it("keeps the indentation on Enter, a level deeper after a brace", () => {
    const { store, box } = open("feature liga {", 14);

    fireEvent.keyDown(box, { key: "Enter" });

    expect(features(store)).toBe("feature liga {\n    ");
    expect(box.selectionStart).toBe(19);
  });

  it("puts a closing brace back a level", () => {
    const { store, box } = open("feature liga {\n    ", 19);

    fireEvent.keyDown(box, { key: "}" });

    expect(features(store)).toBe("feature liga {\n}");
  });

  it("colours the file", () => {
    open("feature liga {\n    sub f i by fi; # ligatures\n} liga;", 0);

    const kinds = [...document.querySelectorAll("[data-kind]")].map(
      (piece) => `${piece.getAttribute("data-kind") ?? ""}:${piece.textContent}`,
    );
    expect(kinds).toContain("keyword:feature");
    expect(kinds).toContain("tag:liga");
    expect(kinds).toContain("glyph:fi");
    expect(kinds).toContain("comment:#·ligatures");
  });

  it("shows each space as a dot of its own width", () => {
    open("feature liga {\n    sub f i by fi;\n} liga;", 0);

    const spaces = [...document.querySelectorAll("[data-kind='space']")].map(
      (piece) => piece.textContent,
    );
    expect(spaces).toContain("····");
    expect(spaces).toContain("·");
  });

  it("sets the text larger and smaller with ctrl and the wheel, and remembers it", () => {
    const { store, box } = open("sub a by b;", 0);
    const editor = box.closest<HTMLElement>("[style]");
    if (editor === null) throw new Error("the source has no size of its own");
    const before = store.getState().featureSize;

    // `false`: the page did not zoom as well.
    expect(fireEvent.wheel(box, { deltaY: -100, ctrlKey: true })).toBe(false);
    const larger = store.getState().featureSize;
    expect(larger).toBeGreaterThan(before);
    expect(editor.style.fontSize).toBe(`${String(larger)}px`);

    fireEvent.wheel(box, { deltaY: 100, ctrlKey: true });
    fireEvent.wheel(box, { deltaY: 100, ctrlKey: true });
    expect(store.getState().featureSize).toBeLessThan(before);

    // A plain wheel scrolls the text and leaves the size alone.
    const settled = store.getState().featureSize;
    expect(fireEvent.wheel(box, { deltaY: 100 })).toBe(true);
    expect(store.getState().featureSize).toBe(settled);
  });
});

describe("finding a problem", () => {
  // A pair adjustment is kerning, which this workspace refuses and reports.
  const withProblem = "feature kern {\n    pos n o -10;\n} kern;";

  it("numbers every line, and marks the lines with problems", () => {
    open(withProblem, 0);

    const marked = [...document.querySelectorAll("[data-problem]")].map((line) => line.textContent);
    expect(marked).toContain("2");
    expect(marked).not.toContain("1");
  });

  it("puts the cursor on the problem's line when the problem is pressed", () => {
    const { box } = open(withProblem, 0);
    const list = screen.getByRole("complementary", { name: "What the features compile to" });
    const problem = within(list)
      .getAllByRole("button")
      .find((button) => button.textContent.startsWith("2"));
    if (problem === undefined) throw new Error("no problem was reported on line 2");

    fireEvent.click(problem);

    expect(document.activeElement).toBe(box);
    expect(box.selectionStart).toBe("feature kern {\n".length);
    expect(box.selectionEnd).toBe("feature kern {\n    pos n o -10;".length);
  });
});

describe("the Marks file", () => {
  // The starter font has no anchors, so the file typed here makes some: `e`
  // attaches by a `_top`, and `o` offers a `top` for it.
  const TYPED = [
    "markClass e <anchor 0 500> @MC_top;",
    "feature mark {",
    "    pos base o <anchor 250 480> mark @MC_top;",
    "} mark;",
  ].join("\n");

  function openMarks(): { store: Store; box: HTMLTextAreaElement } {
    const store = freshStore();
    render(<FeaturesView />, store);
    fireEvent.click(screen.getByRole("tab", { name: "Marks" }));
    const box = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Marks source" });
    return { store, box };
  }

  const anchorsOf = (store: Store, name: string): string[] =>
    (store.editor.document.glyphs[name]?.anchors ?? []).map(
      (a) => `${a.name} ${String(a.pt.x)} ${String(a.pt.y)}`,
    );

  it("is written from the anchors of the master being edited", () => {
    const { box } = openMarks();
    expect(box.value).toContain("# Marks, from the anchors of Regular.");
  });

  it("puts what is typed into the anchors, as a step undo takes back", () => {
    const { store, box } = openMarks();

    fireEvent.change(box, { target: { value: TYPED } });

    expect(anchorsOf(store, "e")).toEqual(["_top 0 500"]);
    expect(anchorsOf(store, "o")).toEqual(["top 250 480"]);
    // What was typed stays as it was typed, rather than being rewritten under the caret.
    expect(box.value).toBe(TYPED);

    act(() => store.undo());

    expect(anchorsOf(store, "o")).toEqual([]);
    // The anchors changed somewhere other than the file, so it is written from them again.
    expect(box.value).not.toContain("pos base o");
  });

  it("changes no anchor while the file has a problem, and says where it is", () => {
    const { store, box } = openMarks();

    fireEvent.change(box, { target: { value: TYPED.replace("pos base o", "pos base nothing") } });

    expect(anchorsOf(store, "e")).toEqual([]);
    const side = screen.getByRole("complementary", { name: "What the marks say" });
    expect(side.textContent).toContain("there is no glyph named nothing");
    expect(box.value).toContain("pos base nothing");
  });

  it("is written again from the anchors when it is left and opened again", () => {
    const { box } = openMarks();
    fireEvent.change(box, { target: { value: `${TYPED}\n# a note` } });

    fireEvent.click(screen.getByRole("tab", { name: "Features" }));
    fireEvent.click(screen.getByRole("tab", { name: "Marks" }));

    const again = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Marks source" });
    expect(again.value).not.toContain("# a note");
    expect(again.value).toContain("pos base o <anchor 250 480> mark @MC_top;");
  });
});
