import type { Axis, Support } from "@typewright/font-model";

import { Bytes } from "./bytes.js";

/**
 * The regions a variable font varies over.
 *
 * Every variation in a font — an outline, a metric, a kerning value — is a set
 * of deltas and a statement of where each delta applies. The where is a
 * *region*: a start, a peak and an end on each axis, in the normalised −1 to 1
 * the format works in. An item variation store is the list of those regions,
 * shared by everything that varies, and one or more sets of rows that each say
 * which of the regions their deltas are for.
 *
 * The regions are exactly the ones the interpolation model already works out —
 * see `@typewright/font-model`'s `variationModel`, gathered glyph by glyph in
 * `variation-plan.ts` — which is the point of having written that the way a
 * variable font does. What the editor previews and what the font draws come out
 * of the same arithmetic, so a preview that looks right is a font that is right.
 *
 * In CFF2 the store carries only the regions and the sets: the deltas themselves
 * live inside the charstrings, next to the values they vary, and a charstring
 * says which set it uses. Every set there has no rows, which looks wrong and is
 * exactly what the format asks for.
 */

/** One `ItemVariationData`: which regions, and a row of deltas per item. */
export type VariationData = {
  readonly regions: readonly number[];
  /** One row per item, one delta per region in `regions`. Empty for CFF2. */
  readonly rows: readonly (readonly number[])[];
};

/** An `ItemVariationStore`, format 1. */
export function itemVariationStore(
  axes: readonly Axis[],
  regions: readonly Support[],
  data: readonly VariationData[],
): Uint8Array {
  const out = new Bytes();

  out.u16(1); // format
  const regionListAt = out.length;
  out.u32(0); // filled in below
  out.u16(data.length);
  const dataAt = out.length;
  for (let i = 0; i < data.length; i++) out.u32(0);

  // The subtables first, so the region list can be written last and every
  // offset known before any is patched.
  for (const [i, set] of data.entries()) {
    out.patchU32(dataAt + i * 4, out.length);
    out.u16(set.rows.length); // itemCount: none for CFF2, whose deltas are elsewhere
    // Every delta a full sixteen bits. The format allows the last of them to be
    // bytes, saving one byte per delta per glyph, at the price of a rule about
    // which are which that is worth more than the bytes.
    out.u16(set.regions.length);
    out.u16(set.regions.length);
    for (const index of set.regions) out.u16(index);

    for (const row of set.rows) {
      for (let r = 0; r < set.regions.length; r++) out.i16(Math.round(row[r] ?? 0));
    }
  }

  out.patchU32(regionListAt, out.length);
  out.u16(axes.length);
  out.u16(regions.length);
  for (const region of regions) {
    for (const a of axes) {
      const at = region[a.tag];
      // An axis the region says nothing about is a region that spans it
      // entirely at no cost: start, peak and end all zero means "does not vary
      // with this axis", which is what a peak of zero says.
      out.f2dot14(at?.min ?? 0);
      out.f2dot14(at?.peak ?? 0);
      out.f2dot14(at?.max ?? 0);
    }
  }

  return out.done();
}

/**
 * `HVAR`: how the horizontal metrics vary.
 *
 * `hmtx` holds one advance per glyph and a variable font still has exactly one
 * `hmtx` — the default master's. Without this table a font's letters change
 * shape as the weight moves and keep the spacing of the weight they were
 * compiled at, which looks like a bug in the rasteriser and is a missing table.
 *
 * One set naming every region, and a row per glyph with a delta for each —
 * zero for the regions a glyph does not vary over. Written with no mapping,
 * which means the plain one: the delta for glyph *n* is row *n* of the store.
 */
export function hvarTable(
  axes: readonly Axis[],
  regions: readonly Support[],
  advances: readonly (readonly number[])[],
): Uint8Array {
  const out = new Bytes();

  out.u16(1).u16(0); // version 1.0
  const storeAt = out.length;
  out.u32(0);
  out.u32(0); // no advance width mapping: glyph n is row n
  out.u32(0); // no left side bearing mapping
  out.u32(0); // and none for the right

  out.patchU32(storeAt, out.length);
  out.bytes(
    itemVariationStore(axes, regions, [{ regions: regions.map((_, i) => i), rows: advances }]),
  );

  return out.done();
}
