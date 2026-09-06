import { vec } from "@fonteditor/geometry";
import { component, contour, counterIds, fontDocument, glyph, node } from "@fonteditor/font-model";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { importFont } from "../src/import.js";

/**
 * What the file gets when shapes overlap.
 *
 * CFF does not allow overlapping contours — its CharStrings are filled by the
 * even-odd rule, under which two shapes subtract where they cross — so the
 * compiler takes the union. A font with the overlap left in looks perfect in a
 * browser, whose rasteriser is lenient, and comes out of a Windows preview with
 * a notch in it.
 */

const ids = counterIds("v");

const box = (minX: number, minY: number, maxX: number, maxY: number) =>
  contour(
    ids.contour(),
    [
      node(ids.node(), vec(minX, minY)),
      node(ids.node(), vec(maxX, minY)),
      node(ids.node(), vec(maxX, maxY)),
      node(ids.node(), vec(minX, maxY)),
    ],
    true,
  );

const roundTrip = (document: Parameters<typeof exportFont>[0]) =>
  importFont(exportFont(document, counterIds("e")).bytes, counterIds("b")).document;

describe("overlapping shapes on the way into a font", () => {
  it("joins a stem crossing a shoulder into one contour", () => {
    const g = glyph("n", {
      advance: 600,
      // Crossing, not flush: the shoulder's edges cut the stem's rather than
      // lying along them.
      contours: [box(100, 0, 200, 700), box(150, 400, 500, 600)],
    });

    const back = roundTrip(fontDocument([g]));
    const out = back.glyphs["n"]!;
    expect(out.contours).toHaveLength(1);
    // The union of the two boxes: eight corners round an L.
    expect(out.contours[0]!.nodes).toHaveLength(8);
  });

  it("joins a component to the contours it overlaps", () => {
    // The case that started this: a composite looked solid in the editor and
    // came out of the font with the overlap subtracted.
    const stem = glyph("i", { advance: 300, contours: [box(100, 0, 200, 700)] });
    const n = glyph("n", {
      advance: 600,
      contours: [box(150, 400, 500, 600)],
      components: [component(ids.component(), "i")],
    });

    const out = roundTrip(fontDocument([stem, n])).glyphs["n"]!;
    expect(out.contours).toHaveLength(1);
    expect(out.contours[0]!.nodes).toHaveLength(8);
  });

  it("leaves a counter alone, and running the other way round", () => {
    const o = glyph("o", {
      advance: 600,
      contours: [box(0, 0, 600, 600), box(150, 150, 450, 450)],
    });

    const out = roundTrip(fontDocument([o])).glyphs["o"]!;
    expect(out.contours).toHaveLength(2);

    const area = (c: (typeof out.contours)[number]) => {
      let sum = 0;
      for (let i = 0; i < c.nodes.length; i++) {
        const a = c.nodes[i]!.pt;
        const b = c.nodes[(i + 1) % c.nodes.length]!.pt;
        sum += a.x * b.y - b.x * a.y;
      }
      return sum;
    };
    const [outer, counter] = [...out.contours].sort(
      (l, r) => Math.abs(area(r)) - Math.abs(area(l)),
    );
    expect(area(outer!)).toBeGreaterThan(0);
    expect(area(counter!)).toBeLessThan(0);
  });

  it("joins shapes that share edges rather than crossing them", () => {
    // Two rectangles from the same corner: they overlap, and every edge of the
    // overlap lies along an edge of one of them, so there is no crossing to
    // split at. This used to be refused and warned about; the ends of the shared
    // stretch are the answer.
    const ell = glyph("t", {
      advance: 600,
      contours: [box(0, 0, 400, 150), box(0, 0, 150, 400)],
    });

    const { warnings } = exportFont(fontDocument([ell]), counterIds("e"));
    expect(warnings).toEqual([]);

    const out = roundTrip(fontDocument([ell])).glyphs["t"]!;
    expect(out.contours).toHaveLength(1);
    // An L: six corners, and nothing left in the middle of the straight runs.
    expect(out.contours[0]!.nodes).toHaveLength(6);
  });

  it("leaves shapes that merely touch alone", () => {
    // Sharing a boundary line is not an overlap: there is no area in common, so
    // there is nothing to join and no seam for a rasteriser to find.
    const touching = glyph("u", {
      advance: 600,
      contours: [box(0, 0, 300, 300), box(300, 0, 600, 300)],
    });

    const out = roundTrip(fontDocument([touching])).glyphs["u"]!;
    expect(out.contours).toHaveLength(2);
  });

  it("leaves a glyph with nothing overlapping exactly as it was", () => {
    const apart = glyph("colon", {
      advance: 300,
      contours: [box(100, 0, 200, 100), box(100, 400, 200, 500)],
    });

    const out = roundTrip(fontDocument([apart])).glyphs["colon"]!;
    expect(out.contours).toHaveLength(2);
    expect(out.contours.flatMap((c) => c.nodes)).toHaveLength(8);
  });
});
