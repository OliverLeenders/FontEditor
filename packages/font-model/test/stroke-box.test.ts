import type { Cubic } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import { STROKE_CASES } from "../../geometry/test/stroke-cases.js";
import { disagreement, sweep } from "../../geometry/test/sweep.js";
import {
  type Contour,
  type Nib,
  contour,
  segmentAt,
  segmentCount,
  segmentCubic,
} from "../src/contour.js";
import { contourOfCurves } from "../src/curves.js";
import { counterIds } from "../src/ids.js";
import { type StrokeEnd, node } from "../src/node.js";
import { inkOf, inkRegions, withNib } from "../src/stroke.js";

/**
 * A rectangular pen, which is exact.
 *
 * At all the squareness there is a pen is a rectangle, and a rectangle's reach
 * to either side is one of its corners: so the edge of its ink is the path
 * itself moved over, with the pen's own straight edges across the ends. Short
 * of that the pen's outline has an exponent and its ink is fitted. What is
 * asked is that the rectangle's ink is to the unit, has no more points than
 * the shape has corners and the path has curves, and is still the pen swept
 * along the path.
 */

const ids = counterIds("box");
const at = (x: number, y: number) => ({ x, y });
const points = (c: Contour): string[] =>
  c.nodes.map(
    (n) => `${String(Math.round(n.pt.x * 1e6) / 1e6)},${String(Math.round(n.pt.y * 1e6) / 1e6)}`,
  );

const stem = (nib: Nib, foot?: StrokeEnd): Contour =>
  withNib(
    contour(
      ids.contour(),
      [
        node(ids.node(), at(200, 600)),
        node(ids.node(), at(200, 0), foot === undefined ? {} : { end: foot }),
      ],
      false,
    ),
    nib,
  );

describe("the ink of a rectangular pen", () => {
  const LEVEL: Nib = { angle: 0, width: 80, thickness: 40, squareness: 1 };

  it("is a rectangle for a stem drawn along the pen's edge: four points, to the unit", () => {
    const ink = inkOf(stem(LEVEL), ids);
    expect(ink).toHaveLength(1);
    expect(points(ink[0]!).sort()).toEqual(["160,-20", "160,620", "240,-20", "240,620"].sort());
    // And every edge of it straight.
    expect(ink[0]!.nodes.every((n) => n.in === null && n.out === null)).toBe(true);
  });

  it("is six points for a stem drawn with the pen turned: its two far corners at each end", () => {
    const ink = inkOf(stem({ ...LEVEL, angle: 30 }), ids);
    expect(ink).toHaveLength(1);
    expect(ink[0]!.nodes).toHaveLength(6);
    expect(ink[0]!.nodes.every((n) => n.in === null && n.out === null)).toBe(true);
  });

  it("ends on the cut where its foot is cut, and is still a few straight edges", () => {
    const ink = inkOf(stem({ ...LEVEL, angle: 30 }, { cut: 0 }), ids);
    expect(ink).toHaveLength(1);
    expect(Math.min(...ink[0]!.nodes.map((n) => n.pt.y))).toBeCloseTo(0, 9);
    expect(ink[0]!.nodes.length).toBeLessThanOrEqual(6);
  });

  it("is what the canvas fills: the one line round it, and no pieces to join", () => {
    expect(inkRegions(stem(LEVEL))).toHaveLength(1);
  });

  it("is fitted, as it was, for a pen a hair short of a rectangle", () => {
    const ink = inkOf(stem({ ...LEVEL, squareness: 0.99 }), ids);
    expect(ink[0]!.nodes.some((n) => n.in !== null || n.out !== null)).toBe(true);
  });
});

describe("the ink of a rectangular pen, against the pen swept along the path", () => {
  const cases = [
    "an oval pen round a sharp V",
    "an oval pen along an S",
    "an oval pen round a closed square",
  ].map((name) => STROKE_CASES.find((c) => c.name === name)!);

  it.each(cases)("fills as the pen does, in far fewer points: $name", { timeout: 240_000 }, (c) => {
    const skeleton = contourOfCurves(
      c.curves.map((curve) => ({ curve, line: false })),
      ids,
      c.closed,
    );
    const pens = c.pens.map((p) => ({ ...p, squareness: 1 }));
    const stroke = { ...skeleton, nib: pens[0]! } as Contour;
    const ink = inkOf(stroke, ids);
    const loops: Cubic[][] = ink.map((o) => {
      const out: Cubic[] = [];
      for (let i = 0; i < segmentCount(o); i++) {
        const s = segmentAt(o, i);
        if (s !== null) out.push(segmentCubic(s));
      }
      return out;
    });
    const d = disagreement(loops, sweep(c.curves, pens, c.closed), 45);
    expect(d.checked).toBeGreaterThan(500);
    expect(d.missing).toEqual([]);
    expect(d.extra).toEqual([]);
    expect(ink.reduce((sum, o) => sum + o.nodes.length, 0)).toBeLessThanOrEqual(24);
  });
});
