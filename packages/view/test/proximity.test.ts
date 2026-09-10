import { project, vec } from "@typewright/geometry";
import {
  type Contour,
  addContour,
  contour,
  counterIds,
  glyph,
  node,
  segmentAt,
  segmentCubic,
  segmentTunniPoint,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { hoveredSegment, sameSegment, segmentProximity } from "../src/proximity.js";
import type { ViewTransform } from "../src/transform.js";

const VIEW: ViewTransform = { scale: 1, tx: 0, ty: 0 };

/** An arch of two curve segments, roughly the shoulder of an 'n'. */
function arch(): Contour {
  const ids = counterIds();
  return contour(
    ids.contour(),
    [
      node(ids.node(), vec(100, 480), { type: "corner", out: vec(100, 632) }),
      node(ids.node(), vec(320, 700), { type: "smooth", in: vec(208, 700), out: vec(432, 700) }),
      node(ids.node(), vec(540, 480), { type: "corner", in: vec(540, 632) }),
    ],
    false,
  );
}

function straight(): Contour {
  const ids = counterIds("s");
  return contour(
    ids.contour(),
    [node(ids.node(), vec(0, 0)), node(ids.node(), vec(400, 0))],
    false,
  );
}

const glyphOf = (c: Contour) => addContour(glyph("n", { advance: 600 }), c);

describe("segmentProximity", () => {
  it("is zero on the curve itself", () => {
    const c = arch();
    const g = glyphOf(c);
    const ref = { contourId: c.id, segmentIndex: 0 };
    expect(segmentProximity(g, ref, vec(100, 480))).toBeLessThan(1e-6);
    expect(segmentProximity(g, ref, vec(320, 700))).toBeLessThan(1e-6);
  });

  // The bug this function exists to fix. The Tunni point sits well off the
  // curve, so a curve-only measure reports the segment as far away at exactly
  // the moment the cursor lands on its control.
  it("is zero at the Tunni point, which is nowhere near the curve", () => {
    const c = arch();
    const g = glyphOf(c);
    const ref = { contourId: c.id, segmentIndex: 0 };
    const tunni = segmentTunniPoint(c, 0)!;

    expect(segmentProximity(g, ref, tunni)).toBeLessThan(1e-6);

    // The assertion above would be trivially satisfied if the Tunni point
    // happened to sit on the curve. It does not — it is far enough off that a
    // curve-only measure would have put it well outside the entry radius.
    const cubic = segmentCubic(segmentAt(c, 0)!);
    expect(project(cubic, tunni).distance).toBeGreaterThan(60);
  });

  it("is zero on a handle", () => {
    const c = arch();
    const g = glyphOf(c);
    const ref = { contourId: c.id, segmentIndex: 0 };
    expect(segmentProximity(g, ref, vec(100, 632))).toBeLessThan(1e-6);
    expect(segmentProximity(g, ref, vec(208, 700))).toBeLessThan(1e-6);
  });

  it("is zero on the Tunni line between the handles", () => {
    const c = arch();
    const g = glyphOf(c);
    const ref = { contourId: c.id, segmentIndex: 0 };
    const middle = vec((100 + 208) / 2, (632 + 700) / 2);
    expect(segmentProximity(g, ref, middle)).toBeLessThan(1e-6);
  });

  it("grows with distance in open space", () => {
    const c = arch();
    const g = glyphOf(c);
    const ref = { contourId: c.id, segmentIndex: 0 };
    const near = segmentProximity(g, ref, vec(200, 800))!;
    const far = segmentProximity(g, ref, vec(200, 2000))!;
    expect(far).toBeGreaterThan(near);
  });

  // A straight segment's cubic has handles at the thirds, but they are a
  // materialisation for geometry queries, not something the user can grab.
  it("counts only handles that really exist", () => {
    const c = straight();
    const g = glyphOf(c);
    const ref = { contourId: c.id, segmentIndex: 0 };
    // A point 50 above the midpoint is 50 from the segment, and there are no
    // handles anywhere else to be nearer to.
    expect(segmentProximity(g, ref, vec(200, 50))).toBeCloseTo(50, 6);
  });

  it("returns null for a segment that is not there", () => {
    const g = glyphOf(arch());
    expect(segmentProximity(g, { contourId: "gone", segmentIndex: 0 }, vec(0, 0))).toBeNull();
    expect(segmentProximity(g, { contourId: arch().id, segmentIndex: 9 }, vec(0, 0))).toBeNull();
  });
});

describe("hoveredSegment", () => {
  it("wakes the segment under the cursor", () => {
    const c = arch();
    const g = glyphOf(c);
    const active = hoveredSegment(g, vec(150, 520), VIEW, null);
    expect(active).not.toBeNull();
    expect(active!.segmentIndex).toBe(0);
  });

  // The whole point of the ensemble measure: hovering the Tunni point must wake
  // its segment, even though the cursor is far from the curve.
  it("wakes a segment from its own Tunni point", () => {
    const c = arch();
    const g = glyphOf(c);
    const tunni = segmentTunniPoint(c, 0)!;
    const active = hoveredSegment(g, tunni, VIEW, null);
    expect(active).not.toBeNull();
    expect(active!.segmentIndex).toBe(0);
  });

  it("stays asleep when the cursor is far from everything", () => {
    expect(hoveredSegment(glyphOf(arch()), vec(5000, 5000), VIEW, null)).toBeNull();
  });

  it("sleeps when the cursor leaves the canvas", () => {
    const c = arch();
    const g = glyphOf(c);
    const current = { contourId: c.id, segmentIndex: 0 };
    expect(hoveredSegment(g, null, VIEW, current)).toBeNull();
  });

  it("holds on past the entry radius once awake", () => {
    const c = arch();
    const g = glyphOf(c);
    const current = { contourId: c.id, segmentIndex: 0 };

    // Between the two radii: too far to wake from cold, near enough to hold.
    const away = vec(100, 480 - 120);
    expect(hoveredSegment(g, away, VIEW, null)).toBeNull();
    expect(sameSegment(hoveredSegment(g, away, VIEW, current), current)).toBe(true);
  });

  it("lets go once past the stay radius", () => {
    const c = arch();
    const g = glyphOf(c);
    const current = { contourId: c.id, segmentIndex: 0 };
    expect(hoveredSegment(g, vec(100, 480 - 400), VIEW, current)).toBeNull();
  });

  it("hands over to a neighbour that is clearly nearer", () => {
    const c = arch();
    const g = glyphOf(c);
    const current = { contourId: c.id, segmentIndex: 0 };
    const deepInSecond = vec(540, 490);
    const handed = hoveredSegment(g, deepInSecond, VIEW, current);
    expect(handed).not.toBeNull();
    expect(handed!.segmentIndex).toBe(1);
  });

  it("scales its radii with the zoom", () => {
    const c = arch();
    const g = glyphOf(c);
    // 300 design units above the arch: out of reach at 1:1…
    const p = vec(320, 700 + 300);
    expect(hoveredSegment(g, p, VIEW, null)).toBeNull();
    // …but well within a 95-pixel radius once zoomed far out.
    expect(hoveredSegment(g, p, { scale: 0.1, tx: 0, ty: 0 }, null)).not.toBeNull();
  });

  it("finds nothing in a glyph with no segments", () => {
    expect(hoveredSegment(glyph("space", { advance: 250 }), vec(0, 0), VIEW, null)).toBeNull();
  });
});

describe("sameSegment", () => {
  it("compares by contour and index", () => {
    expect(
      sameSegment({ contourId: "c1", segmentIndex: 2 }, { contourId: "c1", segmentIndex: 2 }),
    ).toBe(true);
    expect(
      sameSegment({ contourId: "c1", segmentIndex: 2 }, { contourId: "c1", segmentIndex: 3 }),
    ).toBe(false);
    expect(
      sameSegment({ contourId: "c1", segmentIndex: 2 }, { contourId: "c2", segmentIndex: 2 }),
    ).toBe(false);
  });

  it("treats two nulls as the same and one null as different", () => {
    expect(sameSegment(null, null)).toBe(true);
    expect(sameSegment(null, { contourId: "c1", segmentIndex: 0 })).toBe(false);
  });
});

describe("measuring a segment the caller has said is far", () => {
  const g = glyph("a", { advance: 600, contours: [arch()] });
  const ref = { contourId: g.contours[0]!.id, segmentIndex: 0 };

  it("gives the exact distance inside the limit", () => {
    const near = vec(150, 500);
    const exact = segmentProximity(g, ref, near)!;
    expect(segmentProximity(g, ref, near, 1000)).toBeCloseTo(exact, 9);
  });

  it("still says far when it is far, without measuring exactly", () => {
    // Beyond the limit the answer only has to be a floor under the truth, which
    // is what lets the projection be skipped.
    const away = vec(5000, 5000);
    const rough = segmentProximity(g, ref, away, 10)!;
    expect(rough).toBeGreaterThan(10);
    expect(rough).toBeLessThanOrEqual(segmentProximity(g, ref, away)! + 1e-9);
  });

  it("wakes whichever segment is really the nearest", () => {
    // The limit is an optimisation, not a behaviour: what wakes is still the
    // segment with the smallest exact distance, measured without one.
    for (const cursor of [vec(150, 520), vec(300, 660), vec(500, 520)]) {
      const measured = [0, 1].map((segmentIndex) =>
        segmentProximity(g, { contourId: ref.contourId, segmentIndex }, cursor)!,
      );
      const nearest = measured[0]! <= measured[1]! ? 0 : 1;
      expect(hoveredSegment(g, cursor, VIEW, null)?.segmentIndex).toBe(nearest);
    }
  });
});
