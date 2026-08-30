import { vec } from "@fonteditor/geometry";
import {
  type Contour,
  addContour,
  contour,
  counterIds,
  glyph,
  node,
  segmentTunniPoint,
  setHandle,
} from "@fonteditor/font-model";
import { describe, expect, it } from "vitest";

import { buildHitIndex, distanceToTarget, nodesInRect, pick, pickAll, pickOf } from "../src/hit.js";
import { screenTolerance } from "../src/transform.js";

/** Four smooth curve nodes in a ring, every segment well-formed. */
function ring(): Contour {
  const ids = counterIds();
  const k = 140;
  return contour(
    ids.contour(),
    [
      node(ids.node(), vec(0, 250), { type: "smooth", in: vec(-k, 250), out: vec(k, 250) }),
      node(ids.node(), vec(250, 0), { type: "smooth", in: vec(250, k), out: vec(250, -k) }),
      node(ids.node(), vec(0, -250), { type: "smooth", in: vec(k, -250), out: vec(-k, -250) }),
      node(ids.node(), vec(-250, 0), { type: "smooth", in: vec(-250, -k), out: vec(-250, k) }),
    ],
    true,
  );
}

/** A closed triangle of straight lines. */
function triangle(): Contour {
  const ids = counterIds("t");
  return contour(
    ids.contour(),
    [
      node(ids.node(), vec(0, 0)),
      node(ids.node(), vec(100, 0)),
      node(ids.node(), vec(50, 90)),
    ],
    true,
  );
}

const ringGlyph = () => addContour(glyph("o", { advance: 600 }), ring());

describe("buildHitIndex", () => {
  it("offers a target for every node and every handle", () => {
    const index = buildHitIndex(ringGlyph());
    expect(index.targets.filter((t) => t.kind === "node")).toHaveLength(4);
    expect(index.targets.filter((t) => t.kind === "handleIn")).toHaveLength(4);
    expect(index.targets.filter((t) => t.kind === "handleOut")).toHaveLength(4);
  });

  it("offers a target for every segment", () => {
    expect(buildHitIndex(ringGlyph()).targets.filter((t) => t.kind === "segment")).toHaveLength(4);
  });

  // Only a visible control may be grabbed. Tunni controls show for the one
  // awake segment, so only that segment contributes Tunni targets — offering a
  // target for something invisible would make clicking empty canvas do things.
  it("offers Tunni controls for the awake segment only", () => {
    const c = ring();
    const index = buildHitIndex(addContour(glyph("o"), c), [{ contourId: c.id, segmentIndex: 0 }]);
    expect(index.targets.filter((t) => t.kind === "tunniPoint")).toHaveLength(1);
    expect(index.targets.filter((t) => t.kind === "tunniLine")).toHaveLength(1);
  });

  it("offers Tunni controls for several segments at once", () => {
    // The hovered segment and the focused segment are both shown, so both must
    // be grabbable.
    const c = ring();
    const index = buildHitIndex(addContour(glyph("o"), c), [
      { contourId: c.id, segmentIndex: 0 },
      { contourId: c.id, segmentIndex: 2 },
    ]);
    expect(index.targets.filter((t) => t.kind === "tunniPoint")).toHaveLength(2);
    expect(index.targets.filter((t) => t.kind === "tunniLine")).toHaveLength(2);
  });

  it("offers no Tunni controls when nothing is awake", () => {
    const index = buildHitIndex(ringGlyph());
    expect(index.targets.filter((t) => t.kind === "tunniPoint")).toHaveLength(0);
    expect(index.targets.filter((t) => t.kind === "tunniLine")).toHaveLength(0);
    // Nodes, handles and segments are always addressable.
    expect(index.targets.filter((t) => t.kind === "node")).toHaveLength(4);
    expect(index.targets.filter((t) => t.kind === "segment")).toHaveLength(4);
  });

  it("puts the Tunni point where the model says it is", () => {
    const c = ring();
    const index = buildHitIndex(addContour(glyph("o"), c), [{ contourId: c.id, segmentIndex: 0 }]);
    const target = index.targets.find((t) => t.kind === "tunniPoint" && t.segmentIndex === 0);
    expect(target).toBeDefined();
    expect(target!.kind === "tunniPoint" && target!.point).toEqual(segmentTunniPoint(c, 0));
  });

  it("offers no Tunni controls on straight segments", () => {
    const index = buildHitIndex(addContour(glyph("t"), triangle()));
    expect(index.targets.filter((t) => t.kind === "tunniPoint")).toHaveLength(0);
    expect(index.targets.filter((t) => t.kind === "tunniLine")).toHaveLength(0);
    expect(index.targets.filter((t) => t.kind === "segment")).toHaveLength(3);
  });

  it("withdraws the Tunni point but keeps the line when handles cross", () => {
    // Dragging one handle to the far side of the chord makes the point
    // meaningless, but the line is still a thing you can grab — and having it
    // disappear under the cursor mid-gesture would be worse than refusing the
    // drag when it is attempted.
    const c = ring();
    const crossed = setHandle(c, c.nodes[0]!.id, "out", vec(140, -400))!;
    const index = buildHitIndex(addContour(glyph("o"), crossed), [
      { contourId: crossed.id, segmentIndex: 0 },
    ]);

    const points = index.targets.filter((t) => t.kind === "tunniPoint" && t.segmentIndex === 0);
    const lines = index.targets.filter((t) => t.kind === "tunniLine" && t.segmentIndex === 0);
    expect(points).toHaveLength(0);
    expect(lines).toHaveLength(1);
  });

  it("is empty for a glyph with no contours", () => {
    expect(buildHitIndex(glyph("space", { advance: 250 })).targets).toEqual([]);
  });
});

