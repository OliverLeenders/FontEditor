import { describe, expect, it } from "vitest";

import { type Contour, type Nib, contour, contourBounds } from "../src/contour.js";
import { counterIds } from "../src/ids.js";
import { interpolateGlyph } from "../src/interpolate.js";
import { glyph } from "../src/glyph.js";
import { type StrokeEnd, node } from "../src/node.js";
import { insideGlyph } from "../src/direction.js";
import { inkOf, inkRegions, plannedInk, strokeCut, withNib } from "../src/stroke.js";

/**
 * A stroke's end cut straight.
 *
 * A pen held at an angle ends a stroke at that angle, and the way round it —
 * turning the pen level at the last point — makes the stroke wider there. A cut
 * leaves the pen alone: the stroke is carried on past its last point and cut
 * off by a line through it. What is asked is that the ink ends on that line and
 * nowhere short of it, is the stroke's own weight all the way there, and that
 * nothing else about the stroke has moved.
 */

const ids = counterIds("ends");
const at = (x: number, y: number) => ({ x, y });
const BROAD: Nib = { angle: 30, width: 80 };
const OVAL: Nib = { angle: 30, width: 80, thickness: 24 };

/** A stem from 600 down to the baseline, ending as asked at its foot and its head. */
const stem = (nib: Nib, foot?: StrokeEnd, head?: StrokeEnd): Contour =>
  withNib(
    contour(
      ids.contour(),
      [
        node(ids.node(), at(200, 600), head === undefined ? {} : { end: head }),
        node(ids.node(), at(200, 0), foot === undefined ? {} : { end: foot }),
      ],
      false,
    ),
    nib,
  );

const boxOf = (contours: readonly Contour[]) => {
  const boxes = contours.map((c) => contourBounds(c)!);
  return {
    minX: Math.min(...boxes.map((b) => b.minX)),
    maxX: Math.max(...boxes.map((b) => b.maxX)),
    minY: Math.min(...boxes.map((b) => b.minY)),
    maxY: Math.max(...boxes.map((b) => b.maxY)),
  };
};
const inked = (contours: readonly Contour[], x: number, y: number): boolean =>
  insideGlyph(glyph("g", { contours: [...contours] }), at(x, y));

// Half the nib, across and up: a broad edge at thirty degrees and eighty wide.
const ACROSS = 40 * Math.cos(Math.PI / 6);
const UP = 40 * Math.sin(Math.PI / 6);

describe("a stroke's end, as the pen leaves it", () => {
  it("slants as the pen does, and hangs below the point it ends at", () => {
    const ink = inkOf(stem(BROAD), ids);
    expect(boxOf(ink).minY).toBeCloseTo(-UP, 6);
    // Its foot is on the baseline on neither side of the path: one side is
    // short of it and the other past it.
    expect(inked(ink, 200 + ACROSS - 4, 6)).toBe(false);
    expect(inked(ink, 200 - ACROSS + 4, -6)).toBe(true);
  });
});

describe("a stroke's end, cut level", () => {
  it.each([
    ["a broad edge", BROAD],
    ["an oval", OVAL],
  ])("ends on the line through its last point, right across: %s", (_, nib) => {
    const ink = inkOf(stem(nib, { cut: 0 }), ids);
    expect(ink).toHaveLength(1);
    const box = boxOf(ink);

    expect(box.minY).toBeCloseTo(0, 6);
    // The whole width of the stem, down to the baseline on both sides.
    expect(inked(ink, box.minX + 3, 2)).toBe(true);
    expect(inked(ink, box.maxX - 3, 2)).toBe(true);
    expect(inked(ink, 200, -2)).toBe(false);
  });

  it("is the stem's own weight at the cut: the pen was not turned", () => {
    const plain = boxOf(inkOf(stem(BROAD), ids));
    const cut = boxOf(inkOf(stem(BROAD, { cut: 0 }), ids));
    expect(cut.maxX - cut.minX).toBeCloseTo(plain.maxX - plain.minX, 6);
    expect(cut.maxX - cut.minX).toBeCloseTo(2 * ACROSS, 6);
  });

  it("leaves the other end as it was", () => {
    const plain = boxOf(inkOf(stem(BROAD), ids));
    const cut = boxOf(inkOf(stem(BROAD, { cut: 0 }), ids));
    expect(cut.maxY).toBeCloseTo(plain.maxY, 6);
  });

  it("cuts both ends of a stroke of one segment", () => {
    const box = boxOf(inkOf(stem(OVAL, { cut: 0 }, { cut: 0 }), ids));
    expect(box.minY).toBeCloseTo(0, 6);
    expect(box.maxY).toBeCloseTo(600, 6);
  });

  it("is what the canvas fills, too", () => {
    const box = boxOf(inkRegions(stem(BROAD, { cut: 0 })));
    expect(box.minY).toBeCloseTo(0, 6);
  });
});

