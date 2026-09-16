import {
  type FontDocument,
  type FontInfo,
  type Glyph,
  type IdFactory,
  type Guide,
  type Kerning,
  type PlainValue,
  type StyleMapStyle,
  DEFAULT_FONT_INFO,
  EMPTY_KERNING,
  fontDocument,
  hasMetricKeys,
  groupKey,
  guide,
  setFeatures,
  setKern,
  setKernGroup,
  setGuides,
  setKept,
  setKerning,
  STYLE_MAP_STYLES,
} from "@typewright/font-model";

import { embeddingBits } from "./embedding.js";
import { parseGlif } from "./glif.js";
import {
  type PlistDict,
  isDict,
  parsePlistDict,
  plistNumber,
  plistString,
  plistStrings,
  stringEntries,
} from "./plist.js";
import { type ExtraLayer, defaultLayer, extraLayers } from "./ufo-layers.js";
import { type ZipFile, fileText, unzip } from "./unzip.js";

/**
 * Reading a UFO back in — the other half of `exportUfo`.
 *
 * A UFO is a directory, and a browser is handed files, so what this opens is a
 * zipped one. That is the shape our own export produces and the shape every
 * operating system produces from a folder, so it is not a narrowing so much as
 * the only form the format takes when it travels.
 *
 * Nothing here refuses a font over a detail. A glyph that will not parse is
 * dropped and reported, a missing metric falls back to the default, an unknown
 * plist value is ignored. The one thing that stops the import is not finding a
 * UFO at all.
 */

export type UfoImport = {
  readonly document: FontDocument;
  readonly warnings: readonly UfoWarning[];
  /**
   * The pictures the font was carrying, by name.
   *
   * Beside the document rather than in it, for the reason the model gives: they
   * are megabytes that never change, and history keeps a copy of the document
   * on every edit. The caller puts them wherever it keeps such things.
   */
  readonly images: ReadonlyMap<string, Uint8Array>;
  /**
   * The layers this font has besides the one being edited, exactly as found.
   *
   * Beside the document for the reason the pictures are: a second set of glyphs
   * is the size of the first, and the document is a value that history copies
   * on every edit. The caller keeps them and hands them back when the font is
   * written out again.
   */
  readonly layers: readonly ExtraLayer[];
};

export type UfoWarning = {
  /** The glyph it concerns, or `null` for the font as a whole. */
  readonly glyph: string | null;
  readonly message: string;
};

export type UfoImportError = { readonly reason: string };

/** The public.kern1./kern2. prefixes UFO namespaces its kerning groups with. */
const FIRST_PREFIX = "public.kern1.";
const SECOND_PREFIX = "public.kern2.";

export async function importUfo(
  source: ArrayBuffer,
  ids: IdFactory,
): Promise<UfoImport | UfoImportError> {
  const files = await unzip(source);
  if (!Array.isArray(files)) return { reason: files.reason };
  return readUfo(files, ids);
}

/**
 * Read a UFO that is already a list of files.
 *
 * The same reader as `importUfo`, minus the unzipping. A UFO is a directory,
 * and once the File System Access API can hand one over there is no archive in
 * the way — the files arrive as files. Both callers want exactly this, so the
 * archive is a detail of where the bytes came from rather than part of what a
 * UFO is.
 */
