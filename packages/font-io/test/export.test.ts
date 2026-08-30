import { translation } from "@fonteditor/geometry";
import {
  type FontDocument,
  component,
  contour,
  counterIds,
  fontDocument,
  glyph,
  glyphForCharacter,
  node,
  segmentAt,
  segmentCount,
} from "@fonteditor/font-model";
import { describe, expect, it } from "vitest";

import { FontExportError, exportFileName, exportFont } from "../src/export.js";
import { importFont } from "../src/import.js";

const ids = counterIds();

/** A ring: four nodes, all curves — the shape a round trip must preserve. */
const ring = (name: string, code: number) =>
  glyph(name, {
    unicodes: [code],
    advance: 600,
    contours: [
      contour(
        ids.contour(),
        [
          node(ids.node(), { x: 300, y: 0 }, { type: "smooth", in: { x: 420, y: 0 }, out: { x: 180, y: 0 } }),
          node(ids.node(), { x: 60, y: 350 }, { type: "smooth", in: { x: 60, y: 160 }, out: { x: 60, y: 540 } }),
          node(ids.node(), { x: 300, y: 700 }, { type: "smooth", in: { x: 180, y: 700 }, out: { x: 420, y: 700 } }),
          node(ids.node(), { x: 540, y: 350 }, { type: "smooth", in: { x: 540, y: 540 }, out: { x: 540, y: 160 } }),
        ],
        true,
      ),
    ],
  });

/** A box: four nodes, all lines. */
const box = (name: string, code: number) =>
  glyph(name, {
    unicodes: [code],
    advance: 500,
    contours: [
      contour(
        ids.contour(),
        [
          node(ids.node(), { x: 80, y: 0 }),
          node(ids.node(), { x: 420, y: 0 }),
          node(ids.node(), { x: 420, y: 700 }),
          node(ids.node(), { x: 80, y: 700 }),
        ],
        true,
      ),
    ],
  });

const INFO = {
  familyName: "Round Trip",
  styleName: "Regular",
  unitsPerEm: 1000,
  ascender: 800,
  descender: -200,
  xHeight: 500,
  capHeight: 700,
};

const sample = (): FontDocument =>
  fontDocument(
    [
      glyph(".notdef", { advance: 500 }),
      ring("o", 0x6f),
      box("n", 0x6e),
      glyph("space", { unicodes: [0x20], advance: 250 }),
    ],
    INFO,
  );

const roundTrip = (document: FontDocument): FontDocument =>
  importFont(exportFont(document).bytes, counterIds()).document;

