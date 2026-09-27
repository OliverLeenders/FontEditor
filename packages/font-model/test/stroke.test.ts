import { evaluate } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import {
  type Contour,
  contour,
  contourBounds,
  segmentAt,
  segmentCount,
  segmentCubic,
} from "../src/contour.js";
import { contourWinding } from "../src/direction.js";
import { drawableGlyph } from "../src/drawable.js";
import { filledContours } from "../src/direction.js";
import { fontDocument } from "../src/document.js";
import { component } from "../src/component.js";
import { glyph } from "../src/glyph.js";
import { counterIds } from "../src/ids.js";
import { node } from "../src/node.js";
import { offsetContour } from "../src/offset.js";
import { removeOverlap } from "../src/overlap.js";
import { rectContour } from "../src/shapes.js";
import { DEFAULT_NIB, inkOf, isOval, withInk, withNib } from "../src/stroke.js";
import { interpolateGlyph } from "../src/interpolate.js";
import { cutGlyph } from "../src/knife.js";

const ids = counterIds("stroke");

/**
 * Drawing with a pen.
 *
 * The geometry of one curve's stroke is tested in the geometry package, where it
 * is exact. What is asked here is the whole path: that a skeleton becomes one
 * outline, that a corner is covered without any join being worked out, that an
 * outline is left as it is, and that the things which edit ink leave a skeleton
 * alone.
 */

/** A path of straight lines through the given points, open unless asked. */
const path = (points: [number, number][], closed = false): Contour =>
  contour(
    ids.contour(),
    points.map(([x, y]) => node(ids.node(), { x, y })),
    closed,
  );

/** A pen held upright, sixty wide. */
const upright = { angle: 90, width: 60 };

/** Whether a point is inside any of the contours, by the non-zero rule. */
function covers(contours: readonly Contour[], p: { x: number; y: number }): boolean {
  let winding = 0;
  for (const c of contours) {
    const pts = c.nodes.map((n) => n.pt);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const side = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
      if (a.y <= p.y) {
        if (b.y > p.y && side > 0) winding += 1;
      } else if (b.y <= p.y && side < 0) {
        winding -= 1;
      }
    }
  }
  return winding !== 0;
}

describe("a contour's ink", () => {
  it("is the contour itself when it has no pen", () => {
    const box = rectContour(ids, { minX: 0, minY: 0, maxX: 100, maxY: 100 });
    const ink = inkOf(box, ids);
    expect(ink).toHaveLength(1);
    expect(ink[0]).toBe(box);
  });

  it("is a rectangle for a straight stroke drawn with an upright pen", () => {
    const stem = withNib(
      path([
        [0, 0],
        [200, 0],
      ]),
      upright,
    );
    const ink = inkOf(stem, ids);

    expect(ink).toHaveLength(1);
    expect(contourBounds(ink[0]!)).toEqual({ minX: 0, minY: -30, maxX: 200, maxY: 30 });
  });

  it("is one outline for a path with a corner, the corner covered", () => {
    // Along and then up. Each leg's ink includes the pen standing at the corner,
    // so the two meet there without any join being worked out — and the union
    // makes them one shape.
    const ell = withNib(
      path([
        [0, 0],
        [200, 0],
        [200, 200],
      ]),
      { angle: 45, width: 60 },
    );
    const ink = inkOf(ell, ids);

    expect(ink).toHaveLength(1);
    // Just inside the corner rather than on it. A pen at forty-five degrees turning
    // from east to north leaves the outside of the corner cut on the diagonal, and
    // the corner of the path lies exactly on that cut — which is what a broad pen
    // does, and a point on an edge is neither in nor out.
    expect(covers(ink, { x: 195, y: 0 })).toBe(true);
    expect(covers(ink, { x: 100, y: 0 })).toBe(true);
    expect(covers(ink, { x: 200, y: 100 })).toBe(true);
  });

  it("is thin where the pen runs along its own edge", () => {
    // The pen at forty-five degrees, drawn along a forty-five degree line: edge-on
    // the whole way, so there is no ink at all.
    const edgeOn = withNib(
      path([
        [0, 0],
        [100, 100],
      ]),
      { angle: 45, width: 60 },
    );
    expect(inkOf(edgeOn, ids)).toHaveLength(0);
  });

  it("runs the same way round whatever way the path was drawn", () => {
    // Every region is turned one way before they are joined, or two that overlap
    // with opposite turns would cancel and leave a hole in the stroke.
    const forward = inkOf(
      withNib(
        path([
          [0, 0],
          [200, 0],
          [200, 200],
        ]),
        upright,
      ),
      ids,
    );
    const backward = inkOf(
      withNib(
        path([
          [200, 200],
          [200, 0],
          [0, 0],
        ]),
        upright,
      ),
      ids,
    );
    expect(Math.sign(contourWinding(forward[0]!))).toBe(Math.sign(contourWinding(backward[0]!)));
  });

  it("is a ring for a closed skeleton, with the counter left empty", () => {
    // A square drawn with a pen: the ink is a band round it, and the middle is not
    // ink — which is an o written with a broad pen.
    const square = withNib(
      path(
        [
          [0, 0],
          [300, 0],
          [300, 300],
          [0, 300],
        ],
        true,
      ),
      upright,
    );
    const ink = inkOf(square, ids);

    expect(covers(ink, { x: 150, y: 0 })).toBe(true);
    expect(covers(ink, { x: 150, y: 150 })).toBe(false);
  });

  it("is nothing for a pen of no width", () => {
    expect(
      inkOf(
        withNib(
          path([
            [0, 0],
            [200, 0],
          ]),
          { angle: 30, width: 0 },
        ),
        ids,
      ),
    ).toHaveLength(0);
  });
});

