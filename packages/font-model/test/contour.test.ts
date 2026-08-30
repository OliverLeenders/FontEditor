import { distance, evaluate, vec } from "@fonteditor/geometry";
import { describe, expect, it } from "vitest";

import {
  balanceSegment,
  contour,
  contourBounds,
  insertNodeOnSegment,
  makeSegmentLine,
  moveSegmentTunniLine,
  nodeById,
  removeNode,
  reverseContour,
  segmentAt,
  segmentCount,
  segmentCubic,
  segmentTunniPoint,
  segmentTunniStatus,
  segments,
  setHandle,
  setHvLock,
  setNodePoint,
  setNodeType,
  setSegmentCubic,
  setSegmentTunniPoint,
  translateNodeBy,
} from "../src/contour.js";
import { counterIds } from "../src/ids.js";
import { node } from "../src/node.js";
import { openContour, ringContour, triangleContour } from "./fixtures.js";

describe("segment derivation", () => {
  it("gives a closed contour one segment per node", () => {
    expect(segmentCount(ringContour())).toBe(4);
    expect(segments(ringContour())).toHaveLength(4);
  });

  it("gives an open contour one fewer", () => {
    expect(segmentCount(openContour())).toBe(2);
  });

  it("has no segments below two nodes", () => {
    const ids = counterIds();
    const lone = contour(ids.contour(), [node(ids.node(), vec(0, 0))], true);
    expect(segmentCount(lone)).toBe(0);
    expect(segments(lone)).toEqual([]);
  });

  it("wraps the last segment of a closed contour back to the first node", () => {
    const c = ringContour();
    const last = segmentAt(c, 3)!;
    expect(last.fromId).toBe(c.nodes[3]!.id);
    expect(last.toId).toBe(c.nodes[0]!.id);
  });

  it("calls a segment a line only when both facing handles are absent", () => {
    const c = openContour();
    expect(segmentAt(c, 0)!.kind).toBe("line");
    expect(segmentAt(c, 1)!.kind).toBe("curve");
  });

  it("materialises a line as a cubic with handles at the thirds", () => {
    const geometry = segmentCubic(segmentAt(openContour(), 0)!);
    expect(distance(geometry.c1, vec(100 / 3, 0))).toBeLessThan(1e-9);
    expect(distance(geometry.c2, vec(200 / 3, 0))).toBeLessThan(1e-9);
  });

  it("substitutes the anchor for a missing handle on a curve", () => {
    const ids = counterIds();
    const c = contour(ids.contour(), [
      node(ids.node(), vec(0, 0), { out: vec(30, 40) }),
      node(ids.node(), vec(100, 0)),
    ]);
    const geometry = segmentCubic(segmentAt(c, 0)!);
    expect(geometry.c1).toEqual(vec(30, 40));
    expect(geometry.c2).toEqual(vec(100, 0));
  });
});

describe("shared on-curve points", () => {
  // The prototype kept `segments[i].end` and `segments[i+1].start` as the same
  // object by convention, and cloning silently broke the arrangement. With one
  // node per point the question cannot arise — this test states that as a fact
  // about the model rather than a hope about its callers.
  it("cannot desync, because consecutive segments read the same node", () => {
    const c = ringContour();
    const moved = setNodePoint(c, c.nodes[1]!.id, vec(400, 20))!;

    expect(segmentAt(moved, 0)!.b).toEqual(vec(400, 20));
    expect(segmentAt(moved, 1)!.a).toEqual(vec(400, 20));
  });

  it("survives a structuredClone round-trip with the sharing intact", () => {
    const c = structuredClone(ringContour());
    const moved = setNodePoint(c, c.nodes[1]!.id, vec(400, 20))!;
    expect(segmentAt(moved, 0)!.b).toEqual(segmentAt(moved, 1)!.a);
  });

  it("survives a JSON round-trip unchanged", () => {
    const c = ringContour();
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
  });
});

