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
} from "@typewright/font-model";
import { vec } from "@typewright/geometry";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { exportVariableFont } from "../src/variable.js";
import { exportVariableTrueType } from "../src/variable-truetype.js";
import { exportTrueType } from "../src/truetype.js";

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

/** Where a table starts, or -1. */
function tableAt(bytes: ArrayBuffer, tag: string): number {
  const font = new Uint8Array(bytes);
  const view = new DataView(bytes);
  const count = view.getUint16(4);

  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const found = String.fromCharCode(font[at]!, font[at + 1]!, font[at + 2]!, font[at + 3]!);
    if (found === tag) return view.getUint32(at + 8);
  }
  return -1;
}

/**
 * The named instances an `fvar` offers, as their coordinates.
 *
 * The names themselves are ids into the `name` table and reading them back
 * would be a second decoder; how many there are and where they sit is what
 * says whether the styles or the masters were written.
 */
function fvarInstances(bytes: ArrayBuffer): number[][] {
  const start = tableAt(bytes, "fvar");
  if (start < 0) return [];

  const view = new DataView(bytes);
  const axesAt = start + view.getUint16(start + 4);
  const axisCount = view.getUint16(start + 8);
  const axisSize = view.getUint16(start + 10);
  const instanceCount = view.getUint16(start + 12);
  const instanceSize = view.getUint16(start + 14);

  const out: number[][] = [];
  for (let i = 0; i < instanceCount; i++) {
    // Each instance is a name id, flags, and one 16.16 fixed per axis.
    const at = axesAt + axisCount * axisSize + i * instanceSize + 4;
    const coords: number[] = [];
    for (let a = 0; a < axisCount; a++) coords.push(view.getInt32(at + a * 4) / 65536);
    out.push(coords);
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

    // The same family in the other flavour, and each master compiled on its own
    // beside it: the quadratic outlines have no points in common with the cubic
    // drawing, so the only way to ask whether an instance is a master is to
    // compare it with that master as a static font of the same flavour.
    writeFileSync(
      join(out, "Vary.ttf"),
      new Uint8Array(exportVariableTrueType([WEIGHT], made).bytes),
    );
    for (const m of made) {
      writeFileSync(join(out, `${m.name}.ttf`), new Uint8Array(exportTrueType(m.document).bytes));
    }

    // And a harder family: three masters on the axis, which is what turns the
    // regions from plain peaks into intermediate ones — a tuple that has to
    // write its start and end out rather than let them be implied. Two masters
    // never produce one, so the proof font alone would not exercise it.
    const three = [
      { name: "Light", location: { wght: 100 }, document: master(20) },
      { name: "Regular", location: { wght: 400 }, document: master(60) },
      { name: "Black", location: { wght: 900 }, document: master(200) },
    ];
    // The default master goes first: everything in the file is a delta from it.
    const ordered = [three[1]!, three[0]!, three[2]!];
    writeFileSync(
      join(out, "Three.ttf"),
      new Uint8Array(exportVariableTrueType([WEIGHT], ordered).bytes),
    );
    for (const m of three) {
      writeFileSync(
        join(out, `three-${m.name}.ttf`),
        new Uint8Array(exportTrueType(m.document).bytes),
      );
    }
    writeFileSync(
      join(out, "three.json"),
      JSON.stringify(
        {
          masters: three.map((m) => ({
            name: `three-${m.name}`,
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

/**
 * The style menu a variable font offers.
 *
 * Its named instances, which are the family's *instances* — Light, Semibold —
 * and not its masters. The two are different in kind: a master is a drawing
 * somebody made, and a two-axis family's masters are its four corners, which is
 * not a menu anybody wants to pick a style from.
 */
describe("the styles a variable font offers", () => {
  it("offers the styles it was given", () => {
    const out = exportVariableFont([WEIGHT], family(), [
      { name: "Light", location: { wght: 300 } },
      { name: "Regular", location: { wght: 400 } },
      { name: "Semibold", location: { wght: 600 } },
    ]);

    expect(fvarInstances(out.bytes)).toEqual([[300], [400], [600]]);
  });

  it("falls back to the masters where a family has named no styles", () => {
    // A menu of the corners still beats no menu, and it is what this wrote
    // before instances existed.
    expect(fvarInstances(exportVariableFont([WEIGHT], family()).bytes)).toEqual([[400], [900]]);
  });
});

/**
 * The TrueType flavour of the same variable font.
 *
 * `glyf` and `gvar` rather than CFF2 — the flavour a WOFF2 can transform, and
 * so the one the web is actually served. What can be asserted here is shape:
 * that the tables are the ones a variable TrueType font has and not the one it
 * must not. Whether the *deltas* are right is asked of fontTools, which pins the
 * font at each master and compares the outline with that master compiled alone.
 * See `tools/otf-check/check_vf_ttf.py`.
 */
describe("a variable font with quadratic outlines", () => {
  it("has the tables that make it one", () => {
    const tags = tagsOf(exportVariableTrueType([WEIGHT], family()).bytes);

    expect(tags).toContain("glyf");
    expect(tags).toContain("loca");
    expect(tags).toContain("gvar");
    expect(tags).toContain("fvar");
    expect(tags).toContain("HVAR");
    // A font may not have both kinds of outline.
    expect(tags).not.toContain("CFF2");
    expect(tags).not.toContain("CFF ");
  });

  it("says it is a TrueType font in its first four bytes", () => {
    const bytes = exportVariableTrueType([WEIGHT], family()).bytes;
    expect(new DataView(bytes).getUint32(0)).toBe(0x00010000);
  });

  it("refuses to make one out of nothing to vary", () => {
    expect(() => exportVariableTrueType([], family())).toThrow(/at least one axis/);
    expect(() => exportVariableTrueType([WEIGHT], [])).toThrow(/at least one master/);
  });

  it("offers the styles it was given", () => {
    const out = exportVariableTrueType([WEIGHT], family(), [
      { name: "Light", location: { wght: 300 } },
      { name: "Semibold", location: { wght: 600 } },
    ]);

    expect(fvarInstances(out.bytes)).toEqual([[300], [600]]);
  });

  it("is bigger than the master it was made from", () => {
    // The deltas are the difference. A font the size of one master is a font
    // whose gvar is empty, which is the failure that looks like success.
    const one = exportTrueType(master(60)).bytes.byteLength;
    const varying = exportVariableTrueType([WEIGHT], family()).bytes.byteLength;

    expect(varying).toBeGreaterThan(one);
  });

  it("names the glyphs whose masters do not correspond", () => {
    const odd = fontDocument([glyph(".notdef", { advance: 500 }), drawn(60)], {
      ...DEFAULT_FONT_INFO,
      familyName: "Vary",
    });
    const mismatched = [
      { name: "Regular", location: { wght: 400 }, document: master(60) },
      { name: "Black", location: { wght: 900 }, document: odd },
    ];

    // The same glyph drawn with a different number of nodes cannot be varied.
    expect(exportVariableTrueType([WEIGHT], mismatched).bytes.byteLength).toBeGreaterThan(0);
  });
});
