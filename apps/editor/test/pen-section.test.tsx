// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { PenSection } = await import("../src/components/inspector/PenSection.js");
const { addContour, contour, counterIds, node, updateGlyph } =
  await import("@typewright/font-model");

/**
 * The Pen section: whether a contour is an outline or a stroke, and its pen.
 *
 * The commands are tested in tools and the ink in the model. What is asked here
 * is that the two buttons write what they say, that the numbers appear only where
 * there is a pen to describe, and that a number typed goes to the pen at the
 * selected points — the stroke's own pen where every point is selected.
 */

type Store = ReturnType<typeof freshStore>;

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

/** A store whose current glyph has one straight path added to it, selected. */
function withPath(): Store {
  const store = freshStore();
  act(() => {
    const ids = counterIds("pen-ui");
    const name = store.editor.document.glyphOrder[0]!;
    const line = contour(ids.contour(), [
      node(ids.node(), { x: 100, y: 0 }),
      node(ids.node(), { x: 100, y: 500 }),
    ]);
    store.setCurrentGlyph(name);
    const document = updateGlyph(store.editor.document, name, (g) => addContour(g, line))!;
    store.setEditor({
      ...store.editor,
      document,
      selection: [{ contourId: line.id, nodeId: line.nodes[0]!.id, part: "point" as const }],
    });
  });
  return store;
}

/** The path the test added, which is the glyph's last contour. */
const path = (store: Store) => {
  const g = store.editor.document.glyphs[store.editor.currentGlyph]!;
  return g.contours[g.contours.length - 1]!;
};

/** The pen on that path. */
const pen = (store: Store) => path(store).nib;

/** The pens its two points have of their own. */
const pointPens = (store: Store) => path(store).nodes.map((n) => n.pen);

/** Select both points of the path, as selecting the whole stroke does. */
function selectAll(store: Store): void {
  act(() => {
    const c = path(store);
    store.setEditor({
      ...store.editor,
      selection: c.nodes.map((n) => ({ contourId: c.id, nodeId: n.id, part: "point" as const })),
    });
  });
}

/**
 * Open the section the way a person does, by its header.
 *
 * It opens by itself only for a stroke, so as not to take room in the inspector
 * every time an outline is selected; a first stroke is made by opening it.
 */
function opened(store: Store): Store {
  render(<PenSection />, store);
  fireEvent.click(screen.getByRole("button", { name: /^Pen/, expanded: false }));
  return store;
}

describe("the pen section", () => {
  it("stays folded for an outline until it is opened", () => {
    render(<PenSection />, withPath());
    expect(screen.getByRole("button", { name: /^Pen/ }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("shows an outline as an outline, with no numbers", () => {
    opened(withPath());

    expect(screen.getByRole("button", { name: "Outline" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.queryByLabelText("Pen angle")).toBeNull();
  });

  it("puts a pen on the selected contour", () => {
    const store = opened(withPath());

    fireEvent.click(screen.getByRole("button", { name: "Stroke" }));

    expect(pen(store)).toEqual({ angle: 30, width: 80 });
    expect(screen.getByRole("button", { name: "Stroke" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("writes what is typed to the pen at the selected point", () => {
    // One end selected: the pen changes there and blends along to the other end,
    // which keeps the stroke's pen.
    const store = opened(withPath());
    fireEvent.click(screen.getByRole("button", { name: "Stroke" }));

    fireEvent.change(screen.getByLabelText("Pen angle"), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText("Pen width"), { target: { value: "60" } });

    expect(pen(store)).toEqual({ angle: 30, width: 80 });
    expect(pointPens(store)).toEqual([{ angle: 45, width: 60 }, undefined]);
    expect(screen.getByLabelText<HTMLInputElement>("Pen width").value).toBe("60");
  });

  it("changes the stroke's own pen when every point is selected", () => {
    const store = opened(withPath());
    fireEvent.click(screen.getByRole("button", { name: "Stroke" }));
    selectAll(store);

    fireEvent.change(screen.getByLabelText("Pen width"), { target: { value: "60" } });

    expect(pen(store)).toEqual({ angle: 30, width: 60 });
    expect(pointPens(store)).toEqual([undefined, undefined]);
  });

  it("shows points with different pens as a mixture", () => {
    const store = opened(withPath());
    fireEvent.click(screen.getByRole("button", { name: "Stroke" }));
    fireEvent.change(screen.getByLabelText("Pen width"), { target: { value: "60" } });
    selectAll(store);

    const width = screen.getByLabelText<HTMLInputElement>("Pen width");
    expect(width.value).toBe("");
    expect(width.placeholder).toBe("—");
    // Typed into, the number goes to both, and one pen at both ends is the stroke's.
    fireEvent.change(width, { target: { value: "70" } });
    expect(pen(store)).toEqual({ angle: 30, width: 70 });
  });

  it("makes an oval of the pen when given a thickness", () => {
    const store = opened(withPath());
    fireEvent.click(screen.getByRole("button", { name: "Stroke" }));
    selectAll(store);
    expect(screen.getByLabelText<HTMLInputElement>("Pen thickness").value).toBe("0");

    fireEvent.change(screen.getByLabelText("Pen thickness"), { target: { value: "24" } });

    expect(pen(store)).toEqual({ angle: 30, width: 80, thickness: 24 });
  });

  it("takes the pen away again, leaving the path", () => {
    const store = opened(withPath());
    fireEvent.click(screen.getByRole("button", { name: "Stroke" }));

    fireEvent.click(screen.getByRole("button", { name: "Outline" }));

    expect(pen(store)).toBeUndefined();
  });

  it("says there is nothing selected, and offers nothing", () => {
    const store = withPath();
    act(() => {
      store.setEditor({ ...store.editor, selection: [] });
    });
    render(<PenSection />, store);

    expect(screen.getByRole("button", { name: /nothing selected/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stroke" })).toBeNull();
  });
});
