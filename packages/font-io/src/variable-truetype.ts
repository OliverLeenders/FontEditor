import type { Axis } from "@typewright/font-model";
import { orderedGlyphs } from "@typewright/font-model";

import type { NamedInstance } from "./fvar.js";
import { type Drawn, compatiblePoints, glyfTable } from "./glyf.js";
import { type GlyphVariation, flatPoints, gvarTable } from "./gvar.js";
import { withLeftSideBearings } from "./hmtx.js";
import { readTablesOf, withSfntVersion, withTable } from "./sfnt.js";
import { exportTrueType } from "./truetype.js";
import { planVariations } from "./variation-plan.js";
import {
  type VariableMaster,
  type VariableOptions,
  type VariableResult,
  advanceRows,
  flattened,
  notVaryingWarning,
  prepareVariable,
  withVariationTables,
} from "./variable.js";

/**
 * A variable font with quadratic outlines: `glyf` and `gvar`.
 *
 * The other flavour of the same thing. CFF2 keeps the cubics as drawn and its
 * deltas live inside the charstrings; this converts to quadratics and keeps the
 * deltas in a table of their own. Both are legal variable fonts and a browser
 * takes either — but `glyf` is what a WOFF2 can transform, and a transformed
 * WOFF2 is what the web is actually served, so this is the flavour that matters
 * for shipping.
 *
 * The hard part is not the table. It is that every master has to convert to the
 * *same* points before any of this can begin, and how many points a cubic
 * becomes depends on how much it bends — see `compatiblePoints`, which settles
 * that for all the masters at once. A glyph whose masters cannot be matched
 * point for point is written from the default master and named in the warnings,
 * exactly as the CFF2 flavour does.
 */
export function exportVariableTrueType(
  axes: readonly Axis[],
  masters: readonly VariableMaster[],
  named: readonly NamedInstance[] = [],
  options: VariableOptions = {},
): VariableResult {
  const prepared = prepareVariable(axes, masters, named, options);
  const first = prepared.masters[0]!;

  // The whole font from the default master, in the flavour it will stay in.
  // Everything but the outlines and the variation tables is right after this.
  const base = exportTrueType(first.document, { swaps: prepared.swaps });
  let bytes: Uint8Array = new Uint8Array(base.bytes);

  const order = orderedGlyphs(first.document).map((g) => g.name);
  const drawn = prepared.masters.map((m) => flattened(m.document, order, first.document));

  // Every glyph converted across the masters that take part in it at once.
  // This is what `glyf` is written from as well, so the two tables cannot
  // disagree about what points the font has.
  const notVarying: string[] = [];
  const points: ((Drawn | undefined)[] | null)[] = order.map((name, g) => {
    const taking = prepared.masters.flatMap((m, i) =>
      i === 0 || m.sparse !== true || m.document.glyphs[name] !== undefined ? [i] : [],
    );
    const together = compatiblePoints(taking.map((i) => drawn[i]![g]!));
    if (together === null) {
      if (prepared.masters.length > 1) notVarying.push(name);
      return null;
    }
    const out: (Drawn | undefined)[] = prepared.masters.map(() => undefined);
    for (const [k, i] of taking.entries()) out[i] = together[k];
    return out;
  });

  const plan = planVariations(
    prepared.axes,
    prepared.masters.map((m) => m.location),
    points.map((it) => prepared.masters.map((_, i) => i === 0 || it?.[i] !== undefined)),
  );

  // A glyph whose masters could not be matched is left for `glyfTable` to
  // convert on its own, which is what a static font would have done with it.
  const defaults = points.map((it) => it?.[0]);
  const { glyf, loca, longLoca, maxPoints, maxContours, xMins } = glyfTable(drawn[0]!, defaults);

  bytes = withTable(bytes, "glyf", glyf);
  bytes = withTable(bytes, "loca", loca);
  // The default master's points can differ from the static flavour's by a unit
  // where they were converted together, so the sidebearings follow them.
  bytes = withLeftSideBearings(bytes, xMins);
  bytes = withTable(bytes, "maxp", maxpFrom(bytes, maxPoints, maxContours));
  bytes = withTable(bytes, "head", headLoca(bytes, longLoca));

  const variations: (GlyphVariation | null)[] = points.map((it, g) => {
    const glyphPlan = plan.glyphs[g];
    if (it === null || glyphPlan === undefined || glyphPlan.regions.length === 0) return null;

    const flats = it.map((d) => (d === undefined ? null : flatPoints(d)));
    const base = flats[0];
    // A master the conversion could not match point for point. Nothing honest
    // can be said about it, and saying nothing leaves the glyph at its default
    // shape rather than at a wrong one.
    if (base === null || base === undefined) return null;
    if (flats.some((f) => f !== null && f.length !== base.length)) return null;

    return {
      tuples: glyphPlan.regions.map((region, k) => {
        const row = glyphPlan.coefficients[k] ?? [];
        const sum = (read: (m: number) => number): number =>
          row.reduce((total, c, m) => (c === 0 ? total : total + c * read(m)), 0);

        const deltas: [number, number][] = base.map((_, j) => [
          sum((m) => flats[m]?.[j]?.x ?? 0),
          sum((m) => flats[m]?.[j]?.y ?? 0),
        ]);
        // The four phantom points. The second is the horizontal advance, and how
        // far it moves is how much wider the letter is there — which is the
        // whole of how spacing varies in this flavour. The other three do not
        // move: the origin travels with the outline, and there is no vertical
        // metric here to vary.
        deltas.push([0, 0], [sum((m) => drawn[m]?.[g]?.advance ?? 0), 0], [0, 0], [0, 0]);
        return { region: plan.regions[region]!, deltas };
      }),
    };
  });

  bytes = withTable(bytes, "gvar", gvarTable(prepared.axes, variations));

  // How the advances vary, in `HVAR` as well. `gvar`'s phantom points carry the
  // same thing, and this is the newer way and the one the CFF2 flavour uses.
  bytes = withVariationTables(bytes, prepared, plan, advanceRows(plan, drawn));
  bytes = withSfntVersion(bytes, 0x00010000);

  return {
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    warnings: [...base.warnings, ...prepared.warnings, ...notVaryingWarning(notVarying)],
    notVarying,
  };
}

/** `maxp` again, with the counts the new outlines need. */
function maxpFrom(font: Uint8Array, maxPoints: number, maxContours: number): Uint8Array {
  const table = readTablesOf(font).find((t) => t.tag === "maxp");
  const out = new Uint8Array(32);
  out.set(table === undefined ? new Uint8Array(32) : table.data.subarray(0, 32));

  const view = new DataView(out.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(6, maxPoints);
  view.setUint16(8, maxContours);
  return out;
}

/** `head` again, saying which form `loca` is in. */
function headLoca(font: Uint8Array, longLoca: number): Uint8Array {
  const table = readTablesOf(font).find((t) => t.tag === "head");
  if (table === undefined) return new Uint8Array();

  const out = new Uint8Array(table.data);
  new DataView(out.buffer).setInt16(50, longLoca);
  return out;
}
