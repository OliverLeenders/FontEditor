import {
  type Glyph,
  anchor,
  component,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
  placedComponent,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { addComponent, attachComponent, attachmentFor } from "../src/commands/index.js";
import { type EditorState, editorState } from "../src/state.js";

/**
 * Aligning a component to its anchors, inside a composite.
 *
 * "Align to anchors" asked for the anchor on the glyph being edited, and a
 * composite has none of its own: the `top` an accent lands on belongs to the
 * letter placed inside it. So in an `ä` built from `a` and a dieresis the action
 * was always unavailable, though both parts carried their anchors. The anchors
 * on offer now include the ones the composite's own components bring.
 */

const ids = counterIds("ac");

const drawn = () =>
  contour(
    ids.contour(),
    [
      node(ids.node(), { x: 0, y: 0 }),
      node(ids.node(), { x: 10, y: 0 }),
      node(ids.node(), { x: 5, y: 10 }),
    ],
    true,
  );

const part = (name: string, code: number, anchors: readonly [string, number, number][]): Glyph =>
  glyph(name, {
    unicodes: [code],
    advance: 500,
    contours: [drawn()],
    anchors: anchors.map(([n, x, y]) => anchor(ids.anchor(), n, { x, y })),
  });

/** A composite open for editing, its marks wherever `offsets` puts them. */
function editing(name: string, parts: readonly string[], offsets: readonly [number, number][]) {
  const components = parts.map((base, i) =>
    placedComponent(component(`c${String(i)}`, base), offsets[i]![0], offsets[i]![1]),
  );
  const document = fontDocument([
    part("a", 0x61, [["top", 250, 520]]),
    part("u", 0x75, [["top", 250, 520]]),
    part("dieresiscomb", 0x308, [
      ["_top", 100, 480],
      ["top", 100, 700],
    ]),
    part("acutecomb", 0x301, [["_top", 100, 480]]),
    glyph(name, { advance: 500, components }),
  ]);
  return editorState({ document, view: { scale: 1, tx: 0, ty: 0 }, currentGlyph: name });
}

const offsetOf = (state: EditorState, id: string) => {
  const c = state.document.glyphs[state.currentGlyph]!.components.find((each) => each.id === id)!;
  return { x: c.transform.xOffset, y: c.transform.yOffset };
};

describe("aligning a mark inside a composite", () => {
  it("finds the letter's anchor through the letter's component", () => {
    // The dieresis sitting at the origin, nowhere near the a's top.
    const state = editing(
      "adieresis",
      ["a", "dieresiscomb"],
      [
        [0, 0],
        [0, 0],
      ],
    );

    // top (250, 520) minus _top (100, 480).
    expect(attachmentFor(state, "c1")).toEqual({ x: 150, y: 40 });
    expect(offsetOf(attachComponent(state, "c1").state, "c1")).toEqual({ x: 150, y: 40 });
  });

  it("has nothing to align the letter itself by", () => {
    const state = editing(
      "adieresis",
      ["a", "dieresiscomb"],
      [
        [0, 0],
        [0, 0],
      ],
    );
    expect(attachmentFor(state, "c0")).toBeNull();
  });

  it("stacks a mark on the one beneath it where that one actually sits", () => {
    // The dieresis nudged 10 up from where its anchors would put it. The acute
    // is aligned to the dieresis on screen, not to where a re-attach would put
    // the dieresis: aligning one thing should not quietly assume another moved.
    const state = editing(
      "udieresisacute",
      ["u", "dieresiscomb", "acutecomb"],
      [
        [0, 0],
        [150, 50],
        [0, 0],
      ],
    );

    // The dieresis's top is at (100 + 150, 700 + 50) = (250, 750).
    expect(attachmentFor(state, "c2")).toEqual({ x: 150, y: 270 });
  });

  it("lands a mark added to a composite on the letter already in it", () => {
    // The same fault, one step earlier: adding the dieresis asked the composite
    // for a `top` it does not have, and put the mark at the origin.
    const state = editing("adieresis", ["a"], [[0, 0]]);
    const out = addComponent(state, "dieresiscomb", counterIds("n")).state;
    const added = out.document.glyphs["adieresis"]!.components[1]!;

    expect({ x: added.transform.xOffset, y: added.transform.yOffset }).toEqual({ x: 150, y: 40 });
  });
});