describe("a stroke's end, cut other ways", () => {
  it("cuts square to a path that leans", () => {
    // Down and to the right at forty-five degrees: square is across that.
    const leaning = withNib(
      contour(
        ids.contour(),
        [node(ids.node(), at(0, 400)), node(ids.node(), at(400, 0), { end: { cut: "square" } })],
        false,
      ),
      BROAD,
    );
    const cut = strokeCut(leaning, "end")!;
    expect(cut.normal.x).toBeCloseTo(Math.SQRT1_2, 9);
    expect(cut.normal.y).toBeCloseTo(-Math.SQRT1_2, 9);
    // Nothing of the ink is past the line through the end, across the path.
    for (const c of inkOf(leaning, ids)) {
      for (const n of c.nodes) {
        expect((n.pt.x - 400) * cut.normal.x + n.pt.y * cut.normal.y).toBeLessThan(1e-6);
      }
    }
  });

  it("faces away from the stroke whichever way round the angle was given", () => {
    const up = strokeCut(stem(BROAD, { cut: 0 }), "end")!;
    const over = strokeCut(stem(BROAD, { cut: 180 }), "end")!;
    expect(up.normal.y).toBeCloseTo(-1, 9);
    expect(over.normal.y).toBeCloseTo(-1, 9);
    // And at the head of the stem it faces up.
    expect(strokeCut(stem(BROAD, undefined, { cut: 0 }), "start")!.normal.y).toBeCloseTo(1, 9);
  });

  it("is not made nearly along the path, which the pen would never get past", () => {
    const along = stem(BROAD, { cut: 85 });
    expect(strokeCut(along, "end")).toBeNull();
    expect(boxOf(inkOf(along, ids)).minY).toBeCloseTo(-UP, 6);
  });

  it("means nothing on a closed path, or a point that is not an end", () => {
    const closed: Contour = { ...stem(BROAD, { cut: 0 }), closed: true };
    expect(strokeCut(closed, "end")).toBeNull();
  });
});

describe("a cut end and the rest of the stroke", () => {
  // A u: down a stem, round a bowl that hangs below the baseline, up the other
  // stem, both stems cut level at the height of their tops.
  const u = (cut?: StrokeEnd): Contour =>
    withNib(
      contour(
        ids.contour(),
        [
          node(ids.node(), at(0, 400), cut === undefined ? {} : { end: cut }),
          node(ids.node(), at(0, 150), { out: at(0, -60) }),
          node(ids.node(), at(300, 150), { in: at(300, -60) }),
          node(ids.node(), at(300, 400), cut === undefined ? {} : { end: cut }),
        ],
        false,
      ),
      OVAL,
    );

  it("cuts only the segment that ends there: the bowl below is whole", () => {
    const plain = boxOf(inkOf(u(), ids));
    const cut = boxOf(inkOf(u({ cut: 0 }), ids));
    expect(cut.maxY).toBeCloseTo(400, 6);
    expect(cut.minY).toBeCloseTo(plain.minY, 3);
    expect(cut.minX).toBeCloseTo(plain.minX, 3);
  });

  it("is still one outline", () => {
    expect(inkOf(u({ cut: 0 }), ids)).toHaveLength(1);
  });
});

describe("a cut end between masters", () => {
  it("turns with the angle it is cut at", () => {
    const light = glyph("i", { contours: [stem(BROAD, { cut: 0 })] });
    const bold = glyph("i", { contours: [stem(BROAD, { cut: 20 })] });
    const between = interpolateGlyph([light, bold], [0.5, 0.5])!;
    expect(between.contours[0]!.nodes[1]!.end).toEqual({ cut: 10 });
  });

  it("is not yet drawn to one plan for a variable font", () => {
    expect(plannedInk([stem(OVAL, { cut: 0 }), stem(OVAL, { cut: 0 })], ids)).toBeNull();
    expect(plannedInk([stem(OVAL), stem(OVAL)], ids)).not.toBeNull();
  });
});
