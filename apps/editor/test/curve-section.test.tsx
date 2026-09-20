// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { CurveSection } = await import("../src/components/inspector/CurveSection.js");
const { focusedSegmentScales, focusedSegmentStatus } = await import("@typewright/tools");
const { addContour, contour, counterIds, node, updateGlyph } =
  await import("@typewright/font-model");

/**
 * The Tunni controls as numbers: tension, curvature, and the pan between them.
 *
 * The geometry is the kernel's and is tested there. What this section decides
 * is when a number means something — a straight segment has no tension, and a
 * pair of handles that do not point at each other has no proportion anybody
 * could type — that a slider, which is a drag, is one step of undo from press
 * to release however far it travels, and that the two controls are independent:
 * tension is how much handle there is, pan is how it is split, and neither
 * moves the other's number.
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

type Point = { x: number; y: number };

/**
 * A store whose current glyph holds one curve of its own, focused on it.
 *
 * The starter font is drawn the way a font should be, with a point at every
 * extreme — which is the wrong shape for testing a button that adds them.
 */
function drawing(from: Point, out: Point, into: Point, to: Point): Store {
  const store = freshStore();
  act(() => {
    const ids = counterIds("curve");
    const name = store.editor.document.glyphOrder[0]!;
    const drawn = contour(
      ids.contour(),
      [node(ids.node(), from, { out }), node(ids.node(), to, { in: into })],
      false,
    );

    store.setCurrentGlyph(name);
    store.setEditor({
      ...store.editor,
      document: updateGlyph(store.editor.document, name, (g) => addContour(g, drawn))!,
      selection: [],
      focusedSegment: { contourId: drawn.id, segmentIndex: 0 },
    });
  });
  return store;
}

/** A bow out to the right and back: an extreme halfway, with no point on it. */
const bow = (): Store =>
  drawing({ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 300 }, { x: 0, y: 300 });

/** A curve leaning one way and then the other: an inflection halfway. */
const ess = (): Store =>
  drawing({ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 0 }, { x: 100, y: 100 });

/** The curve the test drew, which is the last one in the glyph. */
function drawn(store: Store) {
  const contours = store.editor.document.glyphs[store.editor.currentGlyph]!.contours;
  return contours[contours.length - 1]!;
}

const disabled = (name: string): boolean =>
  screen.getByRole("button", { name }).hasAttribute("disabled");

