import {
  type Axis,
  DEFAULT_FONT_INFO,
  type Rule,
  addContour,
  axis,
  contour,
  fontDocument,
  glyph,
  node,
  segmentCubic,
  segments,
} from "@typewright/font-model";
import { vec } from "@typewright/geometry";
import { Blob, Buffer, Face, Font, Variation, shape } from "harfbuzzjs";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { familyFiles } from "../src/family.js";
import { exportVariableFont } from "../src/variable.js";
import { exportVariableTrueType } from "../src/variable-truetype.js";
import { entryBytes } from "../src/zip.js";

/**
 * A family that uses what a designspace can say, compiled and checked by things
 * that did not write it.
 *
 * Two axes with a master at every corner, which is where a delta taken as a
 * plain difference from the default counts the corner's edges twice. A weight
 * map that bends, so the font needs `avar`. A master at the middle weight that
 * draws only the `n`, so the `n` varies over three regions and everything else
 * over two. And two rules whose regions overlap, so the font needs a record for
 * the overlap as well as for each.
 *
 * HarfBuzz sets text with both flavours here. On CI fontTools reads the
 * designspace, pins both fonts at places between the masters, works out what
 * the outlines should be from the masters' points with its own interpolation
 * model, and compares — see `tools/otf-check/check_designspace_vf.py`.
 */

let ids = 0;
const id = () => `pd${String(++ids)}`;

/** A box with a slanted top: two numbers that move independently. */
const box = (name: string, width: number, height: number, advance: number, unicode?: number) =>
  addContour(
    glyph(name, { advance, unicodes: unicode === undefined ? [] : [unicode] }),
    contour(
      id(),
      [
        node(id(), vec(40, 0)),
        node(id(), vec(40 + width, 0)),
        node(id(), vec(40 + width, height), { in: vec(40 + width, height - 100) }),
        node(id(), vec(40, height - 40)),
      ],
      true,
    ),
  );

/** One master: every glyph drawn at its own proportions. */
const drawing = (n: number, height: number, dollar: number, advance: number) =>
  fontDocument(
    [
      glyph(".notdef", { advance: 500 }),
      box("n", n, height, advance, 0x6e),
      box("n.narrow", n * 0.8, height, advance - 40),
      box("dollar", dollar, height + 40, advance, 0x24),
      box("dollar.heavy", dollar + 30, height + 40, advance),
    ],
    { ...DEFAULT_FONT_INFO, familyName: "Proof" },
  );

/** Stems of 20, 80 and 220 units, offered as 100, 400 and 900 — and 700 drawn at 160. */
const WEIGHT_AXIS: Axis = {
  ...axis("wght", "Weight", 20, 80, 220),
  map: [
    [100, 20],
    [400, 80],
    [700, 160],
    [900, 220],
  ],
};
const WIDTH_AXIS = axis("wdth", "Width", 75, 100, 100);
const AXES = [WEIGHT_AXIS, WIDTH_AXIS];

const MASTERS = [
  { name: "Regular", location: { wght: 80, wdth: 100 }, document: drawing(60, 700, 50, 500) },
  { name: "Black", location: { wght: 220, wdth: 100 }, document: drawing(200, 700, 120, 640) },
  { name: "Condensed", location: { wght: 80, wdth: 75 }, document: drawing(50, 690, 40, 420) },
  // Not the sum of the two edges, which is the case a plain difference gets wrong.
  {
    name: "Black Condensed",
    location: { wght: 220, wdth: 75 },
    document: drawing(150, 660, 90, 520),
  },
];

/** The middle weight, drawn for the `n` alone, as a layer of the Regular's UFO. */
const MID = {
  name: "Mid",
  location: { wght: 150, wdth: 100 },
  document: fontDocument([box("n", 170, 700, 600, 0x6e)], {
    ...DEFAULT_FONT_INFO,
    familyName: "Proof",
  }),
};

