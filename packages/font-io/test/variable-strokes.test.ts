import {
  type FontDocument,
  type Glyph,
  DEFAULT_FONT_INFO,
  WEIGHT,
  component,
  contour,
  contourBounds,
  counterIds,
  fontDocument,
  glyph,
  node,
  withNib,
} from "@typewright/font-model";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { exportFont, writtenOrder } from "../src/export.js";
import { opentype } from "../src/opentype.js";
import { drawnWithPen, exportVariableFont, flattened, flattenedMasters } from "../src/variable.js";
import { sameShape } from "../src/cff2.js";
import { exportVariableTrueType } from "../src/variable-truetype.js";

/**
 * A stroke in a variable font.
 *
 * A stroke is a path and a pen, and what goes in a font is the ink. The static
 * export has always written it; the variable one wrote the path itself, closed
 * up and filled. It is the ink now, and drawn to the same points in every
 * master so that it varies as any other glyph does: a line round the ink that
 * crosses itself where the ink folds, which a variable font may hold. Where
 * the masters' pens are too unlike for one plan, it is the default master's
 * ink at every weight, and said to be.
 */

const ids = counterIds("vs");
const at = (x: number, y: number) => ({ x, y });

/** An S drawn with a pen of a given width, and a letter that is the S again. */
const master = (pen: number, thickness = pen / 4): FontDocument => {
  const skeleton = withNib(
    contour(
      ids.contour(),
      [
        node(ids.node(), at(100, 100), { out: at(300, 100) }),
        node(ids.node(), at(300, 350), {
          type: "smooth",
          in: at(400, 250),
          out: at(200, 450),
        }),
        node(ids.node(), at(500, 600), { in: at(300, 600) }),
      ],
      false,
    ),
    { angle: 30, width: pen, thickness },
  );
  // A stem whose foot is cut level and closed with the pen's shape, and whose
  // head is cut on a slant: ends that are cut, drawn to the same points too.
  const stem = withNib(
    contour(
      ids.contour(),
      [
        node(ids.node(), at(260, 650), { out: at(260, 450), end: { cut: 12 } }),
        node(ids.node(), at(300, 0), { in: at(300, 220), end: { cut: 0, shape: "nib" } }),
      ],
      false,
    ),
    { angle: 30, width: pen, thickness },
  );
  // A hook drawn with a pen that has corners, the squarer the heavier: an oval
  // in the lightest and a rectangle in the heaviest, its foot closed with the
  // pen's shape. A broad edge has no corners, so none where there is no thickness.
  const squareness = Math.min(1, Math.max(0, (pen - 60) / 80));
  const boxed = withNib(
    contour(
      ids.contour(),
      [
        node(ids.node(), at(420, 620), { out: at(250, 620) }),
        node(ids.node(), at(240, 420), { type: "smooth", in: at(240, 540), out: at(240, 300) }),
        node(ids.node(), at(300, 0), { in: at(300, 160), end: { cut: 0, shape: "nib" } }),
      ],
      false,
    ),
    thickness > 0 && squareness > 0
      ? { angle: 30, width: pen, thickness, squareness }
      : { angle: 30, width: pen, thickness },
  );
  // A zigzag drawn with a rectangle in every master, turned differently in
  // each, its last end cut level: the pen whose ink is exact, and is straight
  // edges and the path itself moved over.
  const slab = withNib(
    contour(
      ids.contour(),
      [
        node(ids.node(), at(120, 600)),
        node(ids.node(), at(480, 600)),
        node(ids.node(), at(140, 60), { out: at(260, 0) }),
        node(ids.node(), at(500, 60), { in: at(380, 0), end: { cut: 90 } }),
      ],
      false,
    ),
    thickness > 0
      ? { angle: pen / 7, width: pen, thickness, squareness: 1 }
      : { angle: pen / 7, width: pen, thickness },
  );
  // A leaning stem with a serif at each end, heavier with the pen: a flag at
  // its head, to one side and sloped to a point, and at its foot a bracketed
  // serif with a hollow under it. Outlines of their own laid over the ends.
  const footed = withNib(
    contour(
      ids.contour(),
      [
        node(ids.node(), at(340, 640), {
          end: {
            cut: 0,
            serif: {
              left: pen * 0.8,
              right: 0,
              height: pen * 0.5,
              bracket: 0.3,
              slope: 1,
              cup: 0,
              round: 0,
            },
          },
        }),
        node(ids.node(), at(300, 0), {
          end: {
            cut: 0,
            serif: {
              left: pen * 0.6,
              right: pen * 0.7,
              height: pen * 0.3,
              bracket: 0.6,
              slope: 0.2,
              cup: pen * 0.05,
              round: 0.5,
            },
          },
        }),
      ],
      false,
    ),
    { angle: 30, width: pen, thickness },
  );
  // A stem that comes down a diagonal and turns upright eight units above the
  // line its foot is cut on: a last segment shorter than the pen is wide, whose
  // sides never cross the line, so that it is the diagonal's sides that are cut.
  const hooked = withNib(
    contour(
      ids.contour(),
      [
        node(ids.node(), at(140, 620)),
        node(ids.node(), at(340, 8)),
        node(ids.node(), at(340, 0), { end: { cut: 0 } }),
      ],
      false,
    ),
    { angle: 30, width: pen, thickness },
  );
  // A stroke round a bend and a corner with a rectangle that is another size
  // at each point, held at one angle: its corners draw the edge still, each
  // going its own way, and its foot is cut level.
  const box = (width: number, deep: number) =>
    thickness > 0
      ? { angle: 15, width, thickness: deep, squareness: 1 }
      : { angle: 15, width, thickness: 0 };
  const tapered = withNib(
    contour(
      ids.contour(),
      [
        node(ids.node(), at(140, 600), { out: at(300, 640), pen: box(pen, thickness * 2) }),
        node(ids.node(), at(440, 460), { in: at(440, 580), pen: box(pen * 0.5, thickness) }),
        node(ids.node(), at(180, 300), { pen: box(pen * 1.2, thickness * 1.5) }),
        node(ids.node(), at(320, 0), { pen: box(pen * 0.7, thickness * 3), end: { cut: 0 } }),
      ],
      false,
    ),
    box(pen, thickness * 2),
  );
  // And an S with a broad edge that widens and narrows along it, held at one
  // angle: its two ends, each going its own way.
  const edge = (width: number) => ({ angle: 30, width, thickness: 0 });
  const swelling = withNib(
    contour(
      ids.contour(),
      [
        node(ids.node(), at(100, 100), { out: at(300, 100), pen: edge(pen * 0.4) }),
        node(ids.node(), at(300, 350), {
          type: "smooth",
          in: at(400, 250),
          out: at(200, 450),
          pen: edge(pen * 1.3),
        }),
        node(ids.node(), at(500, 600), { in: at(300, 600), pen: edge(pen * 0.6) }),
      ],
      false,
    ),
    edge(pen),
  );
  // The same S with a broad edge that turns as it goes, and widens: between
  // its two ends the edge of its ink is the place the nib pivots on.
  const turning = (angle: number, width: number) => ({ angle, width, thickness: 0 });
  const twisting = withNib(
    contour(
      ids.contour(),
      [
        node(ids.node(), at(100, 100), { out: at(300, 100), pen: turning(15, pen * 0.8) }),
        node(ids.node(), at(300, 350), {
          type: "smooth",
          in: at(400, 250),
          out: at(200, 450),
          pen: turning(40, pen * 1.2),
        }),
        node(ids.node(), at(500, 600), { in: at(300, 600), pen: turning(65, pen * 0.7) }),
      ],
      false,
    ),
    turning(15, pen),
  );
  // And the S with a rectangle that turns and changes size.
  const turnedBox = (angle: number, width: number, deep: number) =>
    thickness > 0
      ? { angle, width, thickness: deep, squareness: 1 }
      : { angle, width, thickness: 0 };
  const wrung = withNib(
    contour(
      ids.contour(),
      [
        node(ids.node(), at(100, 100), {
          out: at(300, 100),
          pen: turnedBox(15, pen * 0.8, thickness * 2),
        }),
        node(ids.node(), at(300, 350), {
          type: "smooth",
          in: at(400, 250),
          out: at(200, 450),
          pen: turnedBox(40, pen * 1.2, thickness * 1.5),
        }),
        node(ids.node(), at(500, 600), {
          in: at(300, 600),
          pen: turnedBox(65, pen * 0.7, thickness * 2.5),
        }),
      ],
      false,
    ),
    turnedBox(15, pen * 0.8, thickness * 2),
  );
  // An arch and a drop at the end of it, cut level and shorter than the pen
  // is thick: the arch is not cut by the foot's line, and the drop's side is
  // past it all its length. Drawn as the two things it is, which overlap.
  const dropped = withNib(
    contour(
      ids.contour(),
      [
        node(ids.node(), at(100, 300), { out: at(140, 400) }),
        node(ids.node(), at(300, 420), { in: at(220, 430) }),
        node(ids.node(), at(330, 395), { end: { cut: 0 } }),
      ],
      false,
    ),
    { angle: 30, width: pen, thickness },
  );
  return fontDocument(
    [
      glyph(".notdef", { advance: 500 }),
      glyph("r", { advance: 600, unicodes: [0x72], contours: [dropped] }),
      glyph("x", { advance: 600, unicodes: [0x78], contours: [twisting] }),
      glyph("y", { advance: 600, unicodes: [0x79], contours: [wrung] }),
      glyph("v", { advance: 600, unicodes: [0x76], contours: [tapered] }),
      glyph("w", { advance: 600, unicodes: [0x77], contours: [swelling] }),
      glyph("l", { advance: 600, unicodes: [0x6c], contours: [stem] }),
      glyph("t", { advance: 600, unicodes: [0x74], contours: [boxed] }),
      glyph("z", { advance: 600, unicodes: [0x7a], contours: [slab] }),
      glyph("f", { advance: 600, unicodes: [0x66], contours: [footed] }),
      glyph("j", { advance: 600, unicodes: [0x6a], contours: [hooked] }),
      glyph("s", { advance: 600, unicodes: [0x73], contours: [skeleton] }),
      glyph("dollar", {
        advance: 600,
        unicodes: [0x24],
        components: [component(ids.component(), "s")],
      }),
      glyph("n", {
        advance: 500,
        unicodes: [0x6e],
        contours: [
          contour(
            ids.contour(),
            [
              node(ids.node(), at(0, 0)),
              node(ids.node(), at(pen, 0)),
              node(ids.node(), at(pen, 700)),
              node(ids.node(), at(0, 700)),
            ],
            true,
          ),
        ],
      }),
    ],
    { ...DEFAULT_FONT_INFO, familyName: "Penned" },
  );
};

