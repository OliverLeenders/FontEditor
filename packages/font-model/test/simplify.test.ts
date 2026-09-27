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
import { keptByPolicy, simplifyContour } from "../src/simplify.js";
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
