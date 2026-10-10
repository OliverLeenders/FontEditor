import { evaluate, tangent } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import {
  type Contour,
  type Nib,
  contour,
  contourBounds,
  readStrokeEnd,
  segmentAt,
  segmentCubic,
} from "../src/contour.js";
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

describe("a cut end closed with the pen's own shape", () => {
  const nibbed: StrokeEnd = { cut: 0, shape: "nib" };
  const ROUND: Nib = { angle: 0, width: 80, thickness: 80 };

  it("still ends on the line through its last point, and is one outline", () => {
    const ink = inkOf(stem(OVAL, nibbed), ids);
    expect(ink).toHaveLength(1);
    expect(boxOf(ink).minY).toBeCloseTo(0, 1);
    // The middle of the foot is on the baseline.
    const box = boxOf(ink);
    expect(inked(ink, (box.minX + box.maxX) / 2, 1)).toBe(true);
  });

  it("is round at its corners where the plain cut is sharp", () => {
    const sharp = inkOf(stem(OVAL, { cut: 0 }), ids);
    const soft = inkOf(stem(OVAL, nibbed), ids);
    const box = boxOf(sharp);
    // Just inside each corner of the plain cut.
    for (const x of [box.minX + 1.5, box.maxX - 1.5]) {
      expect(inked(sharp, x, 1)).toBe(true);
      expect(inked(soft, x, 1)).toBe(false);
    }
  });

  it("is the stroke's own width, and no wider", () => {
    const sharp = boxOf(inkOf(stem(OVAL, { cut: 0 }), ids));
    const soft = boxOf(inkOf(stem(OVAL, nibbed), ids));
    expect(soft.minX).toBeCloseTo(sharp.minX, 1);
    expect(soft.maxX).toBeCloseTo(sharp.maxX, 1);
  });

  it("is half a circle for a round pen", () => {
    const ink = inkOf(stem(ROUND, nibbed), ids);
    expect(boxOf(ink).minY).toBeCloseTo(0, 1);
    // On the circle of radius forty about (200, 40): inside it inked, outside not.
    const on = (angle: number, r: number) =>
      [200 + r * Math.cos(angle), 40 + r * Math.sin(angle)] as const;
    for (const angle of [-0.5, -1.2, -2.0, -2.7]) {
      expect(inked(ink, ...on(angle, 38))).toBe(true);
      expect(inked(ink, ...on(angle, 42))).toBe(false);
    }
  });

  it("is a box with its corners rounded for a pen with squareness, and the cut itself at a hundred", () => {
    const boxy = inkOf(stem({ ...OVAL, squareness: 1 }, nibbed), ids);
    const box = boxOf(boxy);
    expect(box.minY).toBeCloseTo(0, 1);
    expect(inked(boxy, box.minX + 1.5, 1)).toBe(true);
    expect(inked(boxy, box.maxX - 1.5, 1)).toBe(true);
  });

  it("is the plain cut for a broad edge, which has no shape but a line", () => {
    const plain = boxOf(inkOf(stem(BROAD, { cut: 0 }), ids));
    const shaped = inkOf(stem(BROAD, nibbed), ids);
    expect(boxOf(shaped)).toEqual(plain);
    expect(inked(shaped, plain.minX + 1.5, 1)).toBe(true);
  });

  it("is what the canvas fills, too", () => {
    const regions = inkRegions(stem(OVAL, nibbed));
    expect(boxOf(regions).minY).toBeCloseTo(0, 1);
    const box = boxOf(inkOf(stem(OVAL, { cut: 0 }), ids));
    expect(inked(regions, box.minX + 1.5, 1)).toBe(false);
  });

  it("is read back with the cut, and is the plain cut where the shape is not known", () => {
    expect(readStrokeEnd({ cut: 0, shape: "nib" })).toEqual({ cut: 0, shape: "nib" });
    expect(readStrokeEnd({ cut: "square", shape: "wavy" })).toEqual({ cut: "square" });
  });

  it("is kept between masters, the angle still turning", () => {
    const light = glyph("i", { contours: [stem(BROAD, { cut: 0, shape: "nib" })] });
    const bold = glyph("i", { contours: [stem(BROAD, { cut: 20, shape: "nib" })] });
    const between = interpolateGlyph([light, bold], [0.5, 0.5])!;
    expect(between.contours[0]!.nodes[1]!.end).toEqual({ cut: 10, shape: "nib" });
  });
});