describe("moving nodes", () => {
  it("carries both handles along", () => {
    const c = ringContour();
    const moved = translateNodeBy(c, c.nodes[0]!.id, vec(10, 5))!;
    const n = moved.nodes[0]!;
    expect(n.pt).toEqual(vec(10, 255));
    expect(n.in).toEqual(vec(-130, 255));
    expect(n.out).toEqual(vec(150, 255));
  });

  it("returns null for an unknown node", () => {
    expect(translateNodeBy(ringContour(), "nope", vec(1, 1))).toBeNull();
  });
});

describe("setHandle", () => {
  it("keeps a smooth node smooth by swinging the opposite handle", () => {
    const c = ringContour();
    const id = c.nodes[0]!.id;
    const moved = setHandle(c, id, "out", vec(100, 350))!;
    const n = moved.nodes[0]!;

    // in, pt and out must stay collinear.
    const toIn = { x: n.in!.x - n.pt.x, y: n.in!.y - n.pt.y };
    const toOut = { x: n.out!.x - n.pt.x, y: n.out!.y - n.pt.y };
    expect(Math.abs(toIn.x * toOut.y - toIn.y * toOut.x)).toBeLessThan(1e-9);
    // …and point in opposite directions.
    expect(toIn.x * toOut.x + toIn.y * toOut.y).toBeLessThan(0);
  });

  it("preserves the opposite handle's length rather than mirroring it", () => {
    const c = ringContour();
    const id = c.nodes[0]!.id;
    const before = distance(c.nodes[0]!.pt, c.nodes[0]!.in!);
    const moved = setHandle(c, id, "out", vec(400, 600))!;
    const after = distance(moved.nodes[0]!.pt, moved.nodes[0]!.in!);
    expect(after).toBeCloseTo(before, 9);
  });

  it("leaves the opposite handle alone on a corner node", () => {
    const c = setNodeType(ringContour(), ringContour().nodes[0]!.id, "corner")!;
    const id = c.nodes[0]!.id;
    const before = c.nodes[0]!.in;
    const moved = setHandle(c, id, "out", vec(100, 350))!;
    expect(moved.nodes[0]!.in).toEqual(before);
  });

  it("retracts a handle when given null, without disturbing the other side", () => {
    const c = ringContour();
    const id = c.nodes[0]!.id;
    const before = c.nodes[0]!.in;
    const moved = setHandle(c, id, "out", null)!;
    expect(moved.nodes[0]!.out).toBeNull();
    expect(moved.nodes[0]!.in).toEqual(before);
  });

  it("snaps to an axis when the node is HV-locked", () => {
    const c = setHvLock(ringContour(), ringContour().nodes[0]!.id, true)!;
    const id = c.nodes[0]!.id;

    // Mostly horizontal from (0, 250) — snaps to the node's own y.
    expect(setHandle(c, id, "out", vec(180, 262))!.nodes[0]!.out).toEqual(vec(180, 250));
    // Mostly vertical — snaps to the node's own x.
    expect(setHandle(c, id, "out", vec(12, 420))!.nodes[0]!.out).toEqual(vec(0, 420));
  });
});

describe("setSegmentCubic", () => {
  it("writes c1 and c2 onto the two nodes that own them", () => {
    const c = ringContour();
    const next = setSegmentCubic(c, 0, {
      a: vec(0, 250),
      c1: vec(50, 260),
      c2: vec(260, 60),
      b: vec(250, 0),
    })!;
    expect(next.nodes[0]!.out).toEqual(vec(50, 260));
    expect(next.nodes[1]!.in).toEqual(vec(260, 60));
    // The far handles are untouched.
    expect(next.nodes[0]!.in).toEqual(c.nodes[0]!.in);
    expect(next.nodes[1]!.out).toEqual(c.nodes[1]!.out);
  });

  it("writes the wrapping segment onto the first node", () => {
    const c = ringContour();
    const next = setSegmentCubic(c, 3, {
      a: vec(-250, 0),
      c1: vec(-250, 111),
      c2: vec(-111, 250),
      b: vec(0, 250),
    })!;
    expect(next.nodes[3]!.out).toEqual(vec(-250, 111));
    expect(next.nodes[0]!.in).toEqual(vec(-111, 250));
  });

  it("returns null for an out-of-range index", () => {
    expect(setSegmentCubic(ringContour(), 9, segmentCubic(segmentAt(ringContour(), 0)!))).toBeNull();
  });
});

