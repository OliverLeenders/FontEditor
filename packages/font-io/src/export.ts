import {
  type ComponentSource,
  type Contour,
  type FontDocument,
  type FontInfo,
  type Glyph,
  type IdFactory,
  type StyleMapStyle,
  correctDirections,
  counterIds,
  glyph,
  kernIndex,
  orderedGlyphs,
  removeOverlap,
  resolveGlyphComponents,
  segments,
  withResolvedMetrics,
} from "@typewright/font-model";

import { kerningLookups, kerningSubtables } from "./gpos.js";
import { layoutTable, mergeFeatures, shiftFeatures } from "./layout.js";
import { opentype } from "./opentype.js";
import { compileFeatures } from "./features.js";
import { compileMarks } from "./marks.js";
import { readTablesOf, withTable } from "./sfnt.js";
import type { OtGlyph, OtOS2Init, OtPath } from "opentype.js";

/**
 * Writing a font out.
 *
 * What this produces is a *new* font built from what the editor models:
 * outlines, advance widths, the character map, and the vertical metrics. It is
 * not the file you opened with your changes applied. A font you imported also
 * carried OpenType features, hinting, and composite glyphs that arrive here
 * flattened — none of which this understands, and none of which survives.
 *
 * That distinction belongs in the interface as much as in this comment: the
 * action is "export a new font", never "save".
 */

export type ExportResult = {
  readonly bytes: ArrayBuffer;
  readonly warnings: readonly string[];
};

export class FontExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FontExportError";
  }
}

/**
 * Trace one contour into a path.
 *
 * Coordinates are rounded here and nowhere else. The model is deliberately
 * fractional — rounding at every edit would compound through transforms — and
 * this is the compiler, which is where the format's integer grid finally
 * applies.
 */
function tracePath(path: OtPath, c: Contour): void {
  const first = c.nodes[0];
  if (first === undefined) return;

  const at = (x: number, y: number): [number, number] => [Math.round(x), Math.round(y)];
  path.moveTo(...at(first.pt.x, first.pt.y));

  for (const segment of segments(c)) {
    if (segment.kind === "line" || segment.out === null || segment.in === null) {
      path.lineTo(...at(segment.b.x, segment.b.y));
      continue;
    }
    const c1 = at(segment.out.x, segment.out.y);
    const c2 = at(segment.in.x, segment.in.y);
    const end = at(segment.b.x, segment.b.y);
    path.curveTo(c1[0], c1[1], c2[0], c2[1], end[0], end[1]);
  }

  path.close();
}

/**
 * Every contour a glyph draws, its components included.
 *
 * CFF has no notion of a component, so this is where the references become
 * outlines. Nothing is lost in the shape — a flattened composite draws exactly
 * what it drew — but the fact that it *was* composed does not survive, which is
 * one of the two reasons the UFO export exists alongside this one.
 */
function flatten(g: Glyph, document: FontDocument, ids: IdFactory): readonly Contour[] {
  if (g.components.length === 0) return g.contours;

  const source: ComponentSource = {
    glyphOf: (name) => document.glyphs[name] ?? null,
  };

  return [...g.contours, ...resolveGlyphComponents(source, g.name, g.components, ids)];
}

/**
 * One outline out of overlapping ones, because CFF does not allow overlaps.
 *
 * The OpenType specification is flat about it: `glyf` supports overlapping
 * contours and CFF2 supports them, and the CFF outlines written here do not —
 * CFF CharStrings are filled by the even-odd rule, under which two shapes
 * subtract where they cross. Most rasterisers are lenient and fill by winding
 * anyway, which is why a font with overlaps can look perfect in a browser and
 * come out of a Windows preview or a printer with a notch where a stem crosses
 * a shoulder.
 *
 * So the union is taken here, on the way into the file, and the drawing is left
 * exactly as it was drawn — the same arrangement every font tool has, where a
 * designer keeps the pieces apart and the compiler joins them.
 *
 * Taken *after* the directions are put right, because what the union is depends
 * on them: two shapes running opposite ways enclose the difference between them
 * rather than the whole of both, and the answer would be a shape nobody drew.
 * What comes out is already oriented — the boundary is walked with the ink on
 * its left — so nothing needs correcting afterwards.
 *
 * Refused rather than guessed when the boundary will not close. That is worth a
 * warning, because it is a glyph to go and look at.
 */
