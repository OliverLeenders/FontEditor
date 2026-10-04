import { describe, expect, it } from "vitest";

import {
  type Contour,
  contour,
  correctDirections,
  counterIds,
  glyph,
  nestedAsWound,
  node,
  sameInk,
} from "../src/index.js";

/**
 * A glyph drawn for the rule a font file fills by, read into an editor that
 * fills by another.
 *
 * A file's outlines are ink wherever they wind round a place a number of times
 * that is not nothing; this editor's are ink by how they nest, whichever way
 * they were drawn. Nearly every glyph is the same picture under both. One built
 * of pieces that overlap is not — and was shown, and exported, with holes it
 * never had.
 */

const ids = counterIds("wound");

/** A square, anticlockwise or clockwise. */
const square = (left: number, bottom: number, size: number, anticlockwise = true): Contour => {
  const corners = [
    { x: left, y: bottom },
    { x: left + size, y: bottom },
    { x: left + size, y: bottom + size },
    { x: left, y: bottom + size },
  ];
  return contour(
    ids.contour(),
    (anticlockwise ? corners : [...corners].reverse()).map((pt) => node(ids.node(), pt)),
    true,
  );
};

/** What this editor fills, as outlines the non-zero rule fills the same. */
const asFilled = (contours: readonly Contour[]): readonly Contour[] => correctDirections(contours);

describe("a glyph drawn for the non-zero rule", () => {
  it("is left as it is where the two rules fill it alike", () => {
    // A frame and its counter, drawn as a font draws them; and beside it a
    // shape of its own.
    const g = glyph("frame", {
      contours: [square(0, 0, 400), square(100, 100, 200, false), square(500, 0, 100)],
    });
    expect(nestedAsWound(g, ids)).toBe(g);
  });

  it("is left as it is where a contour runs the other way and is ink either way", () => {
    // A slot inside a counter, drawn the way the counter is: ink under both
    // rules, though nesting would turn it round.
    const g = glyph("slotted", {
      contours: [square(0, 0, 600, false), square(100, 100, 400), square(250, 250, 100)],
    });
    expect(sameInk(g.contours, asFilled(g.contours))).toBe(true);
    expect(nestedAsWound(g, ids)).toBe(g);
  });

  it("loses a shape buried in another that winds the same way", () => {
    // Ink inside ink. Nesting takes the inner one for a counter.
    const g = glyph("buried", { contours: [square(0, 0, 400), square(100, 100, 200)] });
    expect(sameInk(g.contours, asFilled(g.contours))).toBe(false);

    const read = nestedAsWound(g, ids);
    expect(read).not.toBeNull();
    expect(read!.contours).toHaveLength(1);
    expect(sameInk(g.contours, asFilled(read!.contours))).toBe(true);
  });

  it("is left as it is where pieces overlap and nest the way they wind", () => {
    // A frame with a counter, and a bar laid across both the same way round as
    // the frame: ink where it crosses the counter, under either rule, since a
    // bar across a frame is inside nothing.
    const bar = contour(
      ids.contour(),
      [
        { x: -50, y: 180 },
        { x: 450, y: 180 },
        { x: 450, y: 220 },
        { x: -50, y: 220 },
      ].map((pt) => node(ids.node(), pt)),
      true,
    );
    const g = glyph("barred", { contours: [square(0, 0, 400), square(100, 100, 200, false), bar] });

    expect(sameInk(g.contours, asFilled(g.contours))).toBe(true);
    expect(nestedAsWound(g, ids)).toBe(g);
  });

  it("joins a piece that overlaps another and sits inside a third", () => {
    // Two shapes side by side that overlap, and a small one inside where they
    // do, all the same way round: ink throughout. Nested, the small one is
    // inside both and so is ink, but turned — and one inside just the first,
    // clear of the overlap, is taken for a counter.
    const g = glyph("pieces", {
      contours: [square(0, 0, 400), square(300, 0, 400), square(100, 100, 100)],
    });
    expect(sameInk(g.contours, asFilled(g.contours))).toBe(false);

    const read = nestedAsWound(g, ids);
    expect(read).not.toBeNull();
    expect(read).not.toBe(g);
    expect(sameInk(g.contours, asFilled(read!.contours), 2)).toBe(true);
    // One outline round both, and nothing inside it.
    expect(read!.contours).toHaveLength(1);
  });

  it("keeps what is not an outline: an open path beside the shapes", () => {
    const open = contour(
      ids.contour(),
      [node(ids.node(), { x: 600, y: 0 }), node(ids.node(), { x: 700, y: 100 })],
      false,
    );
    const g = glyph("buried", { contours: [square(0, 0, 400), square(100, 100, 200), open] });
    const read = nestedAsWound(g, ids);
    expect(read!.contours.some((c) => !c.closed)).toBe(true);
  });
});

describe("whether two sets of outlines are the same ink", () => {
  it("says so of one shape cut two ways", () => {
    const whole = [square(0, 0, 200)];
    const halves = [
      contour(
        ids.contour(),
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 200 },
          { x: 0, y: 200 },
        ].map((pt) => node(ids.node(), pt)),
        true,
      ),
      contour(
        ids.contour(),
        [
          { x: 100, y: 0 },
          { x: 200, y: 0 },
          { x: 200, y: 200 },
          { x: 100, y: 200 },
        ].map((pt) => node(ids.node(), pt)),
        true,
      ),
    ];
    // The seam between the halves is a place with ink on both sides in one and
    // an edge in the other; within the hairlines a union closes, the same.
    expect(sameInk(whole, halves, 100)).toBe(true);
    expect(sameInk(whole, [square(0, 0, 200, false)])).toBe(true);
  });

  it("says not of a shape and the shape with a hole in it", () => {
    expect(sameInk([square(0, 0, 400)], [square(0, 0, 400), square(100, 100, 200, false)])).toBe(
      false,
    );
    expect(sameInk([square(0, 0, 400)], [])).toBe(false);
  });
});