describe("a pen on a contour", () => {
  it("can be taken away, leaving the path as it was", () => {
    const line = path([
      [0, 0],
      [200, 0],
    ]);
    const stroked = withNib(line, DEFAULT_NIB);
    const plain = withNib(stroked, null);

    expect("nib" in plain).toBe(false);
    expect(plain.nodes).toBe(line.nodes);
  });

  it("is the same contour when the pen asked for is the pen it has", () => {
    const stroked = withNib(
      path([
        [0, 0],
        [200, 0],
      ]),
      DEFAULT_NIB,
    );
    expect(withNib(stroked, { ...DEFAULT_NIB })).toBe(stroked);
  });
});

describe("a glyph's ink", () => {
  it("keeps its outlines, in their places, with their ids", () => {
    const box = rectContour(ids, { minX: 0, minY: 0, maxX: 100, maxY: 100 });
    const stem = withNib(
      path([
        [200, 0],
        [200, 300],
      ]),
      upright,
    );
    const g = glyph("a", { contours: [box, stem] });

    const ink = withInk(g, ids);
    expect(ink.contours[0]).toBe(box);
    expect(ink.contours.some((c) => c.nib !== undefined)).toBe(false);
  });

  it("is the same glyph when there is no pen in it", () => {
    const g = glyph("a", {
      contours: [rectContour(ids, { minX: 0, minY: 0, maxX: 100, maxY: 100 })],
    });
    expect(withInk(g, ids)).toBe(g);
  });

  it("is what a glyph placed as a component draws", () => {
    // A stroke in one glyph, placed in another by reference: the reference draws
    // the ink, not a bare skeleton that fills nothing.
    const bar = glyph("bar", {
      contours: [
        withNib(
          path([
            [0, 0],
            [200, 0],
          ]),
          upright,
        ),
      ],
    });
    const user = glyph("a", { components: [component(ids.component(), "bar")] });
    const document = fontDocument([user, bar]);

    const drawn = drawableGlyph(document, user);
    expect(drawn.contours).toHaveLength(1);
    expect(drawn.contours[0]!.closed).toBe(true);
    expect(contourBounds(drawn.contours[0]!)).toEqual({ minX: 0, minY: -30, maxX: 200, maxY: 30 });
  });
});

describe("what edits ink leaves alone", () => {
  it("is not joined to the outlines around it", () => {
    // A closed skeleton over a box. The union joins outlines, and a skeleton is not
    // one: it is the path a pen goes along.
    const box = rectContour(ids, { minX: 0, minY: 0, maxX: 100, maxY: 100 });
    const skeleton = withNib(
      path(
        [
          [50, 50],
          [150, 50],
          [150, 150],
          [50, 150],
        ],
        true,
      ),
      upright,
    );
    const g = glyph("a", { contours: [box, skeleton] });

    expect(removeOverlap(g, ids)?.crossings).toBe(0);
  });

  it("is not offset", () => {
    const skeleton = withNib(
      path(
        [
          [0, 0],
          [100, 0],
          [100, 100],
          [0, 100],
        ],
        true,
      ),
      upright,
    );
    expect(offsetContour(skeleton, ids, { x: 10, y: 10 })).toBeNull();
  });
});

