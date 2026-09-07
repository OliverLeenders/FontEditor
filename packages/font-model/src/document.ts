import type { Glyph } from "./glyph.js";
import { type Kerning, EMPTY_KERNING, renameGlyphInKerning } from "./kerning.js";

export type GlyphName = string;

/**
 * Anything a plist can hold, which is anything JSON can.
 *
 * Here so that what a font carries and this editor does not understand can be
 * carried anyway — through the model, through autosave, and back out to the
 * file it came from — without the model pretending to know what it means.
 */
export type PlainValue =
  string | number | boolean | null | readonly PlainValue[] | { readonly [key: string]: PlainValue };

/** How a family groups in the menus of software that predates typographic names. */
export type StyleMapStyle = "regular" | "italic" | "bold" | "bold italic";

/** The four of them, for anything that has to check a value it was handed. */
export const STYLE_MAP_STYLES: readonly StyleMapStyle[] = [
  "regular",
  "italic",
  "bold",
  "bold italic",
];

/**
 * The font's own measurements and identity.
 *
 * The measurements are what the editor draws guides from and what a compiler
 * writes into `head`, `hhea` and `OS/2`. The rest is what makes a file a
 * released font rather than a drawing: a version, who made it, what may be done
 * with it, and the three or four numbers by which an operating system decides
 * that this file is the bold of that one.
 *
 * Named as UFO names them, which is not an accident. These fields are read from
 * and written to a `fontinfo.plist`, and a second vocabulary in between would be
 * a translation table to maintain and a place for the two to disagree.
 *
 * Still not all of `fontinfo`, which runs to eighty-odd keys. What is missing is
 * carried verbatim instead — see `Kept`.
 */
export type FontInfo = {
  readonly familyName: string;
  readonly styleName: string;
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  readonly xHeight: number;
  readonly capHeight: number;

  /**
   * The version, as a major and a minor.
   *
   * Two numbers rather than a string because that is what `head.fontRevision`
   * is, and because "1.001" and "1.1" are the same version written two ways.
   */
  readonly versionMajor: number;
  readonly versionMinor: number;

  /** How far the letters lean, in degrees, counter-clockwise from upright. */
  readonly italicAngle: number;

  readonly copyright: string;
  readonly trademark: string;

  readonly openTypeNameDesigner: string;
  readonly openTypeNameDesignerURL: string;
  readonly openTypeNameManufacturer: string;
  readonly openTypeNameManufacturerURL: string;
  readonly openTypeNameLicense: string;
  readonly openTypeNameLicenseURL: string;
  readonly openTypeNameDescription: string;

  /** Four characters identifying whoever made the font, registered with MS. */
  readonly openTypeOS2VendorID: string;
  /** 100 to 1000: 400 is regular, 700 is bold. */
  readonly openTypeOS2WeightClass: number;
  /** 1 to 9: 5 is normal, 3 is condensed, 7 is expanded. */
  readonly openTypeOS2WidthClass: number;

  /**
   * The typographic family, for software that can group more than four styles.
   *
   * A family of Light, Regular, Medium and Black cannot be told in `familyName`
   * alone: the older scheme has four slots per family, so the file has to say
   * "Acme" here and "Acme Light" there, and applications that understand this
   * pair show one family with four members instead of two families with two.
   * Empty means the plain family name says everything.
   */
  readonly openTypeNamePreferredFamilyName: string;
  readonly openTypeNamePreferredSubfamilyName: string;

  /** The four-slot family this file belongs to, for software that only has four. */
  readonly styleMapFamilyName: string;
  readonly styleMapStyleName: StyleMapStyle;
};

