import { evaluate } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import {
  type Contour,
  contour,
  contourBounds,
  insertNodeOnSegment,
  readSegmentBlend,
  segmentAt,
  segmentCount,
  segmentCubic,
} from "../src/contour.js";
import { contourWinding } from "../src/direction.js";
import { drawableGlyph } from "../src/drawable.js";
import { filledContours, insideGlyph } from "../src/direction.js";
import { fontDocument } from "../src/document.js";
import { component } from "../src/component.js";
import { glyph } from "../src/glyph.js";
import { counterIds } from "../src/ids.js";
import { node } from "../src/node.js";
import { offsetContour } from "../src/offset.js";
import { removeOverlap } from "../src/overlap.js";
import { rectContour } from "../src/shapes.js";
import { DEFAULT_NIB, inkOf, inkRegions, isOval, withInk, withNib } from "../src/stroke.js";
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

describe("a stroke whose ends have their handles on their points", () => {
  /**
   * The stroke from the bug report: a curve through two smooth points, its first
   * and last segments each with one handle pulled onto the corner it leaves. An
   * oval pen drew ink along the middle segment only, because the direction a curve
   * leaves a corner by was read as "none" where its handle sat on the point.
   */
  const reported = () =>
    contour(ids.contour(), [
      node(ids.node(), { x: 75, y: -207 }),
      node(
        ids.node(),
        { x: 262, y: -139 },
        { type: "smooth", in: { x: 165, y: -116 }, out: { x: 283, y: -143 } },
      ),
      node(
        ids.node(),
        { x: 385, y: -175 },
        { type: "smooth", in: { x: 348, y: -160 }, out: { x: 456, y: -203 } },
      ),
      node(ids.node(), { x: 497, y: -248 }),
    ]);

  for (const nib of [
    { angle: 30, width: 80 },
    { angle: 30, width: 80, thickness: 20 },
    { angle: 0, width: 60, thickness: 60 },
  ]) {
    it(`is inked along its whole length with ${JSON.stringify(nib)}`, () => {
      const c = withNib(reported(), nib);
      const g = glyph("x", { contours: [c] });
      for (let i = 0; i < segmentCount(c); i++) {
        const s = segmentCubic(segmentAt(c, i)!);
        for (let k = 1; k < 10; k++) expect(insideGlyph(g, evaluate(s, k / 10))).toBe(true);
      }
    });
  }

  it("is drawn fast enough to drag", () => {
    // The fill is what the canvas asks for on every move of a drag, and it used to
    // take a fifth of a second for this stroke and over half a second for an oval.
    // The bound is loose on purpose: it catches a return to that, not a slow machine.
    const start = performance.now();
    for (let i = 0; i < 10; i++) {
      const moved = contour(
        ids.contour(),
        reported().nodes.map((n) => ({ ...n, pt: { x: n.pt.x + i, y: n.pt.y } })),
      );
      filledContours(
        glyph("x", { contours: [withNib(moved, { angle: 30, width: 80, thickness: 20 })] }),
      );
    }
    expect((performance.now() - start) / 10).toBeLessThan(40);
  });
});

