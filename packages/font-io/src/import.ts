import {
  type Component,
  type FontDocument,
  type FontInfo,
  type Glyph,
  type IdFactory,
  fontDocument,
  component,
  glyph,
} from "@fonteditor/font-model";

import { contoursFromCommands } from "./commands.js";
import { type SourceFont, type SourceGlyph, parseFont } from "./source.js";

/**
 * How close two on-curve points must be to count as the same point, as a
 * fraction of the em.
 *
 * Relative, so a 1000-unit and a 2048-unit font import identically. A millionth
 * of an em is far below anything a font's integer grid can express, so this
 * catches exact coincidence and rounding noise without ever merging two points a
 * designer meant to keep apart.
 */
const COINCIDENT = 1e-6;

export type ImportWarning = {
  /** The glyph it concerns, or `null` for the font as a whole. */
  readonly glyph: string | null;
  readonly message: string;
};

export type ImportResult = {
  readonly document: FontDocument;
  readonly warnings: readonly ImportWarning[];
};

/**
 * A name for a glyph the file did not name.
 *
 * CFF fonts without names, and TrueType fonts with a version 3 `post` table,
 * carry no glyph names at all. `uni0041` is the AGL convention and is what other
 * editors show, so a font imported here and opened elsewhere agrees. Glyphs with
 * no codepoint fall back to their index, which at least stays stable.
 */
function inventName(source: SourceGlyph, index: number): string {
  const codepoint = source.unicodes[0];
  if (codepoint === undefined) return `glyph${String(index)}`;
  if (codepoint > 0xffff) return `u${codepoint.toString(16).toUpperCase().padStart(6, "0")}`;
  return `uni${codepoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * Force names to be unique.
 *
 * The document keys glyphs by name, so two glyphs called the same thing would
 * mean one silently replacing the other — a font that loses glyphs on import
 * without saying so. Broken fonts do contain duplicate names, so this cannot be
 * an assertion; it renames and reports.
 */
function uniqueName(preferred: string, taken: Set<string>): string {
  if (!taken.has(preferred)) return preferred;
  let n = 2;
  while (taken.has(`${preferred}.${String(n)}`)) n++;
  return `${preferred}.${String(n)}`;
}

/**
 * Vertical metrics, filled in where the font declines to say.
 *
 * x-height and cap-height live in `OS/2` and are genuinely optional; plenty of
 * real fonts leave them zero. The fallbacks are proportions of the em rather
 * than fixed numbers, so they stay sensible whatever the font's units — and they
 * reproduce the defaults exactly at 1000 units per em.
 */
function infoFrom(source: SourceFont): FontInfo {
  const em = source.unitsPerEm > 0 ? source.unitsPerEm : 1000;
  const usable = (value: number | null): value is number => value !== null && value > 0;
  return {
    familyName: source.familyName ?? "Untitled",
    styleName: source.styleName ?? "Regular",
    unitsPerEm: em,
    ascender: source.ascender,
    descender: source.descender,
    xHeight: usable(source.xHeight) ? source.xHeight : em * 0.5,
    capHeight: usable(source.capHeight) ? source.capHeight : em * 0.7,
  };
}

/**
 * Build a document from an already-parsed font.
 *
 * Split from {@link importFont} so the mapping can be tested on hand-written
 * source data, without a font binary in the loop.
 */
export function documentFrom(source: SourceFont, ids: IdFactory): ImportResult {
  const info = infoFrom(source);
  const epsilon = info.unitsPerEm * COINCIDENT;
  const warnings: ImportWarning[] = [];
  const taken = new Set<string>();
  const glyphs: Glyph[] = [];

  // Components refer to glyphs by index, and the names are only settled here, so
  // the naming pass runs first and the references are resolved against it.
  const names: string[] = [];
  source.glyphs.forEach((g, index) => {
    const preferred = g.name ?? inventName(g, index);
    const name = uniqueName(preferred, taken);
    if (name !== preferred) {
      warnings.push({
        glyph: name,
        message: `Renamed from "${preferred}", which the font used more than once.`,
      });
    }
    taken.add(name);
    names.push(name);
  });

  source.glyphs.forEach((g, index) => {
    const name = names[index]!;
    const components: Component[] = [];

    for (const reference of g.components) {
      const base = names[reference.glyphIndex];
      if (base === undefined) {
        warnings.push({
          glyph: name,
          message: `Dropped a component pointing at glyph ${String(reference.glyphIndex)}, which is not in this font.`,
        });
        continue;
      }
      components.push(component(ids.component(), base, reference.transform));
    }

    glyphs.push(
      glyph(name, {
        unicodes: g.unicodes,
        advance: g.advance,
        contours: contoursFromCommands(g.commands, ids, epsilon),
        components,
      }),
    );
  });

  if (glyphs.length === 0) {
    warnings.push({ glyph: null, message: "This font contains no glyphs." });
  }

  return { document: fontDocument(glyphs, info), warnings };
}

/**
 * Read a font binary into an editable document.
 *
 * Throws {@link FontParseError} only when the file is not a font we can read at
 * all. Anything survivable — an unreadable glyph, a duplicated name, missing
 * metrics — is repaired and reported through `warnings`, because refusing to
 * open a font over one bad glyph helps nobody.
 */
export function importFont(bytes: ArrayBuffer, ids: IdFactory): ImportResult {
  return documentFrom(parseFont(bytes), ids);
}
