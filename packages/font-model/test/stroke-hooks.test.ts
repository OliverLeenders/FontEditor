import type { Cubic } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import { winding } from "../../geometry/test/sweep.js";
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
import { type StrokeEnd, node } from "../src/node.js";
import { inkOf, inkRegions, plannedInk, withNib } from "../src/stroke.js";

/**
 * A cut on the last of a stroke that is more than its last segment.
 *
 * A stem that comes down a diagonal and turns upright a few units from the
 * line it stands on has its pen still standing at that turn, reaching past the
 * line: cut as its last segment alone, the pen at the turn was left sticking
 * out under the foot. The cut is made of the last of the stroke — back through
 * every segment that comes steeply to the line. What is asked is that nothing
 * is left past the line there, that a stroke which only passes near the line
 * is not shaved by it, and that the ink is the same however it is drawn.
 */

const ids = counterIds("hooks");
const at = (x: number, y: number) => ({ x, y });
const OVAL: Nib = { angle: 30, width: 80, thickness: 24 };
const BROAD: Nib = { angle: 30, width: 80 };
const ROUND: Nib = { angle: 0, width: 70, thickness: 70 };

const path = (nib: Nib, points: readonly { x: number; y: number }[], foot?: StrokeEnd): Contour =>
  withNib(
    contour(
      ids.contour(),
      points.map((p, i) =>
        node(ids.node(), p, i === points.length - 1 && foot !== undefined ? { end: foot } : {}),
      ),
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
const differences = (a: readonly Contour[], b: readonly Contour[]): string[] => {
  const box = boxOf([...a, ...b]);
  const out: string[] = [];
  const [la, lb] = [loopsOf(a), loopsOf(b)];
  for (let x = box.minX - 3.37; x < box.maxX + 4; x += 6.3) {
    for (let y = box.minY - 3.29; y < box.maxY + 4; y += 6.1) {
      const [wa, wb] = [winding(la, at(x, y)), winding(lb, at(x, y))];
      if ((wa !== 0) !== (wb !== 0)) out.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
  }
  return out;
};

/** Down a diagonal to a turn, and upright from there to the line: the drop is the last segment. */
const hooked = (nib: Nib, drop: number, foot?: StrokeEnd): Contour =>
  path(nib, [at(100, 420), at(300, drop), at(300, 0)], foot);

describe("a foot a few units below a turn", () => {
  it.each([4, 12, 30])(
    "ends on the line, the pen at the turn cut with it: a drop of %d",
    (drop) => {
      for (const nib of [OVAL, BROAD, ROUND]) {
        const uncut = boxOf(inkOf(hooked(nib, drop), ids));
        // Without the cut the pen reaches under the line, or there is nothing to ask.
        expect(uncut.minY).toBeLessThan(-5);
        const ink = inkOf(hooked(nib, drop, { cut: 0 }), ids);
        expect(ink).toHaveLength(1);
        expect(boxOf(ink).minY).toBeGreaterThan(-1e-6);
        expect(boxOf(ink).minY).toBeLessThan(1e-3);
      }
    },
  );

  it("is the same ink joined as in regions", { timeout: 120_000 }, () => {
    for (const drop of [4, 12, 30, 90]) {
      for (const nib of [OVAL, BROAD, ROUND]) {
        const stroke = hooked(nib, drop, { cut: 0 });
        expect(differences(inkOf(stroke, ids), inkRegions(stroke))).toEqual([]);
      }
    }
  });

  it("leaves the top of the diagonal as it was, a long way from the line", () => {
    const uncut = inkOf(hooked(OVAL, 12), ids);
    const cut = inkOf(hooked(OVAL, 12, { cut: 0 }), ids);
    expect(Math.abs(boxOf(cut).maxY - boxOf(uncut).maxY)).toBeLessThan(0.05);
    expect(Math.abs(boxOf(cut).minX - boxOf(uncut).minX)).toBeLessThan(0.05);
  });
});

describe("a stroke that only passes near the line of a cut", () => {
  it("is not shaved by it: a bar, and a drop at its end shorter than the pen is thick", () => {
    // Level along y = 400 and down twelve to a foot cut level at 388: the bar's
    // own underside is lower than that the whole way along, and is the bar's.
    const bar = (foot?: StrokeEnd): Contour =>
      path(OVAL, [at(100, 400), at(300, 400), at(300, 388)], foot);
    const uncut = inkOf(bar(), ids);
    const cut = inkOf(bar({ cut: 0 }), ids);
    // Half way along the bar and under the line of the foot: the bar's ink
    // before the cut, and after it.
    expect(inked(uncut, 200, 382)).toBe(true);
    expect(inked(cut, 200, 382)).toBe(true);
    expect(differences(cut, inkRegions(bar({ cut: 0 })))).toEqual([]);
  });

  it("is not shaved by it: a bar that slopes a little towards the line", () => {
    // Falling one in ten towards a foot cut level six under its end.
    const sloping = (foot?: StrokeEnd): Contour =>
      path(OVAL, [at(0, 440), at(300, 410), at(300, 404)], foot);
    const uncut = inkOf(sloping(), ids);
    const cut = inkOf(sloping({ cut: 0 }), ids);
    // Near its end its underside is under the line of the foot, and stays.
    expect(inked(uncut, 250, 398)).toBe(true);
    expect(inked(cut, 250, 398)).toBe(true);
  });

  it("is cut by it where it turns to come steeply, and not before", () => {
    // A curve that runs level and turns down into the foot: the level of it is
    // left, the fall of it is cut with the foot.
    const curved = (foot?: StrokeEnd): Contour =>
      withNib(
        contour(
          ids.contour(),
          [
            node(ids.node(), at(0, 300)),
            node(ids.node(), at(200, 300), { out: at(300, 300) }),
            node(ids.node(), at(300, 30), { in: at(300, 200) }),
            node(ids.node(), at(300, 0), foot === undefined ? {} : { end: foot }),
          ],
          false,
        ),
        ROUND,
      );
    const cut = inkOf(curved({ cut: 0 }), ids);
    expect(cut).toHaveLength(1);
    expect(boxOf(cut).minY).toBeCloseTo(0, 3);
    expect(boxOf(cut).maxY).toBeCloseTo(boxOf(inkOf(curved(), ids)).maxY, 6);
    expect(differences(cut, inkRegions(curved({ cut: 0 })))).toEqual([]);
  });
});

describe("a foot a few units below a turn, drawn to one plan", () => {
  it.each([4, 12, 30, 90])(
    "has a plan, and is the single font's ink in each master: a drop of %d",
    { timeout: 180_000 },
    (drop) => {
      for (const [name, nib] of [
        ["oval", OVAL],
        ["broad", BROAD],
        ["round", ROUND],
      ] as const) {
        // Two masters, the second a little heavier: one plan for both, the same
        // pieces in each, and each the ink a single font has of it. A drop of a
        // few units had no plan: the pen is wider than the drop is long, a side
        // of it never crosses the line, and there was nothing of it to stop.
        const stroke = hooked(nib, drop, { cut: 0 });
        const heavier = hooked({ ...nib, width: nib.width + 20 }, drop, { cut: 0 });
        const planned = plannedInk([stroke, heavier], ids);
        expect(planned, name).not.toBeNull();
        expect(differences(planned![0]!, inkOf(stroke, ids)), name).toEqual([]);
        expect(differences(planned![1]!, inkOf(heavier, ids)), name).toEqual([]);
        const shape = (k: number): string =>
          planned!
            [k]!.map((c) => c.nodes.map((n) => (n.out === null ? "l" : "c")).join(""))
            .join("|");
        expect(shape(1), name).toBe(shape(0));
      }
    },
  );
});
