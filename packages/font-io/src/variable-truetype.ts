import type { Axis } from "@fonteditor/font-model";
import { orderedGlyphs } from "@fonteditor/font-model";

import { type NamedInstance, fvarTable, statTable } from "./fvar.js";
import { type Drawn, compatiblePoints, glyfTable } from "./glyf.js";
import { type GlyphVariation, gvarTable } from "./gvar.js";
import { withNames } from "./names.js";
import { readTablesOf, withSfntVersion, withTable } from "./sfnt.js";
import { exportTrueType } from "./truetype.js";
import { type VariableMaster, type VariableResult, flattened } from "./variable.js";
import { deltaMasters, hvarTable, regionsOf } from "./varstore.js";

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
): VariableResult {
  const first = masters[0];
  if (first === undefined) throw new Error("a variable font needs at least one master");
  if (axes.length === 0) throw new Error("a variable font needs at least one axis");

  // The whole font from the default master, in the flavour it will stay in.
  // Everything but the outlines and the variation tables is right after this.
  const base = exportTrueType(first.document);
  let bytes: Uint8Array = new Uint8Array(base.bytes);

  const order = orderedGlyphs(first.document).map((g) => g.name);
  const drawn = masters.map((m) => flattened(m.document, order));

  // Every glyph converted across every master at once. This is what `glyf` is
  // written from as well, so the two tables cannot disagree about what points
  // the font has.
  const notVarying: string[] = [];
  const points: (Drawn[] | null)[] = order.map((name, g) => {
    const together = compatiblePoints(drawn.map((m) => m[g]!));
    if (together === null) notVarying.push(name);
    return together;
  });

  // A glyph whose masters could not be matched is left for `glyfTable` to
  // convert on its own, which is what a static font would have done with it.
  const defaults = points.map((it) => it?.[0]);
  const { glyf, loca, longLoca, maxPoints, maxContours } = glyfTable(drawn[0]!, defaults);

  bytes = withTable(bytes, "glyf", glyf);
  bytes = withTable(bytes, "loca", loca);
  bytes = withTable(bytes, "maxp", maxpFrom(bytes, maxPoints, maxContours));
  bytes = withTable(bytes, "head", headLoca(bytes, longLoca));

  const locations = masters.map((m) => m.location);
  const regions = regionsOf(axes, locations);
  const varying = deltaMasters(axes, locations);

  const variations: (GlyphVariation | null)[] = points.map((it, g) => {
    if (it === null) return null;
    const at = varying.map((m) => it[m]).filter((d): d is Drawn => d !== undefined);
    if (at.length !== varying.length) return null;

    return {
      base: it[0]!,
      at,
      advance: drawn[0]?.[g]?.advance ?? 0,
      advanceAt: varying.map((m) => drawn[m]?.[g]?.advance ?? 0),
    };
  });

  bytes = withTable(bytes, "gvar", gvarTable(axes, regions, variations));

  // The names the axes and instances are known by, added to the table the
  // ordinary export wrote, and the numbers handed back.
  const instances: NamedInstance[] =
    named.length > 0 ? [...named] : masters.map((m) => ({ name: m.name, location: m.location }));
  const names = [...axes.map((a) => a.name), ...instances.map((i) => i.name)];
  const written = withNames(
    readTablesOf(bytes).find((t) => t.tag === "name")?.data ?? new Uint8Array(),
    names,
  );

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
  bytes = withTable(
    bytes,
    "STAT",
    statTable(axes.map((it, i) => ({ it, nameId: axisNames[i] ?? 0 }))),
  );

  // How the advances vary. `gvar`'s phantom points could carry this instead,
  // and this is the newer way and the one the CFF2 flavour already uses — so
  // the phantom points are written as zeroes and this is the single answer.
  const advances = order.map((_, g) =>
    varying.map((m) => (drawn[m]?.[g]?.advance ?? 0) - (drawn[0]?.[g]?.advance ?? 0)),
  );
  bytes = withTable(bytes, "HVAR", hvarTable(axes, regions, advances));

  bytes = withSfntVersion(bytes, 0x00010000);

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
