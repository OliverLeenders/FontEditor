import { describe, expect, it } from "vitest";

import { segmentCount } from "../src/contour.js";
import { glyph, glyphBounds } from "../src/glyph.js";
import { counterIds } from "../src/ids.js";
import { type CombineOutcome, type SetOperation, combineContours } from "../src/overlap.js";
import { ellipseContour, rectContour } from "../src/shapes.js";

const ids = counterIds("set");

/**
 * Subtract, intersect and exclude.
 *
 * The union is tested next door and shares everything but the answer to one
 * question — which region the boundary belongs to — so what is asked here is that
 * each operation keeps the right region, that the result is oriented so a hole is
 * a hole, and that the three ways of doing nothing are told apart: shapes that do
 * not overlap, an operation that would leave nothing, and a boundary that will
 * not close.
 */

/** A target and a tool, the tool being the second one. */
const pair = (
  target: { minX: number; minY: number; maxX: number; maxY: number },
  tool: { minX: number; minY: number; maxX: number; maxY: number },
) => {
  const a = rectContour(ids, target);
  const b = rectContour(ids, tool);
  return { g: glyph("a", { advance: 600, contours: [a, b] }), tool: new Set([b.id]) };
};

const run = (
  op: SetOperation,
  target: { minX: number; minY: number; maxX: number; maxY: number },
  tool: { minX: number; minY: number; maxX: number; maxY: number },
): CombineOutcome => {
  const { g, tool: only } = pair(target, tool);
  return combineContours(g, ids, op, only);
};

const done = (outcome: CombineOutcome) => {
  if (outcome.kind !== "done") throw new Error(`expected a result, got ${outcome.kind}`);
  return outcome;
};

describe("subtracting one shape from another", () => {
  it("takes a bite out of the side", () => {
    // A square with a square overlapping its right half, taken away.
    const out = done(
      run(
        "subtract",
        { minX: 0, minY: 0, maxX: 300, maxY: 300 },
        { minX: 200, minY: 100, maxX: 500, maxY: 200 },
      ),
    ).glyph;

    expect(out.contours).toHaveLength(1);
    expect(glyphBounds(out)).toEqual({ minX: 0, minY: 0, maxX: 300, maxY: 300 });
    // Four corners of the square, less the stretch the bite covers, plus the
    // four corners of the notch: eight.
    expect(segmentCount(out.contours[0]!)).toBe(8);
  });

  it("cuts a hole when the tool is swallowed whole", () => {
    // No crossings at all: the whole of the tool is inside the target, which is
    // how a hole is cut and what a crossing-counting union cannot see.
    const out = done(
      run(
        "subtract",
        { minX: 0, minY: 0, maxX: 400, maxY: 400 },
        { minX: 100, minY: 100, maxX: 300, maxY: 300 },
      ),
    ).glyph;

    expect(out.contours).toHaveLength(2);
    expect(glyphBounds(out)).toEqual({ minX: 0, minY: 0, maxX: 400, maxY: 400 });
  });

  it("makes the hole run against the outline around it", () => {
    // A hole is a hole because it runs the other way. Signed area says which way
    // each contour goes, and the two have to disagree.
    const out = done(
      run(
        "subtract",
        { minX: 0, minY: 0, maxX: 400, maxY: 400 },
        { minX: 100, minY: 100, maxX: 300, maxY: 300 },
      ),
    ).glyph;

    const areas = out.contours.map((c) => signedArea(c.nodes.map((n) => n.pt)));
    expect(Math.sign(areas[0]!)).not.toBe(Math.sign(areas[1]!));
  });

  it("says nothing would be left when the tool covers everything", () => {
    expect(
      run(
        "subtract",
        { minX: 100, minY: 100, maxX: 200, maxY: 200 },
        { minX: 0, minY: 0, maxX: 400, maxY: 400 },
      ).kind,
    ).toBe("empty");
  });

  it("leaves a curve curved where it survives", () => {
    const circle = ellipseContour(ids, { minX: 0, minY: 0, maxX: 300, maxY: 300 });
    const bar = rectContour(ids, { minX: 100, minY: -50, maxX: 200, maxY: 350 });
    const out = done(
      combineContours(
        glyph("o", { advance: 600, contours: [circle, bar] }),
        ids,
        "subtract",
        new Set([bar.id]),
      ),
    ).glyph;

    const nodes = out.contours.flatMap((c) => c.nodes);
    expect(nodes.some((n) => n.in !== null || n.out !== null)).toBe(true);
  });
});

describe("what two shapes have in common", () => {
  it("keeps the overlap and nothing else", () => {
    const out = done(
      run(
        "intersect",
        { minX: 0, minY: 0, maxX: 300, maxY: 300 },
        { minX: 200, minY: 100, maxX: 500, maxY: 200 },
      ),
    ).glyph;

    expect(out.contours).toHaveLength(1);
    boundsAbout(out, { minX: 200, minY: 100, maxX: 300, maxY: 200 });
    expect(segmentCount(out.contours[0]!)).toBe(4);
  });

  it("keeps the whole of a tool the target swallowed", () => {
    const out = done(
      run(
        "intersect",
        { minX: 0, minY: 0, maxX: 400, maxY: 400 },
        { minX: 100, minY: 100, maxX: 300, maxY: 300 },
      ),
    ).glyph;

    expect(out.contours).toHaveLength(1);
    expect(glyphBounds(out)).toEqual({ minX: 100, minY: 100, maxX: 300, maxY: 300 });
  });
});

