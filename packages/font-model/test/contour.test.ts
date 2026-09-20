import { distance, evaluate, vec } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import {
  balanceSegment,
  canBeTangent,
  curvatureAround,
  harmoniseNode,
  contour,
  enforceTangents,
  contourBounds,
  insertNodeOnSegment,
  makeSegmentLine,
  moveSegmentTunniLine,
  nodeById,
  removeNode,
  removeNodeFitted,
  reverseContour,
  segmentAt,
  segmentCount,
  segmentCubic,
  segmentIndexForHandle,
  segmentLambdas,
  segmentTunniPoint,
  segmentTunniStatus,
  segments,
  setHandle,
  setHvLock,
  setNodePoint,
  setNodeType,
  setSegmentCubic,
  setSegmentLambdas,
  setSegmentTunniPoint,
  translateNodeBy,
  translateNodes,
  extendHandle,
  extendSegmentHandles,
  isHalfHandled,
  makeSegmentCurve,
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

describe("segmentIndexForHandle", () => {
  // A handle names exactly one segment, which is what lets touching it say
  // unambiguously which segment is being worked on. A node names two.
  it("maps out to the segment leaving the node and in to the one arriving", () => {
    const c = ringContour();
    expect(segmentIndexForHandle(c, c.nodes[0]!.id, "out")).toBe(0);
    expect(segmentIndexForHandle(c, c.nodes[1]!.id, "in")).toBe(0);
    expect(segmentIndexForHandle(c, c.nodes[1]!.id, "out")).toBe(1);
    expect(segmentIndexForHandle(c, c.nodes[3]!.id, "out")).toBe(3);
  });

  it("wraps the first node's in handle to the closing segment", () => {
    const c = ringContour();
    expect(segmentIndexForHandle(c, c.nodes[0]!.id, "in")).toBe(3);
  });

  it("returns null at the loose ends of an open contour", () => {
    const c = openContour();
    expect(segmentIndexForHandle(c, c.nodes[0]!.id, "in")).toBeNull();
    expect(segmentIndexForHandle(c, c.nodes[2]!.id, "out")).toBeNull();
    expect(segmentIndexForHandle(c, c.nodes[0]!.id, "out")).toBe(0);
    expect(segmentIndexForHandle(c, c.nodes[2]!.id, "in")).toBe(1);
  });

  it("returns null for an unknown node or an empty contour", () => {
    expect(segmentIndexForHandle(ringContour(), "nope", "out")).toBeNull();
    expect(segmentIndexForHandle(contour("c0", []), "nope", "in")).toBeNull();
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

  it("moves many at once for the same answer as moving them one by one", () => {
    const c = ringContour();
    const ids = c.nodes.slice(0, 2).map((n) => n.id);
    const delta = vec(10, 5);

    const together = translateNodes(c, new Set(ids), delta)!;
    let apart = c;
    for (const id of ids) apart = translateNodeBy(apart, id, delta)!;

    expect(together.nodes).toEqual(apart.nodes);
  });

  it("ignores ids it does not have, and declines when none of them land", () => {
    const c = ringContour();
    const some = translateNodes(c, new Set([c.nodes[0]!.id, "nope"]), vec(1, 0))!;
    expect(some.nodes[0]!.pt.x).toBe(c.nodes[0]!.pt.x + 1);
    expect(some.nodes[1]!).toEqual(c.nodes[1]!);

    expect(translateNodes(c, new Set(["nope"]), vec(1, 0))).toBeNull();
    expect(translateNodes(c, new Set<string>(), vec(1, 0))).toBeNull();
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
    const c = setHvLock(ringContour(), ringContour().nodes[0]!.id, "both", true)!;
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
    expect(
      setSegmentCubic(ringContour(), 9, segmentCubic(segmentAt(ringContour(), 0)!)),
    ).toBeNull();
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

  it("reads and writes a segment's handle scales", () => {
    const c = ringContour();
    const before = segmentLambdas(c, 0)!;
    expect(before.lambda1).toBeCloseTo(before.lambda2, 9);

    const set = setSegmentLambdas(c, 0, { lambda1: 0.4, lambda2: 0.8 })!;
    const after = segmentLambdas(set, 0)!;
    expect(after.lambda1).toBeCloseTo(0.4, 9);
    expect(after.lambda2).toBeCloseTo(0.8, 9);

    // Written back through the nodes, so the next segment sees the change too:
    // the second node's incoming handle is the one that moved.
    expect(set.nodes[0]!.pt).toEqual(c.nodes[0]!.pt);
    expect(set.nodes[1]!.in).not.toEqual(c.nodes[1]!.in);
    expect(set.nodes[1]!.out).toEqual(c.nodes[1]!.out);
  });

  it("refuses handle scales that would collapse a handle onto its anchor", () => {
    const c = ringContour();
    expect(setSegmentLambdas(c, 0, { lambda1: 0, lambda2: 0.5 })).toBeNull();
    expect(segmentLambdas(triangleContour(), 0)).toBeNull();
  });

  it("declines on a line segment instead of fabricating handles", () => {
    const t = triangleContour();
    expect(setSegmentLambdas(t, 0, { lambda1: 0.5, lambda2: 0.5 })).toBeNull();
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

describe("extendHandle", () => {
  const ids = counterIds("e");
  /** A closed triangle with no handles at all: every segment a line. */
  const triangle = () =>
    contour(
      ids.contour(),
      [node("t1", vec(0, 0)), node("t2", vec(300, 0)), node("t3", vec(0, 300))],
      true,
    );

  it("places a missing handle a third along the chord", () => {
    const out = extendHandle(triangle(), "t1", "out")!;
    // Segment t1 -> t2 runs 300 units; a third of it is 100.
    expect(nodeById(out, "t1")?.out).toEqual(vec(100, 0));
  });

  it("takes the in handle from the segment arriving, not the one leaving", () => {
    const out = extendHandle(triangle(), "t1", "in")!;
    // t1's `in` belongs to the wrapping segment t3 -> t1.
    expect(nodeById(out, "t1")?.in).toEqual(vec(0, 100));
  });

  it("leaves a handle that is already there alone", () => {
    const withOne = extendHandle(triangle(), "t1", "out")!;
    expect(extendHandle(withOne, "t1", "out")).toBe(withOne);
  });

  it("respects an axis lock", () => {
    const locked = setHvLock(triangle(), "t1", "both", true)!;
    const out = extendHandle(locked, "t1", "out")!;
    const handle = nodeById(out, "t1")?.out;
    // On the axis, so one coordinate matches the anchor exactly.
    expect(handle?.y).toBe(0);
  });

  it("keeps a smooth node smooth", () => {
    let c = extendHandle(triangle(), "t1", "out")!;
    c = setNodeType(c, "t1", "smooth")!;
    c = extendHandle(c, "t1", "in")!;

    const n = nodeById(c, "t1")!;
    // Both handles present and opposite through the anchor.
    expect(n.in).not.toBeNull();
    expect(n.out).not.toBeNull();
    const before = { x: n.pt.x - n.in!.x, y: n.pt.y - n.in!.y };
    const after = { x: n.out!.x - n.pt.x, y: n.out!.y - n.pt.y };
    expect(before.x * after.y - before.y * after.x).toBeCloseTo(0, 6);
  });

  it("declines at the far end of an open contour, where there is no segment", () => {
    const open = contour(ids.contour(), triangle().nodes, false);
    expect(extendHandle(open, "t1", "in")).toBeNull();
    expect(extendHandle(open, "t3", "out")).toBeNull();
  });

  it("returns null for a node that is not there", () => {
    expect(extendHandle(triangle(), "nope", "out")).toBeNull();
  });
});

describe("a curve missing one of its handles", () => {
  const ids = counterIds("h");
  /** A square whose first segment is a curve with only its `out` handle. */
  const half = () =>
    contour(
      ids.contour(),
      [
        node("h1", vec(0, 0), { out: vec(100, 0) }),
        node("h2", vec(300, 0)),
        node("h3", vec(300, 300)),
      ],
      true,
    );

  it("counts as a curve, with the missing control point on its anchor", () => {
    expect(segmentAt(half(), 0)?.kind).toBe("curve");
    expect(segmentAt(half(), 0)?.in).toBeNull();
  });

  it("is recognised as half-handled", () => {
    expect(isHalfHandled(half(), 0)).toBe(true);
    // A plain line is not: it has no control points to be missing.
    expect(isHalfHandled(half(), 1)).toBe(false);
  });

  it("gets its missing handle back", () => {
    const out = extendSegmentHandles(half(), 0)!;
    expect(segmentAt(out, 0)?.out).not.toBeNull();
    expect(segmentAt(out, 0)?.in).not.toBeNull();
    expect(isHalfHandled(out, 0)).toBe(false);
  });

  it("is completed by makeSegmentCurve, which used to decline", () => {
    // Declining here is what made a retracted handle unrecoverable: the menu
    // sees a curve, offers only "make line", and nothing can reach the handle.
    const out = makeSegmentCurve(half(), 0)!;
    expect(isHalfHandled(out, 0)).toBe(false);
  });

  it("survives a retract and extract round trip", () => {
    const full = extendSegmentHandles(half(), 0)!;
    const retracted = setHandle(full, "h2", "in", null)!;
    expect(isHalfHandled(retracted, 0)).toBe(true);

    const restored = extendSegmentHandles(retracted, 0)!;
    expect(isHalfHandled(restored, 0)).toBe(false);
  });

  it("leaves a fully handled segment alone", () => {
    const full = extendSegmentHandles(half(), 0)!;
    expect(extendSegmentHandles(full, 0)).toBe(full);
  });
});

describe("locking one handle at a time", () => {
  /** A corner node whose two handles point in unrelated directions. */
  function corner() {
    const ids = counterIds("lock");
    return contour(
      ids.contour(),
      [
        node(ids.node(), vec(0, 0), { type: "corner", in: vec(-90, 20), out: vec(15, 80) }),
        node(ids.node(), vec(300, 0), { type: "corner", in: vec(240, 40) }),
      ],
      false,
    );
  }

  /** A smooth node: its two handles are one straight line through it. */
  function smooth() {
    const ids = counterIds("sm");
    return contour(
      ids.contour(),
      [
        node(ids.node(), vec(0, 0), { type: "smooth", in: vec(-100, -20), out: vec(50, 10) }),
        node(ids.node(), vec(300, 0), { type: "corner", in: vec(240, 40) }),
      ],
      false,
    );
  }

  it("straightens only the handle that was locked", () => {
    const c = corner();
    const locked = setHvLock(c, c.nodes[0]!.id, "out", true)!;
    const n = locked.nodes[0]!;

    expect(n.hvLock).toEqual({ in: false, out: true });
    // The out handle was nearer the vertical, so it goes upright.
    expect(n.out).toEqual({ x: 0, y: expect.closeTo(81.4, 1) });
    // The in handle is untouched, still off both axes.
    expect(n.in).toEqual({ x: -90, y: 20 });
  });

  it("holds a locked handle while the other one is dragged, on a smooth node", () => {
    // Its handles are one line, so swinging the free side would drag the locked
    // side off its axis with it. A lock that does not hold is not a lock.
    const c = smooth();
    const locked = setHvLock(c, c.nodes[0]!.id, "out", true)!;
    const dragged = setHandle(locked, c.nodes[0]!.id, "in", vec(-70, -55))!;
    const n = dragged.nodes[0]!;

    expect(n.out!.y).toBeCloseTo(0, 9);
    expect(n.in!.y).toBeCloseTo(0, 9);
  });

  it("leaves the free handle free on a corner node", () => {
    // No collinearity to preserve, so the lock is nobody's business but its own.
    const c = corner();
    const locked = setHvLock(c, c.nodes[0]!.id, "out", true)!;
    const dragged = setHandle(locked, c.nodes[0]!.id, "in", vec(-70, -55))!;

    expect(dragged.nodes[0]!.in).toEqual({ x: -70, y: -55 });
  });

  it("still projects the locked handle itself onto its axis when dragged", () => {
    const c = corner();
    const locked = setHvLock(c, c.nodes[0]!.id, "out", true)!;
    const dragged = setHandle(locked, c.nodes[0]!.id, "out", vec(30, 90))!;

    // Projected, not rotated: the pointer says how far along the axis.
    expect(dragged.nodes[0]!.out).toEqual({ x: 0, y: 90 });
  });

  it("lets alt break the link, and with it the far side's claim", () => {
    const c = smooth();
    const locked = setHvLock(c, c.nodes[0]!.id, "out", true)!;
    const dragged = setHandle(locked, c.nodes[0]!.id, "in", vec(-70, -55), true)!;

    expect(dragged.nodes[0]!.in).toEqual({ x: -70, y: -55 });
  });

  it("unlocks one side without disturbing the other", () => {
    const c = corner();
    let next = setHvLock(c, c.nodes[0]!.id, "both", true)!;
    next = setHvLock(next, c.nodes[0]!.id, "in", false)!;

    expect(next.nodes[0]!.hvLock).toEqual({ in: false, out: true });
  });

  it("moves nothing when a lock is switched off", () => {
    const c = corner();
    const locked = setHvLock(c, c.nodes[0]!.id, "out", true)!;
    const unlocked = setHvLock(locked, c.nodes[0]!.id, "out", false)!;

    expect(unlocked.nodes[0]!.out).toEqual(locked.nodes[0]!.out);
  });

  it("makes a smooth node a corner when one side is freed and the other stays locked", () => {
    // Otherwise the far side's lock goes on holding this handle, and the switch
    // would be a switch that changed nothing.
    const c = smooth();
    const both = setHvLock(c, c.nodes[0]!.id, "both", true)!;
    const freed = setHvLock(both, c.nodes[0]!.id, "in", false)!;
    const n = freed.nodes[0]!;

    expect(n.hvLock).toEqual({ in: false, out: true });
    expect(n.type).toBe("corner");

    // Which is what makes the handle free in fact, and not only on paper.
    const dragged = setHandle(freed, c.nodes[0]!.id, "in", vec(-70, -55))!;
    expect(dragged.nodes[0]!.in).toEqual({ x: -70, y: -55 });
  });

  it("leaves a smooth node smooth when the side freed was the only one locked", () => {
    const c = smooth();
    const locked = setHvLock(c, c.nodes[0]!.id, "out", true)!;
    const freed = setHvLock(locked, c.nodes[0]!.id, "out", false)!;

    expect(freed.nodes[0]!.type).toBe("smooth");
    expect(freed.nodes[0]!.hvLock).toEqual({ in: false, out: false });
  });

  it("leaves a smooth node smooth when both sides are freed at once", () => {
    const c = smooth();
    const both = setHvLock(c, c.nodes[0]!.id, "both", true)!;
    const freed = setHvLock(both, c.nodes[0]!.id, "both", false)!;

    expect(freed.nodes[0]!.type).toBe("smooth");
  });

  it("puts each handle of a corner node on the axis it is nearer", () => {
    // The plain case, and the one the other two are exceptions to.
    const c = corner();
    const locked = setHvLock(c, c.nodes[0]!.id, "both", true)!;
    const n = locked.nodes[0]!;

    // In was 90 left and 20 up, so it goes flat; out was 15 right and 80 up, so
    // it goes upright. Each keeps the length it had.
    expect(n.in!.y).toBeCloseTo(0, 9);
    expect(n.in!.x).toBeLessThan(0);
    expect(n.out!.x).toBeCloseTo(0, 9);
    expect(n.out!.y).toBeGreaterThan(0);
  });

  it("sends both handles of a smooth node to one axis, which they agree on", () => {
    // They are one straight line through the node, so "the axis each is nearer"
    // is one question and not two — and the answer has to hold for both, or
    // smooth would be a word the geometry contradicts.
    const c = smooth();
    const locked = setHvLock(c, c.nodes[0]!.id, "both", true)!;
    const n = locked.nodes[0]!;

    expect(n.type).toBe("smooth");
    expect(n.in!.y).toBeCloseTo(0, 9);
    expect(n.out!.y).toBeCloseTo(0, 9);
    expect(n.in!.x).toBeLessThan(0);
    expect(n.out!.x).toBeGreaterThan(0);
  });

  it("leaves a corner node a corner, since it was never holding anything", () => {
    const c = corner();
    const both = setHvLock(c, c.nodes[0]!.id, "both", true)!;
    const freed = setHvLock(both, c.nodes[0]!.id, "in", false)!;

    expect(freed.nodes[0]!.type).toBe("corner");
  });
});

describe("removing a node and fitting what is left", () => {
  /** A quarter arc, as two segments with a point in the middle of it. */
  const halved = () => {
    const whole = contour(
      "q",
      [node("a", vec(0, 0), { out: vec(0, 110) }), node("b", vec(200, 200), { in: vec(90, 200) })],
      false,
    );
    return { whole, split: insertNodeOnSegment(whole, 0, 0.4, counterIds("h"))! };
  };

  it("puts the curve back where inserting a point left it", () => {
    const { whole, split } = halved();
    const back = removeNodeFitted(split, split.nodes[1]!.id)!;

    expect(back.nodes).toHaveLength(2);
    // Within half a unit of the handles it had, on an arc reaching 200 across
    // and 200 up: the fit is an approximation and lands well inside the grid a
    // font is rounded to.
    expect(distance(back.nodes[0]!.out!, whole.nodes[0]!.out!)).toBeLessThan(0.5);
    expect(distance(back.nodes[1]!.in!, whole.nodes[1]!.in!)).toBeLessThan(0.5);
  });

  it("dents the outline when the handles are left as they were", () => {
    // What the fitting is for: the same deletion without it leaves the
    // neighbours reaching half as far as the one segment needs.
    const { whole, split } = halved();
    const plain = removeNode(split, split.nodes[1]!.id)!;

    expect(distance(plain.nodes[0]!.out!, whole.nodes[0]!.out!)).toBeGreaterThan(20);
  });

  it("keeps the directions the neighbours leave and arrive by", () => {
    // They are the join with whatever is beyond, and a smooth node either side
    // rests on them. Only the lengths are the fit's business.
    const { split } = halved();
    const angle = (from: { x: number; y: number }, to: { x: number; y: number }): number =>
      Math.atan2(to.y - from.y, to.x - from.x);
    const was = angle(split.nodes[0]!.pt, split.nodes[0]!.out!);
    const back = removeNodeFitted(split, split.nodes[1]!.id)!;

    expect(angle(back.nodes[0]!.pt, back.nodes[0]!.out!)).toBeCloseTo(was, 9);
  });

  it("leaves two straight segments straight", () => {
    const lines = contour(
      "l",
      [node("a", vec(0, 0)), node("b", vec(50, 0)), node("c", vec(100, 40))],
      false,
    );
    const back = removeNodeFitted(lines, "b")!;

    expect(back.nodes).toHaveLength(2);
    expect(back.nodes[0]!.out).toBeNull();
    expect(back.nodes[1]!.in).toBeNull();
  });

  it("has nothing to fit at the end of an open contour, and simply removes it", () => {
    const { split } = halved();
    const end = removeNodeFitted(split, split.nodes[0]!.id)!;

    expect(end.nodes).toHaveLength(2);
    expect(end.nodes[0]!.pt).toEqual(split.nodes[1]!.pt);
  });
});

describe("the axis lock on a tangent node", () => {
  /** A stem leaning away from upright, so its tangent line is on no axis. */
  const leaning = () =>
    contour(
      "t",
      [
        node("a", vec(60, 0)),
        node("b", vec(100, 500), { type: "tangent", out: vec(112, 650) }),
        node("c", vec(300, 700), { in: vec(200, 700) }),
        node("d", vec(300, 0)),
      ],
      true,
    );

  it("makes the node a corner, rather than snapping a handle and swinging it back", () => {
    // The curved handle of a tangent node runs along the straight side, and the
    // pass every edit ends with puts it back there. Locking it to an axis is
    // asking for a direction the node does not get to choose, so the node stops
    // being a tangent node — the way freeing one side of a smooth node stops it
    // being smooth.
    const locked = setHvLock(leaning(), "b", "out", true)!;
    const n = nodeById(locked, "b")!;

    expect(n.type).toBe("corner");
    expect(n.hvLock).toEqual({ in: false, out: true });
    // Upright, which is the axis it was nearer, and still the length it was.
    expect(n.out!.x).toBeCloseTo(100, 9);
    expect(distance(vec(100, 500), n.out!)).toBeCloseTo(distance(vec(100, 500), vec(112, 650)), 9);
  });

  it("leaves it tangent where the straight side is already on an axis", () => {
    // Nothing is given up, because the handle is already where the lock wants
    // it: an upright stem, which is most of them.
    const upright = contour(
      "t",
      [
        node("a", vec(100, 0)),
        node("b", vec(100, 500), { type: "tangent", out: vec(100, 620) }),
        node("c", vec(300, 700), { in: vec(200, 700) }),
        node("d", vec(300, 0)),
      ],
      true,
    );
    const locked = setHvLock(upright, "b", "out", true)!;
    const n = nodeById(locked, "b")!;

    expect(n.type).toBe("tangent");
    expect(n.out).toEqual(vec(100, 620));
  });
});

describe("tangent nodes", () => {
  /**
   * The top of an "n": a stem going straight up to the corner, and a shoulder
   * curving away from it. Node 1 is the join.
   */
  const stem = () =>
    contour(
      "t",
      [
        node("a", vec(100, 0)),
        node("b", vec(100, 500), { type: "tangent", out: vec(100, 620) }),
        node("c", vec(300, 700), { in: vec(200, 700) }),
        node("d", vec(300, 0)),
      ],
      true,
    );

  const handleOut = (c: ReturnType<typeof stem>, id: string) => nodeById(c, id)?.out ?? null;

  it("knows where the type can truthfully be used", () => {
    const c = stem();
    expect(canBeTangent(c, 1)).toBe(true);
    // Node 2 has a curve on one side and a line on the other as well.
    expect(canBeTangent(c, 2)).toBe(true);
    // Node 0 sits between two straight segments: no curve to continue.
    expect(canBeTangent(c, 0)).toBe(false);
  });

  it("refuses the type where it would not be true", () => {
    expect(setNodeType(stem(), "a", "tangent")).toBeNull();
  });

  it("refuses it at the end of an open contour, which has only one side", () => {
    const open = contour(
      "o",
      [node("a", vec(0, 0)), node("b", vec(100, 0), { in: vec(50, 40) })],
      false,
    );
    expect(canBeTangent(open, 0)).toBe(false);
    expect(canBeTangent(open, 1)).toBe(false);
  });

  it("swings the handle onto the line when the type is adopted", () => {
    // The handle starts off the line and is corrected at once, not on the next
    // drag: a type that visibly changed nothing would read as broken.
    const crooked = contour(
      "t",
      [
        node("a", vec(100, 0)),
        node("b", vec(100, 500), { out: vec(160, 560) }),
        node("c", vec(300, 700), { in: vec(200, 700) }),
        node("d", vec(300, 0)),
      ],
      true,
    );
    const fixed = setNodeType(crooked, "b", "tangent")!;
    const out = handleOut(fixed, "b")!;
    // Straight up from the node, which is where the stem points.
    expect(out.x).toBeCloseTo(100, 6);
    expect(out.y).toBeGreaterThan(500);
  });

  it("keeps the length the handle already had", () => {
    const crooked = contour(
      "t",
      [
        node("a", vec(100, 0)),
        node("b", vec(100, 500), { out: vec(160, 560) }),
        node("c", vec(300, 700), { in: vec(200, 700) }),
        node("d", vec(300, 0)),
      ],
      true,
    );
    const before = distance(vec(100, 500), vec(160, 560));
    const after = distance(vec(100, 500), handleOut(setNodeType(crooked, "b", "tangent")!, "b")!);
    expect(after).toBeCloseTo(before, 6);
  });

  it("swings the handle again when the straight side moves", () => {
    // The line now leans, and the handle has to lean with it or the join is a
    // kink the node claims is not there.
    const leaned = translateNodeBy(stem(), "a", vec(-100, 0))!;
    const out = handleOut(leaned, "b")!;
    const along = { x: 100 - 0, y: 500 - 0 };
    // Same direction as the stem, which now runs from (0,0) to (100,500).
    expect(out.x - 100).toBeCloseTo((along.x * 120) / Math.hypot(along.x, along.y), 4);
    expect(out.y - 500).toBeCloseTo((along.y * 120) / Math.hypot(along.x, along.y), 4);
  });

  it("swings it when the node itself moves", () => {
    const moved = setNodePoint(stem(), "b", vec(200, 500))!;
    const out = handleOut(moved, "b")!;
    const along = { x: 200 - 100, y: 500 - 0 };
    const reach = Math.hypot(along.x, along.y);
    expect(out.x - 200).toBeCloseTo((along.x * 120) / reach, 4);
    expect(out.y - 500).toBeCloseTo((along.y * 120) / reach, 4);
  });

  it("takes the cursor's distance along the line and not its direction", () => {
    // Dragging sideways off a tangent handle should not lengthen it; only the
    // part of the drag that runs along the line counts.
    const dragged = setHandle(stem(), "b", "out", vec(400, 600))!;
    const out = handleOut(dragged, "b")!;
    expect(out.x).toBeCloseTo(100, 6);
    expect(out.y).toBeCloseTo(600, 6);
  });

  it("will not put the handle behind the node", () => {
    const dragged = setHandle(stem(), "b", "out", vec(100, 100))!;
    const out = handleOut(dragged, "b")!;
    expect(out.y).toBeCloseTo(500, 6);
  });

  it("gives up the type when the handle is pulled off the line with alt", () => {
    // Otherwise the node would be called tangent while its geometry said
    // otherwise, and the next edit would silently swing it back.
    const broken = setHandle(stem(), "b", "out", vec(400, 600), true)!;
    expect(nodeById(broken, "b")?.type).toBe("corner");
    expect(handleOut(broken, "b")).toEqual(vec(400, 600));
  });

  it("stops constraining when the straight side stops being straight", () => {
    // Node 1's other side is a curve now, so there is no line for it to follow
    // and nothing to enforce. The handle is left exactly where it was.
    const curved = makeSegmentCurve(stem(), 0)!;
    expect(canBeTangent(curved, 1)).toBe(false);
    const before = handleOut(stem(), "b")!;
    expect(handleOut(curved, "b")).toEqual(before);
  });

  it("leaves a contour with no tangent nodes exactly as it was", () => {
    const plain = contour(
      "p",
      [node("a", vec(0, 0)), node("b", vec(100, 0)), node("c", vec(100, 100))],
      true,
    );
    expect(enforceTangents(plain)).toBe(plain);
  });

  it("hands back the same contour when everything is already true", () => {
    const c = stem();
    expect(enforceTangents(c)).toBe(c);
  });
});

describe("harmonising", () => {
  /** Two curves meeting at a node placed deliberately off the harmonious spot. */
  function join() {
    const ids = counterIds("h");
    return contour(
      ids.contour(),
      [
        node(ids.node(), vec(0, 0), { type: "corner", out: vec(0, 90) }),
        node(ids.node(), vec(120, 150), {
          type: "smooth",
          in: vec(40, 140),
          out: vec(220, 165),
        }),
        node(ids.node(), vec(320, 0), { type: "corner", in: vec(320, 90) }),
      ],
      false,
    );
  }

  it("reads the curvature either side of a node", () => {
    const c = join();
    const k = curvatureAround(c, c.nodes[1]!.id)!;

    expect(k).not.toBeNull();
    // Placed off the harmonious point, so the two sides disagree.
    expect(Math.abs(k.before)).not.toBeCloseTo(Math.abs(k.after), 6);
  });

  it("moves the node until the two sides agree", () => {
    const c = join();
    const id = c.nodes[1]!.id;
    const out = harmoniseNode(c, id)!;

    expect(out).not.toBeNull();
    const k = curvatureAround(out, id)!;
    expect(Math.abs(k.before)).toBeCloseTo(Math.abs(k.after), 9);

    // The handles stayed exactly where they were: only the point moved.
    expect(out.nodes[1]!.in).toEqual(c.nodes[1]!.in);
    expect(out.nodes[1]!.out).toEqual(c.nodes[1]!.out);
    expect(out.nodes[1]!.pt).not.toEqual(c.nodes[1]!.pt);
    // And it is smooth afterwards, because it now is.
    expect(out.nodes[1]!.type).toBe("smooth");
  });

  it("does nothing to a node already where it belongs", () => {
    const once = harmoniseNode(join(), join().nodes[1]!.id)!;
    expect(harmoniseNode(once, once.nodes[1]!.id)).toBeNull();
  });

  it("has nothing to say about a node that is not between two curves", () => {
    const t = triangleContour();
    expect(curvatureAround(t, t.nodes[0]!.id)).toBeNull();
    expect(harmoniseNode(t, t.nodes[0]!.id)).toBeNull();

    // Nor the end of an open contour, which has only one side.
    const open = openContour();
    expect(harmoniseNode(open, open.nodes[0]!.id)).toBeNull();
  });

  it("reaches round a closed contour, where the first node has two sides", () => {
    const ring = ringContour();
    expect(curvatureAround(ring, ring.nodes[0]!.id)).not.toBeNull();
  });
});
