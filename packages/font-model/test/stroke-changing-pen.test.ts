import type { Cubic, PenShape, SegmentBlend } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import { disagreement, sweep } from "../../geometry/test/sweep.js";
import {
  type Contour,
  type Nib,
  contour,
  segmentAt,
  segmentCount,
  segmentCubic,
} from "../src/contour.js";
import { counterIds } from "../src/ids.js";
import { type NodeInit, node } from "../src/node.js";
import { penUnder } from "../src/pen-under.js";
import { DEFAULT_SERIF, serifRise } from "../src/serif.js";
import { inkOf, inkRegions } from "../src/stroke.js";

/**
 * A pen that changes fast for how far it goes.
 *
 * The start of an n's arch, as somebody drew it: a long pen standing upright
 * along the path, turned forty degrees and squared a little over the first
 * seventy units. Its sides straight out from the path are not the edge of its
 * ink — the pen's upper tip stands out ahead of the path where it began, and
 * its lower tip swings out behind as it turns — and the ink was drawn short
 * there, notched where the sides were swept as a fold. What is asked is the
 * pen swept along the path, and nothing else.
 */

const ids = counterIds("changing");
const at = (x: number, y: number) => ({ x, y });
const SMOOTH: SegmentBlend = { angle: "smooth", shape: "smooth" };
const EASE: SegmentBlend = { angle: "ease", shape: "ease" };

type Point = { pt: { x: number; y: number }; init: NodeInit };

const strokeOf = (points: readonly Point[], nib: Nib): Contour => ({
  ...contour(
    ids.contour(),
    points.map((p) => node(ids.node(), p.pt, p.init)),
    false,
  ),
  nib,
});

const loopsOf = (contours: readonly Contour[]): Cubic[][] =>
  contours.map((c) => {
    const out: Cubic[] = [];
    for (let i = 0; i < segmentCount(c); i++) {
      const s = segmentAt(c, i);
      if (s !== null) out.push(segmentCubic(s));
    }
    return out;
  });

const pensOf = (c: Contour): PenShape[] =>
  c.nodes.map((n) => {
    const pen = n.pen ?? c.nib!;
    return { ...pen, thickness: pen.thickness ?? 0 };
  });

const ARCH = strokeOf(
  [
    {
      pt: at(182, 344),
      init: {
        type: "tangent",
        out: at(187, 371),
        pen: { angle: 90, width: 110, thickness: 20 },
        blend: SMOOTH,
      },
    },
    {
      pt: at(215.5036768425422, 410.4963742181191),
      init: {
        type: "tangent",
        in: at(195.32817833031606, 392.80826593342766),
        pen: { angle: 50, width: 108.64930016035147, thickness: 23, squareness: 0.2332547 },
        blend: SMOOTH,
      },
    },
    {
      pt: at(256, 446),
      init: {
        type: "tangent",
        out: at(278.49939776781696, 465.72549941288065),
        pen: { angle: 50, width: 100, thickness: 23, squareness: 0.4 },
        blend: EASE,
      },
    },
    {
      pt: at(347, 478),
      init: {
        type: "smooth",
        in: at(315.7939272231609, 478),
        pen: { angle: 30, width: 90, thickness: 40, squareness: 0.4 },
      },
    },
  ],
  { angle: 30, width: 90, thickness: 30, squareness: 0.4 },
);

describe("a long pen turning away from lying along the path", () => {
  const curves = loopsOf([ARCH])[0]!;
  const truth = sweep(
    curves,
    pensOf(ARCH),
    false,
    ARCH.nodes.map((n) => n.blend),
  );

  it("is the pen swept along the path, drawn in regions", () => {
    const d = disagreement(loopsOf(inkRegions(ARCH)), truth, 60);
    expect(d.checked).toBeGreaterThan(500);
    expect(d.missing).toEqual([]);
    expect(d.extra).toEqual([]);
  }, 300_000);

  it("is the pen swept along the path, joined into one outline", () => {
    const ink = inkOf(ARCH, ids);
    expect(ink).toHaveLength(1);
    const d = disagreement(loopsOf(ink), truth, 60);
    expect(d.missing).toEqual([]);
    expect(d.extra).toEqual([]);
  }, 300_000);
});

describe("a serif on a stroke that flares towards it", () => {
  // A stem as wide as its pen down to the last stretch, and wider at the foot.
  const pen = (width: number): Nib => ({ angle: 30, width, thickness: 30, squareness: 0.4 });
  const serif = { ...DEFAULT_SERIF, left: 80, right: 80, height: 37, bracket: 0.38, slope: 0.07 };
  const stem = strokeOf(
    [
      { pt: at(48, 350), init: { pen: pen(95), blend: SMOOTH } },
      { pt: at(48, 178), init: { pen: pen(95), blend: SMOOTH } },
      { pt: at(48, 0), init: { pen: pen(110), end: { cut: "square", serif } } },
    ],
    pen(100),
  );

  it("leaves the stroke the way the stroke's edge goes, on both sides", () => {
    const rise = serifRise(serif);
    const ink = inkOf(stem, ids);
    let seen = 0;
    for (const c of ink) {
      const count = c.nodes.length;
      c.nodes.forEach((n, i) => {
        // Where the brackets meet the stem's two edges, at the top of the serif.
        if (Math.abs(n.pt.y - rise) > 0.5) return;
        const before = c.nodes[(i - 1 + count) % count]!;
        const after = c.nodes[(i + 1) % count]!;
        const arriving = n.in ?? before.out ?? before.pt;
        const leaving = n.out ?? after.in ?? after.pt;
        const a = Math.atan2(n.pt.y - arriving.y, n.pt.x - arriving.x);
        const b = Math.atan2(leaving.y - n.pt.y, leaving.x - n.pt.x);
        let turn = Math.abs(a - b) % (2 * Math.PI);
        if (turn > Math.PI) turn = 2 * Math.PI - turn;
        expect((turn * 180) / Math.PI, `at ${n.pt.x.toFixed(1)}`).toBeLessThan(0.5);
        seen++;
      });
    }
    expect(seen).toBe(2);
  });
});

describe("the pen under the pointer", () => {
  const stem = strokeOf(
    [
      { pt: at(100, 0), init: { pen: { angle: 0, width: 40, thickness: 20 } } },
      { pt: at(100, 400), init: { pen: { angle: 0, width: 120, thickness: 20 } } },
    ],
    { angle: 0, width: 40, thickness: 20 },
  );

  it("is the pen where the pointer is along the stroke, anywhere over its ink", () => {
    const under = penUnder([stem], at(120, 200), 3);
    expect(under).not.toBeNull();
    expect(under!.at.y).toBeCloseTo(200, 3);
    expect(under!.pen.width).toBeCloseTo(80, 3);
    const xs = under!.outline.flatMap((c) => [c.a.x, c.b.x]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(80, 0);
  });

  it("is nothing off the stroke", () => {
    expect(penUnder([stem], at(200, 200), 3)).toBeNull();
  });

  it("is found near the path of a stroke too thin to be over", () => {
    const hair = strokeOf(
      [
        { pt: at(0, 0), init: {} },
        { pt: at(300, 0), init: {} },
      ],
      { angle: 0, width: 4 },
    );
    expect(penUnder([hair], at(150, 2.5), 3)?.pen.width).toBe(4);
    expect(penUnder([hair], at(150, 10), 3)).toBeNull();
  });
});
