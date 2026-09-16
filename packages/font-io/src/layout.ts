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
   * Lookup flags. The one that matters most is `IgnoreMarks` (8), which keeps
   * an accent between two letters from breaking a kern pair or a ligature.
   */
  readonly flags?: number;
  /**
   * Which mark glyph set the filtering flag means, as an index into GDEF's.
   *
   * Written only where that flag is set, since the field is not there otherwise
   * — the lookup's own header grows by two bytes to hold it.
   */
  readonly markFilteringSet?: number;
  readonly subtables: readonly Uint8Array[];
};

/**
 * A script, and a language written in it: where a font can behave differently.
 *
 * `DFLT` and `dflt` are the defaults, which a shaper falls back to for text in a
 * script or language the font says nothing particular about.
 */
export type LanguageSystem = { readonly script: string; readonly language: string };

/** What a font with nothing to say about scripts declares. */
export const DEFAULT_SYSTEMS: readonly LanguageSystem[] = [{ script: "DFLT", language: "dflt" }];

export const sameSystem = (a: LanguageSystem, b: LanguageSystem): boolean =>
  a.script === b.script && a.language === b.language;

/**
 * A feature, which of the lookups it uses, and where.
 *
 * With no `system`, everywhere the table declares: that is what kerning, marks
 * and a feature file that never mentions a script mean. With one, only there —
 * `locl` for Turkish, say — which is how a feature comes to use different
 * lookups in different languages.
 */
export type FeatureEntry = {
  readonly tag: string;
  readonly lookups: readonly number[];
  readonly system?: LanguageSystem;
};

/**
 * Wrap lookups in the scaffolding a layout table needs.
 *
 * `systems` are the language systems the font declares, and every feature
 * without a system of its own is offered in each of them. A system that only a
 * feature names is in the table too, offering just what names it.
 *
 * Features are listed in tag order, which the format requires — a shaper is
 * entitled to binary-search the list, and an unsorted one is read as a font with
 * features missing rather than as a broken font. A tag whose lookups differ from
 * one language to another is listed once for each set of lookups, and each
 * language points at the one that is its own.
 *
 * Empty when there is nothing to say. A table whose feature list matches nothing
 * is worse than no table at all: it tells a shaper there is something to apply
 * and stops it falling back.
 */
