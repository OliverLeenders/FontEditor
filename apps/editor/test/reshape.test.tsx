// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { Reshape } = await import("../src/components/Reshape.js");
const { counterIds, ellipseContour, glyph, insertNodeOnSegment, putGlyph, rectContour } =
  await import("@typewright/font-model");

/**
 * Offset and simplify, as the bar offers them.
 *
 * The geometry is tested where it lives. What is asked here is that the panel
 * writes the numbers it shows into the operation, that simplify needs no dialog to
 * do its job, and that both say what they did — because an outline that was already
 * tidy and a button that is broken look exactly alike otherwise.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

const ids = counterIds("reshape-ui");
const note = (): string => screen.getByRole("status").textContent;

/** A store whose current glyph is one square. */
function withSquare() {
  const store = freshStore();
  const name = store.editor.currentGlyph;
  const shape = glyph(name, {
    advance: 600,
    contours: [rectContour(ids, { minX: 0, minY: 0, maxX: 100, maxY: 100 })],
  });
  act(() => {
    store.setEditor({ ...store.editor, document: putGlyph(store.editor.document, shape) });
  });
  return store;
}

/** A store whose current glyph is a circle with two points too many. */
function withLitter() {
  const store = freshStore();
  const name = store.editor.currentGlyph;
  let circle = ellipseContour(ids, { minX: 0, minY: 0, maxX: 400, maxY: 400 });
  for (const t of [0.35, 0.7]) {
    const next = insertNodeOnSegment(circle, 0, t, ids);
    if (next !== null) circle = next;
  }
  act(() => {
    store.setEditor({
      ...store.editor,
      document: putGlyph(store.editor.document, glyph(name, { advance: 600, contours: [circle] })),
    });
  });
  return store;
}

describe("offsetting from the bar", () => {
  it("offsets by the numbers in the panel", () => {
    const store = withSquare();
    render(<Reshape />, store);

    fireEvent.click(screen.getByRole("button", { name: "Offset" }));
    fireEvent.change(screen.getByLabelText("Horizontal distance"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Vertical distance"), { target: { value: "5" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Offset" })[1]!);

    expect(note()).toBe("Offset 1 outline.");
  });

  it("offers the three ways of turning a corner", () => {
    const store = withSquare();
    render(<Reshape />, store);

    fireEvent.click(screen.getByRole("button", { name: "Offset" }));
    for (const kind of ["Round", "Mitre", "Flat"]) {
      expect(screen.getByRole("radio", { name: kind })).toBeTruthy();
    }
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "Round" }).checked).toBe(true);
  });

  it("says when there is nothing it can offset", () => {
    const store = withSquare();
    render(<Reshape />, store);

    fireEvent.click(screen.getByRole("button", { name: "Offset" }));
    fireEvent.change(screen.getByLabelText("Horizontal distance"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Vertical distance"), { target: { value: "0" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Offset" })[1]!);

    expect(note()).toBe("Nothing here can be offset.");
  });
});

describe("simplifying from the bar", () => {
  it("takes out the points the outline does not need", () => {
    const store = withLitter();
    render(<Reshape />, store);
    const before =
      store.editor.document.glyphs[store.editor.currentGlyph]!.contours[0]!.nodes.length;

    fireEvent.click(screen.getByRole("button", { name: "Simplify" }));

    expect(note()).toBe("Took out 2 points.");
    const after = store.editor.document.glyphs[store.editor.currentGlyph]!.contours[0]!.nodes;
    expect(after).toHaveLength(before - 2);
  });

  it("says so for an outline with nothing to spare", () => {
    const store = withSquare();
    render(<Reshape />, store);

    fireEvent.click(screen.getByRole("button", { name: "Simplify" }));

    expect(note()).toBe("The outline is already tidy.");
  });

  it("needs no dialog to do it", () => {
    const store = withLitter();
    render(<Reshape />, store);
    // One press, no panel: the tolerance is stated on the button rather than asked
    // for, because nobody has an opinion about a thousandth of an em.
    const button = screen.getByRole<HTMLButtonElement>("button", { name: "Simplify" });
    expect(button.title).toMatch(/add the extremes it lacks$/);
  });
});