describe("the points a curve turns at", () => {
  it("says how many there are to add, and adds them", () => {
    const store = bow();
    render(<CurveSection />, store);

    fireEvent.click(screen.getByRole("button", { name: "Extremes (1)" }));

    expect(drawn(store).nodes).toHaveLength(3);
    // At the rightmost point of the curve, which is not where the handles are.
    expect(drawn(store).nodes[1]!.pt.x).toBeCloseTo(150, 6);
    // And there is nothing left for the button to offer.
    expect(disabled("Extremes")).toBe(true);
  });

  it("counts the inflections apart, since they are a different question", () => {
    const store = ess();
    render(<CurveSection />, store);

    expect(disabled("Extremes")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Inflections (1)" }));

    expect(drawn(store).nodes).toHaveLength(3);
  });

  it("offers neither on a straight segment", () => {
    render(<CurveSection />, focusedOn("flat"));

    expect(disabled("Extremes")).toBe(true);
    expect(disabled("Inflections")).toBe(true);
  });

  it("is one step of undo, however many points it added", () => {
    const store = bow();
    render(<CurveSection />, store);

    fireEvent.click(screen.getByRole("button", { name: "Extremes (1)" }));
    act(() => {
      store.undo();
    });

    expect(drawn(store).nodes).toHaveLength(2);
  });
});

describe("a straight segment", () => {
  it("has no tension to type, and says so", () => {
    render(<CurveSection />, focusedOn("flat"));

    expect(input("Tension of the segment").disabled).toBe(true);
    expect(input("Tension of the segment").title).toBe("A straight segment has no tension");
  });
});

describe("a curve", () => {
  it("shows the handles' tension as one percentage", () => {
    const store = focusedOn("ok");
    render(<CurveSection />, store);
    const { lambda1, lambda2 } = scales(store);

    expect(Number(input("Tension of the segment").value)).toBeCloseTo(
      ((lambda1 + lambda2) / 2) * 100,
      0,
    );
  });

  it("takes a typed tension for both handles at once", () => {
    const store = focusedOn("ok");
    render(<CurveSection />, store);

    fireEvent.change(input("Tension of the segment"), { target: { value: "60" } });

    const { lambda1, lambda2 } = scales(store);
    expect((lambda1 + lambda2) / 2).toBeCloseTo(0.6, 3);
  });

  it("keeps the balance between the handles while the tension changes", () => {
    const store = focusedOn("ok");
    render(<CurveSection />, store);
    const slider = input("Pan the curve between its two handles");

    fireEvent.change(slider, { target: { value: "0.4" } });
    fireEvent.blur(slider);
    const panned = scales(store);

    fireEvent.change(input("Tension of the segment"), { target: { value: "80" } });

    const after = scales(store);
    // Tension changed, and the split between the two handles did not: the two
    // controls are the curve's two dimensions rather than two views of one.
    expect((after.lambda1 + after.lambda2) / 2).toBeCloseTo(0.8, 3);
    expect(after.lambda1 / after.lambda2).toBeCloseTo(panned.lambda1 / panned.lambda2, 6);
    expect(Number(slider.value)).toBeCloseTo(0.4, 6);
  });

  it("leaves the tension where it is while the pan moves", () => {
    const store = focusedOn("ok");
    render(<CurveSection />, store);

    fireEvent.change(input("Tension of the segment"), { target: { value: "50" } });
    const slider = input("Pan the curve between its two handles");
    fireEvent.change(slider, { target: { value: "-0.3" } });
    fireEvent.blur(slider);

    expect(Number(input("Tension of the segment").value)).toBeCloseTo(50, 3);
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

/**
 * The pan as a number.
 *
 * A slider says roughly, and a lean worth keeping is worth being able to write
 * down — and to type into the segment beside it, which is how two curves are
 * made to match.
 */
describe("the pan field", () => {
  it("says where the slider is, as a percentage", () => {
    const store = focusedOn("ok");
    render(<CurveSection />, store);
    const slider = input("Pan the curve between its two handles");

    fireEvent.change(slider, { target: { value: "0.4" } });
    fireEvent.blur(slider);

    expect(Number(input("Pan as a percentage").value)).toBeCloseTo(40, 1);
  });

  it("moves the handles when a number is typed, and the slider with them", () => {
    const store = focusedOn("ok");
    const before = scales(store);
    render(<CurveSection />, store);

    fireEvent.change(input("Pan as a percentage"), { target: { value: "-25" } });

    const after = scales(store);
    expect(after.lambda1 + after.lambda2).toBeCloseTo(before.lambda1 + before.lambda2, 6);
    expect((after.lambda1 - after.lambda2) / (after.lambda1 + after.lambda2)).toBeCloseTo(-0.25, 6);
    expect(Number(input("Pan the curve between its two handles").value)).toBeCloseTo(-0.25, 2);
  });

  it("holds a typed number inside the travel the curve allows", () => {
    const store = focusedOn("ok");
    render(<CurveSection />, store);

    // All of the reach at one end leaves the other handle in its own anchor,
    // which the kernel refuses, so the slider stops just short of it.
    fireEvent.change(input("Pan as a percentage"), { target: { value: "150" } });

    expect(Number(input("Pan as a percentage").value)).toBeCloseTo(98, 1);
  });

  it("is one step of undo, however many digits it took", () => {
    const store = focusedOn("ok");
    const before = scales(store);
    render(<CurveSection />, store);

    fireEvent.change(input("Pan as a percentage"), { target: { value: "30" } });
    act(() => {
      store.undo();
    });

    expect(scales(store).lambda1).toBeCloseTo(before.lambda1, 6);
    expect(scales(store).lambda2).toBeCloseTo(before.lambda2, 6);
  });
});
