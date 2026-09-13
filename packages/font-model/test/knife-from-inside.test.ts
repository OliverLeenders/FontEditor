import { describe, expect, it } from "vitest";

import { contour } from "../src/contour.js";
import { glyph, glyphBounds } from "../src/glyph.js";
import { counterIds } from "../src/ids.js";
import { cutGlyph } from "../src/knife.js";
import { node } from "../src/node.js";

/**
 * A knife stroke that starts inside the ink.
 *
 * Crossings used to be paired off along the stroke by parity, which is only
 * right when the stroke starts outside the letter. Started inside a stem of a
 * `v` and dragged to the inside of the other stem, it crosses two inner edges —
 * and pairing those two closed a chord across the white between the stems, a
 * bar across the letter's mouth. The shape here is a `u` with square corners,
 * which has the same two inner edges and numbers that can be read off.
 */

const ids = counterIds("kv");
const at = (x: number, y: number) => ({ x, y });

/** Two stems 100 wide joined along the bottom, with a mouth 200 wide between them. */
const cup = () =>
  glyph("u", {
    advance: 500,
    contours: [
      contour(
        ids.contour(),
        [
          at(0, 0),
          at(400, 0),
          at(400, 700),
          at(300, 700),
          at(300, 100),
          at(100, 100),
          at(100, 700),
          at(0, 700),
        ].map((p) => node(ids.node(), p)),
        true,
      ),
    ],
  });

describe("a knife stroke that starts inside the ink", () => {
  it("does not close across the white between two stems", () => {
    const cut = cutGlyph(cup(), at(50, 400), at(350, 400), ids)!;

    expect(cut.crossings).toBe(2);
    expect(cut.chords).toBe(0);
    expect(cut.glyph.contours).toHaveLength(1);
    expect(glyphBounds(cut.glyph)).toEqual({ minX: 0, minY: 0, maxX: 400, maxY: 700 });
  });

  it("puts a point where it crossed each edge instead", () => {
    const cut = cutGlyph(cup(), at(50, 400), at(350, 400), ids)!;
    const nodes = cut.glyph.contours[0]!.nodes;

    expect(cut.marked).toBe(2);
    expect(nodes).toHaveLength(10);
    for (const x of [100, 300]) {
      expect(nodes.some((n) => Math.abs(n.pt.x - x) < 1e-6 && Math.abs(n.pt.y - 400) < 1e-6)).toBe(
        true,
      );
    }
  });

  it("still cuts the stem it goes all the way through", () => {
    // In at the left stem's inside edge, across the mouth, and out through the
    // whole of the right stem: that stem is cut, the left one only marked.
    const cut = cutGlyph(cup(), at(50, 400), at(450, 400), ids)!;

    expect(cut.crossings).toBe(3);
    expect(cut.chords).toBe(1);
    expect(cut.marked).toBe(1);
    expect(cut.glyph.contours).toHaveLength(2);
  });

  it("cuts both stems from outside exactly as it always did", () => {
    const cut = cutGlyph(cup(), at(-50, 400), at(450, 400), ids)!;

    expect(cut.crossings).toBe(4);
    expect(cut.chords).toBe(2);
    expect(cut.marked).toBe(0);
    // The two stem tops, and the bottom of the u.
    expect(cut.glyph.contours).toHaveLength(3);
  });
});
