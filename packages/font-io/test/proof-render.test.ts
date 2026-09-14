import {
  DEFAULT_FONT_INFO,
  type Contour,
  type FontDocument,
  component,
  contour,
  counterIds,
  drawableGlyph,
  fontDocument,
  glyph,
  node,
} from "@typewright/font-model";
import { IDENTITY_AFFINE } from "@typewright/geometry";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { exportTrueType } from "../src/truetype.js";

/**
 * A font for FreeType to draw, and the drawing to hold it against.
 *
 * Both flavours are checked against fontTools already, as tables and as curves.
 * What neither check can see is what a rasteriser makes of them: an overlap left
 * in a CFF outline fills with a notch where two strokes cross, a counter running
 * the wrong way fills solid, a hairline can drop out of a small size altogether,
 * and every one of those files reads back perfectly. So `tools/render-check`
 * renders both files with FreeType and compares the pixels with this drawing,
 * filled by a rule written there and not here.
 *
 * Each glyph is here to break one thing:
 *
 * - `H`: a crossbar laid over both stems and out past them, three overlapping
 *   contours the compiler has to join.
 * - `x`: two strokes crossing on the diagonal.
 * - `o`: a counter drawn the same way round as the bowl, which the compiler has
 *   to turn round or the letter fills in.
 * - `l`: a stem eight units wide, a hairline at any small size.
 * - `oacute`: a composite, the `o` and an accent placed by offset.
 *
 * `RENDER_OUT` says where to write the two fonts and the drawing. Without it the
 * test asserts what it can from inside and writes nothing.
 */

const OUT = process.env["RENDER_OUT"] ?? "";

const ids = counterIds("render");

/** A four-cornered contour, in the order given. */
function quad(...corners: readonly (readonly [number, number])[]): Contour {
  return contour(
    ids.contour(),
    corners.map(([x, y]) => node(ids.node(), { x, y })),
    true,
  );
}

/** A box, anticlockwise. */
const box = (minX: number, minY: number, maxX: number, maxY: number): Contour =>
  quad([minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]);

/** An ellipse from four smooth points, anticlockwise. */
function ring(cx: number, cy: number, rx: number, ry: number): Contour {
  const k = 0.5523;
  return contour(
    ids.contour(),
    [
      node(
        ids.node(),
        { x: cx, y: cy - ry },
        { type: "smooth", in: { x: cx - rx * k, y: cy - ry }, out: { x: cx + rx * k, y: cy - ry } },
      ),
      node(
        ids.node(),
        { x: cx + rx, y: cy },
        { type: "smooth", in: { x: cx + rx, y: cy - ry * k }, out: { x: cx + rx, y: cy + ry * k } },
      ),
      node(
        ids.node(),
        { x: cx, y: cy + ry },
        { type: "smooth", in: { x: cx + rx * k, y: cy + ry }, out: { x: cx - rx * k, y: cy + ry } },
      ),
      node(
        ids.node(),
        { x: cx - rx, y: cy },
        { type: "smooth", in: { x: cx - rx, y: cy + ry * k }, out: { x: cx - rx, y: cy - ry * k } },
      ),
    ],
    true,
  );
}

function renderProof(): FontDocument {
  return fontDocument(
    [
      glyph(".notdef", { advance: 500, contours: [box(50, 0, 450, 700)] }),
      glyph("space", { unicodes: [0x20], advance: 250 }),
      glyph("H", {
        unicodes: [0x48],
        advance: 600,
        contours: [box(80, 0, 180, 700), box(420, 0, 520, 700), box(40, 300, 560, 400)],
      }),
      glyph("x", {
        unicodes: [0x78],
        advance: 520,
        contours: [
          quad([40, 0], [120, 0], [480, 500], [400, 500]),
          quad([400, 0], [480, 0], [120, 500], [40, 500]),
        ],
      }),
      // Both contours anticlockwise: the counter runs the same way as the bowl.
      glyph("o", {
        unicodes: [0x6f],
        advance: 560,
        contours: [ring(280, 250, 240, 260), ring(280, 250, 140, 170)],
      }),
      glyph("l", { unicodes: [0x6c], advance: 208, contours: [box(100, 0, 108, 700)] }),
      glyph("acutecomb", {
        unicodes: [0x301],
        advance: 0,
        contours: [quad([0, 0], [60, 0], [200, 160], [120, 160])],
      }),
      glyph("oacute", {
        unicodes: [0xf3],
        advance: 560,
        components: [
          component(ids.component(), "o"),
          component(ids.component(), "acutecomb", {
            ...IDENTITY_AFFINE,
            xOffset: 220,
            yOffset: 560,
          }),
        ],
      }),
    ],
    { ...DEFAULT_FONT_INFO, familyName: "Render", unitsPerEm: 1000 },
  );
}

/**
 * The drawing, as the check reads it: every glyph's contours exactly as drawn,
 * components placed, directions as they were drawn. What the compiler did to
 * them is what is being checked, so none of it is done here.
 */
function drawing(document: FontDocument) {
  return {
    unitsPerEm: document.info.unitsPerEm,
    glyphs: document.glyphOrder.map((name) => {
      const g = document.glyphs[name]!;
      return {
        name,
        codePoint: g.unicodes[0] ?? null,
        advance: g.advance,
        contours: drawableGlyph(document, g).contours.map((c) => ({
          closed: c.closed,
          nodes: c.nodes.map((n) => ({ x: n.pt.x, y: n.pt.y, in: n.in, out: n.out })),
        })),
      };
    }),
  };
}

describe("the render proof font", () => {
  it("compiles in both flavours", () => {
    expect(exportFont(renderProof()).bytes.byteLength).toBeGreaterThan(0);
    expect(exportTrueType(renderProof()).bytes.byteLength).toBeGreaterThan(0);
  });

  it("describes every glyph with its components drawn in", () => {
    const glyphs = drawing(renderProof()).glyphs;
    expect(glyphs.find((g) => g.name === "oacute")?.contours).toHaveLength(3);
    expect(glyphs.find((g) => g.name === "space")?.contours).toEqual([]);
  });

  it("writes itself out when asked to", () => {
    if (OUT === "") return;

    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });

    const document = renderProof();
    writeFileSync(join(OUT, "Render.otf"), new Uint8Array(exportFont(document).bytes));
    writeFileSync(join(OUT, "Render.ttf"), new Uint8Array(exportTrueType(document).bytes));
    writeFileSync(join(OUT, "drawing.json"), JSON.stringify(drawing(document), null, 2));
  });
});