describe("pick", () => {
  it("finds a node when the cursor is on it", () => {
    const index = buildHitIndex(ringGlyph());
    const hit = pick(index, vec(2, 248), 10);
    expect(hit?.kind).toBe("node");
  });

  it("finds nothing when the cursor is in open space", () => {
    expect(pick(buildHitIndex(ringGlyph()), vec(1000, 1000), 10)).toBeNull();
  });

  it("prefers a handle over the segment lying under it", () => {
    const index = buildHitIndex(ringGlyph());
    const hit = pick(index, vec(140, 250), 12);
    expect(hit?.kind).toBe("handleOut");
  });

  // The reason ordering is by priority first: a control a little further away
  // than the curve beneath it is still what the user aimed at.
  it("prefers a nearby control to a marginally closer curve", () => {
    const c = ring();
    const index = buildHitIndex(addContour(glyph("o"), c), [{ contourId: c.id, segmentIndex: 0 }]);
    const tunni = segmentTunniPoint(c, 0)!;
    const hit = pick(index, tunni, 40);
    expect(hit?.kind).toBe("tunniPoint");
  });

  it("finds a node rather than its own retracted handle", () => {
    // A handle sitting on its anchor has no direction, so dragging it would do
    // nothing. The node has to win.
    const ids = counterIds("r");
    const c = contour(
      ids.contour(),
      [
        node(ids.node(), vec(0, 0), { out: vec(0, 0) }),
        node(ids.node(), vec(100, 0), { in: vec(60, 40) }),
      ],
      false,
    );
    const hit = pick(buildHitIndex(addContour(glyph("x"), c)), vec(0, 0), 8);
    expect(hit?.kind).toBe("node");
  });

  it("falls back to the segment when nothing better is close", () => {
    const index = buildHitIndex(addContour(glyph("t"), triangle()));
    const hit = pick(index, vec(50, 1), 5);
    expect(hit?.kind).toBe("segment");
  });

  it("respects the tolerance", () => {
    const index = buildHitIndex(ringGlyph());
    expect(pick(index, vec(0, 262), 8)).toBeNull();
    expect(pick(index, vec(0, 262), 20)?.kind).toBe("node");
  });

  it("widens with the tolerance as the view zooms out", () => {
    const index = buildHitIndex(ringGlyph());
    const zoomedIn = screenTolerance({ scale: 2, tx: 0, ty: 0 }, 7);
    const zoomedOut = screenTolerance({ scale: 0.05, tx: 0, ty: 0 }, 7);

    // The same 7-pixel radius reaches much further in design units when zoomed
    // out, which is what keeps a control clickable at a whole-glyph view.
    expect(pick(index, vec(0, 280), zoomedIn)).toBeNull();
    expect(pick(index, vec(0, 280), zoomedOut)?.kind).toBe("node");
  });
});

describe("pickAll", () => {
  it("returns every target in range, best first", () => {
    const index = buildHitIndex(ringGlyph());
    const hits = pickAll(index, vec(0, 250), 300);
    expect(hits.length).toBeGreaterThan(1);
    for (let i = 1; i < hits.length; i++) {
      const previous = hits[i - 1]!;
      const current = hits[i]!;
      const samePriority =
        previous.target.kind === current.target.kind
        || (previous.target.kind === "handleIn" && current.target.kind === "handleOut");
      if (samePriority) expect(current.distance).toBeGreaterThanOrEqual(previous.distance);
    }
  });

  it("reports distances that agree with distanceToTarget", () => {
    const index = buildHitIndex(ringGlyph());
    const p = vec(30, 200);
    for (const hit of pickAll(index, p, 500)) {
      expect(hit.distance).toBeCloseTo(distanceToTarget(hit.target, p), 9);
    }
  });
});

describe("pickOf", () => {
  it("ignores kinds the tool does not want", () => {
    const index = buildHitIndex(ringGlyph());
    // A knife cares about the outline and nothing else, even though a node and
    // its handles are much closer.
    const hit = pickOf(index, vec(0, 250), 300, ["segment"]);
    expect(hit?.kind).toBe("segment");
  });

  it("returns null when no allowed kind is in range", () => {
    const index = buildHitIndex(addContour(glyph("t"), triangle()));
    expect(pickOf(index, vec(50, 1), 5, ["tunniPoint"])).toBeNull();
  });
});

describe("nodesInRect", () => {
  it("selects the nodes inside a marquee", () => {
    const found = nodesInRect(ringGlyph(), -10, -10, 300, 300);
    expect(found).toHaveLength(2);
  });

  it("selects nothing for an empty region", () => {
    expect(nodesInRect(ringGlyph(), 900, 900, 1000, 1000)).toEqual([]);
  });

  it("ignores handles, matching what a marquee should select", () => {
    // The marquee covers node (0, 250) and the handles either side of it, but
    // handles are not independently selectable this way.
    const found = nodesInRect(ringGlyph(), -200, 200, 200, 300);
    expect(found).toHaveLength(1);
  });
});
