import {
  type ComponentSource,
  type Contour,
  type FontDocument,
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
} from "@fonteditor/font-model";

import { kerningLookups, kerningSubtables } from "./gpos.js";
import { layoutTable, mergeFeatures, shiftFeatures } from "./layout.js";
import { opentype } from "./opentype.js";
import { compileFeatures } from "./features.js";
import { compileMarks } from "./marks.js";
import { withTable } from "./sfnt.js";
import type { OtGlyph, OtPath } from "opentype.js";

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

  return notdefFirst(document).names.map((name) => {
    const g = document.glyphs[name];
    if (g === undefined) return glyph(name);

    const contours = unioned(g, directed(flatten(g, document, ids)), ids, warnings);
    return { ...g, components: [], contours: [...contours] };
  });
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

export function exportFont(document: FontDocument, ids: IdFactory = counterIds("x")): ExportResult {
  // Checked before the synthesised .notdef is added, or a document holding
  // nothing at all would quietly export as a font holding nothing at all.
  if (document.glyphOrder.length === 0) {
    throw new FontExportError("This font has no glyphs to export.");
  }

  const warnings: string[] = [];
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

    const init: {
      name: string;
      advanceWidth: number;
      path: OtPath;
      unicode?: number;
      unicodes?: number[];
    } = {
      name: g.name,
      advanceWidth: Math.max(0, Math.round(g.advance)),
      path: pathFor(g, unioned(g, directed(flatten(g, document, ids)), ids, warnings), warnings),
    };

    // Several code points can map to one glyph, and dropping the extras would
    // quietly unmap characters the font used to cover.
    const first = g.unicodes[0];
    if (first !== undefined) {
      init.unicode = first;
      init.unicodes = [...g.unicodes];
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
    fsSelection: selectionOf(info.styleMapStyleName),
    ...(info.openTypeOS2VendorID.trim() === ""
      ? {}
      : { tables: { os2: { achVendID: info.openTypeOS2VendorID.slice(0, 4).padEnd(4, " ") } } }),

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

  const bytes = font.toArrayBuffer();

  // opentype.js writes no GPOS, so the kerning goes in afterwards. Glyph ids
  // are positions in the list just built, which is the order they were added.
  const order = new Map<string, number>();
  glyphs.forEach((g, i) => {
    if (g.name !== undefined) order.set(g.name, i);
  });

  const features = compileFeatures(document.features, (name) => order.get(name));

  // One GPOS from two sources: the kerning the editor keeps in its own model,
  // and whatever positioning the feature file asks for. A second table is not a
  // thing a font can have, and a second `kern` feature is one a shaper ignores.
  const kernSubtables = kerningSubtables(kernIndex(document.kerning), (name) => order.get(name));
  const kernLookups = kerningLookups(kernSubtables);

  // The third source: the anchors. A component placed by them puts the accent
  // in the outline; this is the rule that puts it there for a letter and a
  // combining mark typed as two characters, where there is no composite to
  // place anything into.
  const marks = compileMarks(orderedGlyphs(document), (name) => order.get(name));
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

  if (gpos.length === 0 && features.table.length === 0 && marks.gdef.length === 0) {
    return { bytes, warnings };
  }

  // Spliced one after the other, each on the bytes the last produced, so the
  // directory and the checksums are right whichever of the two exists.
  let out: Uint8Array = new Uint8Array(bytes);
  if (gpos.length > 0) out = withTable(out, "GPOS", gpos);
  if (features.table.length > 0) out = withTable(out, "GSUB", features.table);
  // GDEF last, and only alongside the lookups that need it: a shaper reads it to
  // know which glyphs are marks, and mark attachment without it is not reliably
  // applied.
  if (gpos.length > 0 && marks.gdef.length > 0) out = withTable(out, "GDEF", marks.gdef);
  return { bytes: out.buffer.slice(0) as ArrayBuffer, warnings };
}

/**
 * A filename for the exported font.
 *
 * `PostScript`-ish: the family and style joined without spaces, which is what
 * every other tool produces and what people expect to find in their downloads.
 */
export function exportFileName(document: FontDocument): string {
  const clean = (s: string): string => s.replace(/[^A-Za-z0-9]/g, "");
  const family = clean(document.info.familyName) || "Untitled";
  const style = clean(document.info.styleName) || "Regular";
  return `${family}-${style}.otf`;
}
