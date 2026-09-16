import type { FontDocument } from "@typewright/font-model";

import { Bytes } from "./bytes.js";
import { type ExportOptions, type ExportResult, exportFont, flattenedGlyphs } from "./export.js";
import { glyfTable } from "./glyf.js";
import { withLeftSideBearings } from "./hmtx.js";
import { postWithNames } from "./post.js";
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

export function exportTrueType(document: FontDocument, options: ExportOptions = {}): ExportResult {
  const base = exportFont(document, undefined, options);
  let bytes: Uint8Array = new Uint8Array(base.bytes);

  const glyphs = flattenedGlyphs(document);
  const { glyf, loca, longLoca, maxPoints, maxContours, xMins } = glyfTable(glyphs);

  bytes = withTable(bytes, "glyf", glyf);
  bytes = withTable(bytes, "loca", loca);
  // From the points as written, which are what a rasteriser measures against.
  bytes = withLeftSideBearings(bytes, xMins);
  // The names, which went out with the CFF table that held them.
  const post = readTablesOf(bytes).find((t) => t.tag === "post")?.data;
  if (post !== undefined) {
    bytes = withTable(
      bytes,
      "post",
      postWithNames(
        post,
        glyphs.map((g) => g.name),
      ),
    );
  }
  bytes = withTable(bytes, "maxp", maxp(glyphs.length, maxPoints, maxContours));
  bytes = withTable(bytes, "head", headWith(bytes, longLoca));
  bytes = withTable(bytes, "gasp", GASP);
  bytes = withTable(bytes, "prep", PREP);
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
 * How Windows should draw a font with no hinting: smoothed, at every size.
 *
 * Left to itself, Windows decides per size whether to smooth a TrueType font,
 * and at some sizes and settings an unhinted one comes out in hard black pixels
 * — which, with nothing snapping its stems to the grid, is as ragged as text
 * gets. One range, up to the largest size there is, with every flag set: what
 * Google Fonts' own fixer writes for an unhinted font and what its checks ask
 * for. Grid-fitting is among the flags and does nothing here, there being no
 * instructions to fit by; it is the right value if the font is ever hinted.
 */
const GASP = new Bytes()
  .u16(1) // version 1, which has the two symmetric (ClearType) flags
  .u16(1) // one range
  .u16(0xffff) // up to every size
  .u16(0x000f) // grid-fit, grayscale, symmetric grid-fit, symmetric smoothing
  .done();

/**
 * The control program, turning dropout control on and nothing else.
 *
 * A stroke thinner than a pixel can fall between pixel centres and not be drawn
 * at all; dropout control fills it in. A hinted font turns it on in its own
 * instructions, and an unhinted one has none, so this is the whole program:
 * `SCANCTRL` 511 — on at every size, rotated or stretched — and `SCANTYPE` 4,
 * the mode that avoids stubs. It is the program Google Fonts adds to an unhinted
 * font alongside the `gasp` above.
 */
const PREP = new Uint8Array([
  ...[0xb8, 0x01, 0xff], // PUSHW[] 511
  ...[0x85], // SCANCTRL[]
  ...[0xb0, 0x04], // PUSHB[] 4
  ...[0x8d], // SCANTYPE[]
]);

/**
 * `maxp` version 1.0, which is the one a TrueType font has.
 *
 * A CFF font's is version 0.5 and says only how many glyphs there are; this one
 * tells a rasteriser how much room to set aside before it starts. The hinting
 * fields are zero because nothing here writes any glyph instructions — the
 * outlines are unhinted, which is what a font from this editor has always been —
 * except the stack, which the control program above pushes one value onto at a
 * time.
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
    .u16(1) // stack elements: the control program's one value at a time
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