export const DEFAULT_FONT_INFO: FontInfo = {
  familyName: "Untitled",
  styleName: "Regular",
  unitsPerEm: 1000,
  ascender: 750,
  descender: -250,
  xHeight: 500,
  capHeight: 700,

  versionMajor: 1,
  versionMinor: 0,
  italicAngle: 0,

  copyright: "",
  trademark: "",

  openTypeNameDesigner: "",
  openTypeNameDesignerURL: "",
  openTypeNameManufacturer: "",
  openTypeNameManufacturerURL: "",
  openTypeNameLicense: "",
  openTypeNameLicenseURL: "",
  openTypeNameDescription: "",

  openTypeOS2VendorID: "",
  openTypeOS2WeightClass: 400,
  openTypeOS2WidthClass: 5,

  openTypeNamePreferredFamilyName: "",
  openTypeNamePreferredSubfamilyName: "",

  styleMapFamilyName: "",
  styleMapStyleName: "regular",
};

/**
 * What the font carries that this editor does not understand.
 *
 * A UFO has eighty-odd `fontinfo` keys, a `lib` anybody may write into, and
 * conventions this editor has never heard of. The model holds what it can act
 * on; everything else would be discarded, and discarding it used to cost an
 * export and now costs somebody their source file, because saving writes over
 * the folder they opened.
 *
 * So the reader keeps what it could not place, as the values it found, and the
 * writer puts them back. The model does not interpret any of it — that is the
 * point. It is somebody's data passing through.
 */
export type Kept = {
  /** `fontinfo.plist` keys the model has no field for, by key. */
  readonly fontInfo: Readonly<Record<string, PlainValue>>;
  /** `lib.plist` keys other than the glyph order, which the model owns. */
  readonly lib: Readonly<Record<string, PlainValue>>;
};

export const NOTHING_KEPT: Kept = { fontInfo: {}, lib: {} };

/**
 * The part of the editor's state that history versions.
 *
 * Glyphs are held in a map keyed by name, with a separate ordering. That is
 * UFO's arrangement and it earns its keep twice over: lookup by name is what
 * components and the glyph strip need, and ordering is a property of the font
 * rather than of the glyphs, so renaming one does not disturb where it sits.
 *
 * Everything inside is undoable; everything outside — the camera, what is
 * hovered, a gesture in flight — is not.
 */
export type FontDocument = {
  readonly info: FontInfo;
  readonly glyphOrder: readonly GlyphName[];
  readonly glyphs: Readonly<Record<GlyphName, Glyph>>;
  /**
   * Kerning belongs to the font, not to a glyph.
   *
   * A pair is a relationship between two of them, so storing it on either would
   * make one glyph's file the owner of a fact about another — and moving or
   * deleting that glyph would take the pair with it.
   */
  readonly kerning: Kerning;
  /**
   * OpenType feature source, as `.fea` text.
   *
   * Kept as text rather than as a parsed structure, and deliberately. It is what
   * a designer writes, what UFO stores, and what every other tool exchanges;
   * parsing it into a model of its own would mean choosing which of the
   * language's many constructs the model can hold, and quietly discarding the
   * rest of somebody's file on the way in.
   */
  readonly features: string;
  /**
   * What the font it was read from carried that this editor cannot model.
   *
   * Undoable along with everything else here, which is right: it is written
   * back out on save, so it is part of what the document *is* rather than a
   * note about where it came from.
   */
  readonly kept: Kept;
};

export function fontDocument(
  glyphs: readonly Glyph[] = [],
  info: FontInfo = DEFAULT_FONT_INFO,
): FontDocument {
  const map: Record<GlyphName, Glyph> = {};
  const order: GlyphName[] = [];
  for (const g of glyphs) {
    if (!(g.name in map)) order.push(g.name);
    map[g.name] = g;
  }
  return {
    info,
    glyphOrder: order,
    glyphs: map,
    kerning: EMPTY_KERNING,
    features: "",
    kept: NOTHING_KEPT,
  };
}

export function glyphNamed(document: FontDocument, name: GlyphName): Glyph | null {
  return document.glyphs[name] ?? null;
}

export function glyphCount(document: FontDocument): number {
  return document.glyphOrder.length;
}

/** Every glyph in font order. Order is the font's, not the map's. */
export function orderedGlyphs(document: FontDocument): Glyph[] {
  const out: Glyph[] = [];
  for (const name of document.glyphOrder) {
    const g = document.glyphs[name];
    if (g !== undefined) out.push(g);
  }
  return out;
}

