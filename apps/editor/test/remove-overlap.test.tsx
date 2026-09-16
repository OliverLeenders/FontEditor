// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { RemoveOverlap } = await import("../src/components/RemoveOverlap.js");
const { contour, counterIds, glyph, node, putGlyph } = await import("@typewright/font-model");
const { selectAllPoints } = await import("@typewright/tools");

/**
 * The button that unions a glyph's contours.
 *
 * Whether the union is right is the geometry kernel's business and is tested
 * there. What is asked here is what the button says about what it did — because
 * "nothing was overlapping" and "these edges cannot be resolved" both look
 * exactly like a button that does nothing, and a silent one of those reads as
 * broken.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ids = counterIds("ro");

/** A square, as a closed contour of four corners. */
const square = (x: number, y: number, size: number) =>
  contour(
    ids.contour(),
    [
      node(ids.node(), { x, y }),
      node(ids.node(), { x: x + size, y }),
      node(ids.node(), { x: x + size, y: y + size }),
      node(ids.node(), { x, y: y + size }),
    ],
    true,
  );

/** A store whose current glyph is two squares, overlapping or apart. */
function withSquares(apart: boolean) {
  const store = freshStore();
  const name = store.editor.currentGlyph;
  const shapes = glyph(name, {
    advance: 600,
    contours: [square(0, 0, 400), square(apart ? 500 : 200, 0, 400)],
  });
  act(() => {
    store.setEditor({ ...store.editor, document: putGlyph(store.editor.document, shapes) });
  });
  return store;
}

const note = (): string => screen.getByRole("status").textContent;

describe("removing overlap", () => {
  it("unions the contours and says where they crossed", () => {
    const store = withSquares(false);
    render(<RemoveOverlap />, store);

    fireEvent.click(screen.getByRole("button", { name: "Remove overlap" }));

    expect(note()).toMatch(/^Removed overlap at \d+ crossings?\.$/);
    expect(store.editor.document.glyphs[store.editor.currentGlyph]?.contours).toHaveLength(1);
  });

  it("says so rather than nothing when there was no overlap", () => {
    const store = withSquares(true);
    render(<RemoveOverlap />, store);

    fireEvent.click(screen.getByRole("button", { name: "Remove overlap" }));

    expect(note()).toBe("Nothing was overlapping.");
    expect(store.editor.document.glyphs[store.editor.currentGlyph]?.contours).toHaveLength(2);
  });

  it("works on the selection when there is one, and says which it looked at", () => {
    const store = withSquares(true);
    act(() => store.applyTool(selectAllPoints(store.editor)));
    render(<RemoveOverlap />, store);

    const button = screen.getByRole("button", { name: "Remove overlap in selection" });
    expect(button.getAttribute("title")).toBe("Replace the selected contours with their outline");

    fireEvent.click(button);
    expect(note()).toBe("Nothing was overlapping in the selection.");
  });

  it("takes the note away again, so the toolbar does not keep an old answer", () => {
    vi.useFakeTimers();
    const store = withSquares(true);
    render(<RemoveOverlap />, store);

    fireEvent.click(screen.getByRole("button", { name: "Remove overlap" }));
    expect(screen.queryByRole("status")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is not offered while another tab is writing the project", () => {
    const store = freshStore();
    act(() => store.patch({ ownership: "reading" }));
    render(<RemoveOverlap />, store);

    const button = screen.getByRole("button", { name: "Remove overlap" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("title")).toBe("Another tab is saving this project");
  });
});
