import { Writer, coverage } from "./gpos.js";

/**
 * Building GSUB by hand, as GPOS beside it is built.
 *
 * The two tables share their entire outer shape — a script list, a feature list
 * and a lookup list, in that order, with the same headers. What differs is the
 * lookups inside. So the scaffolding here is written once and general, where
 * GPOS's is written for the single `kern` feature it needs; if GPOS ever wants a
 * second feature it should come here rather than grow one of its own.
 *
 * Three lookup types, and they are the ones a font being drawn actually uses:
 * one glyph for another, a run of glyphs for one, and either of those again
 * conditioned on what surrounds it.
 */

export type SingleSub = {
  /** Glyph ids, and what each becomes. Equal lengths, sorted by the caller. */
  readonly from: readonly number[];
  readonly to: readonly number[];
};

export type LigatureSub = {
  /** The run being replaced, as glyph ids. Two or more. */
  readonly from: readonly number[];
  readonly to: number;
};

/**
 * A single substitution, in the format that stores the replacements outright.
 *
 * Format 2 rather than format 1. Format 1 stores one delta added to every glyph
 * id in the coverage, which is smaller when a font happens to be ordered so that
 * every replacement sits the same distance from its original — and is a trap,
 * because nothing keeps a font ordered that way and the saving is a few bytes.
 */
export function singleSubst(sub: SingleSub): Uint8Array {
  const pairs = sub.from.map((id, i) => ({ id, to: sub.to[i]! })).sort((l, r) => l.id - r.id);

  const cover = coverage(pairs.map((p) => p.id));
  const w = new Writer();
  w.u16(2); // format 2: a list of replacements
  w.u16(6 + pairs.length * 2); // offset to the coverage, which follows the list
  w.u16(pairs.length);
  for (const pair of pairs) w.u16(pair.to);
  w.bytesOf(cover);
  return w.finish();
}

/**
 * A ligature substitution.
 *
 * Grouped by first glyph, which is how the format is arranged: the coverage
 * holds the first glyph of every ligature, and each covered glyph has a set of
 * ligatures that start with it. Within a set the longest run must come first, or
 * a shaper matching `f` `f` `i` finds `ff` and stops.
 */
export function ligatureSubst(ligatures: readonly LigatureSub[]): Uint8Array {
  const byFirst = new Map<number, LigatureSub[]>();
  for (const lig of ligatures) {
    const first = lig.from[0];
    if (first === undefined || lig.from.length < 2) continue;
    const list = byFirst.get(first) ?? [];
    list.push(lig);
    byFirst.set(first, list);
  }

  const firsts = [...byFirst.keys()].sort((l, r) => l - r);
  if (firsts.length === 0) return new Uint8Array(0);

  const sets = firsts.map((first) => {
    // Longest first: a shaper takes the first match it finds, so `ffi` has to be
    // offered before `ff` or it can never be reached.
    const list = [...byFirst.get(first)!].sort((l, r) => r.from.length - l.from.length);

    const tables = list.map((lig) => {
      const w = new Writer();
      w.u16(lig.to);
      w.u16(lig.from.length);
      // The first glyph is in the coverage, so only the rest is listed.
      for (const id of lig.from.slice(1)) w.u16(id);
      return w.finish();
    });

    const header = 2 + tables.length * 2;
    let at = header;
    const offsets = tables.map((t) => {
      const here = at;
      at += t.length;
      return here;
    });

    const set = new Writer();
    set.u16(tables.length);
    for (const off of offsets) set.u16(off);
    for (const t of tables) set.bytesOf(t);
    return set.finish();
  });

  const cover = coverage(firsts);
  const header = 6 + sets.length * 2;
  let at = header + cover.length;
  const setOffsets = sets.map((s) => {
    const here = at;
    at += s.length;
    return here;
  });

  const w = new Writer();
  w.u16(1); // the only format
  w.u16(header); // the coverage sits between the offsets and the sets
  w.u16(sets.length);
  for (const off of setOffsets) w.u16(off);
  w.bytesOf(cover);
  for (const s of sets) w.bytesOf(s);
  return w.finish();
}

/**
 * A chaining contextual substitution, in the format that matches by coverage.
 *
 * Format 3 rather than 1 or 2. The other two hold rule sets hung off the first
 * glyph or off a class definition, which is smaller for a feature with hundreds
 * of rules and is a second index to keep in step for a feature with three.
 * Format 3 is one rule per subtable, each position a coverage of its own.
 *
 * The table stores the backtrack backwards — the position nearest the match
 * first — because that is the order a shaper walks it in, stepping away from the
 * match one glyph at a time. Callers pass reading order and this reverses it,
 * since reading order is what the rule was written in.
 *
 * A rule with no actions matches and does nothing, which is what `ignore` is:
 * the subtables of a lookup are tried in order and the first to match wins, so
 * an ignore rule placed before another stops it.
 */
export type ChainRule = {
  readonly backtrack: readonly (readonly number[])[];
  readonly input: readonly (readonly number[])[];
  readonly lookahead: readonly (readonly number[])[];
  /** Which lookup runs at which position of the input. */
  readonly actions: readonly { readonly at: number; readonly lookup: number }[];
};

export function chainContextSubst(rule: ChainRule): Uint8Array {
  const back = [...rule.backtrack].reverse();
  const runs = [back, rule.input, rule.lookahead];
  const covers = runs.flat().map((ids) => coverage(ids));

  const header =
    2 + // format
    runs.reduce((n, run) => n + 2 + run.length * 2, 0) +
    2 + // the count of lookup records
    rule.actions.length * 4;

  let at = header;
  const offsets = covers.map((cover) => {
    const here = at;
    at += cover.length;
    return here;
  });

  const w = new Writer();
  w.u16(3);
  let taken = 0;
  for (const run of runs) {
    w.u16(run.length);
    for (let i = 0; i < run.length; i++) w.u16(offsets[taken + i]!);
    taken += run.length;
  }
  w.u16(rule.actions.length);
  for (const action of rule.actions) {
    w.u16(action.at);
    w.u16(action.lookup);
  }
  for (const cover of covers) w.bytesOf(cover);
  return w.finish();
}

/** One lookup: a type, and the subtables it holds, tried in order. */
export type Lookup = {
  /** 1 for single substitution, 4 for ligature, 6 for chaining contextual. */
  readonly type: number;
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
 */
export function gsubTable(
  features: readonly FeatureEntry[],
  lookups: readonly Lookup[],
): Uint8Array {
  const usable = features.filter((f) => f.lookups.length > 0);
  if (lookups.length === 0 || usable.length === 0) return new Uint8Array(0);
  if (lookups.some((l) => l.subtables.length === 0)) return new Uint8Array(0);

  const lookupTables = lookups.map((lookup) => {
    // Tried in the order they are written, first match winning — which is what
    // makes an `ignore` rule work, and why the caller's order is kept.
    const head = 6 + lookup.subtables.length * 2;
    let at = head;
    const offsets = lookup.subtables.map((sub) => {
      const here = at;
      at += sub.length;
      return here;
    });

    const w = new Writer();
    w.u16(lookup.type);
    w.u16(0); // no flags
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
