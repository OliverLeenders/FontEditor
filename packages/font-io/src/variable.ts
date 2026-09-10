import type { Axis, FontDocument, Location } from "@typewright/font-model";
import type { ComponentSource, Glyph } from "@typewright/font-model";
import {
  correctDirections,
  counterIds,
  glyph,
  orderedGlyphs,
  resolveGlyphComponents,
} from "@typewright/font-model";

import { cff2Table } from "./cff2.js";
import { type ExportResult, exportFont } from "./export.js";
import { type NamedInstance, fvarTable, statTable } from "./fvar.js";
import { withNames } from "./names.js";
import { readTablesOf, withTable } from "./sfnt.js";
import { deltaMasters, hvarTable, regionsOf } from "./varstore.js";

/**
 * A variable font: one file that is every master and everything between them.
 *
 * Built on top of the ordinary export rather than beside it. The default master
 * is compiled exactly as a single font is — the same character map, metrics,
 * kerning, features and mark attachment — and then three things change: the
 * outlines become CFF2, which is CFF with deltas in it, and `fvar` says what
 * may be varied.
 *
 * Doing it that way means everything that is hard about compiling a font is
 * done once and in one place, and this file is only about the variation. It
 * also means a variable font is exactly the default master to anything that
 * does not know about variations, which is what the format intends.
 */

export type VariableMaster = {
  readonly name: string;
  readonly location: Location;
  readonly document: FontDocument;
};

export type VariableResult = ExportResult & {
  /** Glyphs written from the default master alone, because the masters disagree. */
  readonly notVarying: readonly string[];
};

/**
 * Compile a family into one variable font.
 *
 * The first master is the default: it is what the font is before anything is
 * asked of it, and every delta is measured from it. A designspace usually has
 * its default in the middle of the axes, and the caller is expected to have put
 * that master first.
 *
 * `named` is what the style menu offers. Those are the family's *instances* —
 * Light, Regular, Semibold — which are a different thing from its masters: a
 * master is a drawing somebody made, and a two-axis family's masters are its
 * four corners, which is not a menu anybody wants. Where a family has named
 * none, the masters stand in, because a menu of corners still beats no menu.
 */
export function exportVariableFont(
  axes: readonly Axis[],
  masters: readonly VariableMaster[],
  named: readonly NamedInstance[] = [],
): VariableResult {
  const first = masters[0];
  if (first === undefined) throw new Error("a variable font needs at least one master");
  if (axes.length === 0) throw new Error("a variable font needs at least one axis");

  // The whole font, compiled from the default master. Everything but the
  // outlines is right already after this.
  const base = exportFont(first.document);
  let bytes: Uint8Array = new Uint8Array(base.bytes);

  // The outlines of every master, prepared identically — or the deltas are
  // between two different shapes.
  //
  // Components are resolved and directions corrected, and the overlaps are
  // *left in*. That is deliberate twice over: CFF2 allows overlapping contours
  // where CFF does not, so there is nothing to fix; and removing an overlap
  // changes how many points a contour has, which would leave two masters
  // describing the same letter with different numbers of them and no way to
  // put a delta between them.
  const order = orderedGlyphs(first.document).map((g) => g.name);
  const drawn = masters.map((m) => flattened(m.document, order));

  const { table, notVarying } = cff2Table({
    axes,
    locations: masters.map((m) => m.location),
    masters: drawn,
    unitsPerEm: first.document.info.unitsPerEm,
  });

  // The names the axes and instances are known by, added to the table
  // opentype.js wrote, and the numbers handed back.
  const instances: NamedInstance[] =
    named.length > 0 ? [...named] : masters.map((m) => ({ name: m.name, location: m.location }));
  const names = [...axes.map((a) => a.name), ...instances.map((i) => i.name)];
  const written = withNames(nameTableOf(bytes), names);

  const axisNames = written.ids.slice(0, axes.length);
  const instanceNames = written.ids.slice(axes.length);

  const fvar = fvarTable(
    axes.map((it, i) => ({ it, nameId: axisNames[i] ?? 0 })),
    instances.map((it, i) => ({ it, nameId: instanceNames[i] ?? 0 })),
  );

  // How the advances vary. Without it the letters change shape as the weight
  // moves and keep the spacing of the weight they were compiled at, which reads
  // as a broken rasteriser and is a missing table.
  const regions = regionsOf(
    axes,
    masters.map((m) => m.location),
  );
  const varying = deltaMasters(
    axes,
    masters.map((m) => m.location),
  );
  const advances = order.map((_, g) =>
    varying.map((m) => (drawn[m]?.[g]?.advance ?? 0) - (drawn[0]?.[g]?.advance ?? 0)),
  );
  bytes = withTable(bytes, "HVAR", hvarTable(axes, regions, advances));

  bytes = withTable(bytes, "name", written.table);
  bytes = withTable(bytes, "fvar", fvar);
  // Required of a variable font, and about the family rather than this file:
  // which of these weights is the regular one, and whether this font and
  // another are the same design.
  bytes = withTable(
    bytes,
    "STAT",
    statTable(axes.map((it, i) => ({ it, nameId: axisNames[i] ?? 0 }))),
  );
  bytes = withTable(bytes, "CFF2", table);
  // Last, and the reason the order matters: a font may not have both, and the
  // one being replaced is the one every reader would otherwise prefer.
  bytes = withTable(bytes, "CFF ", new Uint8Array());

  return {
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    warnings: [
      ...base.warnings,
      ...(notVarying.length === 0
        ? []
        : [
            `${String(notVarying.length)} glyphs do not vary because their masters disagree: ` +
              `${notVarying.slice(0, 8).join(", ")}${notVarying.length > 8 ? "…" : ""}`,
          ]),
    ],
    notVarying,
  };
}

/**
 * One master's glyphs, prepared exactly as the compiler prepares the default.
 *
 * In the default master's order and only its glyphs: a glyph another master has
 * and this one does not is not in the font at all, and one this master lacks
 * cannot vary. Both are the compatibility check's business, and by the time a
 * font is being written the answer has to be a font.
 */
export function flattened(document: FontDocument, order: readonly string[]): Glyph[] {
  const ids = counterIds("v");
  const source: ComponentSource = { glyphOf: (name) => document.glyphs[name] ?? null };

  return order.map((name) => {
    const found = document.glyphs[name];
    if (found === undefined) return glyph(name);

    const resolved = [
      ...found.contours,
      ...resolveGlyphComponents(source, found.name, found.components, ids),
    ];
    return { ...found, components: [], contours: correctDirections(resolved) };
  });
}

/** The `name` table as it stands, for adding to. */
function nameTableOf(font: Uint8Array): Uint8Array {
  return readTablesOf(font).find((t) => t.tag === "name")?.data ?? new Uint8Array();
}
