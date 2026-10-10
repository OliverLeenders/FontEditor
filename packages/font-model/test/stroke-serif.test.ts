import type { Cubic } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import { winding } from "../../geometry/test/sweep.js";
import {
  type Contour,
  type Nib,
  contour,
  contourBounds,
  readStrokeEnd,
  segmentAt,
  segmentCount,
  segmentCubic,
} from "../src/contour.js";
import { counterIds } from "../src/ids.js";
import { interpolateGlyph } from "../src/interpolate.js";
import { glyph } from "../src/glyph.js";
import { type StrokeEnd, node } from "../src/node.js";
import {
  type Serif,
  DEFAULT_SERIF,
  readSerifStyles,
  restyled,
  serifOutline,
  withSerifNumber,
} from "../src/serif.js";
import { inkOf, inkRegions, plannedInk, withNib } from "../src/stroke.js";

/**
 * A serif on the end of a stroke.
 *
 * It stands on the line the end is cut along and is measured from the stroke's
 * own edges there. What is asked is that the ink still ends on the line, that
 * the serif reaches as far as its numbers say past whatever the stroke's width
 * comes to, that it is one outline with the stroke, and that the three ways a
 * stroke is drawn — joined for a font, in regions for the canvas, to one plan
 * for a variable font — are the same ink.
 */

const ids = counterIds("serif");
const at = (x: number, y: number) => ({ x, y });
const BROAD: Nib = { angle: 30, width: 80 };
const OVAL: Nib = { angle: 30, width: 80, thickness: 24 };
const BOX: Nib = { angle: 0, width: 80, thickness: 40, squareness: 1 };
const SLAB: Serif = { ...DEFAULT_SERIF, left: 60, right: 60, height: 40 };

const footed = (serif: Serif): StrokeEnd => ({ cut: 0, serif });

/** A stem from 600 down to the baseline, with what is asked at its foot and its head. */
const stem = (nib: Nib, foot?: StrokeEnd, head?: StrokeEnd, lean = 0): Contour =>
  withNib(
    contour(
      ids.contour(),
      [
        node(ids.node(), at(200 + lean, 600), head === undefined ? {} : { end: head }),
        node(ids.node(), at(200, 0), foot === undefined ? {} : { end: foot }),
      ],
      false,
    ),
    nib,
  );

const loopsOf = (contours: readonly Contour[]): Cubic[][] =>
  contours.map((c) => {
    const out: Cubic[] = [];
    for (let i = 0; i < segmentCount(c); i++) {
      const s = segmentAt(c, i);
      if (s !== null) out.push(segmentCubic(s));
    }
    return out;
  });
const inked = (contours: readonly Contour[], x: number, y: number): boolean =>
  winding(loopsOf(contours), at(x, y)) !== 0;
const boxOf = (contours: readonly Contour[]) => {
  const boxes = contours.map((c) => contourBounds(c)!);
  return {
    minX: Math.min(...boxes.map((b) => b.minX)),
    maxX: Math.max(...boxes.map((b) => b.maxX)),
    minY: Math.min(...boxes.map((b) => b.minY)),
    maxY: Math.max(...boxes.map((b) => b.maxY)),
  };
};

