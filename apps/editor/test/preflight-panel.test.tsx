// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { Preflight } = await import("../src/components/Preflight.js");
const { contour, node, addContour, putGlyph } = await import("@fonteditor/font-model");
const { vec } = await import("@fonteditor/geometry");

/**
 * The report, on screen.
 *
 * The checks themselves are tested where they live. What this asks is the part
 * only the panel can answer: that a finding is shown with something a person
 * can read, and that clicking it puts you in front of the thing it is about —
 * which is the whole reason the report is in the editor rather than in a log.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

/** A store whose `h` has a contour left open, which is a finding. */
function withAnOpenContour() {
  const store = freshStore();
  const editor = store.editor;

  const open = contour("test-c", [node("test-n1", vec(0, 0)), node("test-n2", vec(100, 0))], false);
  const before = editor.document.glyphs["h"];
  if (before === undefined) throw new Error("the starter font has no h");

  store.setEditor({
    ...editor,
    document: putGlyph(editor.document, addContour(before, open)),
  });
  return store;
}

const openPanel = (store = freshStore()) => {
  const shown = render(<Preflight />, store);
  fireEvent.click(screen.getByRole("button", { name: "Check font" }));
  return shown;
};

describe("the check panel", () => {
  it("says nothing is wrong with the font it opens with", () => {
    openPanel();
    expect(screen.getByText(/Nothing found\. Which is not the same as nothing wrong/)).toBeTruthy();
  });

  it("counts what it found, worst first", () => {
    openPanel(withAnOpenContour());

    // One warning, and the heading says so before anything is read.
    expect(screen.getByText(/1 warning/)).toBeTruthy();
    expect(screen.getByText("Contour left open")).toBeTruthy();
  });

  it("says which glyph, and what is wrong with it", () => {
    openPanel(withAnOpenContour());
    expect(screen.getByText(/h · A contour that does not close/)).toBeTruthy();
  });

  it("opens the glyph a finding is about, with the point selected", () => {
    const store = withAnOpenContour();
    openPanel(store);
    // Somewhere else entirely, so the click has to move.
    act(() => {
      store.setCurrentGlyph("o");
    });

    fireEvent.click(screen.getByText("Contour left open"));

    expect(store.editor.currentGlyph).toBe("h");
    // And selected, so the next arrow key moves the thing the report named.
    expect(store.editor.selection).toEqual([
      { contourId: "test-c", nodeId: "test-n1", part: "point" },
    ]);
  });

  it("has nothing to click on a finding about the font as a whole", () => {
    const store = freshStore();
    // No .notdef is a note about the font rather than about any glyph.
    act(() => {
      const { document } = store.editor;
      const without = document.glyphOrder.filter((name) => name !== ".notdef");
      store.setEditor({
        ...store.editor,
        document: {
          ...document,
          glyphOrder: without,
          glyphs: Object.fromEntries(without.map((name) => [name, document.glyphs[name]!])),
        },
      });
    });
    openPanel(store);

    const found = screen.getByText("No .notdef").closest("button");
    expect(found?.disabled).toBe(true);
  });

  it("explains a check when you rest on it", () => {
    openPanel(withAnOpenContour());
    const row = screen.getByText("Contour left open").closest("button");

    // The reason lives with the check rather than in the list, so the panel
    // stays a list and the explanation is there when it is wanted.
    expect(row?.title).toMatch(/fill closed paths only/);
  });

  it("keeps up with the font as it is edited", () => {
    const store = withAnOpenContour();
    openPanel(store);
    expect(screen.getByText(/1 warning/)).toBeTruthy();

    // Closing the contour is the fix the report was asking for, and the report
    // is a reading of the font as it stands rather than of the font as it was
    // when the panel opened.
    act(() => {
      const editor = store.editor;
      const h = editor.document.glyphs["h"]!;
      const closed = h.contours.map((c) => (c.id === "test-c" ? { ...c, closed: true } : c));
      store.setEditor({
        ...editor,
        document: putGlyph(editor.document, { ...h, contours: closed }),
      });
    });

    expect(screen.queryByText("Contour left open")).toBeNull();
    expect(screen.getByText(/Nothing found\. Which is not the same as nothing wrong/)).toBeTruthy();
  });
});
