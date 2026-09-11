// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { CurveSection } = await import("../src/components/inspector/CurveSection.js");
const { focusedSegmentScales, focusedSegmentStatus } = await import("@typewright/tools");

/**
 * The Tunni controls as numbers: tension, curvature, and the pan between them.
 *
 * The geometry is the kernel's and is tested there. What this section decides
 * is when a number means something — a straight segment has no tension, and a
 * pair of handles that do not point at each other has no proportion anybody
 * could type — and that a slider, which is a drag, is one step of undo from
 * press to release however far it travels.
 */

type Store = ReturnType<typeof freshStore>;

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

/** A store focused on the first segment, in any glyph, whose status is `wanted`. */
function focusedOn(wanted: string): Store {
  const store = freshStore();
  act(() => {
    const document = store.editor.document;
    for (const name of document.glyphOrder) {
      for (const contour of document.glyphs[name]?.contours ?? []) {
        const segments = contour.closed ? contour.nodes.length : contour.nodes.length - 1;
        for (let segmentIndex = 0; segmentIndex < segments; segmentIndex++) {
          store.setCurrentGlyph(name);
          store.setEditor({
            ...store.editor,
            focusedSegment: { contourId: contour.id, segmentIndex },
          });
          if (focusedSegmentStatus(store.editor) === wanted) return;
        }
      }
    }
    throw new Error(`no segment in the starter font is ${wanted}`);
  });
  return store;
}

const input = (label: string) => screen.getByLabelText<HTMLInputElement>(label);

function scales(store: Store): { lambda1: number; lambda2: number } {
  const found = focusedSegmentScales(store.editor);
  if (found === null) throw new Error("no scales");
  return found;
}

describe("a straight segment", () => {
  it("has no tension to type, and says so", () => {
    render(<CurveSection />, focusedOn("flat"));

    expect(input("Tension at the start of the segment").disabled).toBe(true);
    expect(input("Tension at the start of the segment").title).toBe(
      "A straight segment has no tension",
    );
  });
});

describe("a curve", () => {
  it("shows each handle's tension as a percentage", () => {
    const store = focusedOn("ok");
    render(<CurveSection />, store);

    expect(Number(input("Tension at the start of the segment").value)).toBeCloseTo(
      scales(store).lambda1 * 100,
      0,
    );
    expect(Number(input("Tension at the end of the segment").value)).toBeCloseTo(
      scales(store).lambda2 * 100,
      0,
    );
  });

  it("takes a typed tension on one side and leaves the other", () => {
    const store = focusedOn("ok");
    const before = scales(store);
    render(<CurveSection />, store);

    fireEvent.change(input("Tension at the start of the segment"), { target: { value: "60" } });

    expect(scales(store).lambda1).toBeCloseTo(0.6, 3);
    expect(scales(store).lambda2).toBeCloseTo(before.lambda2, 6);
  });
});

describe("the pan", () => {
  it("is one step of undo however far it is dragged", () => {
    const store = focusedOn("ok");
    const before = scales(store);
    render(<CurveSection />, store);
    const slider = input("Pan the curve between its two handles");

    fireEvent.change(slider, { target: { value: "0.2" } });
    fireEvent.change(slider, { target: { value: "0.4" } });
    fireEvent.change(slider, { target: { value: "-0.3" } });
    fireEvent.blur(slider);
    expect(scales(store)).not.toEqual(before);

    act(() => {
      store.undo();
    });
    expect(scales(store).lambda1).toBeCloseTo(before.lambda1, 6);
    expect(scales(store).lambda2).toBeCloseTo(before.lambda2, 6);
  });

  it("goes back to balanced on a double-click", () => {
    const store = focusedOn("ok");
    render(<CurveSection />, store);
    const slider = input("Pan the curve between its two handles");

    fireEvent.change(slider, { target: { value: "0.5" } });
    fireEvent.blur(slider);
    fireEvent.doubleClick(slider);

    expect(scales(store).lambda1).toBeCloseTo(scales(store).lambda2, 6);
  });
});

describe("harmonising", () => {
  it("is not offered with no points selected", () => {
    render(<CurveSection />, focusedOn("ok"));

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Harmonise" }).disabled).toBe(
      true,
    );
  });
});
