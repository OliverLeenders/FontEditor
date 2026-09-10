import type { Axis, FontDocument, IdFactory, Location } from "@typewright/font-model";

import {
  type Designspace,
  type Source,
  designspaceFileName,
  designspaceXml,
  parseDesignspace,
} from "./designspace.js";
import { type UfoWarning, readUfo } from "./ufo-import.js";
import { ufoFiles } from "./ufo.js";
import type { ZipFile } from "./unzip.js";
import { type ZipEntry, zip } from "./zip.js";

/**
 * A family: several masters, and the file that says how they relate.
 *
 * One UFO per master and a `.designspace` beside them, which is what fontmake
 * is given and what every other editor writes. Not one file holding everything:
 * the format's arrangement is a document that points at fonts, and following it
 * means a family drawn here can be built by anything.
 *
 *     Family.designspace
 *     Family-Regular.ufo/
 *     Family-Bold.ufo/
 *
 * Delivered as a zip for the same reason a single UFO is: a browser cannot hand
 * over a directory. Unzipping gives the arrangement above.
 */

/**
 * One instance on the way out: a name, a family, and a place.
 *
 * No document, because there is nothing to draw in one — a build works the
 * shapes out from the masters either side. `familyName` is empty for the
 * ordinary case, where the style belongs to the family it was designed in.
 */
export type FamilyInstance = {
  readonly name: string;
  readonly location: Location;
  readonly familyName: string;
};

/** One master on the way out: what it is called, where it sits, what it holds. */
export type FamilyMaster = {
  readonly name: string;
  readonly location: Location;
  readonly document: FontDocument;
  /** Its own pictures, by name. Each master's are written into its own UFO. */
  readonly images?: ReadonlyMap<string, Uint8Array>;
};

export type FamilyExport = {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly files: number;
};

/**
 * Every file a family is made of, as paths and contents.
 *
 * Separated from the zipping so the arrangement can be asserted on directly:
 * what goes wrong here is a designspace naming a UFO that is not beside it, and
 * that is invisible through an archive.
 */
export function familyFiles(
  axes: readonly Axis[],
  masters: readonly FamilyMaster[],
  instances: readonly FamilyInstance[] = [],
): ZipEntry[] {
  const family = familyName(masters);
  const sources: Source[] = masters.map((m) => ({
    filename: ufoFolderName(family, m.name),
    name: `${family} ${m.name}`.trim(),
    familyName: family,
    styleName: m.name,
    location: m.location,
  }));

  const designspace: Designspace = {
    axes,
    sources,
    // The styles between the masters, with the file name a build would give
    // each: the convention every pipeline follows, and the one this editor uses
    // when it writes the instances out itself.
    instances: instances.map((it) => {
      const under = it.familyName === "" ? family : it.familyName;
      return {
        familyName: under,
        styleName: it.name,
        location: it.location,
        filename: `instance_ufo/${ufoFolderName(under, it.name)}`,
      };
    }),
  };
  const entries: ZipEntry[] = [
    { path: designspaceFileName(family), text: designspaceXml(designspace) },
  ];

  for (const [i, m] of masters.entries()) {
    const root = sources[i]?.filename ?? ufoFolderName(family, m.name);
    // Each UFO says which style it is. A master called Bold whose own file
    // calls itself Regular is a file that lies about itself the moment anybody
    // opens it on its own — and the designspace saying otherwise does not help,
    // because a UFO is opened without one all the time.
    for (const entry of ufoFiles(styled(m), m.images ?? new Map())) {
      entries.push({ ...entry, path: `${root}/${entry.path}` });
    }
  }

  return entries;
}

export function exportFamily(
  axes: readonly Axis[],
  masters: readonly FamilyMaster[],
  instances: readonly FamilyInstance[] = [],
): FamilyExport {
  const files = familyFiles(axes, masters, instances);
  return { bytes: zip(files), fileName: `${familyName(masters)}.zip`, files: files.length };
}

/** What came back from reading a family. */
export type FamilyImport = {
  readonly axes: readonly Axis[];
  /** The styles the file asked for between its sources. */
  readonly instances: readonly FamilyInstance[];
  readonly masters: readonly {
    readonly name: string;
    readonly location: Location;
    readonly document: FontDocument;
    readonly images: ReadonlyMap<string, Uint8Array>;
  }[];
  readonly warnings: readonly UfoWarning[];
};