const axes = [WEIGHT];
const family = () => [
  { name: "Regular", location: { wght: 400 }, document: master(60) },
  { name: "Black", location: { wght: 900 }, document: master(140) },
];

describe("a stroke in a variable font", () => {
  it("is prepared as its ink, not as the path it was drawn along", () => {
    const document = master(60);
    const prepared = flattened(document, writtenOrder(document));
    const s = prepared.find((g) => g.name === "s")!;

    expect(s.contours.length).toBeGreaterThan(0);
    for (const c of s.contours) {
      expect(c.closed).toBe(true);
      expect(c.nib).toBeUndefined();
    }
    // The path runs from 100 to 500; the ink is a pen's reach wider.
    const xs = s.contours.map((c) => contourBounds(c)!);
    expect(Math.min(...xs.map((b) => b.minX))).toBeLessThan(90);
    expect(Math.max(...xs.map((b) => b.maxX))).toBeGreaterThan(510);
  });

  it("is ink in a glyph that only names it, too", () => {
    const document = master(60);
    const dollar = flattened(document, writtenOrder(document)).find((g) => g.name === "dollar")!;

    expect(dollar.contours.length).toBeGreaterThan(0);
    expect(dollar.contours.every((c) => c.closed && c.nib === undefined)).toBe(true);
    expect(drawnWithPen(document, "dollar")).toBe(true);
    expect(drawnWithPen(document, "n")).toBe(false);
  });

  it("is drawn to the same points in every master, and varies", () => {
    const masters = family();
    const order = writtenOrder(masters[0]!.document);
    const drawn = flattenedMasters(masters, order);
    const regular = drawn[0]![order.indexOf("s")]!;
    const black = drawn[1]![order.indexOf("s")]!;

    expect(sameShape(regular, black)).toBe(true);
    // One line round the ink of an open path, and the bold's reaching further.
    expect(regular.contours).toHaveLength(1);
    const reach = (g: Glyph): number => contourBounds(g.contours[0]!)!.maxX;
    expect(reach(black)).toBeGreaterThan(reach(regular) + 20);

    const { warnings, notVarying } = exportVariableFont(axes, masters);
    expect(notVarying).toEqual([]);
    expect(warnings.some((w) => w.includes("do not vary"))).toBe(false);
  });

  it("varies in a glyph that only names it, and in the font with quadratic outlines", () => {
    const { bytes, warnings, notVarying } = exportVariableTrueType(axes, family());
    const box = opentype.parse(bytes).charToGlyph("s").path.getBoundingBox();

    expect(box.x1).toBeLessThan(90);
    expect(box.x2).toBeGreaterThan(510);
    expect(notVarying).toEqual([]);
    expect(warnings.some((w) => w.includes("do not vary"))).toBe(false);
  });

  it("writes itself out when asked to, with each weight as a font of its own", () => {
    // For `tools/otf-check/check_vf_strokes.py`: whether the font pinned to a
    // weight fills as the stroke drawn at that weight does is a question about
    // the deltas, and fontTools is who can be asked.
    const out = process.env["STROKES_OUT"] ?? "";
    if (out === "") return;
    mkdirSync(out, { recursive: true });
    const write = (name: string, bytes: ArrayBuffer): void =>
      writeFileSync(join(out, name), new Uint8Array(bytes));

    write("Penned.otf", exportVariableFont(axes, family()).bytes);
    write("Penned.ttf", exportVariableTrueType(axes, family()).bytes);
    // The pen half way between the two is the stroke half way along the axis,
    // the path being the same in both.
    for (const [weight, pen] of [
      [400, 60],
      [650, 100],
      [900, 140],
    ] as const) {
      write(`static-${String(weight)}.otf`, exportFont(master(pen)).bytes);
    }
  });

  it("is the default master's ink, and said not to vary, where the pens are too unlike", () => {
    // An oval in one master and a broad edge in the other: no one plan.
    const unlike = [
      { name: "Regular", location: { wght: 400 }, document: master(60) },
      { name: "Black", location: { wght: 900 }, document: master(140, 0) },
    ];
    const { warnings, notVarying } = exportVariableFont(axes, unlike);

    expect(notVarying).toEqual(expect.arrayContaining(["s", "dollar"]));
    expect(notVarying).not.toContain("n");
    expect(warnings).toContainEqual(
      // Which ones is `notVarying`, above: the warning names the first few.
      expect.stringMatching(/drawn with a pen do not vary/),
    );
    expect(warnings.some((w) => w.includes("masters disagree"))).toBe(false);
  });
});
