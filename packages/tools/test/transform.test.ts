import { rotation, scaling, translation, vec } from "@typewright/geometry";
import { contour, counterIds, fontDocument, glyph, node } from "@typewright/font-model";
import type { Selection } from "@typewright/view";
import { describe, expect, it } from "vitest";

import { transformedDocument } from "../src/transform.js";

/**
 * The kernel both halves of transforming use: the panel when a number is typed,
 * and the box gesture on every pointer move. Tested here directly rather than
 * only through them, because they agree by calling the same function and that is
 * the function.
 */

const ids = counterIds("t");

/** Two contours, so a transform can be shown to leave the other alone. */
function document() {
  const first = contour(
    ids.contour(),
    [
      node("a", vec(0, 0), { out: vec(20, 0), hvLock: { out: true, in: false } }),
      node("b", vec(100, 0), { type: "smooth", in: vec(80, 0), out: vec(120, 0) }),
      node("c", vec(100, 100)),
    ],
    true,
  );
  const second = contour(ids.contour(), [node("d", vec(300, 0)), node("e", vec(400, 0))], false);
  return {
    doc: fontDocument([glyph("a", { advance: 500, contours: [first, second] })]),
    first,
    second,
  };
}

const at = (d: ReturnType<typeof document>["doc"], id: string) =>
  d.glyphs["a"]!.contours.flatMap((c) => c.nodes).find((n) => n.id === id)!;

const points = (contourId: string, ...ids: string[]): Selection =>
  ids.map((nodeId) => ({ contourId, nodeId, part: "point" as const }));

describe("moving a set of points by a matrix", () => {
  it("moves the named points and their handles, and nothing else", () => {
    const { doc, first, second } = document();
    const out = transformedDocument(doc, "a", points(first.id, "a"), translation(10, 5), false)!;

    expect(at(out, "a").pt).toEqual(vec(10, 5));
    expect(at(out, "a").out).toEqual(vec(30, 5));
    expect(at(out, "b").pt).toEqual(vec(100, 0));
    expect(at(out, "d").pt).toEqual(vec(300, 0));
    // The contour nobody touched is the very same object.
    expect(out.glyphs["a"]!.contours[1]).toBe(second);
  });

  it("takes points from several contours in one pass", () => {
    const { doc, first, second } = document();
    const out = transformedDocument(
      doc,
      "a",
      [...points(first.id, "a"), ...points(second.id, "d")],
      translation(0, 50),
      false,
    )!;

    expect(at(out, "a").pt).toEqual(vec(0, 50));
    expect(at(out, "d").pt).toEqual(vec(300, 50));
  });

  it("ignores handles named in the selection: a point carries its own", () => {
    const { doc, first } = document();
    const handleOnly: Selection = [{ contourId: first.id, nodeId: "a", part: "out" }];
    expect(transformedDocument(doc, "a", handleOnly, translation(10, 0), false)).toBeNull();
  });

  it("declines when nothing it was given exists to move", () => {
    const { doc } = document();
    expect(transformedDocument(doc, "a", [], translation(10, 0), false)).toBeNull();
    expect(
      transformedDocument(doc, "nope", points("c1", "a"), translation(10, 0), false),
    ).toBeNull();
  });

  it("keeps a smooth node smooth, because a straight line stays straight", () => {
    const { doc, first } = document();
    const out = transformedDocument(
      doc,
      "a",
      points(first.id, "a", "b", "c"),
      rotation(0.7),
      true,
    )!;
    const n = at(out, "b");
    expect(n.type).toBe("smooth");
    const left = { x: n.in!.x - n.pt.x, y: n.in!.y - n.pt.y };
    const right = { x: n.out!.x - n.pt.x, y: n.out!.y - n.pt.y };
    expect(left.x * right.y - left.y * right.x).toBeCloseTo(0, 6);
  });

  it("lets the axis locks go when told to, and keeps them when not", () => {
    const { doc, first } = document();
    const kept = transformedDocument(doc, "a", points(first.id, "a"), scaling(2, 2), false)!;
    expect(at(kept, "a").hvLock.out).toBe(true);

    // A lock says "this handle is held level or upright". A transform that does
    // not send each axis to an axis cannot keep that true, so the caller says so.
    const loosened = transformedDocument(doc, "a", points(first.id, "a"), rotation(0.4), true)!;
    expect(at(loosened, "a").hvLock).toEqual({ in: false, out: false });
  });

  it("works from the document it is given, so a drag cannot compound", () => {
    // The property the box gesture depends on: every move recomputes from the
    // document as it was when the drag began, so twice to the same place is once.
    const { doc, first } = document();
    const once = transformedDocument(doc, "a", points(first.id, "a"), translation(30, 0), false)!;
    const halfway = transformedDocument(
      doc,
      "a",
      points(first.id, "a"),
      translation(10, 0),
      false,
    )!;
    const again = transformedDocument(doc, "a", points(first.id, "a"), translation(30, 0), false)!;

    expect(at(again, "a").pt).toEqual(at(once, "a").pt);
    expect(at(halfway, "a").pt).toEqual(vec(10, 0));
  });
});
