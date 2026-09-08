import {
  DEFAULT_FONT_INFO,
  WEIGHT,
  addContour,
  contour,
  fontDocument,
  glyph,
  node,
  orderedGlyphs,
  segmentCubic,
  segments,
} from "@fonteditor/font-model";
import { vec } from "@fonteditor/geometry";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { exportVariableFont } from "../src/variable.js";

/**
 * A variable font.
 *
 * What can be asserted here is shape: that the file has the tables a variable
 * font has and not the one it must not, and that it is bigger than the masters
 * it was made from rather than a default master with a header bolted on. That
 * the *deltas* are right is not something this repository can ask itself — the
 * arithmetic that would check them is the arithmetic that wrote them — so it is
 * asked of fontTools on every push. See `tools/otf-check`.
 */

let ids = 0;
const id = () => `v${String(++ids)}`;

/** A stem of a given width, in a glyph that varies only by that width. */
const drawn = (width: number) =>
  addContour(
    glyph("n", { advance: 500 + width, unicodes: [0x6e] }),
    contour(
      id(),
      [
        node(id(), vec(0, 0)),
        node(id(), vec(width, 0)),
        node(id(), vec(width, 700), { in: vec(width, 600) }),
        node(id(), vec(0, 700)),
      ],
      true,
    ),
  );

const master = (width: number) =>
  fontDocument([glyph(".notdef", { advance: 500 }), drawn(width)], {
    ...DEFAULT_FONT_INFO,
    familyName: "Vary",
  });

const family = () => [
  { name: "Regular", location: { wght: 400 }, document: master(60) },
  { name: "Black", location: { wght: 900 }, document: master(200) },
];

/** The tags a finished font holds. */
function tagsOf(bytes: ArrayBuffer): string[] {
  const font = new Uint8Array(bytes);
  const view = new DataView(bytes);
  const count = view.getUint16(4);

  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    out.push(String.fromCharCode(font[at]!, font[at + 1]!, font[at + 2]!, font[at + 3]!));
  }
  return out;
}

describe("a variable font", () => {
  it("has the tables that make it one", () => {
    const tags = tagsOf(exportVariableFont([WEIGHT], family()).bytes);

    expect(tags).toContain("CFF2");
    expect(tags).toContain("fvar");
    // A font may not have both, and every reader prefers the one being
    // replaced.
    expect(tags).not.toContain("CFF ");
  });

  it("refuses to make one out of nothing to vary", () => {
    expect(() => exportVariableFont([], family())).toThrow(/at least one axis/);
    expect(() => exportVariableFont([WEIGHT], [])).toThrow(/at least one master/);
  });

  it("says which glyphs could not be made to vary", () => {
    const odd = master(200);
    const broken = {
      ...odd,
      glyphs: { ...odd.glyphs, n: glyph("n", { advance: 700, unicodes: [0x6e] }) },
    };

    const out = exportVariableFont(
      [WEIGHT],
      [family()[0]!, { name: "Black", location: { wght: 900 }, document: broken }],
    );

    expect(out.notVarying).toContain("n");
    expect(out.warnings.join(" ")).toMatch(/do not vary/);
  });

  it("writes itself out when asked to, with the masters it was made from", () => {
    const out = process.env["VARIABLE_OUT"] ?? "";
    if (out === "") return;

    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });

    const made = family();
    writeFileSync(join(out, "Vary.otf"), new Uint8Array(exportVariableFont([WEIGHT], made).bytes));

    // The masters as they were drawn, for fontTools to compare the font
    // against. Every point in order, which is the only thing that can tell a
    // right delta from a wrong one — the shape is the same either way.
    writeFileSync(
      join(out, "masters.json"),
      JSON.stringify(
        {
          masters: made.map((m) => ({
            name: m.name,
            location: m.location,
            glyphs: Object.fromEntries(
              orderedGlyphs(m.document)
                .filter((g) => g.contours.length > 0)
                .map((g) => [g.name, drawnPoints(g)]),
            ),
            advances: Object.fromEntries(orderedGlyphs(m.document).map((g) => [g.name, g.advance])),
          })),
        },
        null,
        2,
      ),
      "utf8",
    );
  });
});

/**
 * Every point a glyph draws, in the order a pen would put them down.
 *
 * The same order fontTools records, so the two lists can be compared straight
 * across: the first point of each contour, then for each segment its controls
 * and its end.
 */
function drawnPoints(g: ReturnType<typeof glyph>): [number, number][] {
  const out: [number, number][] = [];

  for (const c of g.contours) {
    const start = c.nodes[0]?.pt;
    if (start === undefined || c.nodes.length < 2) continue;
    out.push([start.x, start.y]);

    for (const s of segments(c)) {
      const cubic = segmentCubic(s);
      if (s.kind === "line") out.push([cubic.b.x, cubic.b.y]);
      else out.push([cubic.c1.x, cubic.c1.y], [cubic.c2.x, cubic.c2.y], [cubic.b.x, cubic.b.y]);
    }
  }

  return out;
}
