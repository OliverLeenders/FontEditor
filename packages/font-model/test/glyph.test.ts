import { vec } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import { setNodePoint } from "../src/contour.js";
import {
  addContour,
  allSegments,
  contourById,
  glyph,
  glyphBounds,
  nodeCount,
  removeContour,
  setAdvance,
  updateContour,
} from "../src/glyph.js";
import { openContour, ringContour, triangleContour } from "./fixtures.js";

describe("glyph composition", () => {
  it("starts empty and accumulates contours", () => {
    const g = glyph("o", { advance: 600 });
    expect(g.contours).toEqual([]);
    expect(glyphBounds(g)).toBeNull();

    const withRing = addContour(g, ringContour());
    expect(withRing.contours).toHaveLength(1);
    expect(nodeCount(withRing)).toBe(4);
  });

  it("leaves the original untouched when adding", () => {
    const g = glyph("o");
    addContour(g, ringContour());
    expect(g.contours).toEqual([]);
  });

  it("collects every segment with the contour it came from", () => {
    const g = addContour(addContour(glyph("x"), ringContour()), triangleContour());
    const all = allSegments(g);
    expect(all).toHaveLength(7);
    expect(new Set(all.map((s) => s.contourId)).size).toBe(2);
  });

  it("measures bounds across all contours", () => {
    const g = addContour(addContour(glyph("x"), ringContour()), triangleContour());
    const box = glyphBounds(g)!;
    expect(box.minX).toBeCloseTo(-250, 6);
    expect(box.maxY).toBeCloseTo(250, 6);
  });
});

describe("updateContour", () => {
  it("applies a contour operation in place by id", () => {
    const ring = ringContour();
    const g = addContour(glyph("o"), ring);
    const nodeId = ring.nodes[0]!.id;

    const next = updateContour(g, ring.id, (c) => setNodePoint(c, nodeId, vec(0, 300)))!;
    expect(contourById(next, ring.id)!.nodes[0]!.pt).toEqual(vec(0, 300));
  });

  it("returns null when the contour is missing", () => {
    const g = addContour(glyph("o"), ringContour());
    expect(updateContour(g, "nope", (c) => c)).toBeNull();
  });

  // A declined operation must not half-apply — the caller gets nothing back and
  // the glyph it already holds is still valid.
  it("returns null when the operation declines", () => {
    const ring = ringContour();
    const g = addContour(glyph("o"), ring);
    expect(updateContour(g, ring.id, (c) => setNodePoint(c, "nope", vec(0, 0)))).toBeNull();
  });
});

describe("removeContour and setAdvance", () => {
  it("removes by id", () => {
    const ring = ringContour();
    const g = addContour(addContour(glyph("x"), ring), openContour());
    const fewer = removeContour(g, ring.id)!;
    expect(fewer.contours).toHaveLength(1);
    expect(contourById(fewer, ring.id)).toBeNull();
  });

  it("returns null for an unknown contour", () => {
    expect(removeContour(glyph("x"), "nope")).toBeNull();
  });

  it("sets the advance without touching the outline", () => {
    const g = addContour(glyph("o"), ringContour());
    const wider = setAdvance(g, 700);
    expect(wider.advance).toBe(700);
    expect(wider.contours).toEqual(g.contours);
  });
});

describe("serializability", () => {
  // The rule the whole history design rests on: the document is plain data.
  it("survives structuredClone and JSON unchanged", () => {
    const g = addContour(
      addContour(glyph("x", { unicodes: [0x78] }), ringContour()),
      openContour(),
    );
    expect(structuredClone(g)).toEqual(g);
    expect(JSON.parse(JSON.stringify(g))).toEqual(g);
  });
});
