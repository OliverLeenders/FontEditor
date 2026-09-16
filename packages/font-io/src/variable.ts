import type {
  Axis,
  ComponentSource,
  FontDocument,
  Glyph,
  Location,
  Rule,
  RulesProcessing,
} from "@typewright/font-model";
import {
  correctDirections,
  counterIds,
  glyph,
  isDiscrete,
  orderedGlyphs,
  resolveGlyphComponents,
  sameLocation,
} from "@typewright/font-model";

import { cff2Table, sameShape } from "./cff2.js";
import { type ExportResult, exportFont } from "./export.js";
import { swapVariationsFor, type SwapVariations } from "./feature-variations.js";
import { type NamedInstance, avarTable, fvarTable, statTable } from "./fvar.js";
import { withNames } from "./names.js";
import { postWithNames } from "./post.js";
import { readTablesOf, withTable } from "./sfnt.js";
import { type VariationPlan, deltasOf, planVariations } from "./variation-plan.js";
import { hvarTable } from "./varstore.js";

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
  /** Whether it draws only some glyphs, and takes part only in those. */
  readonly sparse?: boolean;
};

/** What a variable font is built with besides its masters. */
export type VariableOptions = {
  readonly rules?: readonly Rule[];
  readonly rulesProcessing?: RulesProcessing;
};

export type VariableResult = ExportResult & {
  /** Glyphs written from the default master alone, because the masters disagree. */
  readonly notVarying: readonly string[];
};

/**
 * What both flavours start from: the axes the font can vary along, the masters
 * that take part, the rules placed on those axes, and the styles it offers.
 *
 * An axis with stops is not one a variable font can vary along. The font is the
 * designspace at that axis's default stop, and the masters and styles at other
 * stops are left out and said to be — a family with an upright and an italic is
 * two variable fonts, and this is the upright one.
 */
export type PreparedVariable = {
  readonly axes: readonly Axis[];
  readonly masters: readonly VariableMaster[];
  readonly instances: readonly NamedInstance[];
  readonly swaps: SwapVariations | null;
  readonly warnings: readonly string[];
};

export function prepareVariable(
  axes: readonly Axis[],
  masters: readonly VariableMaster[],
  named: readonly NamedInstance[],
  options: VariableOptions,
): PreparedVariable {
  if (masters.length === 0) throw new Error("a variable font needs at least one master");
  if (axes.length === 0) throw new Error("a variable font needs at least one axis");

  const stops = axes.filter(isDiscrete);
  const along = axes.filter((a) => !isDiscrete(a));
  if (along.length === 0)
    throw new Error("a variable font needs at least one axis it can vary along");

  const onStop = (location: Location): boolean =>
    stops.every((a) => (location[a.tag] ?? a.default) === a.default);

  const warnings: string[] = [];
  const kept = masters.filter((m) => onStop(m.location));
  if (kept.length < masters.length) {
    warnings.push(
      `left out ${String(masters.length - kept.length)} master(s) at other stops of ` +
        `${stops.map((a) => a.name).join(", ")}, which a variable font cannot vary along`,
    );
  }

  // The default master first, and a whole one: every delta is measured from it.
  const home = Object.fromEntries(along.map((a) => [a.tag, a.default]));
  const at = kept.findIndex((m) => m.sparse !== true && sameLocation(along, m.location, home));
  const ordered = at <= 0 ? kept : [kept[at]!, ...kept.slice(0, at), ...kept.slice(at + 1)];
  if (ordered[0] === undefined) throw new Error("a variable font needs at least one master");

  const styles = named.filter((it) => onStop(it.location));
  const instances =
    styles.length > 0
      ? styles
      : ordered
          .filter((m) => m.sparse !== true)
          .map((m) => ({ name: m.name, location: m.location }));

  return {
    axes: along,
    masters: ordered,
    instances,
    swaps: swapVariationsFor(along, axes, options.rules ?? [], options.rulesProcessing ?? "first"),
    warnings,
  };
}

