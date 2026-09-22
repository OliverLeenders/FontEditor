/**
 * Classic Macintosh bitmap fonts: `FOND` families and the `NFNT` strikes they
 * name, turned into a font you can draw in.
 *
 * A bitmap strike is one resource holding one picture. Every glyph in the font
 * sits side by side in a single row of pixels as wide as the whole alphabet,
 * and two tables say where each one starts and how far the pen moves after it.
 * That is the entire format: no curves, no sidebearings as such, no names. It
 * was designed to be blitted at one size on a screen that had one size.
 *
 * Turning it into an outline font is a conversion and not a reading, so it is
 * worth being plain about what is chosen here. Each lit pixel becomes a square,
 * squares that touch become one contour, and the strike's own ascent and
 * descent become the em. What comes out is what the screen showed, at a size
 * you can edit — the staircase is the design, not an artefact, and smoothing it
 * would be inventing a font the original never was.
 *
 * `sfnt` resources — a suitcase holding a real TrueType font rather than a
 * bitmap one — are recognised and handed back whole, for the binary importer to
 * read. Nothing about them is this file's business beyond finding them.
 */

import {
  type ContourId,
  type FontDocument,
  type FontInfo,
  type Glyph,
  type IdFactory,
  type Contour,
  DEFAULT_FONT_INFO,
  contour,
  correctDirections,
  fontDocument,
  glyph,
  glyphNameForCodePoint,
  node,
} from "@typewright/font-model";
import type { Resource, ResourceFork } from "@typewright/stuffit";
import {
  looksLikeStuffIt,
  readArchive,
  readResourceFork,
  resourcesOfType,
  unpackFork,
} from "@typewright/stuffit";

import { macRomanCodePoint } from "./mac-roman.js";

/**
 * How many design units one pixel becomes.
 *
 * A hundred, so that the em works out at a round number for any strike — a ten
 * pixel font becomes a 1000-unit em, a twelve pixel one 1200 — and every
 * coordinate in the font lands on an integer. Scaling to a fixed 1000 instead
 * would put most strikes on fractional coordinates for no gain: this is a font
 * whose whole content is a grid, and the grid is worth keeping exact.
 */
const PIXEL = 100;

export type MacGlyph = {
  /** Where the character sits in the font's own encoding. */
  readonly code: number;
  /** Where its picture starts in the strike's one long row of pixels. */
  readonly x: number;
  /** How wide that picture is. */
  readonly pixels: number;
  /** Where the picture goes relative to the pen, before the font's kernMax. */
  readonly offset: number;
  /** How far the pen moves afterwards. */
  readonly width: number;
  /** A character the font does not have, which is drawn as the missing glyph. */
  readonly missing: boolean;
};

export type MacStrike = {
  readonly fontType: number;
  readonly firstChar: number;
  readonly lastChar: number;
  readonly widMax: number;
  readonly kernMax: number;
  readonly rectWidth: number;
  readonly rectHeight: number;
  readonly ascent: number;
  readonly descent: number;
  readonly leading: number;
  readonly rowBytes: number;
  readonly image: Uint8Array;
  readonly glyphs: readonly MacGlyph[];
  /**
   * The picture drawn for a character the font has not got, which every strike
   * carries after its last one.
   */
  readonly notdef: MacGlyph | null;
  /** Whether a pixel of the strike's one big picture is lit. */
  lit(x: number, y: number): boolean;
};

export type MacFamily = {
  readonly familyId: number;
  readonly name: string;
  /** Which strike resource holds which size and style. */
  readonly association: readonly { size: number; style: number; resourceId: number }[];
};

/**
 * Read one `NFNT` or `FONT` resource.
 *
 * The one field worth explaining is `owTLoc`, the offset of the width table,
 * which is counted in *words from the field itself* rather than from the start
 * of the resource. That is how a font could be edited in place without
 * rewriting what came before it.
 */