export function readUfo(files: readonly ZipFile[], ids: IdFactory): UfoImport | UfoImportError {
  const root = findRoot(files);
  if (root === null) {
    return { reason: "no metainfo.plist: this does not look like a UFO" };
  }

  const warnings: UfoWarning[] = [];
  const warn = (glyph: string | null, message: string): void => {
    warnings.push({ glyph, message });
  };

  const at = (path: string): string | null => fileText(files, `${root}${path}`);

  const { info, guides, kept: keptInfo } = readFontInfo(at("fontinfo.plist"), ids, warn);
  const listing = at("layercontents.plist");
  const layer = defaultLayer(listing);
  const contents = parsePlistDict(at(`${layer}/contents.plist`) ?? "");
  const entries = stringEntries(contents);

  if (entries.length === 0) warn(null, `no glyphs listed in ${layer}/contents.plist`);

  const glyphs: Glyph[] = [];
  const seen = new Set<string>();

  for (const [name, file] of entries) {
    const text = at(`${layer}/${file}`);
    if (text === null) {
      warn(name, `listed in contents.plist but ${file} is not in the archive`);
      continue;
    }

    const parsed = parseGlif(text, ids, (message) => warn(name, message));
    if (parsed === null) {
      warn(name, `${file} is not a glif`);
      continue;
    }

    // contents.plist is authoritative for the name; the glif carries one too and
    // the two can disagree in a hand-edited source.
    let unique = name;
    let n = 2;
    while (seen.has(unique)) {
      unique = `${name}.${String(n)}`;
      n++;
    }
    if (unique !== name) warn(name, `renamed to ${unique}: the name was used twice`);
    seen.add(unique);

    glyphs.push({ ...parsed, name: unique });
  }

  if (glyphs.length === 0) return { reason: "the archive contains no readable glyphs" };

  const libSource = at("lib.plist");
  const ordered = inLibOrder(glyphs, libSource);
  // The glyph order is the model's; everything else somebody put in the lib is
  // theirs, and is carried through untouched so that saving puts it back.
  const keptLib =
    libSource === null
      ? {}
      : unmodelled(parsePlistDict(libSource), ["public.glyphOrder", METRIC_KEYS, OLD_METRIC_KEYS]);

  // Where a glyph's spacing comes from, which neither UFO nor OpenType has a
  // field for. Written under this editor's own name, and read back onto the
  // glyphs — a rule about the font rather than a note in somebody's lib.
  const spacedGlyphs = withMetricKeys(ordered, libSource);

  const kerning = readKerning(at("groups.plist"), at("kerning.plist"), warn);
  // Taken as it is, not parsed. What could not be compiled is still somebody's
  // source, and dropping the parts this editor does not understand would make
  // opening a file a way to lose work.
  const features = at("features.fea") ?? "";

  // Everything under `images/`, whatever it is. Nothing here decodes them: a
  // format we cannot read is still the designer's file, and the browser will
  // say so plainly when it fails to draw one.
  const images = new Map<string, Uint8Array>();
  for (const f of files) {
    const prefix = `${root}images/`;
    if (!f.path.startsWith(prefix)) continue;
    const name = f.path.slice(prefix.length);
    if (name !== "" && !name.includes("/")) images.set(name, f.bytes);
  }

  return {
    images,
    layers: extraLayers(files, root, listing),
    document: setKept(
      setGuides(
        setFeatures(setKerning(fontDocument(spacedGlyphs, info), kerning), features),
        guides,
      ),
      { fontInfo: keptInfo, lib: keptLib },
    ),
    warnings,
  };
}

/**
 * The glyphs of one layer the reader carried rather than read.
 *
 * For a master that is drawn as a layer of another's UFO: the designspace names
 * the layer, and its glyphs are that master's drawing. Read the way the default
 * layer is, from `contents.plist` and the `.glif` files it names.
 */
export function readLayerGlyphs(
  layer: ExtraLayer,
  ids: IdFactory,
  warn: (glyph: string | null, message: string) => void,
): Glyph[] {
  const text = (path: string): string | null =>
    layer.files.find((f) => f.path === path)?.text ?? null;

  const glyphs: Glyph[] = [];
  for (const [name, file] of stringEntries(parsePlistDict(text("contents.plist") ?? ""))) {
    const source = text(file);
    if (source === null) {
      warn(name, `listed in ${layer.directory}/contents.plist but ${file} is not there`);
      continue;
    }
    const parsed = parseGlif(source, ids, (message) => warn(name, message));
    if (parsed === null) warn(name, `${layer.directory}/${file} is not a glif`);
    else glyphs.push({ ...parsed, name });
  }
  return glyphs;
}

/**
 * Put the glyphs in the order the font asks for.
 *
 * `contents.plist` is a dictionary and a dictionary has no order, so the order
 * glyphs happen to be listed in is not the font's — most tools write it
 * alphabetically. `public.glyphOrder` in `lib.plist` is where the order is
 * actually kept.
 *
 * Names it lists that are not here are skipped, and glyphs it does not mention
 * follow in the order they were read: a lib that has drifted from the glyphs
 * beside it should cost the drift, not the whole order.
 */
function inLibOrder(glyphs: readonly Glyph[], lib: string | null): Glyph[] {
  if (lib === null) return [...glyphs];

  const wanted = plistStrings(parsePlistDict(lib), "public.glyphOrder");
  if (wanted.length === 0) return [...glyphs];

  const byName = new Map(glyphs.map((g) => [g.name, g]));
  const out: Glyph[] = [];
  for (const name of wanted) {
    const g = byName.get(name);
    if (g === undefined) continue;
    byName.delete(name);
    out.push(g);
  }
  for (const g of glyphs) if (byName.has(g.name)) out.push(g);
  return out;
}

