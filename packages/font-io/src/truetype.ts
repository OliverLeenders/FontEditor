import type { FontDocument } from "@typewright/font-model";

import { Bytes } from "./bytes.js";
import { type ExportResult, exportFont, flattenedGlyphs } from "./export.js";
import { glyfTable } from "./glyf.js";
import { readTablesOf, withSfntVersion, withTable } from "./sfnt.js";

/**
 * The TrueType flavour: the same font, with quadratic outlines.
 *
 * Everything this editor writes is CFF, which is the PostScript flavour and
 * keeps the cubics as drawn. This is the other one, and it is what hinting
 * wants, what most web pipelines expect, and the only flavour that allows
 * overlapping contours in the outline itself.
 *
 * Built on the ordinary export, as the variable font is: the whole font is
 * compiled once and then the outline tables are swapped. What changes is more
 * than a table this time — a TrueType font says so in its first four bytes, and
 * `maxp` grows from the short form CFF uses to the long one that declares how
 * much of a rasteriser's memory the outlines will need.
 */

export function exportTrueType(document: FontDocument): ExportResult {
  const base = exportFont(document);
  let bytes: Uint8Array = new Uint8Array(base.bytes);

  const glyphs = flattenedGlyphs(document);
  const { glyf, loca, longLoca, maxPoints, maxContours } = glyfTable(glyphs);

  bytes = withTable(bytes, "glyf", glyf);
  bytes = withTable(bytes, "loca", loca);
  bytes = withTable(bytes, "maxp", maxp(glyphs.length, maxPoints, maxContours));
  bytes = withTable(bytes, "head", headWith(bytes, longLoca));
  // Last: a font may not have both, and the one being replaced is the one every
  // reader would otherwise prefer.
  bytes = withTable(bytes, "CFF ", new Uint8Array());
  // And the four bytes that say which flavour this is. CFF fonts say `OTTO`;
  // TrueType says a version number, and a reader takes it at its word.
  bytes = withSfntVersion(bytes, 0x00010000);

  return {
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    warnings: base.warnings,
  };
}

/**
 * `maxp` version 1.0, which is the one a TrueType font has.
 *
 * A CFF font's is version 0.5 and says only how many glyphs there are; this one
 * tells a rasteriser how much room to set aside before it starts. The hinting
 * fields are all zero because nothing here writes any instructions — the
 * outlines are unhinted, which is what a font from this editor has always been.
 */
function maxp(glyphs: number, maxPoints: number, maxContours: number): Uint8Array {
  return new Bytes()
    .u32(0x00010000)
    .u16(glyphs)
    .u16(maxPoints)
    .u16(maxContours)
    .u16(0) // composite points: nothing here writes a composite glyph
    .u16(0) // composite contours
    .u16(2) // zones: two, which is what a font without twilight hinting says
    .u16(0) // twilight points
    .u16(0) // storage
    .u16(0) // function definitions
    .u16(0) // instruction definitions
    .u16(0) // stack elements
    .u16(0) // the longest instruction sequence, of which there are none
    .u16(0) // component elements
    .u16(0) // component depth
    .done();
}

/**
 * `head`, with the one field that has to agree with `loca`.
 *
 * `indexToLocFormat` says whether the index is in short or long form, and a
 * reader that believes the wrong one reads every glyph at the wrong offset —
 * which gives a font full of shapes that are almost letters.
 */
function headWith(font: Uint8Array, longLoca: number): Uint8Array {
  const head = readTablesOf(font).find((t) => t.tag === "head")?.data;
  if (head === undefined || head.length < 54) return new Uint8Array();

  const out = head.slice();
  new DataView(out.buffer, out.byteOffset).setInt16(50, longLoca);
  return out;
}
