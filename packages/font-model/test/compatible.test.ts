import { vec } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import { component } from "../src/component.js";
import { contour } from "../src/contour.js";
import { glyphCompatible, glyphIncompatibilities, incompatibilities } from "../src/compatible.js";
import { DEFAULT_FONT_INFO, fontDocument } from "../src/document.js";
import { addContour, glyph } from "../src/glyph.js";
import { node } from "../src/node.js";

/**
 * Whether two drawings of a glyph can be worked out in between.
 *
 * Every rule here is something that ruins an instance silently. Interpolation
 * is arithmetic on corresponding points and nothing in it asks whether the two
 * lists describe the same shape, so the failure is never an error — it is a
 * letter with a spike in it at every weight between, found in a proof weeks
 * later.
 */

let ids = 0;
const id = () => `t${String(++ids)}`;

/** A closed triangle, which is the shape most of these compare. */
const triangle = (x = 0) =>
  contour(
    id(),
    [node(id(), vec(x, 0)), node(id(), vec(x + 300, 0)), node(id(), vec(x + 150, 700))],
    true,
  );

/** The same three points, run the other way round. */
const backwards = () =>
  contour(id(), [node(id(), vec(150, 700)), node(id(), vec(300, 0)), node(id(), vec(0, 0))], true);

const drawn = (...contours: ReturnType<typeof triangle>[]) =>
  contours.reduce((g, c) => addContour(g, c), glyph("a", { advance: 500 }));

const kinds = (one: ReturnType<typeof drawn>, two: ReturnType<typeof drawn>) =>
  glyphIncompatibilities("a", one, two).map((x) => x.kind);

describe("two drawings that agree", () => {
  it("have nothing to report", () => {
    expect(glyphIncompatibilities("a", drawn(triangle()), drawn(triangle(40)))).toEqual([]);
    expect(glyphCompatible("a", drawn(triangle()), drawn(triangle(40)))).toBe(true);
  });

  it("may be moved as far as you like, which is the whole point", () => {
    const light = drawn(triangle());
    const black = drawn(triangle(9000));
    expect(glyphCompatible("a", light, black)).toBe(true);
  });
});

describe("shapes that cannot be worked out in between", () => {
  it("finds a glyph that is only in one master", () => {
    expect(glyphIncompatibilities("a", drawn(triangle()), null)[0]?.kind).toBe("missing");
    expect(glyphIncompatibilities("a", null, null)).toEqual([]);
  });

  it("finds a different number of contours", () => {
    expect(kinds(drawn(triangle()), drawn(triangle(), triangle(400)))).toEqual(["contours"]);
  });

  it("finds a different number of points", () => {
    const four = contour(
      id(),
      [
        node(id(), vec(0, 0)),
        node(id(), vec(300, 0)),
        node(id(), vec(300, 700)),
        node(id(), vec(0, 700)),
      ],
      true,
    );
    const found = glyphIncompatibilities("a", drawn(triangle()), drawn(four));

    expect(found[0]?.kind).toBe("points");
    expect(found[0]?.contour).toBe(0);
    expect(found[0]?.says).toMatch(/3 points in one master and 4 in the other/);
  });

  it("finds one closed and one open", () => {
    const open = contour(id(), [node(id(), vec(0, 0)), node(id(), vec(300, 0))], false);
    const closed = contour(id(), [node(id(), vec(0, 0)), node(id(), vec(300, 0))], true);

    expect(kinds(drawn(open), drawn(closed))).toEqual(["closed"]);
  });

  it("finds a segment that is a line in one master and a curve in the other", () => {
    const straight = contour(
      id(),
      [node(id(), vec(0, 0)), node(id(), vec(300, 0)), node(id(), vec(150, 700))],
      true,
    );
    const curved = contour(
      id(),
      [
        node(id(), vec(0, 0), { out: vec(100, 40) }),
        node(id(), vec(300, 0)),
        node(id(), vec(150, 700)),
      ],
      true,
    );

    // The controls interpolate out of a point on the straight edge, and the
    // shape swells out of it on the way.
    const found = glyphIncompatibilities("a", drawn(straight), drawn(curved));
    expect(found[0]?.kind).toBe("handles");
    expect(found[0]?.says).toMatch(/Point 1 of contour 1/);
  });

  it("finds a contour running the other way round", () => {
    // The strangest-looking of these: the shape turns inside out on the way
    // between, and nothing about the two ends says why.
    expect(kinds(drawn(triangle()), drawn(backwards()))).toEqual(["direction"]);
  });

  it("says one thing per contour, not one per difference", () => {
    const two = contour(id(), [node(id(), vec(0, 0)), node(id(), vec(1, 1))], false);
    const found = glyphIncompatibilities("a", drawn(triangle()), drawn(two));

    // Fewer points, and open where the other is closed, and running the other
    // way: one contour, one line about it.
    expect(found).toHaveLength(1);
  });
});

describe("the glyphs placed inside", () => {
  it("finds a different number of them", () => {
    const one = glyph("Aacute", { advance: 600, components: [component(id(), "A")] });
    const two = glyph("Aacute", {
      advance: 600,
      components: [component(id(), "A"), component(id(), "acute")],
    });

    expect(glyphIncompatibilities("Aacute", one, two)[0]?.kind).toBe("components");
  });

  it("finds a different glyph in the same place", () => {
    const one = glyph("Aacute", { advance: 600, components: [component(id(), "acute")] });
    const two = glyph("Aacute", { advance: 600, components: [component(id(), "grave")] });

    const found = glyphIncompatibilities("Aacute", one, two);
    expect(found[0]?.says).toMatch(/acute in one master and grave in the other/);
  });

  it("does not mind where they are placed, which is what interpolates", () => {
    const one = glyph("Aacute", { advance: 600, components: [component(id(), "acute")] });
    const two = glyph("Aacute", {
      advance: 600,
      components: [
        component(id(), "acute", {
          xScale: 1,
          xyScale: 0,
          yxScale: 0,
          yScale: 1,
          xOffset: 120,
          yOffset: 40,
        }),
      ],
    });

    expect(glyphIncompatibilities("Aacute", one, two)).toEqual([]);
  });
});

describe("two whole masters", () => {
  it("report every glyph that differs, in font order", () => {
    const light = fontDocument(
      [drawn(triangle()), glyph("b", { advance: 500 })],
      DEFAULT_FONT_INFO,
    );
    const black = fontDocument(
      [drawn(triangle(), triangle(400)), glyph("c", { advance: 500 })],
      DEFAULT_FONT_INFO,
    );

    const found = incompatibilities(light, black);
    expect(found.map((x) => x.glyph)).toEqual(["a", "b", "c"]);
    expect(found[0]?.kind).toBe("contours");
    // A glyph in one master and not the other, from both directions.
    expect(found[1]?.kind).toBe("missing");
    expect(found[2]?.kind).toBe("missing");
  });

  it("say nothing about a font that is drawn the same way twice", () => {
    const document = fontDocument([drawn(triangle())], DEFAULT_FONT_INFO);
    expect(incompatibilities(document, document)).toEqual([]);
  });
});
