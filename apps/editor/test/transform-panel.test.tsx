// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { TransformPanel } = await import("../src/components/TransformPanel.js");

/**
 * Moving, scaling, turning and leaning the selection by a typed number.
 *
 * The transforms themselves are tested in tools. What this panel adds is the
 * rule that every field is a verb: a number applies once, on Enter, and the
 * field goes back to meaning nothing — while a number clicked away from, or
 * abandoned with Escape, is a change of mind and does nothing at all.
 */

type Store = ReturnType<typeof freshStore>;

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

/** The store on a glyph that has outlines, with every point of them selected. */
function selectingAll(): Store {
  const store = freshStore();
  act(() => {
    const name = store.editor.document.glyphOrder.find(
      (n) => (store.editor.document.glyphs[n]?.contours.length ?? 0) > 0,
    );
    if (name === undefined) throw new Error("the starter font has no outlines");
    store.setCurrentGlyph(name);

    const glyph = store.editor.document.glyphs[name];
    store.setEditor({
      ...store.editor,
      selection: (glyph?.contours ?? []).flatMap((c) =>
        c.nodes.map((n) => ({ contourId: c.id, nodeId: n.id, part: "point" as const })),
      ),
    });
  });
  return store;
}

/** The box round the current glyph's on-curve points. */
function bounds(store: Store): { minX: number; maxX: number; minY: number; maxY: number } {
  const glyph = store.editor.document.glyphs[store.editor.currentGlyph];
  const points = (glyph?.contours ?? []).flatMap((c) => c.nodes.map((n) => n.pt));
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

const field = (label: string) => screen.getByLabelText<HTMLInputElement>(label);

function type(label: string, value: string, key?: "Enter" | "Escape"): void {
  fireEvent.change(field(label), { target: { value } });
  if (key !== undefined) fireEvent.keyDown(field(label), { key });
}

describe("with nothing selected", () => {
  it("offers nothing to act on", () => {
    render(<TransformPanel />);

    expect(field("Scale x %").disabled).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Flip horizontally" }).disabled,
    ).toBe(true);
    expect(screen.getByText("Transform")).toBeTruthy();
  });
});

describe("a typed number", () => {
  it("says how much is selected", () => {
    const store = selectingAll();
    render(<TransformPanel />, store);

    expect(
      screen.getByText(`Transform · ${String(store.editor.selection.length)} selected`),
    ).toBeTruthy();
  });

  it("applies once on Enter, and the field goes back to its neutral value", () => {
    const store = selectingAll();
    const before = bounds(store);
    render(<TransformPanel />, store);

    type("Scale x %", "50", "Enter");

    const after = bounds(store);
    expect(after.maxX - after.minX).toBeCloseTo((before.maxX - before.minX) / 2, 3);
    // About the middle of the selection, which is where the panel starts.
    expect((after.maxX + after.minX) / 2).toBeCloseTo((before.maxX + before.minX) / 2, 3);
    expect(field("Scale x %").value).toBe("100");
  });

  it("moves by the amount typed", () => {
    const store = selectingAll();
    const before = bounds(store);
    render(<TransformPanel />, store);

    type("Move x", "25", "Enter");

    expect(bounds(store).minX).toBeCloseTo(before.minX + 25, 3);
    expect(bounds(store).minY).toBeCloseTo(before.minY, 3);
  });

  it("is not applied when clicked away from", () => {
    const store = selectingAll();
    const before = bounds(store);
    render(<TransformPanel />, store);

    type("Scale x %", "50");
    fireEvent.blur(field("Scale x %"));

    expect(bounds(store)).toEqual(before);
    expect(field("Scale x %").value).toBe("100");
  });

  it("is abandoned by Escape", () => {
    const store = selectingAll();
    const before = bounds(store);
    render(<TransformPanel />, store);

    type("Scale x %", "50", "Escape");

    expect(bounds(store)).toEqual(before);
    expect(field("Scale x %").value).toBe("100");
  });

  it("does nothing when it is the neutral value, or not a number at all", () => {
    const store = selectingAll();
    const before = bounds(store);
    render(<TransformPanel />, store);

    type("Scale x %", "100", "Enter");
    type("Move x", "-", "Enter");

    expect(bounds(store)).toEqual(before);
  });

  it("is one step of undo", () => {
    const store = selectingAll();
    const before = bounds(store);
    render(<TransformPanel />, store);

    type("Rotate °", "15", "Enter");
    expect(bounds(store)).not.toEqual(before);

    act(() => {
      store.undo();
    });
    const back = bounds(store);
    expect(back.minX).toBeCloseTo(before.minX, 3);
    expect(back.maxY).toBeCloseTo(before.maxY, 3);
  });
});

describe("where it turns", () => {
  it("is the chosen point of the box", () => {
    const store = selectingAll();
    const before = bounds(store);
    render(<TransformPanel />, store);

    const corner = screen.getByRole("button", { name: "About the bottom left of the selection" });
    fireEvent.click(corner);
    expect(corner.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Flip horizontally" }));

    // Flipped about the left edge: what was the left edge is now the right.
    const after = bounds(store);
    expect(after.maxX).toBeCloseTo(before.minX, 3);
    expect(after.minX).toBeCloseTo(before.minX - (before.maxX - before.minX), 3);
  });

  it("can be the glyph's origin or the baseline, and only one place at once", () => {
    render(<TransformPanel />, selectingAll());

    fireEvent.click(screen.getByRole("button", { name: /Origin/ }));
    expect(screen.getByRole("button", { name: /Origin/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      screen
        .getByRole("button", { name: "About the middle centre of the selection" })
        .getAttribute("aria-pressed"),
    ).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /Baseline/ }));
    expect(screen.getByRole("button", { name: /Origin/ }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });
});