describe("the Tunni bridge", () => {
  it("reports a status for every segment of the ring", () => {
    const c = ringContour();
    for (let i = 0; i < segmentCount(c); i++) {
      expect(segmentTunniStatus(c, i)).toBe("ok");
    }
  });

  it("calls a straight segment flat", () => {
    expect(segmentTunniStatus(triangleContour(), 0)).toBe("flat");
  });

  it("balances a segment and writes it back through the owning nodes", () => {
    const c = ringContour();
    const lopsided = setHandle(c, c.nodes[0]!.id, "out", vec(40, 250))!;
    const balanced = balanceSegment(lopsided, 0)!;

    expect(balanced).not.toBeNull();
    // Anchors untouched.
    expect(balanced.nodes[0]!.pt).toEqual(lopsided.nodes[0]!.pt);
    expect(balanced.nodes[1]!.pt).toEqual(lopsided.nodes[1]!.pt);
    // The Tunni line ends up parallel to the chord.
    const geometry = segmentCubic(segmentAt(balanced, 0)!);
    const chord = { x: geometry.b.x - geometry.a.x, y: geometry.b.y - geometry.a.y };
    const line = { x: geometry.c2.x - geometry.c1.x, y: geometry.c2.y - geometry.c1.y };
    const scale = Math.hypot(chord.x, chord.y) * Math.hypot(line.x, line.y);
    expect(Math.abs(chord.x * line.y - chord.y * line.x) / scale).toBeLessThan(1e-9);
  });

  it("moves a Tunni point and leaves it where it was put", () => {
    const c = ringContour();
    const target = vec(150, 150);
    const moved = setSegmentTunniPoint(c, 0, target)!;
    expect(moved).not.toBeNull();
    expect(distance(segmentTunniPoint(moved, 0)!, target)).toBeLessThan(1e-6);
  });

  it("declines on a line segment instead of fabricating handles", () => {
    const t = triangleContour();
    expect(balanceSegment(t, 0)).toBeNull();
    expect(setSegmentTunniPoint(t, 0, vec(50, 50))).toBeNull();
    expect(moveSegmentTunniLine(t, 0, vec(50, 50))).toBeNull();
    expect(segmentTunniPoint(t, 0)).toBeNull();
  });

  it("keeps a smooth node smooth without re-applying the constraint", () => {
    // Tunni operations only rescale handles along fixed directions, so
    // collinearity at the shared node survives for free.
    const c = ringContour();
    const moved = setSegmentTunniPoint(c, 0, vec(150, 150))!;
    const n = moved.nodes[1]!;
    const toIn = { x: n.in!.x - n.pt.x, y: n.in!.y - n.pt.y };
    const toOut = { x: n.out!.x - n.pt.x, y: n.out!.y - n.pt.y };
    expect(Math.abs(toIn.x * toOut.y - toIn.y * toOut.x)).toBeLessThan(1e-6);
  });
});

