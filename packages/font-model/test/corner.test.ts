import { type Vec2, curvature, distance } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import { type Contour, contour, segmentAt, segmentCount, segmentCubic } from "../src/contour.js";
import {
  continuousCuts,
  continuousSizeAt,
  corneredContour,
  hasContinuousCorners,
} from "../src/corner.js";
import { filledContours, insideGlyph } from "../src/direction.js";
import { glyph } from "../src/glyph.js";
import { counterIds } from "../src/ids.js";
import { interpolateGlyph } from "../src/interpolate.js";
import { node } from "../src/node.js";
import { offsetContour } from "../src/offset.js";
import { removeOverlap } from "../src/overlap.js";
import { withInk } from "../src/stroke.js";

const ids = counterIds("corner");

/**
 * Continuous corners in the model: the contour keeps its sharp point, and the
 * outline that is filled, exported and joined is drawn round.
 */

/** A square 400 across with its first corner, at the origin, rounded. */
const square = (size = 100, smoothness = 0): Contour =>
  contour(
    ids.contour(),
    [
      node(ids.node(), { x: 0, y: 0 }, { continuous: { size, smoothness } }),
      node(ids.node(), { x: 400, y: 0 }),
      node(ids.node(), { x: 400, y: 400 }),
      node(ids.node(), { x: 0, y: 400 }),
    ],
    true,
  );

const points = (c: Contour): Vec2[] => c.nodes.map((n) => n.pt);