export function readStrike(bytes: Uint8Array): MacStrike {
  if (bytes.length < 26) throw new Error("a bitmap strike is shorter than its header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const fontType = view.getUint16(0);
  const depth = (fontType >> 2) & 0x03;
  if (depth !== 0) {
    throw new Error(`this strike has ${String(1 << depth)} bits per pixel, and only 1 is read`);
  }

  const firstChar = view.getUint16(2);
  const lastChar = view.getUint16(4);
  const rectHeight = view.getInt16(14);
  const rowBytes = view.getUint16(24) * 2;

  const imageAt = 26;
  const imageLength = rowBytes * rectHeight;
  const image = bytes.subarray(imageAt, imageAt + imageLength);

  const locationsAt = imageAt + imageLength;
  const widthsAt = 16 + view.getUint16(16) * 2;
  // One entry per character, plus one for the missing glyph, plus one more
  // because the location table is read in pairs.
  const count = lastChar - firstChar + 3;
  if (widthsAt + (count - 1) * 2 > bytes.length) {
    throw new Error("the strike's width table is past the end of the resource");
  }

  // One entry per character, and then the missing glyph.
  const entries: MacGlyph[] = [];
  for (let i = 0; i < count - 1; i++) {
    const from = view.getUint16(locationsAt + i * 2);
    const to = view.getUint16(locationsAt + (i + 1) * 2);
    entries.push({
      code: firstChar + i,
      x: from,
      pixels: to - from,
      offset: view.getInt8(widthsAt + i * 2),
      width: bytes[widthsAt + i * 2 + 1] ?? 0,
      // -1 in both bytes at once is the table saying there is no such glyph.
      missing: view.getInt16(widthsAt + i * 2) === -1,
    });
  }

  return {
    fontType,
    firstChar,
    lastChar,
    widMax: view.getInt16(6),
    kernMax: view.getInt16(8),
    rectWidth: view.getInt16(12),
    rectHeight,
    ascent: view.getInt16(18),
    descent: view.getInt16(20),
    leading: view.getInt16(22),
    rowBytes,
    image,
    glyphs: entries.slice(0, lastChar - firstChar + 1),
    notdef: entries[lastChar - firstChar + 1] ?? null,
    lit(x: number, y: number): boolean {
      if (y < 0 || y >= rectHeight) return false;
      const byte = image[y * rowBytes + (x >> 3)];
      if (byte === undefined) return false;
      return ((byte >> (7 - (x & 7))) & 1) === 1;
    },
  };
}

/** Read one `FOND` resource: the family, and which strike is which size. */
export function readMacFamily(resource: Resource): MacFamily {
  const bytes = resource.bytes;
  if (bytes.length < 54) throw new Error("a font family is shorter than its header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const count = view.getInt16(52) + 1;
  const association: { size: number; style: number; resourceId: number }[] = [];
  for (let i = 0; i < count; i++) {
    const at = 54 + i * 6;
    if (at + 6 > bytes.length) break;
    association.push({
      size: view.getInt16(at),
      style: view.getInt16(at + 2),
      resourceId: view.getInt16(at + 4),
    });
  }

  return { familyId: view.getInt16(2), name: resource.name, association };
}

export type Suitcase = {
  readonly families: readonly MacFamily[];
  /** Every bitmap strike in the file, by the resource id a family names. */
  readonly strikes: ReadonlyMap<number, MacStrike>;
  /** Whole TrueType fonts, if the suitcase holds those instead. */
  readonly sfnts: readonly Uint8Array[];
  readonly warnings: readonly string[];
};

/** Everything font-shaped in a resource fork. */
export function readSuitcase(fork: ResourceFork): Suitcase {
  const warnings: string[] = [];
  const families: MacFamily[] = [];
  const strikes = new Map<number, MacStrike>();

  for (const resource of resourcesOfType(fork, "FOND")) {
    try {
      families.push(readMacFamily(resource));
    } catch (error) {
      warnings.push(`family ${String(resource.id)}: ${reasonOf(error)}`);
    }
  }

  for (const resource of [...resourcesOfType(fork, "NFNT"), ...resourcesOfType(fork, "FONT")]) {
    // A `FONT` resource whose id is a multiple of 128 is a family name holder
    // rather than a strike, and holds nothing readable as one.
    if (resource.type === "FONT" && resource.id % 128 === 0) continue;
    try {
      strikes.set(resource.id, readStrike(resource.bytes));
    } catch (error) {
      warnings.push(`strike ${String(resource.id)}: ${reasonOf(error)}`);
    }
  }

  const sfnts = resourcesOfType(fork, "sfnt").map((r) => r.bytes);
  return { families, strikes, sfnts, warnings };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The strike to open, when a suitcase holds several.
 *
 * The largest, because a bitmap font's detail is its size: a 24 pixel strike
 * traced into outlines is a drawing somebody can work on, and a 9 pixel one is
 * a thumbnail of it. Ties go to the first, which is the order the family listed
 * them in.
 */
export function largestStrike(suitcase: Suitcase): { id: number; strike: MacStrike } | null {
  let best: { id: number; strike: MacStrike } | null = null;
  for (const [id, strike] of suitcase.strikes) {
    const height = strike.ascent + strike.descent;
    if (best === null || height > best.strike.ascent + best.strike.descent) best = { id, strike };
  }
  return best;
}

export type MacImportResult = {
  readonly document: FontDocument;
  readonly warnings: readonly string[];
};

export type MacImportOptions = {
  /** What to call the family, when the resources do not say. */
  readonly familyName?: string;
  /** Which strike to read, by resource id. The largest, left out. */
  readonly strikeId?: number;
};

/**
 * Build a font document from a suitcase's bitmap strike.
 *
 * Widths come from the strike, which knows them exactly; sidebearings fall out
 * of where the picture sits against the pen, which is the same thing said
 * twice. What cannot come from the strike is anything about design — there is
 * no x-height or cap height in the resource, so those are measured off the
 * glyphs that define them and left at the default if the font has not got them.
 */
export function documentFromSuitcase(
  suitcase: Suitcase,
  ids: IdFactory,
  options: MacImportOptions = {},
): MacImportResult {
  const warnings = [...suitcase.warnings];

  const chosen =
    options.strikeId === undefined
      ? largestStrike(suitcase)
      : { id: options.strikeId, strike: suitcase.strikes.get(options.strikeId) ?? null };
  if (chosen === null || chosen.strike === null) {
    throw new Error("this suitcase holds no bitmap strike");
  }
  const strike = chosen.strike;

  const family = suitcase.families.find((f) =>
    f.association.some((a) => a.resourceId === chosen.id),
  );
  const size = family?.association.find((a) => a.resourceId === chosen.id)?.size;
  const familyName = options.familyName ?? family?.name ?? "Untitled";

  // A strike is entitled to be damaged, and an em of nothing would divide the
  // whole font by zero. Where the ascent and descent say nothing usable, the
  // picture's own height is the one measurement that cannot be wrong.
  const sane = strike.ascent + strike.descent > 0;
  const ascent = sane ? strike.ascent : strike.rectHeight;
  const descent = sane ? strike.descent : 0;
  if (ascent + descent <= 0) throw new Error("this strike has no height to scale by");

  const notdef =
    strike.notdef === null || strike.notdef.missing
      ? glyph(".notdef", { advance: strike.widMax * PIXEL })
      : glyph(".notdef", {
          advance: strike.notdef.width * PIXEL,
          contours: correctDirections(traceGlyph(strike, strike.notdef, ids, ascent)),
        });

  const glyphs: Glyph[] = [notdef];
  const taken = new Set<string>([".notdef"]);

  for (const g of strike.glyphs) {
    if (g.missing) continue;
    const codePoint = macRomanCodePoint(g.code);
    const name = uniqueName(glyphNameForCodePoint(codePoint), taken);
    taken.add(name);

    glyphs.push(
      glyph(name, {
        unicodes: [codePoint],
        advance: g.width * PIXEL,
        contours: correctDirections(traceGlyph(strike, g, ids, ascent)),
      }),
    );
  }

  const info: FontInfo = {
    ...DEFAULT_FONT_INFO,
    familyName,
    styleName: size === undefined ? "Regular" : `${String(size)} px`,
    unitsPerEm: (ascent + descent) * PIXEL,
    ascender: ascent * PIXEL,
    descender: -descent * PIXEL,
    xHeight: heightOf(glyphs, "x") ?? DEFAULT_FONT_INFO.xHeight,
    capHeight: heightOf(glyphs, "H") ?? DEFAULT_FONT_INFO.capHeight,
    openTypeNameDescription:
      size === undefined
        ? "Converted from a Macintosh bitmap font."
        : `Converted from a ${String(size)} pixel Macintosh bitmap font.`,
  };

  if (strike.leading !== 0) {
    warnings.push(`the strike asks for ${String(strike.leading)} pixels of leading`);
  }

  return { document: fontDocument(glyphs, info), warnings };
}

function uniqueName(preferred: string, taken: ReadonlySet<string>): string {
  if (!taken.has(preferred)) return preferred;
  let n = 2;
  while (taken.has(`${preferred}.${String(n)}`)) n++;
  return `${preferred}.${String(n)}`;
}

/** How tall a named glyph is, for the metrics the strike does not carry. */
function heightOf(glyphs: readonly Glyph[], name: string): number | null {
  const found = glyphs.find((g) => g.name === name);
  if (found === undefined) return null;
  let top: number | null = null;
  for (const c of found.contours) {
    for (const n of c.nodes) if (top === null || n.pt.y > top) top = n.pt.y;
  }
  return top;
}

/** One glyph's pixels, as contours in design units. */
function traceGlyph(
  strike: MacStrike,
  g: MacGlyph,
  ids: IdFactory,
  ascent: number,
): readonly Contour[] {
  const filled = (x: number, y: number): boolean =>
    x >= 0 && x < g.pixels && strike.lit(g.x + x, y);

  // Where the picture goes relative to the pen: the font's kernMax is the
  // furthest any glyph reaches left of its origin, and each glyph's own offset
  // is measured from there.
  const left = (strike.kernMax + g.offset) * PIXEL;
  const top = ascent * PIXEL;

  return traceGrid(filled, g.pixels, strike.rectHeight, ids, (x, y) => ({
    x: left + x * PIXEL,
    y: top - y * PIXEL,
  }));
}

type Corner = { readonly x: number; readonly y: number };

/**
 * Trace a grid of lit cells into closed contours.
 *
 * Every boundary between a lit cell and an unlit one is one edge of the
 * outline, pointed so that the ink is on its left. Those edges meet end to end,
 * so following them from any starting edge walks a closed loop, and the loops
 * that come out are the shapes: the outside of a blob anticlockwise, the inside
 * of a hole clockwise, which is exactly the convention the font wants.
 *
 * The only decision is at a vertex where two pixels touch corner to corner and
 * four edges meet: does the outline stay with the pixel it is on, or cross to
 * the one diagonally beyond it? It stays. Crossing would join a diagonal
 * staircase into one contour, which reads better in an editor, but it also
 * joins a counter to the outside wherever the counter's corner touches the
 * stem's — and then the counter is not a hole any more and the letter fills in
 * solid. A pixel `A` is exactly that shape. So: more contours, and every one of
 * them the shape the screen showed.
 */
function traceGrid(
  filled: (x: number, y: number) => boolean,
  width: number,
  height: number,
  ids: IdFactory,
  place: (x: number, y: number) => { x: number; y: number },
): readonly Contour[] {
  // Edges leaving each corner of the grid, keyed by corner. In grid space x
  // grows right and y grows *down*, the way the pixels are stored; `place`
  // turns that into design space at the end.
  const leaving = new Map<number, Corner[]>();
  const key = (x: number, y: number): number => y * (width + 2) + x;

  const edge = (from: Corner, to: Corner): void => {
    const at = key(from.x, from.y);
    const list = leaving.get(at);
    if (list === undefined) leaving.set(at, [to]);
    else list.push(to);
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!filled(x, y)) continue;
      // Each edge runs with the ink on its left, in a coordinate system where
      // y grows downward — so the directions look mirrored from the usual.
      if (!filled(x, y - 1)) edge({ x, y }, { x: x + 1, y });
      if (!filled(x + 1, y)) edge({ x: x + 1, y }, { x: x + 1, y: y + 1 });
      if (!filled(x, y + 1)) edge({ x: x + 1, y: y + 1 }, { x, y: y + 1 });
      if (!filled(x - 1, y)) edge({ x, y: y + 1 }, { x, y });
    }
  }

  const contours: Contour[] = [];
  for (const [start, first] of leaving) {
    while (first.length > 0) {
      const loop = walk(start, leaving, key);
      if (loop.length >= 4) contours.push(contourOf(loop, ids.contour(), ids, place));
    }
  }
  return contours;
}

/** Follow edges from one corner until the loop closes, using each once. */
function walk(
  start: number,
  leaving: Map<number, Corner[]>,
  key: (x: number, y: number) => number,
): Corner[] {
  const loop: Corner[] = [];
  let at = start;
  let came: Corner | null = null;

  for (;;) {
    const outgoing = leaving.get(at);
    if (outgoing === undefined || outgoing.length === 0) break;

    const here = cornerOf(at, key);
    const next = came === null ? outgoing[0]! : staying(here, came, outgoing);
    outgoing.splice(outgoing.indexOf(next), 1);

    loop.push(here);
    came = here;
    at = key(next.x, next.y);
    if (at === start) break;
  }
  return loop;
}

/**
 * Of the edges leaving a corner, the one that turns back most sharply — which
 * is the one that keeps to the pixel the outline is already tracing rather than
 * crossing to the one beyond the corner.
 */
function staying(here: Corner, came: Corner, outgoing: readonly Corner[]): Corner {
  const inX = here.x - came.x;
  const inY = here.y - came.y;
  let best = outgoing[0]!;
  let bestTurn = -Infinity;
  for (const to of outgoing) {
    const outX = to.x - here.x;
    const outY = to.y - here.y;
    // Cross product first: which side the turn is on. Dot product breaks the
    // tie between going straight on and doubling back.
    const cross = inX * outY - inY * outX;
    const dot = inX * outX + inY * outY;
    const turn = cross !== 0 ? cross * 2 : dot > 0 ? 1 : -3;
    if (turn > bestTurn) {
      bestTurn = turn;
      best = to;
    }
  }
  return best;
}

function cornerOf(at: number, key: (x: number, y: number) => number): Corner {
  const stride = key(0, 1);
  return { x: at % stride, y: Math.floor(at / stride) };
}

/** A loop of grid corners as a contour, with the corners on straight runs dropped. */
function contourOf(
  loop: readonly Corner[],
  id: ContourId,
  ids: IdFactory,
  place: (x: number, y: number) => { x: number; y: number },
): Contour {
  const kept: Corner[] = [];
  for (let i = 0; i < loop.length; i++) {
    const before = loop[(i + loop.length - 1) % loop.length]!;
    const here = loop[i]!;
    const after = loop[(i + 1) % loop.length]!;
    const turns =
      (here.x - before.x) * (after.y - here.y) !== (here.y - before.y) * (after.x - here.x);
    if (turns) kept.push(here);
  }

  return contour(
    id,
    kept.map((c) => node(ids.node(), place(c.x, c.y))),
    true,
  );
}

export type MacFontFile =
  | {
      readonly kind: "bitmap";
      readonly document: FontDocument;
      readonly warnings: readonly string[];
    }
  /** A suitcase holding a real outline font, for the binary importer to read. */
  | { readonly kind: "sfnt"; readonly bytes: Uint8Array };

/** Whether this file is a StuffIt archive, and so possibly a Mac font in one. */
export function looksLikeMacFontFile(bytes: Uint8Array): boolean {
  return looksLikeStuffIt(bytes);
}

/**
 * Read a font out of a StuffIt archive.
 *
 * An archive is not a font and holds whatever somebody put in it — a read-me,
 * an icon, a folder, and somewhere among them the suitcase. So every entry with
 * a resource fork is opened and asked whether it is a font, and the first one
 * that is becomes the answer. Entries that turn out to be something else are
 * not errors; they are what an archive is.
 *
 * An outline font in a suitcase is handed back as bytes rather than read here.
 * That is a TrueType file in a Macintosh wrapper, and it wants the font parser,
 * which this package keeps in an entry point of its own.
 */
export function importMacFont(
  bytes: Uint8Array,
  ids: IdFactory,
  options: MacImportOptions = {},
): MacFontFile {
  const archive = readArchive(bytes);
  const warnings: string[] = [];

  for (const entry of archive.entries) {
    if (entry.resource === null || entry.resource.length === 0) continue;

    let suitcase: Suitcase;
    try {
      suitcase = readSuitcase(readResourceFork(unpackFork(bytes, entry.resource)));
    } catch (error) {
      // An icon or a read-me that cannot be read as a font is the normal case
      // and is not worth saying; one that cannot be *unpacked* might explain a
      // missing font, so it is kept for the report if nothing works out.
      warnings.push(`${entry.path}: ${reasonOf(error)}`);
      continue;
    }

    const sfnt = suitcase.sfnts[0];
    if (sfnt !== undefined) return { kind: "sfnt", bytes: sfnt };
    if (suitcase.strikes.size === 0) continue;

    const read = documentFromSuitcase(suitcase, ids, {
      ...options,
      // The archive's own name for the file is a better family name than the
      // one inside it, which is often empty.
      familyName: options.familyName ?? nameOf(entry.name),
    });
    return { kind: "bitmap", document: read.document, warnings: read.warnings };
  }

  throw new Error(
    warnings.length === 0
      ? "this StuffIt archive holds no font"
      : `this StuffIt archive holds no font that could be read (${warnings.join("; ")})`,
  );
}

/** A file name as a family name: the suffix, if it has one, is not part of it. */
function nameOf(fileName: string): string {
  return fileName.replace(/\.(sit|suit|dfont|bin)$/i, "").trim();
}
