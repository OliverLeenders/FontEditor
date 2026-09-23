import { type FontDocument, type TextToken, glyphForToken } from "@typewright/font-model";
import { NAMED_GLYPH_BASE, exportShapingFont } from "@typewright/font-io/binary";
import { type Engine, type EngineGlyph, type TextSettings, READ_FROM_TEXT } from "@typewright/view";
import bidiFactory from "bidi-js";
import { Blob, Buffer, Direction, Face, Feature, Font, shape } from "harfbuzzjs";

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
 * Text that runs right to left is ordered here as well. A shaper sets a run of
 * one direction; deciding which runs a line has, and in what order they are
 * drawn, is the Unicode bidirectional algorithm's job, and `bidi-js` is a
 * published implementation of it. So a line is cut into runs, each is shaped
 * with its own direction, and what comes back out is the glyphs in the order
 * they are drawn — left to right, whatever the text does — which is what every
 * caller already expects.
 *
 * A package of its own because HarfBuzz is half a megabyte of WebAssembly the
 * editor does not need until text is set: the editor imports this when it is,
 * and uses the in-house shaper until it has.
 */

const bidi = bidiFactory();

/**
 * How a line is set beyond its text belongs to the view, since the views are
 * what choose it; it is re-exported here, where it is acted on.
 */
export type { TextDirection, TextSettings } from "@typewright/view";
export { READ_FROM_TEXT } from "@typewright/view";

/** A document's shaping font, open in HarfBuzz, and what its glyph ids mean. */
type Compiled = {
  readonly font: Font;
  readonly ids: ReadonlyMap<string, number>;
  readonly names: readonly string[];
};

/** A stretch of one direction, as offsets into the line's text. */
type Run = { readonly start: number; readonly end: number; readonly level: number };

/**
 * One engine per document, per settings.
 *
 * The document is a new value after every edit, so an engine never outlives the
 * font it was compiled from, and there is nothing to invalidate. HarfBuzz's own
 * objects are freed by the library when the engine holding them is collected.
 * The settings are keyed within it so that changing the script does not throw
 * away a compiled font, and so a view that re-renders gets the same engine back.
 */
const engines = new WeakMap<FontDocument, Map<string, Engine>>();

const keyOf = (settings: TextSettings): string =>
  `${settings.direction}|${settings.script ?? ""}|${settings.language ?? ""}|${featuresKey(
    settings,
  )}`;

/** The switched features, in a settled order, so one engine is kept per set. */
const featuresKey = (settings: TextSettings): string =>
  Object.entries(settings.features)
    .map(([tag, on]) => `${tag}=${on ? "1" : "0"}`)
    .sort()
    .join(",");

/**
 * The engine that sets a document's text.
 *
 * The font is compiled the first time text is set with it rather than here, so
 * a document that is only ever passed through costs nothing. `null` from the
 * engine where the font could not be compiled or opened, and the caller sets
 * the line the other way.
 */
export function harfBuzzEngine(
  document: FontDocument,
  settings: TextSettings = READ_FROM_TEXT,
): Engine {
  let known = engines.get(document);
  if (known === undefined) {
    known = new Map<string, Engine>();
    engines.set(document, known);
  }
  const key = keyOf(settings);
  const found = known.get(key);
  if (found !== undefined) return found;

  let compiled: Compiled | null | undefined;
  const engine: Engine = (tokens) => {
    if (compiled === undefined) compiled = compile(document);
    return compiled === null ? null : setText(compiled, document, tokens, settings);
  };

  known.set(key, engine);
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
 * The glyphs HarfBuzz sets for a line, in design units and in drawing order.
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
  settings: TextSettings,
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

  const text = codePoints.map((code) => String.fromCodePoint(code)).join("");
  const levels = bidi.getEmbeddingLevels(
    text,
    settings.direction === "auto" ? undefined : settings.direction,
  );
  // Brackets and quotes face the other way inside right-to-left text, and
  // HarfBuzz makes that swap itself for a run it has been told runs right to
  // left. Making it here as well would turn every bracket back as it went in.
  const out: EngineGlyph[] = [];
  for (const run of drawingOrder(runsOf(levels.levels))) {
    const piece = text.slice(run.start, run.end);
    const buffer = new Buffer();
    buffer.addText(piece);
    // Script and language from the text first, so that what is not chosen is
    // still read rather than left at HarfBuzz's invalid default.
    buffer.guessSegmentProperties();
    buffer.setDirection(run.level % 2 === 1 ? Direction.RTL : Direction.LTR);
    if (settings.script !== null) buffer.setScript(settings.script);
    if (settings.language !== null) buffer.setLanguage(settings.language);
    // Only what has been switched by hand. HarfBuzz turns the usual features on
    // for itself, and a list that repeated them would be saying the same thing
    // twice — while a tag with a value of zero is the only way to say no to one.
    shape(compiled.font, buffer, chosenFeatures(settings));

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
  }
  return out;
}

/** The features switched by hand, as HarfBuzz wants them. */
function chosenFeatures(settings: TextSettings): Feature[] {
  return Object.entries(settings.features).map(([tag, on]) => new Feature(tag, on ? 1 : 0));
}

/** The line cut where its embedding level changes, in the order it was written. */
function runsOf(levels: Uint8Array): Run[] {
  const runs: Run[] = [];
  let start = 0;
  for (let at = 1; at <= levels.length; at += 1) {
    if (at < levels.length && levels[at] === levels[start]) continue;
    runs.push({ start, end: at, level: levels[start] ?? 0 });
    start = at;
  }
  return runs;
}

/**
 * The runs in the order they are drawn, left to right.
 *
 * Rule L2 of the algorithm: from the deepest level down to the lowest odd one,
 * every stretch of runs at least that deep is reversed. A line of one direction
 * comes back as it went in; an Arabic line with an English phrase in it comes
 * back with the phrase in the middle, reading the way each of them reads.
 */
function drawingOrder(runs: readonly Run[]): Run[] {
  let deepest = 0;
  let lowestOdd = Number.MAX_SAFE_INTEGER;
  for (const run of runs) {
    deepest = Math.max(deepest, run.level);
    if (run.level % 2 === 1) lowestOdd = Math.min(lowestOdd, run.level);
  }
  if (lowestOdd === Number.MAX_SAFE_INTEGER) return [...runs];

  const out = [...runs];
  for (let level = deepest; level >= lowestOdd; level -= 1) {
    for (let from = 0; from < out.length; from += 1) {
      if (out[from]!.level < level) continue;
      let to = from;
      while (to + 1 < out.length && out[to + 1]!.level >= level) to += 1;
      for (let a = from, b = to; a < b; a += 1, b -= 1) {
        const held = out[a]!;
        out[a] = out[b]!;
        out[b] = held;
      }
      from = to;
    }
  }
  return out;
}