/**
 * Every glyph with its outlines prepared as the compiler prepares them.
 *
 * Components resolved, directions corrected, overlaps joined — the three things
 * that stand between a drawing and a file, in the order they have to happen in.
 * Exported because the TrueType flavour needs exactly the same outlines and
 * would otherwise have its own copy of that order to get wrong.
 */
export function flattenedGlyphs(document: FontDocument): Glyph[] {
  const ids = counterIds("t");
  const warnings: string[] = [];

  const { names, synthesised } = notdefFirst(document);
  const glyphs = names.map((name) => {
    const g = document.glyphs[name];
    if (g === undefined) return glyph(name);

    const contours = unioned(g, directed(flatten(g, document, ids)), ids, warnings);
    return { ...g, components: [], contours: [...contours] };
  });

  // The blank `.notdef` the export gives a font without one, here too. Left out,
  // every glyph after it sat one place earlier than the character map and the
  // metrics said, and the last character pointed past the end of the font.
  return synthesised
    ? [glyph(".notdef", { advance: Math.round(document.info.unitsPerEm / 2) }), ...glyphs]
    : glyphs;
}

function unioned(
  g: Glyph,
  contours: readonly Contour[],
  ids: IdFactory,
  warnings: string[],
): readonly Contour[] {
  // Components are already resolved into `contours`; passing them again would
  // draw each of them twice.
  const union = removeOverlap({ ...g, contours, components: [] }, ids);
  if (union !== null) return union.glyph.contours;

  warnings.push(
    `${g.name}: contours overlap along an edge and could not be joined, so the overlap is in the font.`,
  );
  return contours;
}

/**
 * The contours as the file needs them: each running the way its nesting says.
 *
 * Which way a contour runs is an accident of the order its points were placed,
 * and it decides what a rasteriser filling by the winding rule takes for ink: a
 * counter must run against what holds it or it is not a hole. Put right here,
 * where the font is compiled, so the drawing stays as drawn.
 *
 * Not reported, unlike the union above. A warning is for something to act on,
 * and this is the compiler doing its job — nearly every hand-drawn glyph would
 * carry the note. The editor fills the corrected contours too, so what is on the
 * canvas is what the file will draw.
 */
function directed(contours: readonly Contour[]): readonly Contour[] {
  return correctDirections(contours);
}

function pathFor(g: Glyph, contours: readonly Contour[], warnings: string[]): OtPath {
  const path = new opentype.Path();

  for (const c of contours) {
    if (c.nodes.length < 2) continue;
    if (!c.closed) {
      // A font has no notion of an open path; the outline is the boundary of a
      // filled region. Closing it is what the format will do anyway, said out
      // loud rather than silently.
      warnings.push(`${g.name}: an open contour was closed.`);
    }
    tracePath(path, c);
  }

  return path;
}

/**
 * The `.notdef` glyph, which must exist and must come first.
 *
 * Fonts use it for any character they cannot render, and the format reserves
 * glyph zero for it. A document that has not got one is given an empty one
 * rather than being refused.
 */
function notdefFirst(document: FontDocument): { names: string[]; synthesised: boolean } {
  const names = document.glyphOrder.filter((name) => name !== ".notdef");
  const has = document.glyphOrder.includes(".notdef");
  return { names: has ? [".notdef", ...names] : names, synthesised: !has };
}

/**
 * Build a font binary from a document.
 *
 * Throws {@link FontExportError} only when there is nothing that could be
 * written. Anything survivable is reported through `warnings`, on the same
 * reasoning as import: refusing to produce a font over one odd contour helps
 * nobody.
 */

/**
 * The code points a glyph can be written with.
 *
 * Code point zero belongs to `.null`, and opentype.js refuses to write a font
 * in which any other glyph has it — not the glyph, the whole font. Fonts do
 * carry such a glyph, a `NULL` or `uni0000` left by a converter, and a font that
 * could not be exported at all over one mapping of a character nobody types is
 * the wrong trade. So zero is left out of every other glyph's code points; the
 * glyph, its outline and its other code points are written as they are.
 */
export function writableUnicodes(name: string, unicodes: readonly number[]): number[] {
  return name === ".null" ? [...unicodes] : unicodes.filter((codePoint) => codePoint !== 0);
}

/** The style-map style as the `name` table spells it. */
const STYLE_NAMES: Readonly<Record<StyleMapStyle, string>> = {
  regular: "Regular",
  italic: "Italic",
  bold: "Bold",
  "bold italic": "Bold Italic",
};

