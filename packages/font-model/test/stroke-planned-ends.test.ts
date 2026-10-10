import { evaluate } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import {
  type Contour,
  type Nib,
  contour,
  contourBounds,
  segmentAt,
  segmentCount,
  segmentCubic,
} from "../src/contour.js";
import { insideGlyph } from "../src/direction.js";
import { glyph } from "../src/glyph.js";
import { counterIds } from "../src/ids.js";
import { type StrokeEnd, node } from "../src/node.js";
import { inkOf, plannedInk, withNib } from "../src/stroke.js";

/**
 * A stroke with a cut end, drawn to one plan for a variable font.
 *
 * The line round the ink stops at the cut on each side of the stroke and goes
 * along it, or round half the pen's outline, in place of the pen's own edge.
 * What is asked is that it fills as the ink a single font gets — the stroke
 * carried on and cut — and that it is the same pieces in every master.
 */

const ids = counterIds("pe");
const at = (x: number, y: number) => ({ x, y });

/** How many times the planned line goes round a point: more than none is ink. */
function winding(contours: readonly Contour[], q: { x: number; y: number }): number {
  let w = 0;
  for (const c of contours) {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < segmentCount(c); i++) {
      const curve = segmentCubic(segmentAt(c, i)!);
      for (let k = 0; k < 24; k++) pts.push(evaluate(curve, k / 24));
    }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const side = (b.x - a.x) * (q.y - a.y) - (q.x - a.x) * (b.y - a.y);
      if (a.y <= q.y) {
        if (b.y > q.y && side > 0) w++;
      } else if (b.y <= q.y && side < 0) w--;
    }
  }
  return w;
}

/** Where the planned line and the joined ink disagree, on a grid, away from the edge. */
function disagreement(planned: readonly Contour[], joined: readonly Contour[], margin = 1.5) {
  const g = glyph("g", { contours: [...joined] });
  const boxes = joined.map((c) => contourBounds(c)!);
  const minX = Math.min(...boxes.map((b) => b.minX)) - 20;
  const maxX = Math.max(...boxes.map((b) => b.maxX)) + 20;
  const minY = Math.min(...boxes.map((b) => b.minY)) - 20;
  const maxY = Math.max(...boxes.map((b) => b.maxY)) + 20;
  const step = Math.max(maxX - minX, maxY - minY) / 70;
  const ring = [
    [margin, 0],
    [-margin, 0],
    [0, margin],
    [0, -margin],
  ] as const;
  let checked = 0;
  let least = Infinity;
  const wrong: string[] = [];
  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      const here = insideGlyph(g, at(x, y));
      if (!ring.every(([dx, dy]) => insideGlyph(g, at(x + dx, y + dy)) === here)) continue;
      checked++;
      const w = winding(planned, at(x, y));
      least = Math.min(least, w);
      if (w > 0 !== here) wrong.push(`${x.toFixed(0)},${y.toFixed(0)}`);
    }
  }
  return { checked, wrong, least };
}

const shapeOf = (contours: readonly Contour[]): string =>
  contours
    .map((c) =>
      c.nodes
        .map((n, i) =>
          n.out === null && c.nodes[(i + 1) % c.nodes.length]!.in === null ? "l" : "c",
        )
        .join(""),
    )
    .join(" ");

const OVAL: Nib = { angle: 30, width: 80, thickness: 24 };
const BROAD: Nib = { angle: 30, width: 80 };

/** A stem with a bend in it, from the top down to the baseline. */
const stem = (nib: Nib, foot?: StrokeEnd, head?: StrokeEnd, lean = 0): Contour =>
  withNib(
    contour(
      ids.contour(),
      [
        node(ids.node(), at(200 + lean, 600), {
          out: at(200 + lean, 420),
          ...(head === undefined ? {} : { end: head }),
        }),
        node(ids.node(), at(240, 0), {
          in: at(240, 200),
          ...(foot === undefined ? {} : { end: foot }),
        }),
      ],
      false,
    ),
    nib,
  );

describe("a cut end, drawn to one plan", () => {
  const cases: readonly (readonly [string, Nib, StrokeEnd | undefined, StrokeEnd | undefined])[] = [
    ["an oval's foot cut level", OVAL, { cut: 0 }, undefined],
    ["an oval's foot cut level and closed with the nib", OVAL, { cut: 0, shape: "nib" }, undefined],
    [
      "an oval cut at both ends, one square and one on a slant",
      OVAL,
      { cut: "square" },
      { cut: 25 },
    ],
    [
      "an oval's foot cut on a slant and closed with the nib",
      OVAL,
      { cut: 20, shape: "nib" },
      undefined,
    ],
    [
      "a round pen's foot closed with the nib",
      { angle: 0, width: 70, thickness: 70 },
      { cut: 0, shape: "nib" },
      undefined,
    ],
    ["a broad edge's foot cut level", BROAD, { cut: 0 }, undefined],
    ["a broad edge cut at both ends", BROAD, { cut: 0 }, { cut: 0 }],
  ];

  it.each(cases)("fills as the stroke carried on and cut does: %s", (_, nib, foot, head) => {
    const stroke = stem(nib, foot, head);
    const planned = plannedInk([stroke], ids);
    expect(planned).not.toBeNull();
    const d = disagreement(planned![0]!, inkOf(stroke, ids));
    expect(d.checked).toBeGreaterThan(800);
    expect(d.wrong).toEqual([]);
    // And goes round nothing the wrong way.
    expect(d.least).toBe(0);
  });

  it("is the same pieces in a light master and a bold one", () => {
    for (const foot of [{ cut: 0 }, { cut: 0, shape: "nib" }] as const) {
      const light = stem({ angle: 30, width: 40, thickness: 12 }, foot);
      const bold = stem({ angle: 20, width: 140, thickness: 50 }, foot, undefined, 30);
      const planned = plannedInk([light, bold], ids)!;
      expect(planned).not.toBeNull();
      expect(shapeOf(planned[1]!)).toBe(shapeOf(planned[0]!));
      // Each is still its own master's ink.
      for (const [k, stroke] of [light, bold].entries()) {
        expect(disagreement(planned[k]!, inkOf(stroke, ids)).wrong).toEqual([]);
      }
    }
  });

  it("has no one plan where one master cuts an end and another does not", () => {
    expect(plannedInk([stem(OVAL, { cut: 0 }), stem(OVAL)], ids)).toBeNull();
    expect(
      plannedInk([stem(OVAL, { cut: 0 }), stem(OVAL, { cut: 0, shape: "nib" })], ids),
    ).toBeNull();
  });
});

describe("a cut at the end of a segment that turns on its way there, drawn to one plan", () => {
  // The stroke a cut once took a bite out of: its last segment rises over a
  // hump before it comes down to an end cut on a slant.
  const drawn = (end: StrokeEnd): Contour =>
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
          node(ids.node(), at(675.99, 16.888), { end }),
        ],
        false,
      ),
      { angle: 30, width: 80, thickness: 30 },
    );

  const ends: readonly (readonly [string, StrokeEnd])[] = [
    ["closed straight", { cut: 149 }],
    ["closed with the nib", { cut: 149, shape: "nib" }],
  ];
  it.each(ends)("fills as the single font's ink does: %s", (_, end) => {
    const stroke = drawn(end);
    const planned = plannedInk([stroke], ids);
    expect(planned).not.toBeNull();
    const d = disagreement(planned![0]!, inkOf(stroke, ids), 2);
    expect(d.checked).toBeGreaterThan(800);
    expect(d.wrong).toEqual([]);
    expect(d.least).toBe(0);
  });
});
