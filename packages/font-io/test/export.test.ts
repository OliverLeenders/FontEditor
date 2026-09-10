import { translation } from "@typewright/geometry";
import {
  DEFAULT_FONT_INFO,
  type FontDocument,
  addAnchor,
  anchor,
  component,
  contour,
  counterIds,
  fontDocument,
  glyph,
  rectContour,
  glyphForCodePoint,
  node,
  segmentAt,
  segmentCount,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { FontExportError, exportFileName, exportFont } from "../src/export.js";
import { opentype } from "../src/opentype.js";
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
          node(
            ids.node(),
            { x: 300, y: 0 },
            { type: "smooth", in: { x: 420, y: 0 }, out: { x: 180, y: 0 } },
          ),
          node(
            ids.node(),
            { x: 60, y: 350 },
            { type: "smooth", in: { x: 60, y: 160 }, out: { x: 60, y: 540 } },
          ),
          node(
            ids.node(),
            { x: 300, y: 700 },
            { type: "smooth", in: { x: 180, y: 700 }, out: { x: 420, y: 700 } },
          ),
          node(
            ids.node(),
            { x: 540, y: 350 },
            { type: "smooth", in: { x: 540, y: 540 }, out: { x: 540, y: 160 } },
          ),
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
  ...DEFAULT_FONT_INFO,
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
    expect(glyphForCodePoint(back, 0x6f)?.name).toBe("o");
    expect(glyphForCodePoint(back, 0x6e)?.name).toBe("n");
    expect(glyphForCodePoint(back, 0x20)?.name).toBe("space");
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

describe("mark attachment in an OTF", () => {
  /** A letter with a place for an accent, and an accent that attaches by it. */
  const attaching = (): FontDocument => {
    const ids = counterIds("k");
    const a = addAnchor(
      glyph("a", {
        unicodes: [0x61],
        advance: 500,
        contours: [rectContour(ids, { minX: 0, minY: 0, maxX: 400, maxY: 600 })],
      }),
      anchor("a1", "top", { x: 250, y: 620 }),
    );
    const mark = addAnchor(
      glyph("acutecomb", {
        unicodes: [0x301],
        advance: 0,
        contours: [rectContour(ids, { minX: 0, minY: 0, maxX: 80, maxY: 60 })],
      }),
      anchor("m1", "_top", { x: 40, y: 0 }),
    );
    return fontDocument([a, mark], INFO);
  };

  /** The four-byte tags in a font's table directory. */
  const tagsOf = (bytes: ArrayBuffer): string[] => {
    const view = new DataView(bytes);
    const count = view.getUint16(4);
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const at = 12 + i * 16;
      out.push(String.fromCharCode(...new Uint8Array(bytes, at, 4)));
    }
    return out;
  };

  it("writes GPOS and GDEF when the anchors describe an attachment", () => {
    const { bytes, warnings } = exportFont(attaching());
    expect(warnings).toEqual([]);

    const tags = tagsOf(bytes);
    expect(tags).toContain("GPOS");
    // Without GDEF a shaper does not know which glyphs are marks, and the
    // attachment is not reliably applied — so it is written with the lookups.
    expect(tags).toContain("GDEF");
  });

  it("writes neither for a font whose anchors attach nothing", () => {
    const ids = counterIds("p");
    const lonely = addAnchor(
      glyph("a", {
        unicodes: [0x61],
        advance: 500,
        contours: [rectContour(ids, { minX: 0, minY: 0, maxX: 400, maxY: 600 })],
      }),
      anchor("a1", "top", { x: 250, y: 620 }),
    );

    const tags = tagsOf(exportFont(fontDocument([lonely], INFO)).bytes);
    expect(tags).not.toContain("GDEF");
  });

  it("parses back through opentype.js, which reads the lookups it wrote", () => {
    const font = opentype.parse(exportFont(attaching()).bytes);
    const lookups = font.tables.gpos?.lookups ?? [];

    // Type 4 is mark-to-base. Reading it back is the check that the offsets
    // inside the subtable are right and not merely the byte count.
    expect(lookups.some((l: { lookupType: number }) => l.lookupType === 4)).toBe(true);
  });
});

describe("what the font says about itself", () => {
  /**
   * A font with an identity: a semibold italic in a family of more than four
   * styles, which is the case the four-slot name scheme cannot hold and the one
   * that comes out wrong when a compiler treats the two schemes as one.
   */
  const identified = (): FontDocument =>
    fontDocument(
      [glyph(".notdef", { advance: 500 }), glyph("a", { unicodes: [0x61], advance: 500 })],
      {
        ...DEFAULT_FONT_INFO,
        familyName: "Named",
        styleName: "Semibold Italic",
        openTypeNamePreferredFamilyName: "Named",
        openTypeNamePreferredSubfamilyName: "Semibold Italic",
        styleMapFamilyName: "Named Semibold",
        styleMapStyleName: "italic",
        versionMajor: 2,
        versionMinor: 7,
        italicAngle: -12,
        copyright: "Copyright nobody",
        openTypeNameDesigner: "A Designer",
        openTypeNameLicense: "Do as you like.",
        openTypeOS2VendorID: "TUNN",
        openTypeOS2WeightClass: 600,
        openTypeOS2WidthClass: 5,
      },
    );

  const namesOf = (document: FontDocument): Record<string, string> => {
    const font = opentype.parse(exportFont(document).bytes);
    const table = font.names["windows"] ?? font.names["macintosh"] ?? {};
    const out: Record<string, string> = {};
    for (const [key, translations] of Object.entries(table)) {
      const value = translations["en"];
      if (value !== undefined) out[key] = value;
    }
    return out;
  };

  it("writes what the designer filled in", () => {
    const names = namesOf(identified());

    expect(names["copyright"]).toBe("Copyright nobody");
    expect(names["designer"]).toBe("A Designer");
    expect(names["license"]).toBe("Do as you like.");
    expect(names["version"]).toBe("Version 2.007");
  });

  it("puts the four-slot names in 1 and 2, and the real ones in 16 and 17", () => {
    const names = namesOf(identified());

    // What an operating system groups by: this file is the italic of
    // "Named Semibold", a family of two.
    expect(names["fontFamily"]).toBe("Named Semibold");
    expect(names["fontSubfamily"]).toBe("Italic");

    // What software that can group more than four styles reads instead.
    expect(names["preferredFamily"]).toBe("Named");
    expect(names["preferredSubfamily"]).toBe("Semibold Italic");

    expect(names["fullName"]).toBe("Named Semibold Italic");
  });

  it("leaves out a name nobody filled in, rather than writing a blank one", () => {
    const plain = fontDocument([glyph(".notdef", { advance: 500 })], DEFAULT_FONT_INFO);
    const names = namesOf(plain);

    // opentype.js writes a single space where it was given nothing, so this is
    // the difference between "not stated" and "stated to be empty".
    expect(names["designer"]).toBeUndefined();
    expect(names["copyright"]).toBeUndefined();

    // The typographic names say nothing the four-slot pair does not, here.
    // opentype.js writes 16 and 17 whether or not it was asked to, so this is
    // that they agree rather than that they are absent.
    expect(names["preferredFamily"]).toBe(names["fontFamily"]);
    expect(names["preferredSubfamily"]).toBe(names["fontSubfamily"]);
  });
});
