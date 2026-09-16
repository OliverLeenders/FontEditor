import { Writer, coverage } from "./gpos.js";

/**
 * The substitution subtables of GSUB.
 *
 * Only what goes inside a lookup. The scaffolding the two layout tables share —
 * script list, feature list, lookup list — is in `layout.ts`, written once for
 * both.
 *
 * The lookup types a font being drawn actually uses: one glyph for another, one
 * for several, one of a set of alternates, a run of glyphs for one, and any of
 * those again conditioned on what surrounds it.
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
/** One glyph into several: `sub f_i by f i;`. */
export type MultipleSub = { readonly from: number; readonly to: readonly number[] };

/** One glyph, and the alternates an application may offer for it. */
export type AlternateSub = { readonly from: number; readonly alternates: readonly number[] };

/**
 * A lookup of one glyph to a list: a multiple substitution or an alternate set.
 *
 * The two formats are laid out alike — a coverage of the glyphs, and for each
 * one a count and a list — and differ only in what the list means: glyphs that
 * all replace the one, or glyphs of which one is chosen.
 */
function sequences(entries: readonly { from: number; list: readonly number[] }[]): Uint8Array {
  const sorted = [...entries].sort((l, r) => l.from - r.from);
  const cover = coverage(sorted.map((e) => e.from));

  const lists = sorted.map((entry) => {
    const w = new Writer();
    w.u16(entry.list.length);
    for (const id of entry.list) w.u16(id);
    return w.finish();
  });

  const header = 6 + lists.length * 2;
  let at = header + cover.length;
  const offsets = lists.map((list) => {
    const here = at;
    at += list.length;
    return here;
  });

  const w = new Writer();
  w.u16(1); // format 1, the only one
  w.u16(header); // the coverage sits between the offsets and the lists
  w.u16(lists.length);
  for (const off of offsets) w.u16(off);
  w.bytesOf(cover);
  for (const list of lists) w.bytesOf(list);
  return w.finish();
}

/** A multiple substitution: each covered glyph becomes a run of glyphs. */
export function multipleSubst(subs: readonly MultipleSub[]): Uint8Array {
  return sequences(subs.map((s) => ({ from: s.from, list: s.to })));
}

/** An alternate substitution: each covered glyph offers a set to choose from. */
export function alternateSubst(subs: readonly AlternateSub[]): Uint8Array {
  return sequences(subs.map((s) => ({ from: s.from, list: s.alternates })));
}

/**
 * A reverse chaining substitution: one glyph swapped, chosen by its context,
 * with the line read from the end.
 *
 * The one rule in the language that runs backwards, and what it is for: a form
 * chosen by what *follows* it, when what follows has already been decided.
 * Arabic final forms are the reason it exists.
 *
 * One glyph becomes one glyph — there is no ligature or one-into-several form
 * of this — and the context is never replaced.
 */
export type ReverseSub = {
  readonly backtrack: readonly (readonly number[])[];
  readonly lookahead: readonly (readonly number[])[];
  /** What is replaced, and by what. Written in coverage order, as the format wants. */
  readonly pairs: readonly { readonly from: number; readonly to: number }[];
};

/** A reverse chaining single substitution, format 1 — the only format there is. */
export function reverseChainSubst(rule: ReverseSub): Uint8Array {
  const sorted = [...rule.pairs].sort((l, r) => l.from - r.from);
  const cover = coverage(sorted.map((pair) => pair.from));
  // Backwards, as a chaining context stores it: the position nearest the match
  // first, which is the order a shaper steps away from the match in.
  const back = [...rule.backtrack].reverse().map((ids) => coverage(ids));
  const ahead = rule.lookahead.map((ids) => coverage(ids));

  const header =
    2 + // format
    2 + // the coverage of what is replaced
    2 +
    back.length * 2 +
    2 +
    ahead.length * 2 +
    2 +
    sorted.length * 2;

  let at = header;
  const offsets = [cover, ...back, ...ahead].map((table) => {
    const here = at;
    at += table.length;
    return here;
  });

  const w = new Writer();
  w.u16(1);
  w.u16(offsets[0]!);
  w.u16(back.length);
  for (let i = 0; i < back.length; i++) w.u16(offsets[1 + i]!);
  w.u16(ahead.length);
  for (let i = 0; i < ahead.length; i++) w.u16(offsets[1 + back.length + i]!);
  w.u16(sorted.length);
  for (const pair of sorted) w.u16(pair.to);
  for (const table of [cover, ...back, ...ahead]) w.bytesOf(table);
  return w.finish();
}

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

/**
 * A chaining contextual adjustment: GPOS type 8, format 3.
 *
 * Byte for byte the same layout as the substitution — the coverages of the
 * backtrack, the input and the lookahead, then which lookup runs where — with
 * the lookups it points at being positioning ones. Kept as a name of its own so
 * that the table each one belongs in is said where it is used.
 */
export const chainContextPos: (rule: ChainRule) => Uint8Array = chainContextSubst;
