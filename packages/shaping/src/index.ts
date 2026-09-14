import { type FontDocument, type TextToken, glyphForToken } from "@typewright/font-model";
import { NAMED_GLYPH_BASE, exportShapingFont } from "@typewright/font-io/binary";
import type { Engine, EngineGlyph } from "@typewright/view";
import { Blob, Buffer, Face, Font, shape } from "harfbuzzjs";

/**
 * Setting text with HarfBuzz.
 *
 * HarfBuzz is the shaper nearly every browser and operating system sets text
 * with, built to WebAssembly. Setting the proof and the spacing line with it
 * shows a font as it will set, and tests the substitutions, kerning and mark
 * attachment this editor compiles against something other than the code that
 * compiled them — the in-house shaper reads the feature source it was written
 * from, and could only ever agree with it.
 *
 * A package of its own because HarfBuzz is half a megabyte of WebAssembly the
 * editor does not need until text is set: the editor imports this when it is,
 * and uses the in-house shaper until it has.
 */

/** A document's shaping font, open in HarfBuzz, and what its glyph ids mean. */
type Compiled = {
  readonly font: Font;
  readonly ids: ReadonlyMap<string, number>;
  readonly names: readonly string[];
};

/**
 * One engine per document.
 *
 * The document is a new value after every edit, so an engine never outlives the
 * font it was compiled from, and there is nothing to invalidate. HarfBuzz's own
 * objects are freed by the library when the engine holding them is collected.
 */
const engines = new WeakMap<FontDocument, Engine>();

/**
 * The engine that sets a document's text.
 *
 * The font is compiled the first time text is set with it rather than here, so
 * a document that is only ever passed through costs nothing. `null` from the
 * engine where the font could not be compiled or opened, and the caller sets
 * the line the other way.
 */
export function harfBuzzEngine(document: FontDocument): Engine {
  const known = engines.get(document);
  if (known !== undefined) return known;

  let compiled: Compiled | null | undefined;
  const engine: Engine = (tokens) => {
    if (compiled === undefined) compiled = compile(document);
    return compiled === null ? null : setText(compiled, document, tokens);
  };

  engines.set(document, engine);
  return engine;
}

function compile(document: FontDocument): Compiled | null {
  try {
    const { bytes, glyphNames } = exportShapingFont(document);
    const font = new Font(new Face(new Blob(bytes)));
    return { font, ids: new Map(glyphNames.map((name, id) => [name, id])), names: glyphNames };
  } catch {
    // A font that cannot be compiled for shaping is one the export would also
    // refuse, and says why there. A proof set the simpler way is still a proof.
    return null;
  }
}

/**
 * The glyphs HarfBuzz sets for a line, in design units.
 *
 * A character goes in as itself, so the character map and every rule keyed on
 * it apply. A glyph named after a slash goes in as its private code point — see
 * `NAMED_GLYPH_BASE` — which is how a glyph with no character is asked for at
 * all. A name the font has not got is left out, as a character with no glyph is.
 *
 * What HarfBuzz sets as `.notdef` is left out too: it stands for a character
 * the font has no glyph for, and this editor's lines have always skipped those
 * rather than drawing an invented box between two real letters.
 */
function setText(
  compiled: Compiled,
  document: FontDocument,
  tokens: readonly TextToken[],
): EngineGlyph[] {
  const codePoints: number[] = [];
  for (const token of tokens) {
    if (token.kind === "character") {
      codePoints.push(token.codePoint);
      continue;
    }
    const glyph = glyphForToken(document, token);
    const id = glyph === null ? undefined : compiled.ids.get(glyph.name);
    if (id !== undefined) codePoints.push(NAMED_GLYPH_BASE + id);
  }
  if (codePoints.length === 0) return [];

  const buffer = new Buffer();
  buffer.addCodePoints(codePoints);
  // Direction, script and language worked out from the text itself. The line is
  // still laid out left to right; a proof with controls for them is later.
  buffer.guessSegmentProperties();
  shape(compiled.font, buffer);

  const out: EngineGlyph[] = [];
  for (const placed of buffer.getGlyphInfosAndPositions()) {
    if (placed.codepoint === 0) continue;
    const name = compiled.names[placed.codepoint];
    if (name === undefined) continue;
    out.push({
      name,
      xAdvance: placed.xAdvance ?? 0,
      xOffset: placed.xOffset ?? 0,
      yOffset: placed.yOffset ?? 0,
    });
  }
  return out;
}
