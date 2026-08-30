import type { OtCommand, OtFont, OtNames } from "opentype.js";

import { opentype } from "./opentype.js";

import type { PathCommand } from "./commands.js";

/**
 * The only file that knows which parser we use.
 *
 * Everything past this point sees `SourceFont` — our own flat, plain description
 * of what a font binary contains. That is the whole reason `font-io` exists as a
 * package: `opentype.js` is a reasonable choice today and a replaceable one
 * tomorrow, and nothing in the model, the tools or the editor should have to
 * care either way.
 */

export type SourceGlyph = {
  /** May be absent in the file; the importer is what settles on a final name. */
  readonly name: string | null;
  readonly unicodes: readonly number[];
  readonly advance: number;
  readonly commands: readonly PathCommand[];
};

export type SourceFont = {
  readonly familyName: string | null;
  readonly styleName: string | null;
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  readonly xHeight: number | null;
  readonly capHeight: number | null;
  /** `truetype` or `cff` — recorded for diagnostics, not acted on. */
  readonly outlines: string;
  readonly glyphs: readonly SourceGlyph[];
};

export class FontParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FontParseError";
  }
}

/**
 * Read a localised name.
 *
 * opentype.js 2.0 keys names by platform first — `unicode`, `macintosh`,
 * `windows` — each holding the same records in a different encoding. Any of the
 * three will do; they are asked for in the order most likely to be present and
 * correctly decoded. English is preferred but not required, because a font whose
 * only name record is in another language still has a name.
 */
function readName(names: OtNames, key: string): string | null {
  for (const platform of ["unicode", "windows", "macintosh"]) {
    const record = names[platform]?.[key];
    if (record === undefined) continue;
    const value = record["en"] ?? Object.values(record)[0];
    if (value !== undefined && value.trim() !== "") return value;
  }
  return null;
}

function toCommand(c: OtCommand): PathCommand | null {
  switch (c.type) {
    case "M":
    case "L":
      return { type: c.type, x: c.x, y: c.y };
    case "C":
      return { type: "C", x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, x: c.x, y: c.y };
    case "Q":
      return { type: "Q", x1: c.x1, y1: c.y1, x: c.x, y: c.y };
    case "Z":
      return { type: "Z" };
    default:
      return null;
  }
}

function readGlyphs(font: OtFont): SourceGlyph[] {
  const glyphs: SourceGlyph[] = [];
  for (let i = 0; i < font.glyphs.length; i++) {
    const g = font.glyphs.get(i);

    // `path` is lazily decoded, so a single malformed glyph throws here rather
    // than at parse time. One bad glyph should cost that glyph's outline, not
    // the whole font — a font you cannot open at all is the worse failure.
    let commands: PathCommand[] = [];
    try {
      commands = g.path.commands.map(toCommand).filter((c): c is PathCommand => c !== null);
    } catch {
      commands = [];
    }

    const unicodes = g.unicodes ?? (g.unicode === undefined ? [] : [g.unicode]);
    glyphs.push({
      name: g.name ?? null,
      unicodes,
      advance: g.advanceWidth ?? 0,
      commands,
    });
  }
  return glyphs;
}

/**
 * Parse a font binary.
 *
 * Composite glyphs are flattened by the parser: a glyph built from components
 * arrives as the outlines those components draw, with the fact that it was
 * composed lost. That is correct for editing outlines and wrong for preserving
 * structure, and it is the main thing standing between this and a faithful
 * round trip. Components are phase 3; this is where they will be recovered.
 */
export function parseFont(bytes: ArrayBuffer): SourceFont {
  let font: OtFont;
  try {
    font = opentype.parse(bytes);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new FontParseError(`Could not read this font: ${detail}`, { cause });
  }

  const os2 = font.tables.os2;
  return {
    familyName: readName(font.names, "fontFamily"),
    styleName: readName(font.names, "fontSubfamily"),
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
    xHeight: os2?.sxHeight ?? null,
    capHeight: os2?.sCapHeight ?? null,
    outlines: font.outlinesFormat,
    glyphs: readGlyphs(font),
  };
}