export function layoutTable(
  features: readonly FeatureEntry[],
  lookups: readonly Lookup[],
  systems: readonly LanguageSystem[] = DEFAULT_SYSTEMS,
): Uint8Array {
  const usable = features.filter((f) => f.lookups.length > 0);
  if (lookups.length === 0 || usable.length === 0) return new Uint8Array(0);
  if (lookups.some((l) => l.subtables.length === 0)) return new Uint8Array(0);

  const declared = systems.length > 0 ? systems : DEFAULT_SYSTEMS;
  const everywhere: LanguageSystem[] = [];
  for (const system of [...declared, ...usable.flatMap((f) => (f.system ? [f.system] : []))]) {
    if (!everywhere.some((s) => sameSystem(s, system))) everywhere.push(system);
  }

  // What each system's features are: the lookups of every entry that applies
  // there, in lookup-list order, each once.
  const records: { tag: string; lookups: number[] }[] = [];
  const recordKey = (tag: string, list: readonly number[]) => `${tag}|${list.join(",")}`;
  const keysOf = new Map<LanguageSystem, string[]>();
  for (const system of everywhere) {
    const byTag = new Map<string, Set<number>>();
    for (const f of usable) {
      const applies = f.system
        ? sameSystem(f.system, system)
        : declared.some((d) => sameSystem(d, system));
      if (!applies) continue;
      const set = byTag.get(f.tag) ?? new Set<number>();
      for (const index of f.lookups) set.add(index);
      byTag.set(f.tag, set);
    }
    const keys: string[] = [];
    for (const [tag, set] of byTag) {
      const list = [...set].sort((a, b) => a - b);
      const key = recordKey(tag, list);
      if (!records.some((r) => recordKey(r.tag, r.lookups) === key)) {
        records.push({ tag, lookups: list });
      }
      keys.push(key);
    }
    keysOf.set(system, keys);
  }
  if (records.length === 0) return new Uint8Array(0);

  const lookupTables = lookups.map((lookup) => {
    // Subtables are tried in the order they are written, first match winning —
    // which is what makes an exception rule work, and why the caller's order is
    // kept rather than sorted.
    // Two more bytes where the filtering flag is set: the set's index sits
    // after the subtable offsets, and everything after it moves along.
    const filtering = ((lookup.flags ?? 0) & 0x0010) !== 0;
    const head = 6 + lookup.subtables.length * 2 + (filtering ? 2 : 0);
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
    if (filtering) w.u16(lookup.markFilteringSet ?? 0);
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

  const sorted = [...records].sort((l, r) =>
    l.tag !== r.tag ? (l.tag < r.tag ? -1 : 1) : compareLists(l.lookups, r.lookups),
  );
  const indexOf = new Map(sorted.map((r, i) => [recordKey(r.tag, r.lookups), i]));

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

  /** A language's list of features, by index into the feature list. */
  const langSys = (system: LanguageSystem): Uint8Array => {
    const indices = (keysOf.get(system) ?? [])
      .map((key) => indexOf.get(key)!)
      .sort((a, b) => a - b);
    const w = new Writer();
    w.u16(0); // lookup order, always null
    w.u16(0xffff); // no required feature
    w.u16(indices.length);
    for (const index of indices) w.u16(index);
    return w.finish();
  };

  const scripts = [...new Set(everywhere.map((s) => s.script))].sort();
  const scriptTables = scripts.map((script) => {
    const own = everywhere.filter((s) => s.script === script);
    const fallback = own.find((s) => s.language === "dflt");
    const named = own
      .filter((s) => s.language !== "dflt")
      .sort((l, r) => (l.language < r.language ? -1 : l.language > r.language ? 1 : 0));

    const defaultBytes = fallback === undefined ? null : langSys(fallback);
    const namedBytes = named.map(langSys);

    const header = 4 + named.length * 6;
    let offset = header;
    const w = new Writer();
    w.u16(defaultBytes === null ? 0 : offset);
    if (defaultBytes !== null) offset += defaultBytes.length;
    w.u16(named.length);
    for (const [i, system] of named.entries()) {
      w.tag(system.language.padEnd(4, " "));
      w.u16(offset);
      offset += namedBytes[i]!.length;
    }
    if (defaultBytes !== null) w.bytesOf(defaultBytes);
    for (const bytes of namedBytes) w.bytesOf(bytes);
    return w.finish();
  });

  const scriptHeader = 2 + scriptTables.length * 6;
  let scriptAt = scriptHeader;
  const scriptList = new Writer();
  scriptList.u16(scriptTables.length);
  for (const [i, script] of scripts.entries()) {
    scriptList.tag(script.padEnd(4, " "));
    scriptList.u16(scriptAt);
    scriptAt += scriptTables[i]!.length;
  }
  for (const table of scriptTables) scriptList.bytesOf(table);
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

function compareLists(l: readonly number[], r: readonly number[]): number {
  for (let i = 0; i < Math.min(l.length, r.length); i++) {
    if (l[i] !== r[i]) return l[i]! - r[i]!;
  }
  return l.length - r.length;
}

/**
 * Put two sets of features together, keeping one entry per tag and system.
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
  const same = (a: FeatureEntry, b: FeatureEntry) =>
    a.tag === b.tag &&
    (a.system === undefined
      ? b.system === undefined
      : b.system !== undefined && sameSystem(a.system, b.system));
  for (const entry of [...first, ...second]) {
    const found = out.findIndex((e) => same(e, entry));
    if (found < 0) out.push(withLookups(entry, [...entry.lookups]));
    else out[found] = withLookups(entry, [...out[found]!.lookups, ...entry.lookups]);
  }
  return out;
}

/** Move a set of features' lookup indices along, for appending one list to another. */
export function shiftFeatures(features: readonly FeatureEntry[], by: number): FeatureEntry[] {
  return features.map((f) =>
    withLookups(
      f,
      f.lookups.map((i) => i + by),
    ),
  );
}

/** An entry with other lookups, and no `system` key at all where it had none. */
function withLookups(entry: FeatureEntry, lookups: readonly number[]): FeatureEntry {
  return entry.system === undefined
    ? { tag: entry.tag, lookups }
    : { tag: entry.tag, lookups, system: entry.system };
}