/**
 * The `OS/2` selection bits for a style-map style.
 *
 * Stated rather than deduced. opentype.js would work these out from the italic
 * angle and the weight class, which is a guess that goes wrong in both
 * directions: an upright face of a family called Bold, and an italic drawn
 * without any slant at all.
 */
/**
 * The `fsSelection` bits a font decides for itself: 7, 8 and 9.
 *
 * The first seven are left out even where a source lists them, because they are
 * the style map's to say. A font whose bold bit disagrees with its style map is
 * one an operating system files under two different names.
 */
function decidedSelection(info: FontInfo): number {
  let bits = 0;
  for (const bit of info.openTypeOS2Selection) if (bit >= 7 && bit <= 9) bits |= 1 << bit;
  return bits;
}

/** What `OS/2` is told, where the font has decided, rather than left to derive. */
function os2Overrides(info: FontInfo): OtOS2Init {
  const os2: OtOS2Init = {};
  if (info.openTypeOS2VendorID.trim() !== "") {
    os2.achVendID = info.openTypeOS2VendorID.slice(0, 4).padEnd(4, " ");
  }
  // Bits 7 to 9 are only defined from version 4, which is the same length as the
  // 3 opentype.js writes: asking for them is changing one number.
  if (decidedSelection(info) !== 0) os2.version = 4;

  // What a document may do with the font embedded in it. opentype.js writes 0,
  // installable, whatever the licence says; a font that has decided says so here.
  const embedding = info.openTypeOS2Type.reduce(
    (bits, bit) => ([1, 2, 3, 8, 9].includes(bit) ? bits | (1 << bit) : bits),
    0,
  );
  if (embedding !== 0) os2.fsType = embedding;

  if (info.openTypeOS2TypoAscender !== null) {
    os2.sTypoAscender = Math.round(info.openTypeOS2TypoAscender);
  }
  if (info.openTypeOS2TypoDescender !== null) {
    os2.sTypoDescender = Math.round(info.openTypeOS2TypoDescender);
  }
  if (info.openTypeOS2TypoLineGap !== null) {
    os2.sTypoLineGap = Math.round(info.openTypeOS2TypoLineGap);
  }
  if (info.openTypeOS2WinAscent !== null) os2.usWinAscent = Math.round(info.openTypeOS2WinAscent);
  if (info.openTypeOS2WinDescent !== null) {
    os2.usWinDescent = Math.round(info.openTypeOS2WinDescent);
  }
  return os2;
}

/**
 * The line metrics `hhea` is told, where the font sets them.
 *
 * opentype.js builds `hhea` from the ascender and descender alone, with no line
 * gap, and unlike `OS/2` takes no overrides for it. So the three numbers are
 * written into the finished table instead: they sit at fixed offsets straight
 * after its version, and the table is spliced back so the checksums are right.
 */
