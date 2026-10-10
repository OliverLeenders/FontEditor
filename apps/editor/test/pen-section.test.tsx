// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
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

  it("keeps what is typed when the points differ in another number", () => {
    // Different widths, the same angle. Every keystroke goes in as it is typed,
    // and the widths still differ after the angle has changed: a field reading the
    // whole pen as mixed emptied itself after the first digit and lost the rest.
    const store = opened(withPath());
    fireEvent.click(screen.getByRole("button", { name: "Stroke" }));
    fireEvent.change(screen.getByLabelText("Pen width"), { target: { value: "60" } });
    selectAll(store);

    expect(screen.getByLabelText<HTMLInputElement>("Pen angle").value).toBe("30");
    const angle = screen.getByLabelText<HTMLInputElement>("Pen angle");
    fireEvent.focus(angle);
    fireEvent.change(angle, { target: { value: "4" } });
    expect(angle.value).toBe("4");
    fireEvent.change(angle, { target: { value: "45" } });

    expect(pointPens(store).map((p) => p?.angle ?? pen(store)!.angle)).toEqual([45, 45]);
    expect(screen.getByLabelText<HTMLInputElement>("Pen width").placeholder).toBe("—");
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

describe("the pen's blends", () => {
  it("offers them at the start of a segment of a stroke, and sets the one pressed", () => {
    const store = opened(withPath());
    expect(screen.queryByRole("group", { name: "Shape blend" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stroke" }));

    const shape = within(screen.getByRole("group", { name: "Shape blend" }));
    expect(shape.getByRole("button", { name: "Linear" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(shape.getByRole("button", { name: "Smooth" }));

    expect(path(store).nodes[0]!.blend).toEqual({ angle: "linear", shape: "smooth" });
    expect(shape.getByRole("button", { name: "Smooth" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("how a stroke ends", () => {
  /** The same path as a stroke, with its last point selected: the foot of a stem. */
  function atItsEnd(): Store {
    const store = opened(withPath());
    fireEvent.click(screen.getByRole("button", { name: "Stroke" }));
    return store;
  }

  it("is offered at an end of an open stroke, as the pen leaves it until set", () => {
    opened(withPath());
    // An outline has no ends to cut.
    expect(screen.queryByRole("group", { name: "End" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stroke" }));

    const end = within(screen.getByRole("group", { name: "End" }));
    expect(end.getByRole("button", { name: "Pen" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByLabelText("Cut angle")).toBeNull();
  });

  it("cuts the end level, shows the angle, and takes another typed over it", () => {
    const store = atItsEnd();
    const end = within(screen.getByRole("group", { name: "End" }));

    fireEvent.click(end.getByRole("button", { name: "Level" }));
    expect(path(store).nodes[0]!.end).toEqual({ cut: 0 });
    expect(end.getByRole("button", { name: "Level" }).getAttribute("aria-pressed")).toBe("true");

    const angle = screen.getByLabelText("Cut angle");
    fireEvent.change(angle, { target: { value: "12" } });
    fireEvent.blur(angle);
    expect(path(store).nodes[0]!.end).toEqual({ cut: 12 });
    // Neither level nor upright now, and not the pen's either.
    expect(end.getByRole("button", { name: "Level" }).getAttribute("aria-pressed")).toBe("false");
    expect(end.getByRole("button", { name: "Pen" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("is switched off again by Pen, and the angle goes with it", () => {
    const store = atItsEnd();
    const end = within(screen.getByRole("group", { name: "End" }));

    fireEvent.click(end.getByRole("button", { name: "Square" }));
    expect(path(store).nodes[0]!.end).toEqual({ cut: "square" });
    expect(screen.queryByLabelText("Cut angle")).toBeNull();

    fireEvent.click(end.getByRole("button", { name: "Pen" }));
    expect(path(store).nodes[0]!.end).toBeUndefined();
  });
});

describe("a pen's squareness", () => {
  it("is offered for a pen with thickness, and not for a broad edge", () => {
    opened(withPath());
    fireEvent.click(screen.getByRole("button", { name: "Stroke" }));
    // The pen a stroke starts with is a broad edge: a line has no corners.
    expect(screen.queryByLabelText("Pen squareness")).toBeNull();

    const thickness = screen.getByLabelText("Pen thickness");
    fireEvent.change(thickness, { target: { value: "20" } });
    fireEvent.blur(thickness);
    expect(screen.getByLabelText("Pen squareness")).toBeTruthy();
  });

  it("is typed as a percentage of the way from an oval to a rectangle", () => {
    const store = opened(withPath());
    fireEvent.click(screen.getByRole("button", { name: "Stroke" }));
    selectAll(store);
    const thickness = screen.getByLabelText("Pen thickness");
    fireEvent.change(thickness, { target: { value: "20" } });
    fireEvent.blur(thickness);

    const squareness = screen.getByLabelText("Pen squareness");
    fireEvent.change(squareness, { target: { value: "60" } });
    fireEvent.blur(squareness);
    expect(pen(store)?.squareness).toBeCloseTo(0.6, 9);
  });

  it("is dragged with the slider beside it, all of one drag being one step to undo", () => {
    const store = opened(withPath());
    fireEvent.click(screen.getByRole("button", { name: "Stroke" }));
    selectAll(store);
    const thickness = screen.getByLabelText("Pen thickness");
    fireEvent.change(thickness, { target: { value: "20" } });
    fireEvent.blur(thickness);

    const slider = screen.getByLabelText("Pen squareness, from oval to rectangle");
    fireEvent.change(slider, { target: { value: "30" } });
    fireEvent.change(slider, { target: { value: "55" } });
    fireEvent.change(slider, { target: { value: "80" } });
    fireEvent.pointerUp(slider);
    expect(pen(store)?.squareness).toBeCloseTo(0.8, 9);

    act(() => store.undo());
    expect(pen(store)?.squareness ?? 0).toBe(0);
  });
});