/**
 * Add a glyph, or replace one of the same name in place.
 *
 * Returns the same document when the glyph is already there and unchanged —
 * reference equality, which is what lets the history and autosave layers tell
 * "nothing happened" from "something did" without any bookkeeping.
 */
export function putGlyph(document: FontDocument, glyph: Glyph): FontDocument {
  if (document.glyphs[glyph.name] === glyph) return document;

  const glyphs = { ...document.glyphs, [glyph.name]: glyph };
  const glyphOrder =
    glyph.name in document.glyphs ? document.glyphOrder : [...document.glyphOrder, glyph.name];
  return { ...document, glyphOrder, glyphs };
}

/**
 * Why a glyph cannot be deleted, or `null` when it can.
 *
 * `.notdef` is kept for the reason it cannot be renamed: a font is required to
 * have one, and the writer finds it by name. Deleting it is recoverable — the
 * export synthesises a blank in its place — but what it recovers is a blank, so
 * whatever was drawn is gone and nothing said so.
 */
export function deleteProblem(
  document: FontDocument,
  name: GlyphName,
): "missing" | "reserved" | null {
  if (!(name in document.glyphs)) return "missing";
  return name === NOTDEF ? "reserved" : null;
}

export function removeGlyph(document: FontDocument, name: GlyphName): FontDocument | null {
  if (deleteProblem(document, name) !== null) return null;
  const glyphs = { ...document.glyphs };
  delete glyphs[name];
  return {
    ...document,
    glyphOrder: document.glyphOrder.filter((candidate) => candidate !== name),
    glyphs,
  };
}

/**
 * Apply a pure edit to one glyph by name.
 *
 * `null` from the operation means it declined, and that propagates — a failed
 * edit never half-applies.
 */
export function updateGlyph(
  document: FontDocument,
  name: GlyphName,
  operation: (glyph: Glyph) => Glyph | null,
): FontDocument | null {
  const existing = document.glyphs[name];
  if (existing === undefined) return null;
  const next = operation(existing);
  if (next === null) return null;
  return putGlyph(document, next);
}

export function setFontInfo(document: FontDocument, info: FontInfo): FontDocument {
  return { ...document, info };
}

export function setGlyphOrder(
  document: FontDocument,
  glyphOrder: readonly GlyphName[],
): FontDocument {
  return { ...document, glyphOrder };
}

// ---------------------------------------------------------------------------
// character lookup
// ---------------------------------------------------------------------------

/**
 * Every code point the font covers, for one document.
 *
 * Keyed on the document object itself, which is what makes an index safe here:
 * the model is persistent, so a document that has changed at all is a different
 * object and gets a different map. There is no invalidation to get wrong, and a
 * document nobody holds any more takes its map with it.
 */
const cmaps = new WeakMap<FontDocument, Map<number, Glyph>>();

function cmap(document: FontDocument): Map<number, Glyph> {
  const known = cmaps.get(document);
  if (known !== undefined) return known;

  const built = new Map<number, Glyph>();
  for (const name of document.glyphOrder) {
    const g = document.glyphs[name];
    if (g === undefined) continue;
    // First in the glyph order wins, which is what the scan this replaced did.
    for (const codePoint of g.unicodes) if (!built.has(codePoint)) built.set(codePoint, g);
  }
  cmaps.set(document, built);
  return built;
}

/**
 * The glyph carrying a given code point, or `null`.
 *
 * Named for what it takes. It was `glyphForCharacter`, which reads as though a
 * string would do and cost one failing test before anyone noticed.
 *
 * This was a scan, on the grounds that the map is small and an index is one more
 * thing that can fall out of step. It became the hot path anyway: the strip
 * resolves its text on every pointer move of a drag, and the proof resolves a
 * paragraph, so a real font ran a linear search per character per frame. The
 * index above is what answers it now.
 */
export function glyphForCodePoint(document: FontDocument, codePoint: number): Glyph | null {
  return cmap(document).get(codePoint) ?? null;
}

