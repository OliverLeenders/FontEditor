import { readFileSync } from "node:fs";

import {
  type Contour,
  correctDirections,
  counterIds,
  isEmptyContour,
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
  "../../../apps/editor/browser/fixtures/MaterialSymbolsOutlined_28pt-Regular.ttf",
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

  it("are read without a word where they could be redrawn", () => {
    expect(read.warnings).toEqual([]);
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
    const back = importFont(out.bytes, counterIds("back")).document.glyphs[name]!;
    // On the whole-unit grid a font file is written to, and with the hairlines
    // a union closes.
    expect(sameInk(inFile(name), correctDirections(back.contours), 4)).toBe(true);
  });
});