describe("a cut at the end of a segment that turns on its way there", () => {
  // A drawn stroke whose last segment rises over a hump before it comes down
  // to its end, cut there on a slant. The cut's line, going on across the
  // glyph, passes through the near end of the same segment.
  const drawn = (end?: StrokeEnd): Contour =>
    withNib(
      contour(
        ids.contour(),
        [
          node(ids.node(), at(30.637, 464.017)),
          node(ids.node(), at(230.293, 538.027), {
            type: "smooth",
            in: at(94.32, 567.287),
            out: at(366.265, 508.767),
          }),
          node(ids.node(), at(318.072, 224.774)),
          node(ids.node(), at(507.892, 131.686), {
            type: "smooth",
            in: at(330.611, -23.219),
            out: at(685.172, 286.592),
          }),
          node(ids.node(), at(675.99, 16.888), end === undefined ? {} : { end }),
        ],
        false,
      ),
      { angle: 30, width: 80, thickness: 30 },
    );

  const ends: readonly (readonly [string, StrokeEnd])[] = [
    ["closed straight", { cut: 149 }],
    ["closed with the nib", { cut: 149, shape: "nib" }],
  ];
  it.each(ends)("cuts the end and not the near end of the same segment: %s", (_, end) => {
    const ink = inkOf(drawn(end), ids);
    // It came to two outlines, a bite taken out of the hump's near side.
    expect(ink).toHaveLength(1);

    // Beside the path where the last segment starts, either side of it: ink,
    // as it is without the cut.
    const plain = inkOf(drawn(), ids);
    const hump = segmentCubic(segmentAt(drawn(), 3)!);
    // Across the whole width of the stroke there, wherever the uncut one is ink.
    let asked = 0;
    for (const t of [0.02, 0.06, 0.12, 0.2, 0.35]) {
      const on = evaluate(hump, t);
      const along = tangent(hump, t)!;
      for (let side = -36; side <= 36; side += 4) {
        const x = on.x - along.y * side;
        const y = on.y + along.x * side;
        if (!inked(plain, x, y)) continue;
        asked++;
        expect(inked(ink, x, y)).toBe(true);
      }
    }
    expect(asked).toBeGreaterThan(40);
    // And the end is cut: nothing of it past the line through the last point.
    const cut = strokeCut(drawn(end), "end")!;
    for (const c of ink) {
      for (const n of c.nodes) {
        if (Math.hypot(n.pt.x - 675.99, n.pt.y - 16.888) > 90) continue;
        const past = (n.pt.x - 675.99) * cut.normal.x + (n.pt.y - 16.888) * cut.normal.y;
        expect(past).toBeLessThan(0.5);
      }
    }
  });

  it("cuts both ends of one arch, each where it comes down, and leaves the top", () => {
    // One segment up over an arch and down again, both feet cut level.
    const arch = (cut?: StrokeEnd): Contour =>
      withNib(
        contour(
          ids.contour(),
          [
            node(ids.node(), at(0, 0), {
              out: at(0, 400),
              ...(cut === undefined ? {} : { end: cut }),
            }),
            node(ids.node(), at(300, 0), {
              in: at(300, 400),
              ...(cut === undefined ? {} : { end: cut }),
            }),
          ],
          false,
        ),
        OVAL,
      );
    const plain = boxOf(inkOf(arch(), ids));
    const ink = inkOf(arch({ cut: 0 }), ids);
    const box = boxOf(ink);

    expect(ink).toHaveLength(1);
    expect(box.minY).toBeCloseTo(0, 3);
    expect(box.maxY).toBeCloseTo(plain.maxY, 3);
    // Each foot the stroke's whole width, down to the line.
    for (const x of [0, 300]) {
      expect(inked(ink, x - 25, 2)).toBe(true);
      expect(inked(ink, x + 25, 2)).toBe(true);
    }
  });
});