/**
 * The directory the UFO sits in, found by looking for its metainfo.
 *
 * Zipping a folder puts everything inside a directory named for it, and zipping
 * a folder's *contents* does not. Both turn up, so the root is found rather than
 * assumed.
 */
function findRoot(files: readonly ZipFile[]): string | null {
  const marker = files.find(
    (f) => f.path === "metainfo.plist" || f.path.endsWith("/metainfo.plist"),
  );
  if (marker === undefined) return null;
  return marker.path.slice(0, marker.path.length - "metainfo.plist".length);
}

function readFontInfo(
  source: string | null,
  ids: IdFactory,
  warn: (glyph: string | null, message: string) => void,
): { info: FontInfo; guides: readonly Guide[]; kept: Readonly<Record<string, PlainValue>> } {
  if (source === null) {
    warn(null, "no fontinfo.plist: the font's metrics are the defaults");
    return { info: DEFAULT_FONT_INFO, guides: [], kept: {} };
  }

  const dict = parsePlistDict(source);
  const upem = plistNumber(dict, "unitsPerEm");
  if (upem === null) warn(null, "no unitsPerEm: assuming 1000");

  // A descender is stored negative and is sometimes written positive by hand.
  const descender = plistNumber(dict, "descender");

  const text = (key: keyof FontInfo): string =>
    plistString(dict, key) ?? (DEFAULT_FONT_INFO[key] as string);
  const number = (key: keyof FontInfo): number =>
    plistNumber(dict, key) ?? (DEFAULT_FONT_INFO[key] as number);

  const info: FontInfo = {
    familyName: text("familyName"),
    styleName: text("styleName"),
    unitsPerEm: upem ?? DEFAULT_FONT_INFO.unitsPerEm,
    ascender: plistNumber(dict, "ascender") ?? DEFAULT_FONT_INFO.ascender,
    descender: descender === null ? DEFAULT_FONT_INFO.descender : -Math.abs(descender),
    xHeight: plistNumber(dict, "xHeight") ?? DEFAULT_FONT_INFO.xHeight,
    capHeight: plistNumber(dict, "capHeight") ?? DEFAULT_FONT_INFO.capHeight,

    versionMajor: number("versionMajor"),
    versionMinor: number("versionMinor"),
    italicAngle: number("italicAngle"),

    copyright: text("copyright"),
    trademark: text("trademark"),

    openTypeNameDesigner: text("openTypeNameDesigner"),
    openTypeNameDesignerURL: text("openTypeNameDesignerURL"),
    openTypeNameManufacturer: text("openTypeNameManufacturer"),
    openTypeNameManufacturerURL: text("openTypeNameManufacturerURL"),
    openTypeNameLicense: text("openTypeNameLicense"),
    openTypeNameLicenseURL: text("openTypeNameLicenseURL"),
    openTypeNameDescription: text("openTypeNameDescription"),

    openTypeOS2VendorID: text("openTypeOS2VendorID"),
    openTypeOS2WeightClass: number("openTypeOS2WeightClass"),
    openTypeOS2WidthClass: number("openTypeOS2WidthClass"),

    // Signs as the format has them, whatever the file says — the reason the
    // descender above is read the way it is. Hand-written sources get these
    // backwards often enough, and a font read in with a positive descender here
    // is one whose every later edit in Font Info is refused.
    openTypeHheaAscender: whole(plistNumber(dict, "openTypeHheaAscender")),
    openTypeHheaDescender: below(plistNumber(dict, "openTypeHheaDescender")),
    openTypeHheaLineGap: whole(plistNumber(dict, "openTypeHheaLineGap")),
    openTypeOS2TypoAscender: whole(plistNumber(dict, "openTypeOS2TypoAscender")),
    openTypeOS2TypoDescender: below(plistNumber(dict, "openTypeOS2TypoDescender")),
    openTypeOS2TypoLineGap: whole(plistNumber(dict, "openTypeOS2TypoLineGap")),
    openTypeOS2WinAscent: distance(plistNumber(dict, "openTypeOS2WinAscent")),
    openTypeOS2WinDescent: distance(plistNumber(dict, "openTypeOS2WinDescent")),
    openTypeOS2Selection: selectionBits(dict),
    openTypeOS2Type: sourceEmbeddingBits(dict),

    openTypeNamePreferredFamilyName: text("openTypeNamePreferredFamilyName"),
    openTypeNamePreferredSubfamilyName: text("openTypeNamePreferredSubfamilyName"),

    styleMapFamilyName: text("styleMapFamilyName"),
    styleMapStyleName: styleMapStyle(plistString(dict, "styleMapStyleName")),
  };

  // `guidelines` is read into the model rather than kept, so it must not also
  // be carried as something unmodelled — it would be written twice.
  const modelled = [...Object.keys(DEFAULT_FONT_INFO), "guidelines"];
  return { info, guides: readGuides(dict, ids), kept: unmodelled(dict, modelled) };
}