/**
 * Compile a family into one variable font.
 *
 * The master at the default location is the default: it is what the font is
 * before anything is asked of it, and every delta is measured from it.
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
  options: VariableOptions = {},
): VariableResult {
  const prepared = prepareVariable(axes, masters, named, options);
  const first = prepared.masters[0]!;

  // The whole font, compiled from the default master, the rules with it.
  // Everything but the outlines is right already after this.
  const base = exportFont(first.document, undefined, { swaps: prepared.swaps });
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
  const drawn = prepared.masters.map((m) => flattened(m.document, order, first.document));

  // Which masters take part in each glyph: all of them, a sparse one only where
  // it draws the glyph, and none but the default where they disagree.
  const notVarying: string[] = [];
  const presence = order.map((name, g) => {
    const present = prepared.masters.map(
      (m, i) => i === 0 || m.sparse !== true || m.document.glyphs[name] !== undefined,
    );
    const agree = present.every((p, i) => !p || i === 0 || sameShape(drawn[0]![g]!, drawn[i]![g]!));
    if (agree) return present;
    notVarying.push(name);
    return present.map((_, i) => i === 0);
  });

  const plan = planVariations(
    prepared.axes,
    prepared.masters.map((m) => m.location),
    presence,
  );

  const table = cff2Table({
    axes: prepared.axes,
    masters: drawn,
    plan,
    unitsPerEm: first.document.info.unitsPerEm,
  });

  bytes = withVariationTables(bytes, prepared, plan, advanceRows(plan, drawn));
  // The names, which went out with the CFF table that held them: CFF2 has no
  // place for them, so `post` carries them, as it does in a TrueType font.
  const post = readTablesOf(bytes).find((t) => t.tag === "post")?.data;
  if (post !== undefined) bytes = withTable(bytes, "post", postWithNames(post, order));
  bytes = withTable(bytes, "CFF2", table);
  // Last, and the reason the order matters: a font may not have both, and the
  // one being replaced is the one every reader would otherwise prefer.
  bytes = withTable(bytes, "CFF ", new Uint8Array());

  return {
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    warnings: [...base.warnings, ...prepared.warnings, ...notVaryingWarning(notVarying)],
    notVarying,
  };
}

/**
 * Every glyph's advance deltas, one per region of the whole font.
 *
 * `HVAR` has one row per glyph over every region, so a glyph that varies over
 * only some of them has zeroes for the rest.
 */
export function advanceRows(plan: VariationPlan, drawn: readonly (readonly Glyph[])[]): number[][] {
  return plan.glyphs.map((glyphPlan, g) => {
    const row = new Array<number>(plan.regions.length).fill(0);
    const deltas = deltasOf(
      glyphPlan,
      drawn.map((m) => m[g]?.advance ?? 0),
    );
    for (const [k, region] of glyphPlan.regions.entries()) row[region] = deltas[k] ?? 0;
    return row;
  });
}

/**
 * The tables both flavours share: the names of the axes and styles, `fvar`,
 * `avar` where a map bends, `STAT`, and `HVAR`.
 */
export function withVariationTables(
  font: Uint8Array,
  prepared: PreparedVariable,
  plan: VariationPlan,
  advances: readonly (readonly number[])[],
): Uint8Array {
  let bytes = font;
  const { axes, instances } = prepared;

  // The names the axes and instances are known by, added to the table the
  // ordinary export wrote, and the numbers handed back.
  const names = [...axes.map((a) => a.name), ...instances.map((i) => i.name)];
  const written = withNames(nameTableOf(bytes), names);
  const axisNames = written.ids.slice(0, axes.length);
  const instanceNames = written.ids.slice(axes.length);

  bytes = withTable(bytes, "name", written.table);
  bytes = withTable(
    bytes,
    "fvar",
    fvarTable(
      axes.map((it, i) => ({ it, nameId: axisNames[i] ?? 0 })),
      instances.map((it, i) => ({ it, nameId: instanceNames[i] ?? 0 })),
    ),
  );
  const avar = avarTable(axes);
  if (avar !== null) bytes = withTable(bytes, "avar", avar);
  // Required of a variable font, and about the family rather than this file:
  // which of these weights is the regular one, and whether this font and
  // another are the same design.
  bytes = withTable(
    bytes,
    "STAT",
    statTable(axes.map((it, i) => ({ it, nameId: axisNames[i] ?? 0 }))),
  );

  // How the advances vary. Without it the letters change shape as the weight
  // moves and keep the spacing of the weight they were compiled at, which reads
  // as a broken rasteriser and is a missing table.
  bytes = withTable(bytes, "HVAR", hvarTable(axes, plan.regions, advances));
  return bytes;
}

export function notVaryingWarning(notVarying: readonly string[]): string[] {
  return notVarying.length === 0
    ? []
    : [
        `${String(notVarying.length)} glyphs do not vary because their masters disagree: ` +
          `${notVarying.slice(0, 8).join(", ")}${notVarying.length > 8 ? "…" : ""}`,
      ];
}

/**
 * One master's glyphs, prepared exactly as the compiler prepares the default.
 *
 * In the default master's order and only its glyphs: a glyph another master has
 * and this one does not is not in the font at all, and one this master lacks
 * cannot vary. Both are the compatibility check's business, and by the time a
 * font is being written the answer has to be a font.
 *
 * A component naming a glyph this master does not draw — which in a sparse
 * master is most of them — is resolved from `fallback`, the default master.
 */
export function flattened(
  document: FontDocument,
  order: readonly string[],
  fallback: FontDocument = document,
): Glyph[] {
  const ids = counterIds("v");
  const source: ComponentSource = {
    glyphOf: (name) => document.glyphs[name] ?? fallback.glyphs[name] ?? null,
  };

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
