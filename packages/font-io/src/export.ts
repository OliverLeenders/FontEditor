import {
  type ComponentSource,
  type Contour,
  type FontDocument,
  type Glyph,
  type IdFactory,
  correctDirections,
  counterIds,
  kernIndex,
  resolveGlyphComponents,
  segments,
} from "@fonteditor/font-model";

import { kerningLookups, kerningSubtables } from "./gpos.js";
import { layoutTable, mergeFeatures, shiftFeatures } from "./layout.js";
import { opentype } from "./opentype.js";
import { compileFeatures } from "./features.js";
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
 * The contours as the file needs them: each running the way its nesting says.
 *
 * A rasteriser fills one path by the non-zero winding rule, so two contours that
 * overlap must run the same way round or the overlap is subtracted — a stem
 * crossing a shoulder comes out with a notch in it. Which way a contour runs is
 * an accident of the order its points were placed, so it is put right here,
 * where the font is compiled, and the drawing is left exactly as it was drawn.
 *
 * Not reported. A warning is for something to act on, and this is the compiler
 * doing its job: which way a contour runs is not a decision anyone made, and
 * nearly every hand-drawn glyph would carry the note. The editor fills the
 * corrected contours too, so nothing about it is hidden — what is on the canvas
 * is what the file will draw.
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
      path: pathFor(g, directed(flatten(g, document, ids)), warnings),
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
  const font = new opentype.Font({
    familyName: info.familyName.trim() === "" ? "Untitled" : info.familyName,
    styleName: info.styleName.trim() === "" ? "Regular" : info.styleName,
    unitsPerEm: Math.round(info.unitsPerEm),
    ascender: Math.round(info.ascender),
    // The format requires this to be negative, and a document can hold anything.
    descender: -Math.abs(Math.round(info.descender)),
    glyphs,
  });

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
  const gpos = layoutTable(
    mergeFeatures(
      kernLookups.length === 0 ? [] : [{ tag: "kern", lookups: kernLookups.map((_, i) => i) }],
      shiftFeatures(features.positioning.entries, kernLookups.length),
    ),
    [...kernLookups, ...features.positioning.lookups],
  );
  for (const problem of features.problems) {
    warnings.push(`features, line ${String(problem.line)}: ${problem.message}`);
  }

  if (gpos.length === 0 && features.table.length === 0) return { bytes, warnings };

  // Spliced one after the other, each on the bytes the last produced, so the
  // directory and the checksums are right whichever of the two exists.
  let out: Uint8Array = new Uint8Array(bytes);
  if (gpos.length > 0) out = withTable(out, "GPOS", gpos);
  if (features.table.length > 0) out = withTable(out, "GSUB", features.table);
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