describe("a pen between masters", () => {
  it("interpolates with the path", () => {
    // A light master drawn with a narrow pen and a bold one with a wide pen: the
    // weight between them is the pen's as much as the skeleton's.
    const light = glyph("l", {
      contours: [
        withNib(
          path([
            [0, 0],
            [0, 300],
          ]),
          { angle: 20, width: 40 },
        ),
      ],
    });
    const bold = glyph("l", {
      contours: [
        withNib(
          path([
            [0, 0],
            [0, 300],
          ]),
          { angle: 40, width: 120 },
        ),
      ],
    });

    const half = interpolateGlyph([light, bold], [0.5, 0.5])!;
    expect(half.contours[0]!.nib).toEqual({ angle: 30, width: 80 });
  });

  it("is carried from the base where the other master has none", () => {
    const light = glyph("l", {
      contours: [
        withNib(
          path([
            [0, 0],
            [0, 300],
          ]),
          { angle: 20, width: 40 },
        ),
      ],
    });
    const bold = glyph("l", {
      contours: [
        path([
          [0, 0],
          [0, 300],
        ]),
      ],
    });

    const half = interpolateGlyph([light, bold], [0.5, 0.5])!;
    expect(half.contours[0]!.nib).toEqual({ angle: 20, width: 40 });
  });
});

describe("the knife on a stroke", () => {
  it("cuts an open stroke into strokes drawn with the same pen", () => {
    const g = glyph("l", {
      contours: [
        withNib(
          path([
            [0, 0],
            [0, 300],
          ]),
          { angle: 0, width: 80 },
        ),
      ],
    });
    const cut = cutGlyph(g, { x: -100, y: 150 }, { x: 100, y: 150 }, ids)!;

    expect(cut.glyph.contours).toHaveLength(2);
    for (const c of cut.glyph.contours) expect(c.nib).toEqual({ angle: 0, width: 80 });
  });

  it("leaves a closed stroke alone", () => {
    // Closing across a chord is how the knife cuts ink. A closed skeleton is not
    // ink, and a chord across it would be a new stretch of path for the pen.
    const ring = withNib(
      path(
        [
          [0, 0],
          [300, 0],
          [300, 300],
          [0, 300],
        ],
        true,
      ),
      upright,
    );
    const g = glyph("o", { contours: [ring] });
    const cut = cutGlyph(g, { x: -100, y: 150 }, { x: 400, y: 150 }, ids);

    expect(cut === null || cut.glyph === g).toBe(true);
  });
});

describe("what a glyph fills", () => {
  it("is a stroke's ink, not its skeleton", () => {
    // What the canvas, the glyph browser and the strip all fill. A skeleton is an
    // open line — it fills nothing — so a glyph drawn with a pen showed nothing at
    // all until what is filled was asked of the ink.
    const g = glyph("l", {
      contours: [
        withNib(
          path([
            [0, 0],
            [0, 300],
          ]),
          { angle: 0, width: 80 },
        ),
      ],
    });
    const filled = filledContours(g);

    expect(filled).toHaveLength(1);
    expect(filled[0]!.closed).toBe(true);
    expect(filled[0]!.nib).toBeUndefined();
    expect(contourBounds(filled[0]!)).toEqual({ minX: -40, minY: 0, maxX: 40, maxY: 300 });
  });
});

