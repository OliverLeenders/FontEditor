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
 * A cut a few units past a corner, drawn to one plan for a variable font.
 *
 * A cut is made of the last of the stroke, and the stroke before that is whole:
 * it ends with the pen standing at the corner, and where the corner is nearer
 * the cut than the pen is wide the pen reaches past the cut's line there. That
 * is ink, in a single font and on the canvas. What is asked is that the line a
 * variable font gets fills it too — the pen laid at the corner, a loop of its
 * own — and that nothing is laid where the pen does not reach the line.
 */

const ids = counterIds("standing");
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
  return disagreement(loopsOf(planned), canvas, 90);
}

const OVAL: Nib = { angle: 30, width: 140, thickness: 60 };
const ROUND: Nib = { angle: 0, width: 140, thickness: 140 };
const BOX: Nib = { angle: 20, width: 120, thickness: 60, squareness: 1 };
const SQUARED: Nib = { angle: 20, width: 120, thickness: 60, squareness: 0.6 };

/** Up a diagonal, round a sharp corner, and thirty units down to a level cut. */
const HAIRPIN = [at(320, 60), at(200, 400), at(180, 370)];
/** Down a stem and a short foot to the right, cut upright. */
const FOOT = [at(200, 500), at(200, 40), at(235, 30)];
/** Down a diagonal and forty units straight down to a slanted cut: the pen clear of the line. */
const CLEAR = [at(400, 500), at(250, 60), at(250, 20)];

describe("the pen standing at a corner just short of a cut, in a variable font", () => {
  it.each([
    ["an oval round a hairpin", HAIRPIN, 0, OVAL],
    ["a rectangle round a hairpin", HAIRPIN, 0, BOX],
    ["a squared pen round a hairpin", HAIRPIN, 0, SQUARED],
    ["a round pen at a short foot", FOOT, 90, ROUND],
  ] as const)(
    "is ink past the cut's line, as on the canvas: %s",
    { timeout: 240_000 },
    (_name, points, cut, nib) => {
      const c = stroke(points, cut, nib);
      const planned = plannedInk([c], ids);
      expect(planned).not.toBeNull();
      // The line round the stroke, and the pen at the corner.
      expect(planned![0]).toHaveLength(2);
      const d = against(c, planned![0]!);
      expect(d.checked).toBeGreaterThan(2000);
      expect(d.missing).toEqual([]);
      expect(d.extra).toEqual([]);
    },
  );

  it.each([
    ["an oval", OVAL],
    ["a round pen", ROUND],
    ["a rectangle", BOX],
    ["a squared pen", SQUARED],
    ["a broad edge", { angle: 30, width: 140 }],
  ] as const)(
    "is not laid where it does not reach the line: %s",
    { timeout: 240_000 },
    (_name, nib) => {
      const c = stroke(CLEAR, 35, nib);
      const planned = plannedInk([c], ids);
      expect(planned).not.toBeNull();
      expect(planned![0]).toHaveLength(1);
      const d = against(c, planned![0]!);
      expect(d.missing).toEqual([]);
      expect(d.extra).toEqual([]);
    },
  );

  it("is laid in every master where it reaches the line in one", { timeout: 240_000 }, () => {
    const light = stroke(HAIRPIN, 0, { angle: 30, width: 40, thickness: 16 });
    const heavy = stroke(HAIRPIN, 0, OVAL);
    // On its own the light master's pen is clear of the line.
    expect(plannedInk([light], ids)![0]).toHaveLength(1);
    const planned = plannedInk([light, heavy], ids);
    expect(planned).not.toBeNull();
    expect(planned![0]).toHaveLength(2);
    expect(planned![1]).toHaveLength(2);
    expect(planned![0]![1]!.nodes).toHaveLength(planned![1]![1]!.nodes.length);
    for (const [k, c] of [light, heavy].entries()) {
      const d = against(c, planned![k]!);
      expect(d.missing).toEqual([]);
      expect(d.extra).toEqual([]);
    }
  });
});
