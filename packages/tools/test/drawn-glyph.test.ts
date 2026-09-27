import {
  component,
  counterIds,
  fontDocument,
  glyph,
  placedComponent,
  rectContour,
} from "@typewright/font-model";
import { vec } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import { pointerDown, pointerMove, pointerUp } from "../src/knife.js";
import { shownSection } from "../src/section.js";
import { type EditorState, drawnGlyph, editorState } from "../src/state.js";

const ids = counterIds("drawn");
const VIEW = { scale: 1, tx: 0, ty: 0 };

/**
 * The tools that had not been told about components.
 *
 * The canvas has drawn a glyph's components for a long time and the pointer has
 * found them, so a letter built partly by reference looked whole. Three readers
 * still went by the contours as stored: the ruler, the gap measure and the knife.
 * What is asked here is that each of them now sees what is on the screen — and
 * that the knife, which changes the glyph, turns only the components it actually
 * crosses into outlines.
 */

/** A stem drawn in place, with a bar placed across it by reference. */
function stemAndBar(barAt: number): EditorState {
  return editorState({
    document: fontDocument([
      glyph("a", {
        advance: 600,
        contours: [rectContour(ids, { minX: 100, minY: 0, maxX: 200, maxY: 400 })],
        components: [placedComponent(component(ids.component(), "bar"), 0, barAt)],
      }),
      glyph("bar", {
        advance: 600,
        contours: [rectContour(ids, { minX: 0, minY: 0, maxX: 300, maxY: 60 })],
      }),
    ]),
    view: VIEW,
    currentGlyph: "a",
  });
}

describe("the glyph as drawn", () => {
  it("has the components drawn in after its own contours", () => {
    const drawn = drawnGlyph(stemAndBar(150))!;
    expect(drawn.contours).toHaveLength(2);
    expect(drawn.components).toHaveLength(0);
  });

  it("keeps its own contours first, with their ids", () => {
    // What a reader finds by id — the segment under the pointer — is found in the
    // drawn glyph exactly as in the glyph itself.
    const state = stemAndBar(150);
    const own = state.document.glyphs["a"]!.contours[0]!;
    expect(drawnGlyph(state)!.contours[0]!.id).toBe(own.id);
  });
});

describe("the ruler", () => {
  it("reads a component's edges as well as the contours drawn in place", () => {
    // Laid level across the letter at the height of the bar: it crosses the bar's
    // two ends as well as the stem's two sides. Reading only the stem it saw two
    // crossings and a line of ink the width of the stem.
    const state = {
      ...stemAndBar(150),
      section: { from: vec(-50, 180), to: vec(400, 180), drawing: false },
    };
    const section = shownSection(state)!;
    expect(section.crossings.length).toBeGreaterThanOrEqual(2);
    // The bar runs from 0 to 300, so the ink begins at 0 rather than at the stem.
    const ink = section.spans.filter((span) => span.ink);
    const leftmost = Math.min(...ink.map((span) => Math.min(span.from.x, span.to.x)));
    expect(leftmost).toBeCloseTo(0, 3);
  });
});

describe("the knife", () => {
  const stroke = (
    state: EditorState,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => {
    const down = pointerDown(state, { point: from, modifiers: {} } as never).state;
    const moved = pointerMove(down, { point: to, modifiers: {} } as never).state;
    return pointerUp(moved, undefined, { ids });
  };

  it("cuts through a component the stroke crosses", () => {
    // Straight down through the bar, clear of the stem. The bar is a reference,
    // and a reference cannot be cut: it becomes outlines, and they are cut.
    const { state, effects } = stroke(stemAndBar(150), { x: 50, y: 300 }, { x: 50, y: 100 });

    const after = state.document.glyphs["a"]!;
    expect(after.components).toHaveLength(0);
    expect(after.contours.length).toBeGreaterThan(1);
    expect(effects[0]).toMatchObject({ kind: "beginTransaction", label: "Cut through component" });
  });

  it("leaves a component the stroke does not reach as a reference", () => {
    // Through the stem only, well below a bar sitting high above it.
    const { state } = stroke(stemAndBar(900), { x: 150, y: 300 }, { x: 300, y: 100 });

    const after = state.document.glyphs["a"]!;
    expect(after.components).toHaveLength(1);
  });

  it("leaves the glyph alone when the stroke crosses nothing", () => {
    // Out to the right of everything. No crossing means no cut, and no cut means
    // no reference turned into outlines on the way to finding that out.
    const state = stemAndBar(150);
    const { state: after, effects } = stroke(state, { x: 450, y: 300 }, { x: 500, y: 100 });
    expect(after.document).toBe(state.document);
    expect(effects).toContainEqual({ kind: "abortTransaction" });
  });

  it("marks a point on a component the stroke only enters", () => {
    // One crossing is a mark rather than a cut: the knife puts a point where the
    // stroke met the outline, which is what it does to any contour. A point cannot
    // be put on a reference, so the bar becomes outlines to carry it — the same
    // rule as a cut, because it is the same stroke.
    const { state, effects } = stroke(stemAndBar(150), { x: 20, y: 300 }, { x: 20, y: 180 });

    const after = state.document.glyphs["a"]!;
    expect(after.components).toHaveLength(0);
    // Named for what it did: a point put in, not a cut.
    expect(effects[0]).toMatchObject({ label: "Insert point in component" });
  });

  it("does not touch the glyph the reference points at", () => {
    const { state } = stroke(stemAndBar(150), { x: 50, y: 300 }, { x: 50, y: 100 });
    expect(state.document.glyphs["bar"]!.contours).toHaveLength(1);
  });
});