/**
 * The font's own guides, from `fontinfo.plist`.
 *
 * Dictionaries rather than the glif's attributes, and the same three ways of
 * saying a line: `x` alone is vertical, `y` alone level, both with an angle is
 * anything else.
 */
function readGuides(dict: PlistDict, ids: IdFactory): Guide[] {
  const listed = dict["guidelines"];
  if (!Array.isArray(listed)) return [];

  const out: Guide[] = [];
  for (const entry of listed) {
    if (!isDict(entry)) continue;
    const x = plistNumber(entry, "x");
    const y = plistNumber(entry, "y");
    const angle = plistNumber(entry, "angle");
    const name = plistString(entry, "name") ?? "";
    const color = plistString(entry, "color");

    if (x !== null && y !== null) out.push(guide(ids.guide(), { x, y }, angle ?? 0, name, color));
    else if (x !== null) out.push(guide(ids.guide(), { x, y: 0 }, 90, name, color));
    else if (y !== null) out.push(guide(ids.guide(), { x: 0, y }, 0, name, color));
  }
  return out;
}

/** A metric the file set, in whole units; `null` where it set nothing. */
const whole = (value: number | null): number | null => (value === null ? null : Math.round(value));
/** A descender: below the baseline, so never positive. */
const below = (value: number | null): number | null =>
  value === null ? null : -Math.abs(Math.round(value));
/** A Windows ascent or descent, which the format stores as a distance. */
const distance = (value: number | null): number | null =>
  value === null ? null : Math.abs(Math.round(value));

/** The embedding permissions a source sets, as `fsType` bit numbers; see `embeddingBits`. */
function sourceEmbeddingBits(dict: PlistDict): number[] {
  const listed = dict["openTypeOS2Type"];
  return Array.isArray(listed) ? embeddingBits(listed) : [];
}

/** The `fsSelection` bits a font sets itself, as a list of bit numbers. */
function selectionBits(dict: PlistDict): number[] {
  const listed = dict["openTypeOS2Selection"];
  if (!Array.isArray(listed)) return [];
  return listed.filter(
    (bit): bit is number =>
      typeof bit === "number" && Number.isInteger(bit) && bit >= 0 && bit <= 15,
  );
}

/** The four names this key is allowed to have, and the default for anything else. */
function styleMapStyle(value: string | null): StyleMapStyle {
  const found = STYLE_MAP_STYLES.find((s) => s === value);
  return found ?? DEFAULT_FONT_INFO.styleMapStyleName;
}

/**
 * The keys of a dictionary that the model has no field for.
 *
 * Kept exactly as they were read, so that writing the font back out puts them
 * where they were. Nothing here decides what they mean — deciding is what the
 * model does, and these are the ones it cannot.
 */
function unmodelled(
  dict: PlistDict,
  modelled: readonly string[],
): Readonly<Record<string, PlainValue>> {
  const mine = new Set(modelled);
  const out: Record<string, PlainValue> = {};
  for (const [key, value] of Object.entries(dict)) {
    if (!mine.has(key)) out[key] = value;
  }
  return out;
}

/**
 * Groups and pairs, back into the model's arrangement.
 *
 * UFO writes the side of a group into its name; the model keeps the two sides in
 * separate tables and marks a group with a prefix. So the namespace is stripped
 * here and becomes structure again — the exact inverse of what `ufoSide` does on
 * the way out. A group with neither namespace is not kerning and is left alone:
 * `groups.plist` is shared with everything else that groups glyphs.
 */
