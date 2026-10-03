import { evaluate, project } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import {
  type Contour,
  contour,
  insertNodeOnSegment,
  segmentAt,
  segmentCount,
  segmentCubic,
} from "../src/contour.js";
import { counterIds } from "../src/ids.js";
import { node } from "../src/node.js";
import {
  isEmptyContour,
  keptByPolicy,
  simplifyContour,
  withoutEmptySegments,
} from "../src/simplify.js";
import { ellipseContour, rectContour } from "../src/shapes.js";

const ids = counterIds("simp");

/**
 * Taking out the points an outline does not need.
 *
 * The fit is the geometry package's and is tested there. What is asked here is the
 * policy: that a point which was added in the middle of a curve comes back out and
 * leaves the curve where it was, that an extreme and a corner are never taken out
 * however flat the tolerance, and that a drawing with nothing to spare is left
 * exactly as it is.
 */

/**
 * How far one contour's outline strays from another's.
 *
 * Sampled along the first and projected onto the second, because the two are cut
 * into different numbers of pieces and comparing sample against sample would
 * measure how far apart the samples are rather than how far apart the outlines
 * are — which is the same reason the fitter itself measures by projection.
 */
function apart(one: Contour, other: Contour, per = 16): number {
  const curves = [];
  for (let i = 0; i < segmentCount(other); i++) {
    const s = segmentAt(other, i);
    if (s !== null) curves.push(segmentCubic(s));
  }

  let worst = 0;
  for (let i = 0; i < segmentCount(one); i++) {
    const s = segmentAt(one, i);
    if (s === null) continue;
    const curve = segmentCubic(s);
    for (let k = 0; k <= per; k++) {
      const p = evaluate(curve, k / per);
      let nearest = Infinity;
      for (const c of curves) nearest = Math.min(nearest, project(c, p).distance);
      worst = Math.max(worst, nearest);
    }
  }
  return worst;
}

describe("a point that was not needed", () => {
  /** A circle with an extra point inserted halfway along one of its quarters. */
  const withExtra = () => {
    const circle = ellipseContour(ids, { minX: 0, minY: 0, maxX: 200, maxY: 200 });
    const more = insertNodeOnSegment(circle, 0, 0.5, ids);
    if (more === null) throw new Error("nothing inserted");
    return { circle, more };
  };

  it("comes out", () => {
    const { circle, more } = withExtra();
    expect(more.nodes.length).toBe(circle.nodes.length + 1);

    const out = simplifyContour(more, 1)!;
    expect(out.nodes.length).toBe(circle.nodes.length);
  });

  it("leaves the outline where it was", () => {
    // The point was on the curve, so the curve through what is left is the curve
    // that was there — and that is the whole claim this operation makes.
    const { circle, more } = withExtra();
    const out = simplifyContour(more, 1)!;
    expect(apart(out, circle)).toBeLessThan(0.5);
  });

  it("is refused by a tolerance of nothing", () => {
    const { more } = withExtra();
    expect(simplifyContour(more, 0)).toBeNull();
  });
});

describe("what is never taken out", () => {
  it("leaves a circle alone, because every point of it is an extreme", () => {
    // Four points at the four extremes: there is nothing here to take out, and a
    // tidy-up that rounded a circle off to three points would be a bug in a font.
    const circle = ellipseContour(ids, { minX: 0, minY: 0, maxX: 200, maxY: 200 });
    expect(simplifyContour(circle, 100)).toBeNull();
    for (let i = 0; i < circle.nodes.length; i++) expect(keptByPolicy(circle, i)).toBe(true);
  });

  it("leaves a rectangle alone, because every point of it is a corner", () => {
    const box = rectContour(ids, { minX: 0, minY: 0, maxX: 100, maxY: 200 });
    expect(simplifyContour(box, 100)).toBeNull();
  });

  it("keeps a corner in the middle of a run of curves", () => {
    // Two curves meeting at a point where the direction changes: the fit would
    // keep the outer directions and round the corner off, which is a shape nobody
    // drew.
    const kink = contour(
      ids.contour(),
      [
        node(ids.node(), { x: 0, y: 0 }, { out: { x: 40, y: 0 } }),
        node(ids.node(), { x: 100, y: 100 }, { in: { x: 100, y: 40 }, out: { x: 100, y: 160 } }),
        node(ids.node(), { x: 0, y: 200 }, { in: { x: 40, y: 200 } }),
      ],
      true,
    );
    expect(simplifyContour(kink, 50)).toBeNull();
  });

  it("never goes below two points", () => {
    const circle = ellipseContour(ids, { minX: 0, minY: 0, maxX: 200, maxY: 200 });
    const out = simplifyContour(circle, 1000);
    expect(out === null || out.nodes.length >= 2).toBe(true);
  });

  it("leaves the ends of an open contour", () => {
    const open = contour(
      ids.contour(),
      [
        node(ids.node(), { x: 0, y: 0 }, { out: { x: 30, y: 0 } }),
        node(ids.node(), { x: 60, y: 30 }, { in: { x: 30, y: 15 }, out: { x: 90, y: 45 } }),
        node(ids.node(), { x: 120, y: 60 }, { in: { x: 90, y: 60 } }),
      ],
      false,
    );
    const out = simplifyContour(open, 100);
    // Whatever it does with the middle, the two ends stay.
    const kept = out ?? open;
    expect(kept.nodes[0]!.pt).toEqual({ x: 0, y: 0 });
    expect(kept.nodes[kept.nodes.length - 1]!.pt).toEqual({ x: 120, y: 60 });
  });
});

