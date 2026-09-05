import { Writer } from "./gpos.js";

/**
 * The shape GSUB and GPOS share.
 *
 * The two tables differ entirely in what their lookups contain and not at all
 * in how they are wrapped: a script list, a feature list and a lookup list, in
 * that order, with the same headers and the same rules about ordering. Written
 * once here so that a fix to the scaffolding is a fix to both, and so that
 * positioning can carry a feature that is not `kern` — which it could not while
 * its own builder had the tag written into it.
 */

/** One lookup: a type, its flags, and the subtables it holds, tried in order. */
export type Lookup = {
  /**
   * What the subtables are. The number means different things in the two
   * tables — 1 is a single substitution in GSUB and a single adjustment in
   * GPOS — which is why nothing here interprets it.
   */
  readonly type: number;
  /**
   * Lookup flags. The one that matters here is `IgnoreMarks` (8), which keeps
   * an accent between two letters from breaking a kern pair.
   */
  readonly flags?: number;
  readonly subtables: readonly Uint8Array[];
};

/** A feature, and which of the lookups it uses. */
export type FeatureEntry = {
  readonly tag: string;
  readonly lookups: readonly number[];
};

/**
 * Wrap lookups in the scaffolding a layout table needs.
 *
 * Features are listed in tag order, which the format requires — a shaper is
 * entitled to binary-search the list, and an unsorted one is read as a font with
 * features missing rather than as a broken font.
 *
 * Empty when there is nothing to say. A table whose feature list matches nothing
 * is worse than no table at all: it tells a shaper there is something to apply
 * and stops it falling back.
 */
export function layoutTable(
  features: readonly FeatureEntry[],
  lookups: readonly Lookup[],
): Uint8Array {
  const usable = features.filter((f) => f.lookups.length > 0);
  if (lookups.length === 0 || usable.length === 0) return new Uint8Array(0);
  if (lookups.some((l) => l.subtables.length === 0)) return new Uint8Array(0);

  const lookupTables = lookups.map((lookup) => {
    // Subtables are tried in the order they are written, first match winning —
    // which is what makes an exception rule work, and why the caller's order is
    // kept rather than sorted.
    const head = 6 + lookup.subtables.length * 2;
    let at = head;
    const offsets = lookup.subtables.map((sub) => {
      const here = at;
      at += sub.length;
      return here;
    });

    const w = new Writer();
    w.u16(lookup.type);
    w.u16(lookup.flags ?? 0);
    w.u16(lookup.subtables.length);
    for (const off of offsets) w.u16(off);
    for (const sub of lookup.subtables) w.bytesOf(sub);
    return w.finish();
  });

  const lookupHeader = 2 + lookupTables.length * 2;
  let at = lookupHeader;
  const lookupOffsets = lookupTables.map((l) => {
    const here = at;
    at += l.length;
    return here;
  });

  const lookupList = new Writer();
  lookupList.u16(lookupTables.length);
  for (const off of lookupOffsets) lookupList.u16(off);
  for (const l of lookupTables) lookupList.bytesOf(l);
  const lookupBytes = lookupList.finish();

  const sorted = [...usable].sort((l, r) => (l.tag < r.tag ? -1 : l.tag > r.tag ? 1 : 0));

  const featureTables = sorted.map((feature) => {
    const w = new Writer();
    w.u16(0); // no feature params
    w.u16(feature.lookups.length);
    for (const index of feature.lookups) w.u16(index);
    return w.finish();
  });

  const featureHeader = 2 + featureTables.length * 6;
  let featureAt = featureHeader;
  const featureOffsets = featureTables.map((f) => {
    const here = featureAt;
    featureAt += f.length;
    return here;
  });

  const featureList = new Writer();
  featureList.u16(featureTables.length);
  for (const [i, feature] of sorted.entries()) {
    featureList.tag(feature.tag.padEnd(4, " "));
    featureList.u16(featureOffsets[i]!);
  }
  for (const f of featureTables) featureList.bytesOf(f);
  const featureListBytes = featureList.finish();

  // DFLT/dflt, using every feature. A font with no language-specific behaviour
  // declares this, and shapers fall back to it for everything.
  const langSys = new Writer();
  langSys.u16(0); // lookup order, always null
  langSys.u16(0xffff); // no required feature
  langSys.u16(sorted.length);
  for (let i = 0; i < sorted.length; i++) langSys.u16(i);
  const langSysBytes = langSys.finish();

  const script = new Writer();
  script.u16(4); // offset to the default LangSys
  script.u16(0); // no named languages
  script.bytesOf(langSysBytes);
  const scriptBytes = script.finish();

  const scriptList = new Writer();
  scriptList.u16(1);
  scriptList.tag("DFLT");
  scriptList.u16(2 + 6);
  scriptList.bytesOf(scriptBytes);
  const scriptListBytes = scriptList.finish();

  const headerSize = 10;
  const w = new Writer();
  w.u32(0x00010000); // version 1.0
  w.u16(headerSize);
  w.u16(headerSize + scriptListBytes.length);
  w.u16(headerSize + scriptListBytes.length + featureListBytes.length);
  w.bytesOf(scriptListBytes);
  w.bytesOf(featureListBytes);
  w.bytesOf(lookupBytes);
  return w.finish();
}

/**
 * Put two sets of features together, keeping one entry per tag.
 *
 * Two tags the same in a feature list is a font whose second `kern` a shaper
 * ignores. The lookups of the later one are appended to the earlier, which is
 * the reading that keeps both.
 */
export function mergeFeatures(
  first: readonly FeatureEntry[],
  second: readonly FeatureEntry[],
): FeatureEntry[] {
  const out: FeatureEntry[] = [];
  for (const entry of [...first, ...second]) {
    const found = out.findIndex((e) => e.tag === entry.tag);
    if (found < 0) out.push({ tag: entry.tag, lookups: [...entry.lookups] });
    else out[found] = { tag: entry.tag, lookups: [...out[found]!.lookups, ...entry.lookups] };
  }
  return out;
}

/** Move a set of features' lookup indices along, for appending one list to another. */
export function shiftFeatures(features: readonly FeatureEntry[], by: number): FeatureEntry[] {
  return features.map((f) => ({ tag: f.tag, lookups: f.lookups.map((i) => i + by) }));
}