function withHheaMetrics(bytes: ArrayBuffer, info: FontInfo): ArrayBuffer {
  const ascender = info.openTypeHheaAscender;
  const descender = info.openTypeHheaDescender;
  const lineGap = info.openTypeHheaLineGap;
  if (ascender === null && descender === null && lineGap === null) return bytes;

  const font = new Uint8Array(bytes);
  const hhea = readTablesOf(font).find((t) => t.tag === "hhea");
  if (hhea === undefined) return bytes;

  const table = hhea.data.slice();
  const view = new DataView(table.buffer);
  if (ascender !== null) view.setInt16(4, Math.round(ascender));
  if (descender !== null) view.setInt16(6, Math.round(descender));
  if (lineGap !== null) view.setInt16(8, Math.round(lineGap));

  const out = withTable(font, "hhea", table);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

function selectionOf(style: StyleMapStyle): number {
  const ITALIC = 1;
  const BOLD = 32;
  const REGULAR = 64;

  switch (style) {
    case "italic":
      return ITALIC;
    case "bold":
      return BOLD;
    case "bold italic":
      return BOLD | ITALIC;
    default:
      return REGULAR;
  }
}

/** Set one name record in every platform's table, as the constructor does. */
function setName(font: { names: Record<string, unknown> }, key: string, value: string): void {
  for (const table of platformsOf(font)) table[key] = { en: value };
}

/** Take one name out of every platform's table, so no record is written. */
function clearName(font: { names: Record<string, unknown> }, key: string): void {
  for (const table of platformsOf(font)) delete table[key];
}

function platformsOf(font: { names: Record<string, unknown> }): Record<string, { en: string }>[] {
  const out: Record<string, { en: string }>[] = [];
  for (const platform of ["unicode", "macintosh", "windows"]) {
    const table = font.names[platform];
    if (table !== undefined && table !== null) out.push(table as Record<string, { en: string }>);
  }
  return out;
}

export function exportFont(source: FontDocument, ids: IdFactory = counterIds("x")): ExportResult {
  // Checked before the synthesised .notdef is added, or a document holding
  // nothing at all would quietly export as a font holding nothing at all.
  if (source.glyphOrder.length === 0) {
    throw new FontExportError("This font has no glyphs to export.");
  }

  // A font file has no way to say "this glyph is spaced like that one": it
  // records an advance and an outline position, and that is all a rasteriser
  // ever sees. So the keys are followed here and what comes out is ordinary.
  const spaced = withResolvedMetrics(source);
  const document = spaced.document;

  const warnings: string[] = spaced.problems.map((p) => `${p.glyph} ${p.says}`);
  const { names, synthesised } = notdefFirst(document);

  const glyphs: OtGlyph[] = [];
  if (synthesised) {
    glyphs.push(
      new opentype.Glyph({
        name: ".notdef",
        advanceWidth: Math.round(document.info.unitsPerEm / 2),
        path: new opentype.Path(),
      }),
    );
  }

  for (const name of names) {
    const g = document.glyphs[name];
    if (g === undefined) continue;

    const path = pathFor(
      g,
      unioned(g, directed(flatten(g, document, ids)), ids, warnings),
      warnings,
    );
    const init: {
      name: string;
      advanceWidth: number;
      path: OtPath;
      leftSideBearing?: number;
      unicode?: number;
      unicodes?: number[];
    } = {
      name: g.name,
      advanceWidth: Math.max(0, Math.round(g.advance)),
      path,
    };
    // Said, because opentype.js writes zero for a sidebearing it is not given,
    // and zero is where nearly no outline starts. Floored, as a bound on an
    // integer grid is: the outline starts at or right of it.
    if (path.commands.length > 0) {
      init.leftSideBearing = Math.floor(path.getBoundingBox().x1);
    }

    // Several code points can map to one glyph, and dropping the extras would
    // quietly unmap characters the font used to cover — so the only one ever
    // left out is the one the format reserves, and it is said.
    const unicodes = writableUnicodes(g.name, g.unicodes);
    if (unicodes.length < g.unicodes.length) {
      warnings.push(
        `${g.name}: U+0000 is left out of the character map, which keeps it for a glyph named .null.`,
      );
    }
    const first = unicodes[0];
    if (first !== undefined) {
      init.unicode = first;
      init.unicodes = unicodes;
    }
    glyphs.push(new opentype.Glyph(init));
  }

  const { info } = document;
  const family = info.familyName.trim() === "" ? "Untitled" : info.familyName;
  const style = info.styleName.trim() === "" ? "Regular" : info.styleName;

  // Names 1 and 2 are the four-slot pair every operating system falls back to,
  // so they carry the style map rather than the real names. The real ones go in
  // 16 and 17 below, where software that can group more than four styles looks.
  const mapFamily = info.styleMapFamilyName.trim() === "" ? family : info.styleMapFamilyName;
  const mapStyle = STYLE_NAMES[info.styleMapStyleName];

  const font = new opentype.Font({
    familyName: mapFamily,
    styleName: mapStyle,
    fullName: `${family} ${style}`,
    postScriptName: `${family}-${style}`.replace(/\s/g, ""),
    unitsPerEm: Math.round(info.unitsPerEm),
    ascender: Math.round(info.ascender),
    // The format requires this to be negative, and a document can hold anything.
    descender: -Math.abs(Math.round(info.descender)),

    version: `Version ${String(info.versionMajor)}.${String(info.versionMinor).padStart(3, "0")}`,

    italicAngle: info.italicAngle,
    weightClass: info.openTypeOS2WeightClass,
    widthClass: info.openTypeOS2WidthClass,
    fsSelection: selectionOf(info.styleMapStyleName) | decidedSelection(info),
    tables: { os2: os2Overrides(info) },

    glyphs,
  });

  // What the designer filled in, and nothing where they filled in nothing.
  // opentype.js gives every name it was not given a single space, so leaving a
  // field out of the options is not enough — a blank record is a record, and it
  // is one a validator complains about and a font window shows as empty.
  for (const [key, value] of Object.entries({
    copyright: info.copyright,
    trademark: info.trademark,
    designer: info.openTypeNameDesigner,
    designerURL: info.openTypeNameDesignerURL,
    manufacturer: info.openTypeNameManufacturer,
    manufacturerURL: info.openTypeNameManufacturerURL,
    license: info.openTypeNameLicense,
    licenseURL: info.openTypeNameLicenseURL,
    description: info.openTypeNameDescription,
  })) {
    if (value.trim() === "") clearName(font, key);
    else setName(font, key, value);
  }

  // The typographic names, written only where they say something the four-slot
  // pair does not. A name 16 identical to name 1 is noise every reader has to
  // decide to ignore.
  if (mapFamily !== family) setName(font, "preferredFamily", family);
  if (mapStyle !== style) setName(font, "preferredSubfamily", style);

  const bytes = withHheaMetrics(font.toArrayBuffer(), info);

  // opentype.js writes no GPOS, so the kerning goes in afterwards. Glyph ids
  // are positions in the list just built, which is the order they were added.
  const order = new Map<string, number>();
  glyphs.forEach((g, i) => {
    if (g.name !== undefined) order.set(g.name, i);
  });

  const layout = layoutTables(document, (name) => order.get(name));
  for (const problem of layout.warnings) warnings.push(problem);
  return { bytes: withLayoutTables(bytes, layout), warnings };
}

/** The three layout tables a font is compiled with, each empty where it has nothing to say. */
export type LayoutTables = {
  readonly gpos: Uint8Array;
  readonly gsub: Uint8Array;
  readonly gdef: Uint8Array;
  readonly warnings: readonly string[];
};

/**
 * `GPOS`, `GSUB` and `GDEF` for a document, given where each glyph sits.
 *
 * Apart from the rest of the export because a font set for a preview needs
 * exactly these and nothing of the outlines, which are the slow part: the same
 * substitutions, kerning and mark attachment, compiled the same way, so what the
 * preview shows is what the font will do.
 */
export function layoutTables(
  document: FontDocument,
  glyphIdOf: (name: string) => number | undefined,
): LayoutTables {
  const warnings: string[] = [];
  const features = compileFeatures(document.features, glyphIdOf);

  // One GPOS from two sources: the kerning the editor keeps in its own model,
  // and whatever positioning the feature file asks for. A second table is not a
  // thing a font can have, and a second `kern` feature is one a shaper ignores.
  const kernSubtables = kerningSubtables(kernIndex(document.kerning), glyphIdOf);
  const kernLookups = kerningLookups(kernSubtables);

  // The third source: the anchors. A component placed by them puts the accent
  // in the outline; this is the rule that puts it there for a letter and a
  // combining mark typed as two characters, where there is no composite to
  // place anything into.
  const marks = compileMarks(orderedGlyphs(document), glyphIdOf);
  for (const problem of marks.warnings) warnings.push(problem);

  const markAt = kernLookups.length + features.positioning.lookups.length;
  const gpos = layoutTable(
    mergeFeatures(
      mergeFeatures(
        kernLookups.length === 0 ? [] : [{ tag: "kern", lookups: kernLookups.map((_, i) => i) }],
        shiftFeatures(features.positioning.entries, kernLookups.length),
      ),
      marks.features.map((tag, i) => ({ tag, lookups: [markAt + i] })),
    ),
    [...kernLookups, ...features.positioning.lookups, ...marks.lookups],
  );
  for (const problem of features.problems) {
    warnings.push(`features, line ${String(problem.line)}: ${problem.message}`);
  }

  // GDEF only alongside the lookups that need it: a shaper reads it to know
  // which glyphs are marks, and mark attachment without it is not reliably
  // applied.
  return {
    gpos,
    gsub: features.table,
    gdef: gpos.length > 0 ? marks.gdef : new Uint8Array(),
    warnings,
  };
}

/** A compiled font with its layout tables spliced in, or as it was where there are none. */
export function withLayoutTables(bytes: ArrayBuffer, layout: LayoutTables): ArrayBuffer {
  if (layout.gpos.length === 0 && layout.gsub.length === 0 && layout.gdef.length === 0) {
    return bytes;
  }

  // Spliced one after the other, each on the bytes the last produced, so the
  // directory and the checksums are right whichever of them exists.
  let out: Uint8Array = new Uint8Array(bytes);
  if (layout.gpos.length > 0) out = withTable(out, "GPOS", layout.gpos);
  if (layout.gsub.length > 0) out = withTable(out, "GSUB", layout.gsub);
  if (layout.gdef.length > 0) out = withTable(out, "GDEF", layout.gdef);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

export { exportFileName } from "./file-name.js";