function readKerning(
  groupsSource: string | null,
  kernSource: string | null,
  warn: (glyph: string | null, message: string) => void,
): Kerning {
  let kerning = EMPTY_KERNING;
  if (groupsSource === null && kernSource === null) return kerning;

  const named = new Map<string, string>();

  if (groupsSource !== null) {
    const groups = parsePlistDict(groupsSource);
    for (const [key, value] of Object.entries(groups)) {
      if (!Array.isArray(value)) continue;
      const members = value.filter((v): v is string => typeof v === "string");

      if (key.startsWith(FIRST_PREFIX)) {
        const name = key.slice(FIRST_PREFIX.length);
        kerning = setKernGroup(kerning, "first", name, members);
        named.set(key, groupKey(name));
      } else if (key.startsWith(SECOND_PREFIX)) {
        const name = key.slice(SECOND_PREFIX.length);
        kerning = setKernGroup(kerning, "second", name, members);
        named.set(key, groupKey(name));
      }
    }
  }

  if (kernSource === null) return kerning;

  const pairs = parsePlistDict(kernSource);
  for (const [first, row] of Object.entries(pairs)) {
    if (!isDict(row)) continue;
    for (const [second, value] of Object.entries(row)) {
      if (typeof value !== "number") continue;

      const left = named.get(first) ?? bare(first, warn);
      const right = named.get(second) ?? bare(second, warn);
      if (left === null || right === null) continue;

      kerning = setKern(kerning, left, right, value);
    }
  }

  return kerning;
}

/**
 * A pair side that named no group we found.
 *
 * A plain glyph name passes through. A namespaced name that `groups.plist` never
 * defined is a dangling reference, which is reported rather than invented: a
 * group made up here would be an empty one, and kerning against it would apply
 * to nothing while looking as though it applied to something.
 */
function bare(key: string, warn: (glyph: string | null, message: string) => void): string | null {
  if (key.startsWith(FIRST_PREFIX) || key.startsWith(SECOND_PREFIX)) {
    warn(null, `kerning refers to ${key}, which groups.plist does not define`);
    return null;
  }
  return key;
}

/** Whether a file looks like a zipped UFO, for a caller choosing an importer. */
export function looksLikeUfo(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".ufo.zip") || lower.endsWith(".ufoz") || lower.endsWith(".ufo");
}

/**
 * Whether a file is worth opening as an archive at all.
 *
 * Wider than {@link looksLikeUfo}, because a family is a zip of UFOs beside a
 * designspace and its name says nothing about that. Being wrong is cheap: the
 * archive is read, found not to hold a font, and the binary reader is asked
 * instead — where being wrong the other way means telling somebody their family
 * is an unsupported OpenType signature.
 */
export function looksLikeArchive(fileName: string): boolean {
  return looksLikeUfo(fileName) || fileName.toLowerCase().endsWith(".zip");
}

/** Where a glyph's spacing comes from, in a lib key of this editor's own. */
const METRIC_KEYS = "org.typewright.metricKeys";

/**
 * The same key, under the name the editor had before it was named.
 *
 * Read, never written. A lib key is not a setting — it is in the source on
 * disk, in files this editor wrote and someone may still be working on, so
 * dropping it would silently lose the spacing rules from every font saved
 * before the rename.
 */
const OLD_METRIC_KEYS = "org.fonteditor.metricKeys";

/**
 * The glyphs, with whatever the lib said about where their spacing comes from.
 *
 * A dictionary of glyph name to a dictionary of the three keys. Nothing here
 * checks that the glyphs named exist: a source is allowed to be mid-edit, and
 * a key pointing nowhere is reported when the font is compiled rather than
 * dropped on the way in — dropping it would lose the designer's rule to fix a
 * problem they can see and we cannot.
 */
function withMetricKeys(glyphs: readonly Glyph[], lib: string | null): Glyph[] {
  if (lib === null) return [...glyphs];

  const dict = parsePlistDict(lib);
  const found = dict[METRIC_KEYS] ?? dict[OLD_METRIC_KEYS];
  if (!isDict(found)) return [...glyphs];

  return glyphs.map((g) => {
    const keys = found[g.name];
    if (!isDict(keys)) return g;

    const metricKeys = {
      left: plistString(keys, "left") ?? "",
      right: plistString(keys, "right") ?? "",
      width: plistString(keys, "width") ?? "",
    };
    return hasMetricKeys(metricKeys) ? { ...g, metricKeys } : g;
  });
}
