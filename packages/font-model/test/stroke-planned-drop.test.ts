import type { Cubic } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import { disagreement, winding } from "../../geometry/test/sweep.js";
import {
  type Contour,
  type Nib,
  contour,
  contourBounds,
  segmentAt,
  segmentCount,
  segmentCubic,
} from "../src/contour.js";
import { counterIds } from "../src/ids.js";
import { node } from "../src/node.js";
import { inkRegions, plannedInk, withNib } from "../src/stroke.js";

/**
 * A drop at the end of a bar, shorter than the pen is thick, in a variable font.
 *
 * The bar is not on its way to the line the drop is cut on, and is not cut by
 * it; and the drop's own side, on the side the pen leans to, is past that line
 * from end to end, so there is nothing of it to stop at the cut. The stroke is
 * then drawn as the two things it is — the bar whole, the pen standing where
 * the drop begins, and the drop as what lies between its two sides and the
 * cut — which overlap and are filled as one. What is asked is that the two
 * together fill as the canvas does, in every master the same pieces.
 */

const ids = counterIds("drop");
const at = (x: number, y: number) => ({ x, y });

const loopsOf = (contours: readonly Contour[]): Cubic[][] =>
  contours.map((o) => {
    const out: Cubic[] = [];
    for (let i = 0; i < segmentCount(o); i++) {
      const s = segmentAt(o, i);
      if (s !== null) out.push(segmentCubic(s));
    }
    return out;
  });

const stroke = (
  points: readonly { x: number; y: number }[],
  cut: number | "square",
  nib: Nib,
): Contour =>
  withNib(
    contour(
      ids.contour(),
      points.map((p, i) => node(ids.node(), p, i === points.length - 1 ? { end: { cut } } : {})),
      false,
    ),
    nib,
  );

/** The planned line against the ink the canvas fills, over a grid: where they differ. */
function against(c: Contour, planned: readonly Contour[]) {
  const regions = inkRegions(c);
  const loops = loopsOf(regions);
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const r of [...regions, ...planned]) {
    const b = contourBounds(r);
    if (b === null) continue;
    bounds.minX = Math.min(bounds.minX, b.minX);
    bounds.minY = Math.min(bounds.minY, b.minY);
    bounds.maxX = Math.max(bounds.maxX, b.maxX);
    bounds.maxY = Math.max(bounds.maxY, b.maxY);
  }
  const canvas = { inked: (q: { x: number; y: number }) => winding(loops, q) !== 0, bounds };
  return disagreement(loopsOf(planned), canvas, 48);
}

// A round pen and a squared one too, where everything is asked for: they
// fill the same, and each is a minute of looking.
const PENS: readonly (readonly [string, Nib])[] = [
  ["an oval", { angle: 30, width: 140, thickness: 60 }],
  ["a broad edge", { angle: 30, width: 140 }],
  ["a rectangle", { angle: 20, width: 120, thickness: 60, squareness: 1 }],
  ...(process.env["STROKE_DIAGNOSE"] === undefined
    ? []
    : ([
        ["a round pen", { angle: 0, width: 140, thickness: 140 }],
        ["a squared pen", { angle: 20, width: 120, thickness: 60, squareness: 0.6 }],
      ] as const)),
];

const SHAPES: readonly (readonly [
  string,
  readonly { x: number; y: number }[],
  number | "square",
])[] = [
  ["an arch and a drop cut level", [at(100, 300), at(300, 420), at(330, 395)], 0],
  ["a bar and a drop cut level", [at(60, 400), at(360, 400), at(366, 380)], 0],
  ["a stem and a foot to the right cut upright", [at(200, 500), at(200, 40), at(235, 30)], 90],
  ["a hairpin and a drop cut level", [at(320, 60), at(200, 400), at(180, 370)], 0],
];

describe("a drop shorter than the pen is thick, drawn to one plan", () => {
  const cases = SHAPES.flatMap(([shape, points, cut]) =>
    PENS.map(([pen, nib]) => [shape, pen, points, cut, nib] as const),
  );

  it.each(cases)("fills as the canvas does: %s, with %s", { timeout: 240_000 }, (...given) => {
    const [, , points, cut, nib] = given;
    const c = stroke(points, cut, nib);
    const planned = plannedInk([c], ids);
    expect(planned).not.toBeNull();
    const d = against(c, planned![0]!);
    expect(d.checked).toBeGreaterThan(300);
    expect(d.missing).toEqual([]);
    expect(d.extra).toEqual([]);
  });

  it("is the same pieces in a light master and a heavy one", { timeout: 240_000 }, () => {
    const [, points, cut] = SHAPES[0]!;
    const light = stroke(points, cut, { angle: 30, width: 50, thickness: 20 });
    const heavy = stroke(points, cut, { angle: 30, width: 140, thickness: 60 });
    const planned = plannedInk([light, heavy], ids);
    expect(planned).not.toBeNull();
    expect(planned![0]).toHaveLength(planned![1]!.length);
    for (const [k, loop] of planned![0]!.entries()) {
      expect(loop.nodes).toHaveLength(planned![1]![k]!.nodes.length);
    }
    for (const [k, c] of [light, heavy].entries()) {
      const d = against(c, planned![k]!);
      expect(d.missing).toEqual([]);
      expect(d.extra).toEqual([]);
    }
  });
});