/**
 * Resolve a string to glyphs, one entry per character, `null` where the font has
 * nothing for it.
 *
 * Iterating the string directly rather than by index so astral characters —
 * anything above U+FFFF, which is two UTF-16 units — resolve as one character
 * instead of two broken halves.
 */
export function glyphsForString(document: FontDocument, text: string): Array<Glyph | null> {
  const out: Array<Glyph | null> = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    out.push(codePoint === undefined ? null : glyphForCodePoint(document, codePoint));
  }
  return out;
}

/** Replace the font's feature source, leaving everything else alone. */
export function setFeatures(document: FontDocument, features: string): FontDocument {
  return document.features === features ? document : { ...document, features };
}

/** Replace what the font carries that this editor does not model. */
export function setKept(document: FontDocument, kept: Kept): FontDocument {
  return document.kept === kept ? document : { ...document, kept };
}

/** Replace the font's kerning, leaving the glyphs alone. */
export function setKerning(document: FontDocument, kerning: Kerning): FontDocument {
  return kerning === document.kerning ? document : { ...document, kerning };
}

/**
 * Why a rename was refused, or `null` when it would go through.
 *
 * Separate from the rename itself so an interface can say what is wrong while
 * someone is still typing, rather than only when they commit.
 */
export type RenameProblem = "missing" | "empty" | "taken" | "reserved";

/**
 * The one glyph a font is required to have, and which is found by name.
 *
 * The OTF writer puts it at glyph id zero by looking it up as `.notdef` — a
 * renamed one is not found, and the export quietly synthesises a blank in its
 * place, throwing away whatever was drawn. So the name is not the user's to
 * change, and saying so is better than letting it be changed and lost.
 */
export const NOTDEF = ".notdef";

export function renameProblem(
  document: FontDocument,
  from: GlyphName,
  to: GlyphName,
): RenameProblem | null {
  if (!(from in document.glyphs)) return "missing";
  if (to === from) return null;
  if (from === NOTDEF) return "reserved";
  if (to.trim() === "") return "empty";
  if (to in document.glyphs) return "taken";
  return null;
}

/**
 * Rename a glyph, and everything that refers to it by that name.
 *
 * A glyph name is not a label, it is a reference, and it is held in four places:
 * the map it is keyed by, the order it appears in, the `base` of every component
 * that places it, and the kerning — where it appears both as a pair's side and
 * as a member of any group. A rename that fixes only the first two leaves
 * composites pointing at a glyph that no longer exists and kerning that silently
 * stops applying, neither of which shows up until much later.
 *
 * The position in `glyphOrder` is kept. The order is the font's own, someone
 * arranged it, and a rename is not a reordering.
 *
 * `null` when the rename cannot be made — see {@link renameProblem} for which of
 * the reasons it was.
 */
export function renameGlyph(
  document: FontDocument,
  from: GlyphName,
  to: GlyphName,
): FontDocument | null {
  if (renameProblem(document, from, to) !== null) return null;
  if (from === to) return document;

  const moved = document.glyphs[from];
  if (moved === undefined) return null;

  const glyphs: Record<GlyphName, Glyph> = {};
  for (const [name, g] of Object.entries(document.glyphs)) {
    const renamed = name === from ? { ...g, name: to } : g;
    // Every glyph is walked, not just the one moving: any of them may place the
    // renamed glyph as a component, and one that does has to be rewritten too.
    glyphs[name === from ? to : name] = withComponentBase(renamed, from, to);
  }

  return {
    ...document,
    glyphs,
    glyphOrder: document.glyphOrder.map((name) => (name === from ? to : name)),
    kerning: renameGlyphInKerning(document.kerning, from, to),
  };
}

/** Point a glyph's components at a renamed base, leaving it alone if none do. */
function withComponentBase(g: Glyph, from: GlyphName, to: GlyphName): Glyph {
  if (!g.components.some((c) => c.base === from)) return g;
  return {
    ...g,
    components: g.components.map((c) => (c.base === from ? { ...c, base: to } : c)),
  };
}
