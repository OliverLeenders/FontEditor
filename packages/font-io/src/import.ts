import {
  type Component,
  type FontDocument,
  type Kerning,
  type FontInfo,
  type Glyph,
  type IdFactory,
  DEFAULT_FONT_INFO,
  derivedVerticalMetrics,
  fontDocument,
  EMPTY_KERNING,
  component,
  glyph,
  groupKey,
  setFontInfo,
  setKern,
  setKernGroup,
  setKerning,
} from "@typewright/font-model";

import { contoursFromCommands } from "./commands.js";
import { embeddingBits, setBits } from "./embedding.js";
import { type SourceKernSide, type SourceKerning } from "./readkern.js";
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
  const typo = source.os2;
  // The identity fields keep their defaults: this reader is given outlines and
  // metrics by the parser and does not go looking in `name` for the rest. A
  // binary opened here is a font to draw from, not a source to save back over,
  // so what is not read is not at risk of being written away.
  return {
    ...DEFAULT_FONT_INFO,
    familyName: source.familyName ?? "Untitled",
    styleName: source.styleName ?? "Regular",
    unitsPerEm: em,
    // The typographic pair where the font has one, because that is what the
    // exporter writes from these two; `hhea`'s, where it differs, is an
    // override of its own and is read as one below.
    ascender: typo !== undefined && typo.typoAscender !== 0 ? typo.typoAscender : source.ascender,
    descender:
      typo !== undefined && typo.typoDescender !== 0 ? typo.typoDescender : source.descender,
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

  const document = setKerning(fontDocument(glyphs, info), kerningFrom(source.kerning, names));
  return { document: withLineMetrics(document, source), warnings };
}

/**
 * The line metrics and the embedding flag the file carries, as Font Info's
 * overrides.
 *
 * Each is kept only where it differs from what the exporter would derive from
 * this very document, because an override equal to the derived number says
 * nothing — and a font that set none would otherwise open with every field in
 * Line spacing filled in, as though somebody had decided each of them. Compared
 * after the glyphs are in, since the Windows box is derived from how far they
 * reach.
 */
function withLineMetrics(document: FontDocument, source: SourceFont): FontDocument {
  const { hhea, os2 } = source;
  if (hhea === undefined && os2 === undefined) return document;

  const derived = derivedVerticalMetrics(document);
  const unlike = (value: number | undefined, from: number): number | null =>
    value === undefined || Math.round(value) === from ? null : Math.round(value);

  // Bits 7 to 9 of `fsSelection` are the ones a font sets for itself; the rest
  // are the style map's, which the exporter works out from the style.
  const selection =
    os2 === undefined ? [] : setBits(os2.fsSelection).filter((bit) => bit >= 7 && bit <= 9);

  return setFontInfo(document, {
    ...document.info,
    openTypeHheaAscender: unlike(hhea?.ascender, derived.hheaAscender),
    openTypeHheaDescender: unlike(hhea?.descender, derived.hheaDescender),
    openTypeHheaLineGap: unlike(hhea?.lineGap, derived.hheaLineGap),
    openTypeOS2TypoAscender: unlike(os2?.typoAscender, derived.typoAscender),
    openTypeOS2TypoDescender: unlike(os2?.typoDescender, derived.typoDescender),
    openTypeOS2TypoLineGap: unlike(os2?.typoLineGap, derived.typoLineGap),
    openTypeOS2WinAscent: unlike(os2?.winAscent, derived.winAscent),
    openTypeOS2WinDescent: unlike(os2?.winDescent, derived.winDescent),
    openTypeOS2Selection: selection,
    openTypeOS2Type: os2 === undefined ? [] : embeddingBits(setBits(os2.fsType)),
  });
}

/**
 * Turn the file's kerning, which is in glyph indices, into the model's, which is
 * in names.
 *
 * Groups arrive as anonymous classes and are given numbered names. A font
 * usually names its kerning classes something meaningful, but that naming lives
 * in the source the font was built from and not in the font itself, so there is
 * nothing to recover.
 */
function kerningFrom(source: SourceKerning, names: readonly string[]): Kerning {
  if (source.pairs.length === 0) return EMPTY_KERNING;

  const glyphOf = (index: number): string | undefined => names[index];
  const named = (glyphs: readonly number[]): string[] =>
    glyphs.map(glyphOf).filter((n): n is string => n !== undefined);

  let kerning = EMPTY_KERNING;
  const firstNames: string[] = [];
  const secondNames: string[] = [];

  source.firstGroups.forEach((glyphs, i) => {
    const name = `kern1.${String(i + 1)}`;
    firstNames.push(name);
    kerning = setKernGroup(kerning, "first", name, named(glyphs));
  });
  source.secondGroups.forEach((glyphs, i) => {
    const name = `kern2.${String(i + 1)}`;
    secondNames.push(name);
    kerning = setKernGroup(kerning, "second", name, named(glyphs));
  });

  const key = (side: SourceKernSide, group: readonly string[]): string | undefined =>
    side.kind === "glyph" ? glyphOf(side.glyph) : groupKeyOf(group[side.group]);

  for (const pair of source.pairs) {
    const first = key(pair.first, firstNames);
    const second = key(pair.second, secondNames);
    if (first === undefined || second === undefined) continue;
    kerning = setKern(kerning, first, second, pair.value);
  }

  return kerning;
}

const groupKeyOf = (name: string | undefined): string | undefined =>
  name === undefined ? undefined : groupKey(name);

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