describe("an oval pen", () => {
  it("leaves one outline with round ends on a straight stroke", () => {
    // A round pen forty wide drawn from (0,0) to (200,0): a stadium, forty tall,
    // reaching twenty past each end.
    const ink = inkOf(
      withNib(
        path([
          [0, 0],
          [200, 0],
        ]),
        { angle: 0, width: 40, thickness: 40 },
      ),
      ids,
    );
    expect(ink).toHaveLength(1);

    const box = contourBounds(ink[0]!)!;
    expect(box.minX).toBeCloseTo(-20, 1);
    expect(box.maxX).toBeCloseTo(220, 1);
    expect(box.minY).toBeCloseTo(-20, 1);
    expect(box.maxY).toBeCloseTo(20, 1);
  });

  it("keeps some weight where a broad edge would pinch to nothing", () => {
    // Drawn along the pen's own angle, a broad edge leaves no ink at all. An oval
    // leaves its thickness.
    const broad = withNib(
      path([
        [0, 0],
        [200, 0],
      ]),
      { angle: 0, width: 60 },
    );
    const oval = withNib(
      path([
        [0, 0],
        [200, 0],
      ]),
      { angle: 0, width: 60, thickness: 20 },
    );

    expect(inkOf(broad, ids)).toHaveLength(0);
    const box = contourBounds(inkOf(oval, ids)[0]!)!;
    expect(box.maxY - box.minY).toBeCloseTo(20, 1);
  });

  it("goes round a corner in one piece", () => {
    const ell = withNib(
      path([
        [0, 0],
        [200, 0],
        [200, 200],
      ]),
      { angle: 30, width: 60, thickness: 20 },
    );
    const ink = inkOf(ell, ids);
    expect(ink).toHaveLength(1);
    expect(covers(ink, { x: 190, y: 0 })).toBe(true);
    expect(covers(ink, { x: 200, y: 100 })).toBe(true);
  });

  it("makes a ring of a closed skeleton, the counter left empty", () => {
    const ring = withNib(
      path(
        [
          [0, 0],
          [300, 0],
          [300, 300],
          [0, 300],
        ],
        true,
      ),
      { angle: 0, width: 40, thickness: 40 },
    );
    const ink = inkOf(ring, ids);
    expect(covers(ink, { x: 150, y: 0 })).toBe(true);
    expect(covers(ink, { x: 150, y: 150 })).toBe(false);
  });

  it("is a broad edge when it is too thin to differ from one", () => {
    expect(isOval({ angle: 0, width: 60 })).toBe(false);
    expect(isOval({ angle: 0, width: 60, thickness: 0.1 })).toBe(false);
    expect(isOval({ angle: 0, width: 60, thickness: 20 })).toBe(true);
  });

  it("thickens between masters, from a broad edge to an oval", () => {
    const light = glyph("l", {
      contours: [
        withNib(
          path([
            [0, 0],
            [0, 300],
          ]),
          { angle: 30, width: 60 },
        ),
      ],
    });
    const bold = glyph("l", {
      contours: [
        withNib(
          path([
            [0, 0],
            [0, 300],
          ]),
          { angle: 30, width: 60, thickness: 40 },
        ),
      ],
    });
    const half = interpolateGlyph([light, bold], [0.5, 0.5])!;
    expect(half.contours[0]!.nib).toEqual({ angle: 30, width: 60, thickness: 20 });
  });

  it("is a different pen from the broad edge of the same width", () => {
    const stem = withNib(
      path([
        [0, 0],
        [0, 300],
      ]),
      { angle: 30, width: 60 },
    );
    expect(withNib(stem, { angle: 30, width: 60, thickness: 20 })).not.toBe(stem);
    expect(withNib(stem, { angle: 30, width: 60, thickness: 0 })).toBe(stem);
  });
});

describe("a round pen, joined", () => {
  it("leaves an outline every point of which is the pen's radius from the path", () => {
    // The strongest thing that can be said of the joined ink: for a round pen its
    // edge is exactly the set of points at the radius from the path. A quarter
    // circle with a straight run after it, drawn with a pen thirty across.
    const K = 0.5522847498307933;
    const skeleton = withNib(
      contour(
        ids.contour(),
        [
          node(ids.node(), { x: 0, y: 0 }, { out: { x: 100 * K, y: 0 } }),
          node(ids.node(), { x: 100, y: 100 }, { in: { x: 100, y: 100 - 100 * K } }),
          node(ids.node(), { x: 100, y: 250 }),
        ],
        false,
      ),
      { angle: 0, width: 30, thickness: 30 },
    );
    const ink = inkOf(skeleton, ids);
    expect(ink).toHaveLength(1);

    const path = [
      ...Array.from({ length: 401 }, (_, i) => {
        const t = i / 400;
        const u = 1 - t;
        return {
          x: 3 * u * u * t * 100 * K + 3 * u * t * t * 100 + t * t * t * 100,
          y: 3 * u * t * t * (100 - 100 * K) + t * t * t * 100,
        };
      }),
      ...Array.from({ length: 151 }, (_, i) => ({ x: 100, y: 100 + i })),
    ];

    for (let i = 0; i < segmentCount(ink[0]!); i++) {
      const curve = segmentCubic(segmentAt(ink[0]!, i)!);
      for (const t of [0, 0.25, 0.5, 0.75]) {
        const p = evaluate(curve, t);
        const nearest = Math.min(...path.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
        expect(nearest).toBeCloseTo(15, 0);
      }
    }
  });
});
