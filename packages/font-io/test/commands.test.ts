import { evaluate, evaluateQuadratic } from "@fonteditor/geometry";
import { counterIds, segmentAt, segmentCount } from "@fonteditor/font-model";
import { describe, expect, it } from "vitest";

import { type PathCommand, contoursFromCommands } from "../src/commands.js";

const EPS = 1000 * 1e-6;
const build = (commands: PathCommand[]) => contoursFromCommands(commands, counterIds(), EPS);

describe("contoursFromCommands", () => {
  it("closes a path that draws back to its start without duplicating the point", () => {
    // A triangle whose final lineTo returns to the origin. Naively that is four
    // points; it is three, and the fourth is the closing segment's end.
    const [c] = build([
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 100, y: 0 },
      { type: "L", x: 50, y: 80 },
      { type: "L", x: 0, y: 0 },
      { type: "Z" },
    ]);

    expect(c?.closed).toBe(true);
    expect(c?.nodes).toHaveLength(3);
    expect(segmentCount(c!)).toBe(3);
  });

  it("adds the implicit closing segment when a path does not draw back", () => {
    const [c] = build([
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 100, y: 0 },
      { type: "L", x: 50, y: 80 },
      { type: "Z" },
    ]);

    expect(c?.nodes).toHaveLength(3);
    expect(segmentCount(c!)).toBe(3);
    expect(segmentAt(c!, 2)?.kind).toBe("line");
  });

  it("gives the first node of a closed contour the handle from the wrapping segment", () => {
    // The closing curve's second control point governs the arrival at node 0.
    const [c] = build([
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 100, y: 0 },
      { type: "C", x1: 90, y1: 40, x2: 10, y2: 40, x: 0, y: 0 },
      { type: "Z" },
    ]);

    expect(c?.nodes).toHaveLength(2);
    expect(c?.nodes[0]?.in).toEqual({ x: 10, y: 40 });
    expect(c?.nodes[1]?.out).toEqual({ x: 90, y: 40 });
  });

  it("leaves an unclosed path open, with no handles off either end", () => {
    const [c] = build([
      { type: "M", x: 0, y: 0 },
      { type: "C", x1: 10, y1: 30, x2: 40, y2: 30, x: 50, y: 0 },
    ]);

    expect(c?.closed).toBe(false);
    expect(c?.nodes).toHaveLength(2);
    expect(c?.nodes[0]?.in).toBeNull();
    expect(c?.nodes[1]?.out).toBeNull();
    expect(c?.nodes[0]?.out).toEqual({ x: 10, y: 30 });
  });

  it("converts a quadratic to a cubic tracing exactly the same curve", () => {
    const a = { x: 0, y: 0 };
    const q = { x: 50, y: 200 };
    const b = { x: 100, y: 0 };

    const [c] = build([
      { type: "M", x: a.x, y: a.y },
      { type: "Q", x1: q.x, y1: q.y, x: b.x, y: b.y },
    ]);
    const curve = {
      a,
      c1: c!.nodes[0]!.out!,
      c2: c!.nodes[1]!.in!,
      b,
    };

    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const onQuadratic = evaluateQuadratic({ a, q, b }, t);
      const onCubic = evaluate(curve, t);
      expect(onCubic.x).toBeCloseTo(onQuadratic.x, 10);
      expect(onCubic.y).toBeCloseTo(onQuadratic.y, 10);
    }
  });

  it("reads collinear handles as a smooth node and a kink as a corner", () => {
    const smooth = build([
      { type: "M", x: 0, y: 0 },
      { type: "C", x1: 20, y1: 50, x2: 80, y2: 50, x: 100, y: 0 },
      { type: "C", x1: 120, y1: -50, x2: 180, y2: -50, x: 200, y: 0 },
    ]);
    // Arriving at (100,0) from (80,50) and leaving toward (120,-50): the two
    // handles lie on one line through the node.
    expect(smooth[0]?.nodes[1]?.type).toBe("smooth");

    const corner = build([
      { type: "M", x: 0, y: 0 },
      { type: "C", x1: 20, y1: 50, x2: 80, y2: 50, x: 100, y: 0 },
      { type: "C", x1: 120, y1: 50, x2: 180, y2: 50, x: 200, y: 0 },
    ]);
    expect(corner[0]?.nodes[1]?.type).toBe("corner");
  });

  it("reads a cusp as a corner even though its handles are collinear", () => {
    // Both handles leave the node in the same direction: the curve doubles back.
    // Collinear, but emphatically not smooth.
    const [c] = build([
      { type: "M", x: 0, y: 0 },
      { type: "C", x1: 20, y1: 0, x2: 80, y2: 0, x: 100, y: 0 },
      { type: "C", x1: 80, y1: 0, x2: 20, y2: 40, x: 0, y: 40 },
    ]);
    expect(c?.nodes[1]?.type).toBe("corner");
  });

  it("splits subpaths into separate contours", () => {
    const contours = build([
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 10, y: 0 },
      { type: "Z" },
      { type: "M", x: 50, y: 50 },
      { type: "L", x: 60, y: 50 },
      { type: "Z" },
    ]);
    expect(contours).toHaveLength(2);
    expect(contours[0]?.nodes[0]?.pt).toEqual({ x: 0, y: 0 });
    expect(contours[1]?.nodes[0]?.pt).toEqual({ x: 50, y: 50 });
  });

  it("ignores drawing commands that arrive before any move", () => {
    const contours = build([
      { type: "L", x: 10, y: 10 },
      { type: "Z" },
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 10, y: 0 },
    ]);
    expect(contours).toHaveLength(1);
    expect(contours[0]?.nodes).toHaveLength(2);
  });

  it("gives every node a distinct id", () => {
    const contours = build([
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 10, y: 0 },
      { type: "L", x: 10, y: 10 },
      { type: "Z" },
    ]);
    const ids = contours.flatMap((c) => c.nodes.map((n) => n.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns nothing for an empty path", () => {
    expect(build([])).toEqual([]);
  });
});
