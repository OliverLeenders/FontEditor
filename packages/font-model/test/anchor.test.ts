import { vec } from "@fonteditor/geometry";
import { describe, expect, it } from "vitest";

import {
  type Glyph,
  addAnchor,
  anchor,
  anchorById,
  anchorNamed,
  counterIds,
  glyph,
  isMarkAnchor,
  movedAnchor,
  moveAnchorBy,
  moveAnchorTo,
  pairedName,
  removeAnchor,
  renameAnchor,
  roundGlyph,
} from "../src/index.js";

const ids = counterIds("a");

/** An `a` with somewhere to put an accent, and an accent to put there. */
function base(): Glyph {
  return addAnchor(glyph("a", { advance: 500 }), anchor(ids.anchor(), "top", vec(250, 700)));
}

describe("anchors on a glyph", () => {
  it("adds one and finds it by id or by name", () => {
    const g = base();
    const only = g.anchors[0]!;

    expect(anchorById(g, only.id)).toBe(only);
    expect(anchorNamed(g, "top")).toBe(only);
    expect(anchorNamed(g, "bottom")).toBeNull();
  });

  it("moves one, and hands back the same glyph when it would not move", () => {
    const g = base();
    const id = g.anchors[0]!.id;

    expect(moveAnchorBy(g, id, 10, -5)!.anchors[0]!.pt).toEqual(vec(260, 695));
    expect(moveAnchorTo(g, id, vec(100, 100))!.anchors[0]!.pt).toEqual(vec(100, 100));

    // Nothing moved, so nothing is a new object — which is what the whole model
    // uses to answer "did this change?".
    expect(moveAnchorBy(g, id, 0, 0)).toBe(g);
    expect(moveAnchorTo(g, id, vec(250, 700))).toBe(g);
    expect(moveAnchorBy(g, "nobody", 1, 1)).toBeNull();
  });

  it("refuses a rename onto a name the glyph already uses", () => {
    const two = addAnchor(base(), anchor(ids.anchor(), "bottom", vec(250, 0)));
    const top = two.anchors[0]!.id;

    expect(renameAnchor(two, top, "bottom")).toBeNull();
    expect(renameAnchor(two, top, "ogonek")!.anchors[0]!.name).toBe("ogonek");
    // Renaming one to what it is already called is not a collision with itself.
    expect(renameAnchor(two, top, "top")).toBe(two);
  });

  it("removes one, and says so when there was nothing to remove", () => {
    const g = base();
    expect(removeAnchor(g, g.anchors[0]!.id)!.anchors).toHaveLength(0);
    expect(removeAnchor(g, "nobody")).toBeNull();
  });

  it("leaves the outline alone: an anchor is not part of the shape", () => {
    const g = base();
    expect(g.contours).toHaveLength(0);
    expect(g.components).toHaveLength(0);
  });
});

describe("what an anchor's name says", () => {
  it("tells the side that attaches from the side that is attached to", () => {
    const top = anchor("x", "top", vec(0, 0));
    const mark = anchor("y", "_top", vec(0, 0));

    expect(isMarkAnchor(top)).toBe(false);
    expect(isMarkAnchor(mark)).toBe(true);
    // An accent's `_top` is the thing that lands on a letter's `top`.
    expect(pairedName(mark)).toBe("top");
    expect(pairedName(top)).toBeNull();
  });

  it("moves one without renaming it", () => {
    const a = anchor("x", "top", vec(10, 20));
    expect(movedAnchor(a, 5, 5)).toEqual(anchor("x", "top", vec(15, 25)));
    expect(movedAnchor(a, 0, 0)).toBe(a);
  });
});

describe("rounding", () => {
  it("puts an anchor on the grid with everything else", () => {
    const g = addAnchor(glyph("a"), anchor(ids.anchor(), "top", vec(250.4, 699.6)));
    const rounded = roundGlyph(g);
    expect(rounded.anchors[0]!.pt).toEqual(vec(250, 700));
    // And a glyph already on the grid comes back as the very same glyph.
    expect(roundGlyph(rounded)).toBe(rounded);
  });
});
