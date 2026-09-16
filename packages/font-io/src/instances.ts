import type { Axis, FontDocument, Glyph, Location, Rule } from "@typewright/font-model";
import { interpolateFont, swapsAt } from "@typewright/font-model";

import { exportFont } from "./export.js";
import { type ZipEntry, zip } from "./zip.js";

/**
 * The styles of a family, each written out as a font of its own.
 *
 * A variable font is one file that is every style and everything between them,
 * and it is the right answer nearly everywhere. This is the other one: a folder
 * of ordinary static fonts, Light.otf beside Bold.otf, which is what a printer
 * wants, what an operating system older than 2017 can install, and what most
 * places that take an upload still ask for.
 *
 * The shapes are worked out rather than drawn — that is what an instance is —
 * and every glyph the masters disagree about is left out of the instance rather
 * than drawn wrongly, and named. A designer told which letters are missing can
 * go and make the masters agree; one shown a font that is quietly missing an
 * `æ` cannot.
 */

export type InstanceMaster = {
  readonly location: Location;
  readonly document: FontDocument;
  /** Whether it draws only some glyphs, and counts only for those. */
  readonly sparse?: boolean;
};

/** A style to write out: what it is called, and where on the axes it is. */
export type NamedPlace = {
  readonly name: string;
  readonly location: Location;
  /** The family it belongs to, or `""` for the one it was designed in. */
  readonly familyName: string;
};

export type InstanceFont = {
  readonly name: string;
  readonly fileName: string;
  readonly bytes: ArrayBuffer;
  readonly warnings: readonly string[];
};

export type InstancesExport = {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly files: number;
  readonly warnings: readonly string[];
};

/**
 * Work out one font per instance.
 *
 * Each carries its own names. An instance whose `name` table said `Regular`
 * because that is what the nearest master is called would be a file that lies
 * about itself the moment it is installed, and a folder of six such files
 * installs as one font that keeps replacing itself.
 */
export function instanceFonts(
  axes: readonly Axis[],
  masters: readonly InstanceMaster[],
  instances: readonly NamedPlace[],
  rules: readonly Rule[] = [],
): InstanceFont[] {
  const locations = masters.map((m) => m.location);
  const sources = masters.map((m) => m.document);
  const sparse = masters.map((m) => m.sparse === true);
  const out: InstanceFont[] = [];

  for (const it of instances) {
    const worked = interpolateFont(axes, locations, sources, it.location, sparse);
    const { refused } = worked;
    // The rules in effect here, applied the way a build applies them to a
    // static instance: the glyphs trade drawings, and keep their names and
    // characters, so a `$` typed at this weight is the heavy one.
    const document = withSwaps(worked.document, swapsAt(axes, rules, it.location));
    const family = it.familyName === "" ? document.info.familyName : it.familyName;

    const named: FontDocument = {
      ...document,
      info: { ...document.info, familyName: family, styleName: it.name },
    };

    const written = exportFont(named);
    const warnings = [
      ...written.warnings,
      ...(refused.length === 0
        ? []
        : [
            `left out ${String(refused.length)} glyph(s) the masters disagree about: ${list(refused)}`,
          ]),
    ];

    out.push({
      name: it.name,
      fileName: `${fileNameOf(family)}-${fileNameOf(it.name)}.otf`,
      bytes: written.bytes,
      warnings,
    });
  }

  return out;
}

/**
 * A font with some glyphs' drawings traded for others'.
 *
 * Each pair in turn, so a later rule sees what an earlier one did — which is
 * the order a variable font applies them in. A pair naming a glyph the font
 * has not got changes nothing.
 */
export function withSwaps(
  document: FontDocument,
  swaps: readonly (readonly [string, string])[],
): FontDocument {
  if (swaps.length === 0) return document;

  const glyphs: Record<string, Glyph> = { ...document.glyphs };
  for (const [a, b] of swaps) {
    const one = glyphs[a];
    const two = glyphs[b];
    if (one === undefined || two === undefined) continue;
    glyphs[a] = { ...two, name: a, unicodes: one.unicodes };
    glyphs[b] = { ...one, name: b, unicodes: two.unicodes };
  }
  return { ...document, glyphs };
}

/** Every instance, zipped, because a browser hands over one file at a time. */
export function exportInstances(
  axes: readonly Axis[],
  masters: readonly InstanceMaster[],
  instances: readonly NamedPlace[],
  rules: readonly Rule[] = [],
): InstancesExport {
  const fonts = instanceFonts(axes, masters, instances, rules);
  const entries: ZipEntry[] = fonts.map((f) => ({
    path: f.fileName,
    bytes: new Uint8Array(f.bytes),
  }));

  // The family names the archive. An unnamed family gets the stand-in the rest
  // of the exporters use rather than an empty string.
  const family = fileNameOf(masters[0]?.document.info.familyName ?? "");

  return {
    bytes: zip(entries),
    fileName: `${family}-instances.zip`,
    files: entries.length,
    warnings: fonts.flatMap((f) => f.warnings.map((w) => `${f.name}: ${w}`)),
  };
}

/** A name a file can carry: letters and digits, and never empty. */
function fileNameOf(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, "") || "Untitled";
}

/** A few names, and then how many more, so a warning stays one line. */
function list(names: readonly string[]): string {
  const shown = names.slice(0, 6).join(", ");
  return names.length <= 6 ? shown : `${shown} and ${String(names.length - 6)} more`;
}