describe("a continuous corner", () => {
  it("is drawn round, spending the size of each side, and the contour keeps its point", () => {
    const c = square();
    const drawn = corneredContour(c);
    expect(points(drawn).some((p) => p.x === 0 && p.y === 0)).toBe(false);
    expect(points(drawn).some((p) => distance(p, { x: 100, y: 0 }) < 1e-6)).toBe(true);
    expect(points(drawn).some((p) => distance(p, { x: 0, y: 100 }) < 1e-6)).toBe(true);
    expect(c.nodes[0]!.pt).toEqual({ x: 0, y: 0 });
    // The drawing is found by the contour's id.
    expect(drawn.id).toBe(c.id);
  });

  it("is the same drawing every time it is asked", () => {
    const c = square();
    expect(corneredContour(c)).toBe(corneredContour(c));
  });

  it("is filled round: the tip of the corner is outside the letter", () => {
    const g = glyph("o", { advance: 400, contours: [square()] });
    expect(insideGlyph(g, { x: 5, y: 5 })).toBe(false);
    expect(insideGlyph(g, { x: 60, y: 60 })).toBe(true);
    expect(insideGlyph(g, { x: 395, y: 5 })).toBe(true);
    expect(filledContours(g)[0]!.nodes.length).toBeGreaterThan(4);
  });

  it("is exported round", () => {
    const g = glyph("o", { advance: 400, contours: [square()] });
    const out = withInk(g, ids).contours[0]!;
    expect(points(out).some((p) => p.x === 0 && p.y === 0)).toBe(false);
  });

  it("leaves no curvature on either side when fully smooth", () => {
    const drawn = corneredContour(square(120, 1));
    // The first curve after the straight bottom side starts with none.
    let checked = 0;
    for (let i = 0; i < segmentCount(drawn); i++) {
      const s = segmentAt(drawn, i)!;
      if (s.kind !== "curve") continue;
      const before = segmentAt(drawn, (i - 1 + segmentCount(drawn)) % segmentCount(drawn))!;
      if (before.kind !== "line") continue;
      expect(Math.abs(curvature(segmentCubic(s), 0)!)).toBeLessThan(1e-9);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("spends no more of a side than it has", () => {
    const drawn = corneredContour(square(1000));
    for (const p of points(drawn)) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-9);
      expect(p.y).toBeGreaterThanOrEqual(-1e-9);
    }
    expect(continuousCuts(square(1000)).get(0)!.before.y).toBeGreaterThan(0);
  });

  it("is only drawn at a corner or tangent point", () => {
    const c = square();
    const smooth = {
      ...c,
      nodes: [{ ...c.nodes[0]!, type: "smooth" as const }, ...c.nodes.slice(1)],
    };
    expect(hasContinuousCorners(smooth)).toBe(false);
    expect(corneredContour(smooth)).toBe(smooth);
  });

  it("is not drawn at the ends of an open contour, and is between them", () => {
    const open = contour(ids.contour(), [
      node(ids.node(), { x: 0, y: 0 }, { continuous: { size: 50, smoothness: 0 } }),
      node(ids.node(), { x: 200, y: 0 }, { continuous: { size: 50, smoothness: 0.5 } }),
      node(ids.node(), { x: 200, y: 200 }),
    ]);
    const drawn = corneredContour(open);
    expect(drawn.closed).toBe(false);
    expect(drawn.nodes[0]!.pt).toEqual({ x: 0, y: 0 });
    expect(drawn.nodes[drawn.nodes.length - 1]!.pt).toEqual({ x: 200, y: 200 });
    expect(points(drawn).some((p) => p.x === 200 && p.y === 0)).toBe(false);
  });

  it("says where its round begins on each side, and the size a point along a side means", () => {
    const c = square(100);
    const cut = continuousCuts(c).get(0)!;
    // The incoming side is the left edge, running down to the origin.
    expect(cut.before.x).toBeCloseTo(0, 6);
    expect(cut.before.y).toBeCloseTo(100, 6);
    expect(cut.after.x).toBeCloseTo(100, 6);
    expect(continuousSizeAt(c, 0, "out", { x: 150, y: 20 })).toBeCloseTo(150, 0);
    expect(continuousSizeAt(c, 0, "in", { x: -10, y: 80 })).toBeCloseTo(80, 0);
  });
});

describe("a continuous tangent point", () => {
  /** A line along the baseline into a bowl rising from it, through a tangent point. */
  const shoulder = (size: number): Contour =>
    contour(
      ids.contour(),
      [
        node(ids.node(), { x: 0, y: 0 }),
        node(
          ids.node(),
          { x: 300, y: 0 },
          { type: "tangent", out: { x: 410, y: 0 }, continuous: { size, smoothness: 0.6 } },
        ),
        node(ids.node(), { x: 500, y: 200 }, { in: { x: 500, y: 90 } }),
      ],
      true,
    );

  it("ramps from the line into the bowl without curving harder than the bowl", () => {
    const drawn = corneredContour(shoulder(60));
    expect(points(drawn).some((p) => p.x === 300 && p.y === 0)).toBe(false);
    let most = 0;
    let ramp = 0;
    for (let i = 0; i < segmentCount(drawn); i++) {
      const s = segmentAt(drawn, i)!;
      if (s.kind !== "curve") continue;
      const cubic = segmentCubic(s);
      if (cubic.a.y === 0 && cubic.a.x < 300) {
        for (let k = 0; k <= 40; k++) ramp = Math.max(ramp, Math.abs(curvature(cubic, k / 40)!));
      } else {
        most = Math.max(most, Math.abs(curvature(cubic, 0)!));
      }
    }
    expect(ramp).toBeGreaterThan(0);
    expect(ramp).toBeLessThanOrEqual(most * 1.02);
  });

  it("takes the size whose ramp ends where its line end is dragged", () => {
    const c = shoulder(60);
    const size = continuousSizeAt(c, 1, "in", { x: 220, y: 3 });
    const moved = {
      ...c,
      nodes: c.nodes.map((n, i) => (i === 1 ? { ...n, continuous: { size, smoothness: 0.6 } } : n)),
    };
    expect(continuousCuts(moved).get(1)!.before.x).toBeCloseTo(220, 0);
  });
});

describe("operations on a rounded outline", () => {
  it("leaves the corner as it is when nothing overlaps", () => {
    const g = glyph("o", { contours: [square()] });
    const joined = removeOverlap(g, ids)!;
    expect(joined.crossings).toBe(0);
    expect(joined.glyph.contours[0]!.nodes[0]!.continuous).toBeDefined();
  });

  it("joins the outline as it is drawn where something does", () => {
    const bar = contour(
      ids.contour(),
      [
        node(ids.node(), { x: 300, y: 100 }),
        node(ids.node(), { x: 600, y: 100 }),
        node(ids.node(), { x: 600, y: 200 }),
        node(ids.node(), { x: 300, y: 200 }),
      ],
      true,
    );
    const g = glyph("o", { advance: 600, contours: [square(), bar] });
    const joined = removeOverlap(g, ids)!;
    expect(joined.crossings).toBeGreaterThan(0);
    const all = joined.glyph.contours.flatMap(points);
    expect(all.some((p) => p.x === 0 && p.y === 0)).toBe(false);
    expect(joined.glyph.contours.every((c) => !hasContinuousCorners(c))).toBe(true);
  });

  it("offsets the round with the rest", () => {
    const moved = offsetContour(square(), ids, { x: 10, y: 10, join: "miter" })!;
    expect(points(moved).some((p) => distance(p, { x: -10, y: -10 }) < 1)).toBe(false);
  });

  it("interpolates the size and the smoothness", () => {
    const half = interpolateGlyph(
      [glyph("o", { contours: [square(60, 0)] }), glyph("o", { contours: [square(100, 1)] })],
      [0.5, 0.5],
    )!;
    expect(half.contours[0]!.nodes[0]!.continuous).toEqual({ size: 80, smoothness: 0.5 });
  });
});