describe("what only one of them covers", () => {
  it("leaves both shapes with the overlap taken out of each", () => {
    const out = done(
      run(
        "exclude",
        { minX: 0, minY: 0, maxX: 300, maxY: 300 },
        { minX: 200, minY: 200, maxX: 500, maxY: 500 },
      ),
    ).glyph;

    // The two squares meet in a corner, so what is left is an eight-sided ring
    // of one piece: neither square's corner survives inside the other.
    expect(glyphBounds(out)).toEqual({ minX: 0, minY: 0, maxX: 500, maxY: 500 });
    const points = out.contours.flatMap((c) => c.nodes.map((n) => n.pt));
    expect(points.some((p) => Math.abs(p.x - 200) < 0.1 && Math.abs(p.y - 200) < 0.1)).toBe(true);
    // Nothing of the shared square is left: its far corner is gone from the ink.
    expect(covers(out, { x: 250, y: 250 })).toBe(false);
  });

  it("leaves a ring when one is inside the other", () => {
    const out = done(
      run(
        "exclude",
        { minX: 0, minY: 0, maxX: 400, maxY: 400 },
        { minX: 100, minY: 100, maxX: 300, maxY: 300 },
      ),
    ).glyph;

    expect(out.contours).toHaveLength(2);
    expect(covers(out, { x: 50, y: 200 })).toBe(true);
    expect(covers(out, { x: 200, y: 200 })).toBe(false);
  });
});

describe("when there is nothing to do", () => {
  const apart = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const elsewhere = { minX: 300, minY: 300, maxX: 400, maxY: 400 };

  it("says so for shapes that are nowhere near each other", () => {
    for (const op of ["subtract", "intersect", "exclude"] as const) {
      expect(run(op, apart, elsewhere).kind).toBe("apart");
    }
  });

  it("says so for shapes that only share an edge", () => {
    // Touching is not overlapping: they share no area, so there is nothing for
    // one to take out of the other. Joining them is the union's business.
    for (const op of ["subtract", "intersect", "exclude"] as const) {
      expect(
        run(
          op,
          { minX: 0, minY: 0, maxX: 300, maxY: 300 },
          { minX: 300, minY: 0, maxX: 600, maxY: 300 },
        ).kind,
      ).toBe("apart");
    }
  });

  it("says so when nothing was named as the tool", () => {
    const { g } = pair(apart, elsewhere);
    expect(combineContours(g, ids, "subtract", new Set()).kind).toBe("apart");
  });

  it("says so when everything was named as the tool", () => {
    const { g } = pair(apart, elsewhere);
    expect(combineContours(g, ids, "subtract", new Set(g.contours.map((c) => c.id))).kind).toBe(
      "apart",
    );
  });
});

describe("the rest of the glyph", () => {
  it("is drawn into the answer, counters and all", () => {
    // A bowl with a counter, and a bar taken out of the bowl. The counter is not
    // the tool and not a hole the subtraction made, and it has to survive as one.
    const outer = rectContour(ids, { minX: 0, minY: 0, maxX: 400, maxY: 400 });
    // Wound the other way, which is what makes it a hole rather than a blot.
    const drawn = rectContour(ids, { minX: 150, minY: 150, maxX: 250, maxY: 250 });
    const counter = { ...drawn, nodes: [...drawn.nodes].reverse() };
    const bar = rectContour(ids, { minX: 300, minY: -50, maxX: 500, maxY: 450 });
    const out = done(
      combineContours(
        glyph("o", { advance: 600, contours: [outer, counter, bar] }),
        ids,
        "subtract",
        new Set([bar.id]),
      ),
    ).glyph;

    boundsAbout(out, { minX: 0, minY: 0, maxX: 300, maxY: 400 });
    expect(covers(out, { x: 200, y: 200 })).toBe(false);
    expect(covers(out, { x: 50, y: 200 })).toBe(true);
  });
});

/**
 * The bounds, to within what a crossing is found to.
 *
 * A corner of an intersection is a crossing rather than a point anybody placed,
 * and the search that finds it works to two thousandths of a unit — see
 * `MEET_TOLERANCE`. Exact equality is right where the surviving corners were
 * drawn, and a lie where they were computed.
 */
function boundsAbout(
  g: ReturnType<typeof glyph>,
  want: { minX: number; minY: number; maxX: number; maxY: number },
): void {
  const box = glyphBounds(g)!;
  expect(box.minX).toBeCloseTo(want.minX, 1);
  expect(box.minY).toBeCloseTo(want.minY, 1);
  expect(box.maxX).toBeCloseTo(want.maxX, 1);
  expect(box.maxY).toBeCloseTo(want.maxY, 1);
}

/** Twice the signed area, which is all that is wanted: its sign. */
function signedArea(points: readonly { x: number; y: number }[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/** Whether a point is inside the ink, by the non-zero rule over the corners. */
function covers(g: ReturnType<typeof glyph>, p: { x: number; y: number }): boolean {
  let winding = 0;
  for (const c of g.contours) {
    const points = c.nodes.map((n) => n.pt);
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      if (a.y <= p.y) {
        if (b.y > p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) > 0) winding += 1;
      } else if (b.y <= p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) < 0) {
        winding -= 1;
      }
    }
  }
  return winding !== 0;
}