describe("exportFont", () => {
  it("produces a font that parses back", () => {
    const { bytes, warnings } = exportFont(sample());
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(warnings).toEqual([]);

    const back = roundTrip(sample());
    expect(back.info.familyName).toBe("Round Trip");
    expect(back.info.unitsPerEm).toBe(1000);
    expect(back.info.ascender).toBe(800);
    expect(back.info.descender).toBe(-200);
  });

  it("keeps every glyph, its name and its advance", () => {
    const back = roundTrip(sample());
    expect(back.glyphOrder).toEqual([".notdef", "o", "n", "space"]);
    expect(back.glyphs["o"]?.advance).toBe(600);
    expect(back.glyphs["n"]?.advance).toBe(500);
    expect(back.glyphs["space"]?.advance).toBe(250);
  });

  it("keeps the character map", () => {
    const back = roundTrip(sample());
    expect(glyphForCharacter(back, 0x6f)?.name).toBe("o");
    expect(glyphForCharacter(back, 0x6e)?.name).toBe("n");
    expect(glyphForCharacter(back, 0x20)?.name).toBe("space");
  });

  it("preserves a curved outline point for point", () => {
    const before = sample().glyphs["o"]!;
    const after = roundTrip(sample()).glyphs["o"]!;

    const c = after.contours[0]!;
    expect(after.contours).toHaveLength(1);
    expect(c.closed).toBe(true);
    expect(c.nodes).toHaveLength(before.contours[0]!.nodes.length);

    for (let i = 0; i < segmentCount(c); i++) {
      expect(segmentAt(c, i)?.kind).toBe("curve");
    }
    const points = c.nodes.map((n) => [n.pt.x, n.pt.y]);
    expect(points).toContainEqual([300, 0]);
    expect(points).toContainEqual([60, 350]);
    expect(points).toContainEqual([540, 350]);
  });

  it("preserves a straight-sided outline as lines, not flattened curves", () => {
    const after = roundTrip(sample()).glyphs["n"]!;
    const c = after.contours[0]!;
    for (let i = 0; i < segmentCount(c); i++) {
      expect(segmentAt(c, i)?.kind).toBe("line");
    }
  });

  it("writes a blank glyph as blank rather than dropping it", () => {
    const after = roundTrip(sample()).glyphs["space"]!;
    expect(after.contours).toEqual([]);
    expect(after.advance).toBe(250);
  });

  it("puts .notdef first even when the document lists it elsewhere", () => {
    const document = fontDocument([box("n", 0x6e), glyph(".notdef", { advance: 500 })], INFO);
    expect(roundTrip(document).glyphOrder[0]).toBe(".notdef");
  });

  it("invents a .notdef when the document has none", () => {
    const document = fontDocument([box("n", 0x6e)], INFO);
    const back = roundTrip(document);
    expect(back.glyphOrder).toContain(".notdef");
    expect(back.glyphs["n"]).toBeDefined();
  });

  it("rounds coordinates, because the format has an integer grid", () => {
    const document = fontDocument(
      [
        glyph(".notdef", { advance: 500 }),
        glyph("a", {
          unicodes: [0x61],
          advance: 500.6,
          contours: [
            contour(
              ids.contour(),
              [
                node(ids.node(), { x: 10.4, y: 0.5 }),
                node(ids.node(), { x: 200.6, y: 0 }),
                node(ids.node(), { x: 200, y: 300.2 }),
              ],
              true,
            ),
          ],
        }),
      ],
      INFO,
    );

    const after = roundTrip(document).glyphs["a"]!;
    for (const n of after.contours[0]!.nodes) {
      expect(Number.isInteger(n.pt.x)).toBe(true);
      expect(Number.isInteger(n.pt.y)).toBe(true);
    }
    expect(after.advance).toBe(501);
  });

  it("closes an open contour, and says so", () => {
    const document = fontDocument(
      [
        glyph(".notdef", { advance: 500 }),
        glyph("a", {
          unicodes: [0x61],
          advance: 400,
          contours: [
            contour(
              ids.contour(),
              [
                node(ids.node(), { x: 0, y: 0 }),
                node(ids.node(), { x: 300, y: 0 }),
                node(ids.node(), { x: 300, y: 300 }),
              ],
              false,
            ),
          ],
        }),
      ],
      INFO,
    );

    const { warnings } = exportFont(document);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("open contour");
    expect(roundTrip(document).glyphs["a"]?.contours[0]?.closed).toBe(true);
  });

  it("forces the descender negative, whatever the document says", () => {
    const document = fontDocument([glyph(".notdef", { advance: 500 })], {
      ...INFO,
      descender: 200,
    });
    expect(roundTrip(document).info.descender).toBe(-200);
  });

  it("refuses a document with nothing in it", () => {
    expect(() => exportFont(fontDocument([], INFO))).toThrow(FontExportError);
  });

  it("survives a round trip twice without drifting", () => {
    const once = roundTrip(sample());
    const twice = roundTrip(once);
    expect(twice.glyphOrder).toEqual(once.glyphOrder);
    expect(twice.glyphs["o"]?.contours[0]?.nodes.map((n) => n.pt)).toEqual(
      once.glyphs["o"]?.contours[0]?.nodes.map((n) => n.pt),
    );
  });
});

describe("components in an OTF", () => {
  const ids = counterIds("k");

  const composite = () =>
    fontDocument(
      [
        glyph(".notdef", { advance: 500 }),
        box("n", 0x6e),
        glyph("nn", {
          unicodes: [0x100],
          advance: 1000,
          components: [
            component(ids.component(), "n"),
            component(ids.component(), "n", translation(500, 0)),
          ],
        }),
      ],
      INFO,
    );

  it("flattens a component into real outlines, since CFF has none", () => {
    const back = roundTrip(composite()).glyphs["nn"]!;
    expect(back.contours).toHaveLength(2);
    // The second copy is where the transform put it.
    const xs = back.contours.map((c) => Math.min(...c.nodes.map((n) => n.pt.x)));
    expect(xs.sort((a, b) => a - b)).toEqual([80, 580]);
  });

  it("keeps the composite glyph's own advance, not the base's", () => {
    expect(roundTrip(composite()).glyphs["nn"]?.advance).toBe(1000);
  });

  it("draws a glyph's own contours as well as its components", () => {
    const mixed = fontDocument(
      [
        glyph(".notdef", { advance: 500 }),
        box("n", 0x6e),
        glyph("mixed", {
          unicodes: [0x101],
          advance: 900,
          contours: [box("own", 0x102).contours[0]!],
          components: [component(ids.component(), "n", translation(400, 0))],
        }),
      ],
      INFO,
    );
    expect(roundTrip(mixed).glyphs["mixed"]?.contours).toHaveLength(2);
  });

  it("does not hang on a glyph that refers to itself", () => {
    const looped = fontDocument(
      [
        glyph(".notdef", { advance: 500 }),
        glyph("loop", {
          unicodes: [0x103],
          advance: 400,
          contours: [box("b", 0x104).contours[0]!],
          components: [component(ids.component(), "loop")],
        }),
      ],
      INFO,
    );
    // Its own contour still draws; only the loop is cut.
    expect(roundTrip(looped).glyphs["loop"]?.contours).toHaveLength(1);
  });
});

describe("exportFileName", () => {
  it("joins family and style, dropping anything awkward", () => {
    expect(exportFileName(sample())).toBe("RoundTrip-Regular.otf");
  });

  it("falls back where a name is empty or unusable", () => {
    const document = fontDocument([], { ...INFO, familyName: "  ", styleName: "!!" });
    expect(exportFileName(document)).toBe("Untitled-Regular.otf");
  });
});