/** Where two drawings of the same ink differ, on a grid kept off every round number. */
const differences = (a: readonly Contour[], b: readonly Contour[]): string[] => {
  const box = boxOf([...a, ...b]);
  const out: string[] = [];
  const [la, lb] = [loopsOf(a), loopsOf(b)];
  for (let x = box.minX - 3.37; x < box.maxX + 4; x += 7.3) {
    for (let y = box.minY - 3.29; y < box.maxY + 4; y += 7.1) {
      const [wa, wb] = [winding(la, at(x, y)), winding(lb, at(x, y))];
      if ((wa !== 0) !== (wb !== 0)) out.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
  }
  return out;
};

describe("a serif on the foot of a stem", () => {
  it("stands on the line, as far out past the stem's edges as it reaches", () => {
    const ink = inkOf(stem(BOX, footed(SLAB)), ids);
    expect(ink).toHaveLength(1);
    const box = boxOf(ink);
    // The stem is 160 to 240; sixty past each edge, and no lower than the line.
    expect(box.minX).toBeCloseTo(100, 6);
    expect(box.maxX).toBeCloseTo(300, 6);
    expect(box.minY).toBeCloseTo(0, 6);
    // Forty high, and above that the stem alone.
    expect(inked(ink, 110, 35)).toBe(true);
    expect(inked(ink, 290, 35)).toBe(true);
    expect(inked(ink, 110, 45)).toBe(false);
    expect(inked(ink, 290, 45)).toBe(false);
    expect(inked(ink, 200, 300)).toBe(true);
  });

  it("is a slab of eight straight edges on a stem drawn with a rectangle", () => {
    const ink = inkOf(stem(BOX, footed(SLAB)), ids);
    expect(ink[0]!.nodes.every((n) => n.in === null && n.out === null)).toBe(true);
    expect(ink[0]!.nodes).toHaveLength(8);
  });

  it("is measured from the stroke as wide as its pen makes it, not from the pen", () => {
    // A broad edge at thirty degrees makes a stem narrower than the pen is wide.
    const bare = boxOf(inkOf(stem(BROAD, { cut: 0 }), ids));
    const ink = inkOf(stem(BROAD, footed(SLAB)), ids);
    expect(ink).toHaveLength(1);
    const box = boxOf(ink);
    const narrow = 80 * Math.cos(Math.PI / 6);
    expect(box.maxX - box.minX).toBeCloseTo(narrow + 120, 3);
    expect(box.minY).toBeCloseTo(0, 6);
    expect(box.maxY).toBeCloseTo(bare.maxY, 6);
  });

  it("reaches on one side only where the other reach is nothing", () => {
    const ink = inkOf(stem(BOX, footed({ ...SLAB, right: 0 })), ids);
    expect(ink).toHaveLength(1);
    const box = boxOf(ink);
    expect(box.minX).toBeCloseTo(100, 6);
    expect(box.maxX).toBeCloseTo(240, 6);
  });

  it("leans with a stem that leans, its foot still level", () => {
    const ink = inkOf(stem(OVAL, footed(SLAB), undefined, 120), ids);
    expect(ink).toHaveLength(1);
    expect(boxOf(ink).minY).toBeCloseTo(0, 6);
    // Just above the serif the stem has moved right with its lean, and the ink
    // is the stem's alone: nothing where an upright serif's side would be.
    expect(inked(ink, 200 + 12, 60)).toBe(true);
    expect(inked(ink, 130, 60)).toBe(false);
  });

  it("is left off, and the end cut plain, where it has no height", () => {
    const plain = inkOf(stem(OVAL, { cut: 0 }), ids);
    const ink = inkOf(stem(OVAL, footed({ ...SLAB, height: 0 })), ids);
    expect(boxOf(ink)).toEqual(boxOf(plain));
  });
});

describe("a serif's shape", () => {
  const cases: [string, Serif][] = [
    ["a slab", SLAB],
    ["bracketed", { ...SLAB, height: 24, bracket: 0.7 }],
    ["bracketed all the way", { ...SLAB, height: 24, bracket: 1 }],
    ["a wedge", { ...SLAB, height: 60, slope: 1, right: 0 }],
    ["half a wedge", { ...SLAB, slope: 0.5 }],
    ["cupped", { ...SLAB, cup: 12 }],
    ["cupped deeper than it is high", { ...SLAB, cup: 400 }],
    ["cupped and sloped to a point", { ...SLAB, cup: 30, slope: 1 }],
    ["rounded", { ...SLAB, round: 1 }],
    [
      "everything at once",
      { left: 70, right: 40, height: 36, bracket: 0.6, slope: 0.4, cup: 8, round: 0.8 },
    ],
    ["wider on the left", { ...SLAB, left: 120, right: 10, bracket: 0.5 }],
  ];

  it.each(cases)(
    "is one outline with the stroke, the same joined as in regions: %s",
    (_, serif) => {
      for (const nib of [BROAD, OVAL, BOX]) {
        const stroke = stem(nib, footed(serif));
        const joined = inkOf(stroke, ids);
        expect(joined).toHaveLength(1);
        expect(boxOf(joined).minY).toBeGreaterThan(-1e-6);
        expect(differences(joined, inkRegions(stroke))).toEqual([]);
      }
    },
  );

  it("has the same fourteen pieces whatever its numbers", () => {
    const seat = {
      through: at(200, 0),
      normal: at(0, -1),
      foot: { from: -40, to: 40 },
      top: { from: -40, to: 40 },
      rise: 60,
    };
    for (const [, serif] of cases) {
      expect(serifOutline(serif, seat)).toHaveLength(14);
    }
  });

  it("hollows its foot by the cup, and no further", () => {
    const ink = inkOf(stem(BOX, footed({ ...SLAB, cup: 12 })), ids);
    expect(inked(ink, 200, 10)).toBe(false);
    expect(inked(ink, 200, 14)).toBe(true);
    // The tips still stand on the line.
    expect(inked(ink, 104, 1)).toBe(true);
    expect(inked(ink, 296, 1)).toBe(true);
  });

  it("fills the corner between serif and stem with its bracket", () => {
    const square = inkOf(stem(BOX, footed({ ...SLAB, height: 24 })), ids);
    const bracketed = inkOf(stem(BOX, footed({ ...SLAB, height: 24, bracket: 1 })), ids);
    expect(inked(square, 150, 34)).toBe(false);
    expect(inked(bracketed, 150, 34)).toBe(true);
    // And leaves the tip as thin as it was.
    expect(inked(bracketed, 104, 30)).toBe(false);
  });
});

describe("a serif on the head of a stem", () => {
  it("is as wide as the stem under a cut that slants, on the canvas as in the font", () => {
    // The k whose head serif had a piece missing where it met the stem, on the
    // canvas only: the stem's side was cut in the wrong place by the slanted
    // line, and the serif took the stem for half as wide as it is.
    const head: Serif = {
      left: 60,
      right: 287,
      height: 30,
      bracket: 0.16,
      slope: 0.31,
      cup: 5,
      round: 1,
    };
    const stroke = withNib(
      contour(
        ids.contour(),
        [
          node(ids.node(), at(111.54800713159574, 750), { end: { cut: 17, serif: head } }),
          node(ids.node(), at(111.54800713159574, 0), { end: { cut: "square" } }),
        ],
        false,
      ),
      { angle: 30, width: 120, thickness: 4, squareness: 0.54 },
    );
    const joined = inkOf(stroke, ids);
    expect(joined).toHaveLength(1);
    expect(differences(joined, inkRegions(stroke))).toEqual([]);
    // Just right of the stem's middle and under the serif: ink, where the
    // notch was.
    expect(inked(inkRegions(stroke), 158, 712)).toBe(true);
  });

  it("stands on the head's line and hangs down from it, left still on the left", () => {
    const ink = inkOf(stem(BOX, undefined, { cut: 0, serif: { ...SLAB, right: 0 } }), ids);
    expect(ink).toHaveLength(1);
    const box = boxOf(ink);
    expect(box.maxY).toBeCloseTo(600, 6);
    expect(box.minX).toBeCloseTo(100, 6);
    expect(box.maxX).toBeCloseTo(240, 6);
    expect(inked(ink, 110, 570)).toBe(true);
    expect(inked(ink, 110, 550)).toBe(false);
  });

  it("is the same ink joined as in regions, at both ends at once", () => {
    const stroke = stem(OVAL, footed(SLAB), { cut: 0, serif: { ...SLAB, right: 0, slope: 1 } });
    const joined = inkOf(stroke, ids);
    expect(joined).toHaveLength(1);
    expect(differences(joined, inkRegions(stroke))).toEqual([]);
  });
});

describe("a serif drawn to one plan", () => {
  const light = stem({ ...OVAL, width: 40 }, footed({ ...SLAB, left: 30, right: 30, height: 16 }));
  const bold = stem(
    { ...OVAL, width: 140 },
    footed({ ...SLAB, left: 70, right: 70, height: 50, bracket: 0.6, cup: 6 }),
  );

  it("is the same ink as a single font draws, in each master", () => {
    const planned = plannedInk([light, bold], ids)!;
    expect(planned).not.toBeNull();
    expect(differences(planned[0]!, inkOf(light, ids))).toEqual([]);
    expect(differences(planned[1]!, inkOf(bold, ids))).toEqual([]);
  });

  it("has the same points in every master, the serif an outline of its own", () => {
    const planned = plannedInk([light, bold], ids)!;
    const shape = (k: number): string =>
      planned[k]!.map((c) =>
        c.nodes.map((n) => (n.in === null ? "" : "i") + (n.out === null ? "." : "o")).join(""),
      ).join("|");
    expect(planned[0]).toHaveLength(2);
    expect(shape(1)).toBe(shape(0));
  });

  it("is refused where one master has a serif and another none", () => {
    expect(plannedInk([light, stem({ ...OVAL, width: 140 }, { cut: 0 })], ids)).toBeNull();
  });

  it("interpolates between masters number by number", () => {
    const other = {
      ...bold,
      id: light.id,
      nodes: bold.nodes.map((n, i) => ({ ...n, id: light.nodes[i]!.id })),
    };
    const half = interpolateGlyph(
      [glyph("i", { contours: [light] }), glyph("i", { contours: [other] })],
      [0.5, 0.5],
    )!;
    const serif = half.contours[0]!.nodes[1]!.end!.serif!;
    expect(serif.left).toBeCloseTo(50, 9);
    expect(serif.height).toBeCloseTo(33, 9);
    expect(serif.bracket).toBeCloseTo(0.3, 9);
    expect(serif.cup).toBeCloseTo(3, 9);
  });
});

describe("a serif's numbers", () => {
  it("come back from what was written, with what is unsound made sound", () => {
    const end = readStrokeEnd({
      cut: 0,
      serif: {
        left: -5,
        right: 40,
        height: 30,
        bracket: 3,
        style: "Foot",
        own: ["right", "nonsense"],
      },
    })!;
    expect(end.serif).toEqual({
      left: 0,
      right: 40,
      height: 30,
      bracket: 1,
      slope: 0,
      cup: 0,
      round: 0,
      style: "Foot",
      own: ["right"],
    });
  });

  it("follow their style, but for the ones set on the end itself", () => {
    const style = { name: "Foot", ...SLAB };
    const end = withSerifNumber({ ...SLAB, style: "Foot" }, "right", 10);
    expect(end.own).toEqual(["right"]);
    const now = restyled(end, { ...style, left: 90, right: 90, height: 50 });
    expect(now.left).toBe(90);
    expect(now.height).toBe(50);
    expect(now.right).toBe(10);
  });

  it("are a font's styles one to a name", () => {
    const styles = readSerifStyles([
      { name: "Foot", ...SLAB },
      { name: "Foot", ...SLAB, left: 1 },
      { name: " ", ...SLAB },
      { name: "Head", height: 20 },
    ]);
    expect(styles.map((s) => s.name)).toEqual(["Foot", "Head"]);
    expect(styles[0]!.left).toBe(60);
    expect(styles[1]!.height).toBe(20);
  });
});
