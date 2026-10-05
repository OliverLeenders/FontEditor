import { readFileSync } from "node:fs";

import {
  type Contour,
  type FontDocument,
  correctDirections,
  counterIds,
  fillAsWound,
  glyph,
  isEmptyContour,
  removeOverlap,
  sameInk,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { contoursFromCommands } from "../src/commands.js";
import { exportFont } from "../src/export.js";
import { documentFrom, importFont } from "../src/import.js";
import { type SourceFont, parseFont } from "../src/source.js";

/**
 * Icons built of pieces that overlap, in from a font file and out again.
 *
 * A file fills its outlines by which way they wind, and this editor by how
 * they nest. A couple of dozen of Material Symbols' four thousand icons are
 * drawn as pieces laid over each other — a clock as a ring and its halves, a
 * plant as a pot against a stand — and were shown here, and written out, as a
 * different picture: holes where the pieces met, or most of the icon gone.
 *
 * Asked of the ink, on the icons themselves. The font is the one the browser
 * tests bring in; its licence is beside it.
 */

const FONT = new URL(
  "../../../fixtures/fonts/material-symbols/MaterialSymbolsOutlined_28pt-Regular.ttf",
  import.meta.url,
);

// Ones that were wrong, and two that never were.
const ICONS = [
  "avg_time",
  "potted_plant",
  "account_circle_off",
  "table_edit",
  "face_5",
  "door_open",
  "video_stable",
  "hdr_plus",
  "agriculture",
  "mobile_off",
  "robot",
  "delete",
];

function some(names: readonly string[]): SourceFont {
  const bytes = readFileSync(FONT);
  const whole = parseFont(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  return {
    ...whole,
    glyphs: whole.glyphs.filter((g) => g.name === ".notdef" || names.includes(g.name ?? "")),
  };
}

const source = some(ICONS);

/** A glyph as the file draws it: what the non-zero rule fills. */
function inFile(name: string): Contour[] {
  const g = source.glyphs.find((it) => it.name === name)!;
  return contoursFromCommands(g.commands, counterIds("file"), 0.001).filter(
    (c) => !isEmptyContour(c),
  );
}

describe("icons drawn as pieces that overlap", () => {
  const read = documentFrom(source, counterIds("in"));

  it.each(ICONS)("%s is the ink here that it is in the file", (name) => {
    const mine = read.document.glyphs[name]!;
    // As this editor fills it: turned by its nesting.
    expect(sameInk(inFile(name), correctDirections(mine.contours), 2)).toBe(true);
  });

  it.each(ICONS)("%s joined is the ink it was, or is said not to be joined", (name) => {
    // The union itself, of the file's own contours as they wind. It came back
    // with some of these in pieces and said nothing; what it makes is asked
    // now whether it is the ink it was made of.
    const drawn = inFile(name);
    const union = removeOverlap(glyph(name, { contours: drawn }), counterIds("join"));
    expect(union).not.toBeNull();
    expect(sameInk(drawn, union!.glyph.contours, 2)).toBe(true);
  });

  it("are read without a word where they could be redrawn", () => {
    expect(read.warnings).toEqual([]);
  });

  it("are put right in a font that was read before they were, without reading it again", () => {
    // What a font read in before this held: each glyph as the file draws it,
    // contour for contour, filled here by its nesting.
    const order = [".notdef", ...ICONS];
    const old: FontDocument = {
      ...read.document,
      glyphOrder: order,
      glyphs: Object.fromEntries(
        order.map((name) => [
          name,
          name === ".notdef"
            ? read.document.glyphs[name]!
            : { ...read.document.glyphs[name]!, contours: inFile(name) },
        ]),
      ),
    };
    const plan = fillAsWound(old, counterIds("fill"));

    // The ones that were wrong, and not the two that never were.
    expect(plan.left).toEqual([]);
    expect(plan.redrawn).not.toContain("robot");
    expect(plan.redrawn).not.toContain("delete");
    expect(plan.redrawn.length).toBeGreaterThan(5);
    for (const name of ICONS) {
      const mine = plan.document.glyphs[name]!;
      expect(sameInk(inFile(name), correctDirections(mine.contours), 2), name).toBe(true);
    }
  });

  it("leaves alone the ones that were never wrong", () => {
    const points = (contours: readonly Contour[]): number[] => contours.map((c) => c.nodes.length);
    for (const name of ["robot", "delete"]) {
      const kept = read.document.glyphs[name]!.contours.filter((c) => !isEmptyContour(c));
      expect(points(kept), name).toEqual(points(inFile(name)));
    }
  });

  it.each(ICONS)("%s is written out as the ink it is in the file", (name) => {
    const out = exportFont({ ...read.document, features: "" }, counterIds("out"));
    expect(out.warnings).toEqual([]);
    const back = importFont(out.bytes, counterIds("back")).document.glyphs[name]!;
    // On the whole-unit grid a font file is written to, and with the hairlines
    // a union closes.
    expect(sameInk(inFile(name), correctDirections(back.contours), 4)).toBe(true);
  });
});