export type FamilyProblem = { readonly reason: string };

/** A readonly array's element type, as something a reader can build up. */
type Mutable<T extends readonly unknown[]> = T[number][];

/** Whether a list of files holds a designspace, and therefore a family. */
export function looksLikeFamily(files: readonly ZipFile[]): boolean {
  return files.some((f) => f.path.endsWith(".designspace"));
}

/**
 * Read a family: the designspace, and the UFO each of its sources names.
 *
 * A source whose UFO is not beside the file is reported and skipped rather than
 * refused — a family with three masters of which two are here is worth opening,
 * and the alternative is a designer with nothing on screen and no idea which
 * file is missing.
 */
export function readFamily(
  files: readonly ZipFile[],
  ids: IdFactory,
): FamilyImport | FamilyProblem {
  const found = files.find((f) => f.path.endsWith(".designspace"));
  if (found === undefined) return { reason: "no .designspace: this is not a family" };

  const designspace = parseDesignspace(new TextDecoder().decode(found.bytes));
  if (designspace === null) return { reason: `${found.path} is not a designspace` };

  // Everything is named relative to the designspace, so where it sits inside
  // the archive is the root everything else hangs from.
  const root = found.path.slice(0, found.path.lastIndexOf("/") + 1);
  const warnings: UfoWarning[] = [];
  const masters: Mutable<FamilyImport["masters"]> = [];

  for (const source of designspace.sources) {
    const prefix = `${root}${source.filename}/`;
    const inside = files
      .filter((f) => f.path.startsWith(prefix))
      .map((f) => ({ path: f.path.slice(prefix.length), bytes: f.bytes }));

    if (inside.length === 0) {
      warnings.push({ glyph: null, message: `${source.filename} is not in the archive` });
      continue;
    }

    const read = readUfo(inside, ids);
    if ("reason" in read) {
      warnings.push({ glyph: null, message: `${source.filename}: ${read.reason}` });
      continue;
    }

    warnings.push(
      ...read.warnings.map((w) => ({
        glyph: w.glyph,
        message: `${source.styleName || source.filename}: ${w.message}`,
      })),
    );
    masters.push({
      // The style name is what a master is called; the source name is the
      // family and the style together and reads oddly in a list of masters.
      name: source.styleName === "" ? source.name : source.styleName,
      location: source.location,
      document: read.document,
      images: read.images,
    });
  }

  if (masters.length === 0) {
    return { reason: "the designspace names no source this archive contains" };
  }

  return {
    axes: designspace.axes,
    masters,
    // The family name is dropped where it is the family's own: a style that
    // says it belongs to the family it is in is saying nothing, and keeping it
    // would make every instance look like a split-off subfamily.
    instances: designspace.instances.map((it) => ({
      name: it.styleName,
      location: it.location,
      familyName: it.familyName === familyOf(designspace.sources) ? "" : it.familyName,
    })),
    warnings,
  };
}

/** The family the sources agree they belong to, or the first one's answer. */
function familyOf(sources: readonly Source[]): string {
  return sources[0]?.familyName ?? "";
}

/**
 * A master's document, calling itself by the master's name.
 *
 * The master's name *is* its style: that is what a master is. Left alone, every
 * UFO in a family would carry whatever style name the font was drawn with,
 * which is the same one in all of them.
 */
function styled(m: FamilyMaster): FontDocument {
  const styleName = m.name.trim();
  if (styleName === "" || styleName === m.document.info.styleName) return m.document;
  return { ...m.document, info: { ...m.document.info, styleName } };
}

/** The family's name, from the master that has one. */
function familyName(masters: readonly FamilyMaster[]): string {
  for (const m of masters) {
    const clean = m.document.info.familyName.replace(/[^A-Za-z0-9]/g, "");
    if (clean !== "") return clean;
  }
  return "Untitled";
}

/** What one master's UFO is called: the family and the style, as UFO wants. */
function ufoFolderName(family: string, style: string): string {
  const clean = style.replace(/[^A-Za-z0-9]/g, "") || "Regular";
  return `${family}-${clean}.ufo`;
}