describe("pens set at points", () => {
  /**
   * Straight up from the baseline, drawn with a level broad nib — the full width
   * across the stroke — and a point at the top whose own nib stands upright, along
   * the stroke, where it draws no width at all.
   */
  const turning = (): Contour => {
    const c = withNib(
      path([
        [0, 0],
        [0, 300],
      ]),
      { angle: 0, width: 80 },
    );
    return { ...c, nodes: [c.nodes[0]!, { ...c.nodes[1]!, pen: { angle: 90, width: 40 } }] };
  };

  it("draw a stroke that changes along the way from one to the next", () => {
    // Near the bottom the nib is level and the ink is its full width; near the top
    // it has turned to stand along the stroke, and the ink has all but run out.
    const g = glyph("l", { advance: 600, contours: [turning()] });
    expect(insideGlyph(g, { x: 30, y: 20 })).toBe(true);
    expect(insideGlyph(g, { x: 30, y: 280 })).toBe(false);
    expect(insideGlyph(g, { x: 0, y: 280 })).toBe(true);
  });

  it("give a point put into a segment the pen already there", () => {
    const split = insertNodeOnSegment(turning(), 0, 0.5, ids)!;
    expect(split.nodes[1]!.pen).toEqual({ angle: 45, width: 60 });
    expect(split.nib).toEqual({ angle: 0, width: 80 });
  });

  it("give a point put into a stroke of one pen nothing of its own", () => {
    const plain = withNib(
      path([
        [0, 0],
        [0, 300],
      ]),
      { angle: 30, width: 80 },
    );
    const split = insertNodeOnSegment(plain, 0, 0.5, ids)!;
    expect("pen" in split.nodes[1]!).toBe(false);
  });

  it("leave the ink as it was when a point is put in", () => {
    // The new point's pen is the blend at its place, so the stroke either side
    // blends from and to the same pens it did before.
    const before = glyph("l", { advance: 600, contours: [turning()] });
    const after = glyph("l", {
      advance: 600,
      contours: [insertNodeOnSegment(turning(), 0, 0.5, ids)!],
    });
    for (const [x, y] of [
      [30, 20],
      [25, 100],
      [15, 200],
      [30, 280],
      [0, 280],
    ] as const) {
      expect(insideGlyph(after, { x, y })).toBe(insideGlyph(before, { x, y }));
    }
  });

  it("are given to the ends the knife makes", () => {
    const g = glyph("l", { contours: [turning()] });
    const cut = cutGlyph(g, { x: -100, y: 150 }, { x: 100, y: 150 }, ids)!;

    const ends = cut.glyph.contours.flatMap((c) => c.nodes.filter((n) => n.pt.y === 150));
    expect(ends).toHaveLength(2);
    for (const n of ends) expect(n.pen).toEqual({ angle: 45, width: 60 });
    const top = cut.glyph.contours.flatMap((c) => c.nodes.filter((n) => n.pt.y === 300));
    expect(top[0]!.pen).toEqual({ angle: 90, width: 40 });
  });

  it("are quick enough to redraw while a point is dragged", () => {
    // A pen that changes at every point is fitted rather than worked out exactly,
    // which is the slow part; eleven curved segments of it, broad and oval, stay
    // well inside a frame. Fresh contours each time, as a drag makes them. The
    // middle time is the one judged, after one run to warm up: the first run pays
    // for compiling, and a run that lands on a collection or on a machine busy
    // with other suites says nothing about the code.
    for (const thickness of [0, 20]) {
      const times: number[] = [];
      for (let run = 0; run < 11; run++) {
        const nodes = Array.from({ length: 12 }, (_, i) => {
          const y = 200 * Math.sin(i / 2);
          return node(
            ids.node(),
            { x: i * 60 + run, y },
            {
              type: "smooth",
              in: { x: i * 60 - 20 + run, y: y - 30 },
              out: { x: i * 60 + 20 + run, y: y + 30 },
              pen: { angle: 30 + i * 7, width: 60 + (i % 3) * 20, thickness },
            },
          );
        });
        const c = { ...contour(ids.contour(), nodes), nib: { angle: 30, width: 80, thickness } };
        const start = performance.now();
        filledContours(glyph("s", { contours: [c] }));
        if (run > 0) times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      expect(times[5]!).toBeLessThan(40);
    }
  });

  it("hold along a stepped segment and change at the next point", () => {
    // Held, the stroke keeps the level nib — the full width — right up to the top.
    const c = turning();
    const stepped = {
      ...c,
      nodes: [{ ...c.nodes[0]!, blend: { angle: "step", shape: "step" } as const }, c.nodes[1]!],
    };
    const g = glyph("l", { advance: 600, contours: [stepped] });
    expect(insideGlyph(g, { x: 30, y: 280 })).toBe(true);
  });

  it("give a point put into a segment its blend, and the pen that blend has there", () => {
    const c = turning();
    const stepped = {
      ...c,
      nodes: [{ ...c.nodes[0]!, blend: { angle: "step", shape: "step" } as const }, c.nodes[1]!],
    };
    const split = insertNodeOnSegment(stepped, 0, 0.5, ids)!;
    expect(split.nodes[1]!.blend).toEqual({ angle: "step", shape: "step" });
    // Held, the pen halfway is still the first point's, which is the stroke's own.
    expect("pen" in split.nodes[1]!).toBe(false);
  });

  it("interpolate with their points", () => {
    const at = (angle: number, width: number) => {
      const c = turning();
      return glyph("l", {
        contours: [{ ...c, nodes: [c.nodes[0]!, { ...c.nodes[1]!, pen: { angle, width } }] }],
      });
    };
    const half = interpolateGlyph([at(60, 40), at(80, 80)], [0.5, 0.5])!;
    expect(half.contours[0]!.nodes[1]!.pen).toEqual({ angle: 70, width: 60 });
  });
});

describe("reading a stored blend", () => {
  it("reads the words it knows and nothing for all linear", () => {
    expect(readSegmentBlend({ angle: "smooth", shape: "ease" })).toEqual({
      angle: "smooth",
      shape: "ease",
    });
    expect(readSegmentBlend({ angle: "linear", shape: "linear" })).toBeUndefined();
    expect(readSegmentBlend("smooth")).toBeUndefined();
  });

  it("reads a word from a later version as linear", () => {
    expect(readSegmentBlend({ angle: "wobble", shape: "step" })).toEqual({
      angle: "linear",
      shape: "step",
    });
  });
});

describe("a stroke turned into outlines", () => {
  type P = [number, number];
  const at = (pt: P, handles: [P | null, P | null], pen?: { angle: number; width: number }) =>
    node(
      ids.node(),
      { x: pt[0], y: pt[1] },
      {
        type: handles[0] !== null && handles[1] !== null ? "smooth" : "corner",
        in: handles[0] === null ? null : { x: handles[0][0], y: handles[0][1] },
        out: handles[1] === null ? null : { x: handles[1][0], y: handles[1][1] },
        ...(pen === undefined ? {} : { pen }),
      },
    );
  const thin = { angle: 30, width: 20 };

  // The two strokes of an n, drawn with a broad pen at thirty degrees that thins
  // at the ends; each leaves its first point almost along the nib's own edge.
  const stem = (): Contour => ({
    ...contour(ids.contour(), [
      at([140, 670], [null, [190, 700]], thin),
      at(
        [245, 705],
        [
          [200, 705],
          [300, 705],
        ],
      ),
      at(
        [305, 590],
        [
          [305, 650],
          [300, 520],
        ],
      ),
      at([294, 388], [null, null]),
      at([277, 35], [null, null], thin),
    ]),
    nib: { angle: 30, width: 90 },
  });
  const arch = (): Contour => ({
    ...contour(ids.contour(), [
      at([312, 472], [null, [400, 640]], thin),
      at(
        [586, 705],
        [
          [480, 705],
          [690, 705],
        ],
      ),
      at(
        [744, 487],
        [
          [744, 600],
          [742, 420],
        ],
      ),
      at([724, 138], [null, null]),
      at(
        [797, 34],
        [
          [740, 34],
          [830, 34],
        ],
      ),
      at([883, 63], [[850, 50], null], thin),
    ]),
    nib: { angle: 30, width: 90 },
  });

  it("joins the pieces of its ink rather than handing them back as they are", () => {
    // The pieces overlap, a band for each stretch of the path. The union used to
    // give up on these two — a hair-thin band where the path leaves along the
    // nib, and loops that met along the nib's line at a pinch — and the pieces
    // went into the letter as they were, lines across the stroke and all.
    for (const c of [stem(), arch()]) {
      const regions = inkRegions(c).length;
      const ink = inkOf(c, ids);
      expect(ink.length).toBeLessThan(regions);
      expect(ink.length).toBeLessThanOrEqual(2);
    }
  });

  it("covers the same ground as the pieces did", () => {
    const g = glyph("n", { advance: 900, contours: [stem(), arch()] });
    const joined = glyph("n", {
      advance: 900,
      contours: [...inkOf(stem(), ids), ...inkOf(arch(), ids)],
    });
    for (const p of [
      { x: 290, y: 300 },
      { x: 250, y: 690 },
      { x: 600, y: 700 },
      { x: 735, y: 300 },
      { x: 780, y: 40 },
      { x: 500, y: 300 },
      { x: 100, y: 100 },
    ]) {
      expect(insideGlyph(joined, p)).toBe(insideGlyph(g, p));
    }
  });
});