const RULES: Rule[] = [
  {
    id: "heavy",
    name: "heavy dollar",
    conditionSets: [[{ tag: "wght", min: 150, max: null }]],
    swaps: [["dollar", "dollar.heavy"]],
  },
  {
    id: "narrow",
    name: "narrow n",
    conditionSets: [[{ tag: "wdth", min: null, max: 90 }]],
    swaps: [["n", "n.narrow"]],
  },
];

const variableMasters = [...MASTERS, { ...MID, sparse: true }];
const otf = () => exportVariableFont(AXES, variableMasters, [], { rules: RULES });
const ttf = () => exportVariableTrueType(AXES, variableMasters, [], { rules: RULES });

/** The glyphs HarfBuzz sets for some text at a place on the user scale. */
function setAt(bytes: ArrayBuffer, text: string, at: Record<string, number>): string[] {
  const font = new Font(new Face(new Blob(bytes)));
  font.setVariations(Object.entries(at).map(([tag, value]) => new Variation(tag, value)));
  const buffer = new Buffer();
  buffer.addText(text);
  buffer.guessSegmentProperties();
  shape(font, buffer);
  return buffer.getGlyphInfosAndPositions().map((p) => font.glyphName(p.codepoint));
}

describe("the rules, as HarfBuzz sets them", () => {
  for (const [flavour, make] of [
    ["CFF2", otf],
    ["TrueType", ttf],
  ] as const) {
    it(`swaps where each rule applies, and both where they overlap (${flavour})`, () => {
      const { bytes, warnings, notVarying } = make();
      expect(notVarying).toEqual([]);
      expect(warnings.join(" ")).not.toMatch(/rule/);

      // Weight 700 is drawn at 160, past the heavy rule's 150; weight 500 is at
      // 100, short of it. Without avar the menu's 500 would be 125 of the way
      // and the rule would say the same, so it is the map being honoured.
      expect(setAt(bytes, "$n", { wght: 400, wdth: 100 })).toEqual(["dollar", "n"]);
      expect(setAt(bytes, "$n", { wght: 700, wdth: 100 })).toEqual(["dollar.heavy", "n"]);
      expect(setAt(bytes, "$n", { wght: 400, wdth: 80 })).toEqual(["dollar", "n.narrow"]);
      expect(setAt(bytes, "$n", { wght: 900, wdth: 75 })).toEqual(["dollar.heavy", "n.narrow"]);
      expect(setAt(bytes, "$n", { wght: 500, wdth: 100 })).toEqual(["dollar", "n"]);
    });
  }
});

describe("the proof designspace family", () => {
  it("writes itself out when asked to", () => {
    const out = process.env["DESIGNSPACE_OUT"] ?? "";
    if (out === "") return;

    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });

    const family = [...MASTERS, { ...MID, sparse: { of: 0, layer: "Mid" } }];
    for (const entry of familyFiles(AXES, family, [], { rules: RULES })) {
      const path = join(out, entry.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, entryBytes(entry));
    }

    writeFileSync(join(out, "Proof-VF.otf"), new Uint8Array(otf().bytes));
    writeFileSync(join(out, "Proof-VF.ttf"), new Uint8Array(ttf().bytes));

    writeFileSync(
      join(out, "masters.json"),
      JSON.stringify(
        {
          masters: variableMasters.map((m) => ({
            name: m.name,
            location: m.location,
            sparse: "sparse" in m,
            glyphs: Object.fromEntries(
              Object.values(m.document.glyphs)
                .filter((g) => g.contours.length > 0)
                .map((g) => [g.name, { points: pointsOf(g), advance: g.advance }]),
            ),
          })),
          // On the user scale, by axis name, as a person would ask for them.
          locations: [
            { Weight: 100, Width: 100 },
            { Weight: 400, Width: 100 },
            { Weight: 550, Width: 100 },
            { Weight: 650, Width: 100 },
            { Weight: 700, Width: 87.5 },
            { Weight: 800, Width: 90 },
            { Weight: 900, Width: 75 },
            { Weight: 300, Width: 80 },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
  });
});

/** Every point a glyph draws, in pen order: see `variable.test.ts`. */
function pointsOf(g: ReturnType<typeof glyph>): [number, number][] {
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
