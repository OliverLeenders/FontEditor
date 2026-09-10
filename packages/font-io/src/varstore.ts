import type { Axis, Location, Support } from "@typewright/font-model";
import { supportsFor } from "@typewright/font-model";

import { Bytes } from "./bytes.js";

/**
 * The regions a variable font varies over.
 *
 * Every variation in a font — an outline, a metric, a kerning value — is a set
 * of deltas and a statement of where each delta applies. The where is a
 * *region*: a start, a peak and an end on each axis, in the normalised −1 to 1
 * the format works in. An item variation store is the list of those regions,
 * shared by everything that varies.
 *
 * The regions are exactly the ones the interpolation model already works out —
 * see `@typewright/font-model`'s `supportsFor` — which is the point of having
 * written that the way a variable font does. What the editor previews and what
 * the font draws come out of the same arithmetic, so a preview that looks right
 * is a font that is right.
 *
 * In CFF2 the store carries only the regions: the deltas themselves live inside
 * the charstrings, next to the values they vary. `itemCount` is therefore zero
 * and there is nothing in the delta sets, which looks wrong and is exactly what
 * the format asks for.
 */

/** The regions of a designspace, in the order the deltas will refer to them. */
export function regionsOf(axes: readonly Axis[], locations: readonly Location[]): Support[] {
  // The default master has a region of nothing — it is what the deltas are
  // measured from — so it contributes no region and no delta.
  return supportsFor(axes, locations).filter((support) => Object.keys(support).length > 0);
}

/**
 * Which masters produce a delta, in region order.
 *
 * The same filter as `regionsOf`, said as indices, so a caller can line each
 * region up with the master it came from.
 */
export function deltaMasters(axes: readonly Axis[], locations: readonly Location[]): number[] {
  const supports = supportsFor(axes, locations);
  return supports.flatMap((support, i) => (Object.keys(support).length > 0 ? [i] : []));
}

/**
 * An `ItemVariationStore`, format 1.
 *
 * One `ItemVariationData` naming every region, because CFF2 charstrings select
 * a set of regions by index into this list and everything here varies over all
 * of them. A font with several sets — outlines varying over one set of regions
 * and metrics over another — would have several, and nothing writes one yet.
 */
export function itemVariationStore(
  axes: readonly Axis[],
  regions: readonly Support[],
  /**
   * One row of deltas per item, each with one delta per region.
   *
   * Empty for CFF2, whose deltas live in the charstrings. Given for `HVAR`,
   * where the deltas are here and the charstrings know nothing about them.
   */
  deltas: readonly (readonly number[])[] = [],
): Uint8Array {
  const out = new Bytes();

  out.u16(1); // format
  const regionListAt = out.length;
  out.u32(0); // filled in below
  out.u16(1); // one ItemVariationData
  const dataAt = out.length;
  out.u32(0);

  // The subtable first, so the region list can be written last and the two
  // offsets both known before either is patched.
  out.patchU32(dataAt, out.length);
  out.u16(deltas.length); // itemCount: none for CFF2, whose deltas are elsewhere
  // Every delta a full sixteen bits. The format allows the last of them to be
  // bytes, saving one byte per delta per glyph, at the price of a rule about
  // which are which that is worth more than the bytes.
  out.u16(regions.length);
  out.u16(regions.length);
  for (let i = 0; i < regions.length; i++) out.u16(i);

  for (const row of deltas) {
    for (let i = 0; i < regions.length; i++) out.i16(Math.round(row[i] ?? 0));
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
 * Written with no mapping, which means the plain one: the delta for glyph *n*
 * is row *n* of the store. A font with many glyphs sharing an advance can map
 * them onto fewer rows; that is a saving rather than a difference, and it is
 * not worth the arithmetic here.
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
  out.bytes(itemVariationStore(axes, regions, advances));

  return out.done();
}