describe("how far it goes", () => {
  it("takes out several points at once", () => {
    // Three extra points along one quarter of a circle, all of them on it.
    const circle = ellipseContour(ids, { minX: 0, minY: 0, maxX: 200, maxY: 200 });
    let more = circle;
    for (const t of [0.25, 0.5, 0.75]) {
      const next = insertNodeOnSegment(more, 0, t, ids);
      if (next !== null) more = next;
    }
    expect(more.nodes.length).toBeGreaterThan(circle.nodes.length);

    const out = simplifyContour(more, 1)!;
    expect(out.nodes.length).toBe(circle.nodes.length);
    expect(apart(out, circle)).toBeLessThan(0.5);
  });

  it("keeps the outline inside the tolerance it was given", () => {
    const circle = ellipseContour(ids, { minX: 0, minY: 0, maxX: 400, maxY: 400 });
    let more = circle;
    for (const t of [0.3, 0.6]) {
      const next = insertNodeOnSegment(more, 1, t, ids);
      if (next !== null) more = next;
    }
    const out = simplifyContour(more, 0.5);
    if (out !== null) expect(apart(out, more)).toBeLessThan(2);
  });
});

describe("segments that go nowhere", () => {
  const at = (x: number, y: number, init: Parameters<typeof node>[2] = {}) =>
    node(ids.node(), { x, y }, init);

  it("takes out a line from a point to itself, and keeps the shape", () => {
    const square = contour(
      ids.contour(),
      [at(0, 0), at(100, 0), at(100, 0), at(100, 100), at(0, 100)],
      true,
    );
    const tidied = withoutEmptySegments(square)!;
    expect(tidied.nodes.map((n) => [n.pt.x, n.pt.y])).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]);
  });

  it("takes out a corner rounded to nothing, as a font cut from a variable one has it", () => {
    // Material Symbols' counters: each corner a curve whose handles lie on its
    // ends, which are one point.
    const corner = (x: number, y: number) => [
      at(x, y, { in: { x, y } }),
      at(x, y, { out: { x, y } }),
    ];
    const counter = contour(
      ids.contour(),
      [...corner(157, 237), ...corner(803, 237), ...corner(803, 723), ...corner(157, 723)],
      true,
    );
    const tidied = withoutEmptySegments(counter)!;
    expect(tidied.nodes).toHaveLength(4);
    // What is left is a plain rectangle: no handles, every point a corner.
    expect(tidied.nodes.every((n) => n.in === null && n.out === null && n.type === "corner")).toBe(
      true,
    );
  });

  it("leaves a loop alone, which starts and ends at one place but goes somewhere", () => {
    const loop = contour(
      ids.contour(),
      [at(0, 0, { out: { x: 100, y: 100 } }), at(0, 0, { in: { x: -100, y: 100 } }), at(50, -50)],
      true,
    );
    expect(withoutEmptySegments(loop)).toBeNull();
  });

  it("never takes a contour below two points", () => {
    const dot = contour(ids.contour(), [at(5, 5), at(5, 5), at(5, 5)], true);
    expect(withoutEmptySegments(dot)!.nodes).toHaveLength(2);
  });
});

describe("a contour that draws nothing", () => {
  const at = (x: number, y: number, init: Parameters<typeof node>[2] = {}) =>
    node(ids.node(), { x, y }, init);

  it("is a closed line there and back, as pause_presentation has one", () => {
    expect(isEmptyContour(contour(ids.contour(), [at(157, 237), at(803, 237)], true))).toBe(true);
  });

  it("is a closed run of points along one slant, handles and all", () => {
    const slant = contour(
      ids.contour(),
      [at(0, 0, { out: { x: 10, y: 20 } }), at(30, 60, { in: { x: 20, y: 40 } }), at(50, 100)],
      true,
    );
    expect(isEmptyContour(slant)).toBe(true);
  });

  it("is every point at one place, open or closed", () => {
    expect(isEmptyContour(contour(ids.contour(), [at(5, 5), at(5, 5)], true))).toBe(true);
    expect(isEmptyContour(contour(ids.contour(), [at(5, 5), at(5, 5)], false))).toBe(true);
  });

  it("is not a closed line with a handle off it, which bulges", () => {
    const bulge = contour(
      ids.contour(),
      [at(0, 0, { out: { x: 50, y: 40 } }), at(100, 0, { in: { x: 50, y: 40 } })],
      true,
    );
    expect(isEmptyContour(bulge)).toBe(false);
  });

  it("is not an open line, which may yet be given a pen or closed", () => {
    expect(isEmptyContour(contour(ids.contour(), [at(0, 0), at(100, 0)], false))).toBe(false);
  });

  it("is never a stroke, whose pen leaves ink along a line or at a point", () => {
    const line = contour(ids.contour(), [at(0, 0), at(100, 0)], true);
    expect(isEmptyContour({ ...line, nib: { angle: 30, width: 80 } })).toBe(false);
    const dot = contour(ids.contour(), [at(5, 5), at(5, 5)], false);
    expect(isEmptyContour({ ...dot, nib: { angle: 30, width: 80 } })).toBe(false);
  });

  it("is not a rectangle", () => {
    expect(isEmptyContour(rectContour(ids, { minX: 0, minY: 0, maxX: 10, maxY: 10 }))).toBe(false);
  });
});