describe("insertNodeOnSegment", () => {
  it("splits a curve without changing its shape", () => {
    const c = ringContour();
    const before = segmentCubic(segmentAt(c, 0)!);
    const split = insertNodeOnSegment(c, 0, 0.5, counterIds("x"))!;

    expect(split.nodes).toHaveLength(5);
    const left = segmentCubic(segmentAt(split, 0)!);
    const right = segmentCubic(segmentAt(split, 1)!);

    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(distance(evaluate(left, t), evaluate(before, t * 0.5))).toBeLessThan(1e-9);
      expect(distance(evaluate(right, t), evaluate(before, 0.5 + t * 0.5))).toBeLessThan(1e-9);
    }
  });

  it("keeps a line straight when splitting it", () => {
    const t = triangleContour();
    const split = insertNodeOnSegment(t, 0, 0.5, counterIds("x"))!;
    expect(split.nodes[1]!.pt).toEqual(vec(50, 0));
    expect(split.nodes[1]!.in).toBeNull();
    expect(split.nodes[1]!.out).toBeNull();
    expect(segmentAt(split, 0)!.kind).toBe("line");
    expect(segmentAt(split, 1)!.kind).toBe("line");
  });

  it("refuses a parameter at or outside the ends", () => {
    const ids = counterIds("x");
    expect(insertNodeOnSegment(ringContour(), 0, 0, ids)).toBeNull();
    expect(insertNodeOnSegment(ringContour(), 0, 1, ids)).toBeNull();
    expect(insertNodeOnSegment(ringContour(), 0, 1.5, ids)).toBeNull();
  });

  it("inserts into the wrapping segment at the end of the list", () => {
    const c = ringContour();
    const split = insertNodeOnSegment(c, 3, 0.5, counterIds("x"))!;
    expect(split.nodes).toHaveLength(5);
    expect(segmentAt(split, 4)!.toId).toBe(c.nodes[0]!.id);
  });
});

describe("removeNode", () => {
  it("drops the node and re-derives the segments", () => {
    const c = ringContour();
    const fewer = removeNode(c, c.nodes[1]!.id)!;
    expect(fewer.nodes).toHaveLength(3);
    expect(segmentCount(fewer)).toBe(3);
    expect(nodeById(fewer, c.nodes[1]!.id)).toBeNull();
  });

  it("returns null for an unknown node", () => {
    expect(removeNode(ringContour(), "nope")).toBeNull();
  });
});

describe("reverseContour", () => {
  it("swaps in and out on every node", () => {
    const c = openContour();
    const r = reverseContour(c);
    const original = c.nodes[1]!;
    const reversedSame = r.nodes.find((n) => n.id === original.id)!;
    expect(reversedSame.in).toEqual(original.out);
    expect(reversedSame.out).toEqual(original.in);
  });

  it("reverses an open contour outright", () => {
    const c = openContour();
    const r = reverseContour(c);
    expect(r.nodes.map((n) => n.id)).toEqual([...c.nodes].reverse().map((n) => n.id));
  });

  it("keeps a closed contour's start point and reverses the rest", () => {
    const c = ringContour();
    const r = reverseContour(c);
    expect(r.nodes.map((n) => n.id)).toEqual([
      c.nodes[0]!.id,
      c.nodes[3]!.id,
      c.nodes[2]!.id,
      c.nodes[1]!.id,
    ]);
  });

  it("traces the same outline, so the bounds are unchanged", () => {
    const before = contourBounds(ringContour())!;
    const after = contourBounds(reverseContour(ringContour()))!;
    expect(after.minX).toBeCloseTo(before.minX, 9);
    expect(after.minY).toBeCloseTo(before.minY, 9);
    expect(after.maxX).toBeCloseTo(before.maxX, 9);
    expect(after.maxY).toBeCloseTo(before.maxY, 9);
  });

  it("is its own inverse", () => {
    const c = ringContour();
    expect(reverseContour(reverseContour(c))).toEqual(c);
  });
});

describe("makeSegmentLine", () => {
  it("retracts both facing handles", () => {
    const c = makeSegmentLine(ringContour(), 0)!;
    expect(c.nodes[0]!.out).toBeNull();
    expect(c.nodes[1]!.in).toBeNull();
    expect(segmentAt(c, 0)!.kind).toBe("line");
    // The other side of each node is left alone.
    expect(c.nodes[0]!.in).not.toBeNull();
    expect(c.nodes[1]!.out).not.toBeNull();
  });
});

describe("contourBounds", () => {
  it("measures the curve, not the handle hull", () => {
    const box = contourBounds(ringContour())!;
    // Handles reach 250 in x and y; so does the curve, at the extrema.
    expect(box.maxX).toBeCloseTo(250, 6);
    expect(box.minY).toBeCloseTo(-250, 6);
  });

  it("returns null for an empty contour", () => {
    expect(contourBounds(contour("c0", []))).toBeNull();
  });
});
