import { bounds } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import { segmentAt, segmentCount, segmentCubic } from "../src/contour.js";
import { counterIds } from "../src/ids.js";
import { KAPPA, ellipseContour, rectContour } from "../src/shapes.js";

const ids = counterIds("s");
const box = { minX: 100, minY: 0, maxX: 500, maxY: 300 };

describe("rectContour", () => {
  const c = () => rectContour(ids, box);

  it("has four corners and closes", () => {
    expect(c().nodes).toHaveLength(4);
    expect(c().closed).toBe(true);
    expect(segmentCount(c())).toBe(4);
  });

  it("has a straight side everywhere", () => {
    const shape = c();
    for (let i = 0; i < segmentCount(shape); i++) {
      expect(segmentAt(shape, i)?.kind).toBe("line");
    }
  });

  it("sits exactly in the box it was given", () => {
    const xs = c().nodes.map((n) => n.pt.x);
    const ys = c().nodes.map((n) => n.pt.y);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([100, 500]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([0, 300]);
  });

  it("runs counter-clockwise, as an outer contour should", () => {
    // The direction this model's own glyphs use, and what a PostScript outline
    // expects: the other way round fills as a hole wherever it overlaps.
    const n = c().nodes;
    const area = n.reduce((sum, p, i) => {
      const q = n[(i + 1) % n.length]!;
      return sum + (p.pt.x * q.pt.y - q.pt.x * p.pt.y);
    }, 0);
    expect(area).toBeGreaterThan(0);
  });
});

describe("ellipseContour", () => {
  const c = () => ellipseContour(ids, box);

  it("has four points, at the extremes rather than the corners", () => {
    const shape = c();
    expect(shape.nodes).toHaveLength(4);
    // Right, top, left, bottom.
    expect(shape.nodes.map((n) => n.pt)).toEqual([
      { x: 500, y: 150 },
      { x: 300, y: 300 },
      { x: 100, y: 150 },
      { x: 300, y: 0 },
    ]);
  });

  it("is smooth at every point", () => {
    expect(c().nodes.every((n) => n.type === "smooth")).toBe(true);
  });

  it("is a curve on every side", () => {
    const shape = c();
    for (let i = 0; i < segmentCount(shape); i++) {
      expect(segmentAt(shape, i)?.kind).toBe("curve");
    }
  });

  it("reaches the box exactly and never past it", () => {
    // The extremes are the points, so the drawn curve's own bounding box is the
    // box asked for — which is what makes the shape's sidebearings honest.
    const shape = c();
    let box2 = bounds(segmentCubic(segmentAt(shape, 0)!));
    for (let i = 1; i < segmentCount(shape); i++) {
      const b = bounds(segmentCubic(segmentAt(shape, i)!));
      box2 = {
        minX: Math.min(box2.minX, b.minX),
        minY: Math.min(box2.minY, b.minY),
        maxX: Math.max(box2.maxX, b.maxX),
        maxY: Math.max(box2.maxY, b.maxY),
      };
    }
    expect(box2.minX).toBeCloseTo(100, 6);
    expect(box2.maxX).toBeCloseTo(500, 6);
    expect(box2.minY).toBeCloseTo(0, 6);
    expect(box2.maxY).toBeCloseTo(300, 6);
  });

  it("holds its handles tangent, so the extremes really are extremes", () => {
    const shape = c();
    const right = shape.nodes[0]!;
    const top = shape.nodes[1]!;
    // At the right the tangent is vertical: both handles share the node's x.
    expect(right.in?.x).toBe(500);
    expect(right.out?.x).toBe(500);
    // At the top it is horizontal.
    expect(top.in?.y).toBe(300);
    expect(top.out?.y).toBe(300);
  });

  it("reaches kappa of the radius along each tangent", () => {
    const right = c().nodes[0]!;
    expect(right.out!.y - right.pt.y).toBeCloseTo(150 * KAPPA, 9);
  });

  it("runs counter-clockwise too", () => {
    const n = c().nodes;
    const area = n.reduce((sum, p, i) => {
      const q = n[(i + 1) % n.length]!;
      return sum + (p.pt.x * q.pt.y - q.pt.x * p.pt.y);
    }, 0);
    expect(area).toBeGreaterThan(0);
  });
});
