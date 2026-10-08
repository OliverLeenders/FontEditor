import { TableTooLarge, Writer, classDef, coverage } from "./gpos.js";
import type { ChainRule } from "./gsub.js";

/**
 * Rules in a context, several to a subtable.
 *
 * A rule in a context can be written by itself — the glyphs allowed at each
 * place, each as a list of its own — and that is how one rule is written here.
 * A font with a few dozen of them is no larger for it. A Nastaliq has eleven
 * thousand, and a lookup can only point at so many subtables: one to a rule,
 * they are more than a font file has room to find.
 *
 * So rules that agree about their glyphs are written together, the way the
 * fonts that have so many write them. The glyphs are sorted into classes —
 * one sorting for what comes before, one for the run the rule is about, one
 * for what comes after — and each rule is then a few class numbers and no
 * lists at all. A thousand rules about the same forty sets of letters are the
 * forty sets once and a thousand short lines.
 *
 * What makes rules agree: every set of glyphs one of them names at a place is
 * either a set another names there too, or shares no glyph with any of them.
 * Then each set is a class. Rules are taken in the order written and a new
 * subtable is begun at the first that does not agree with the ones before it,
 * so the order they are tried in is the order they were written in: within a
 * subtable, rules that could match the same glyph begin with the same class,
 * and are kept in a row.
 *
 * But for the glyph a rule begins at, which is asked two things: whether it is
 * one the subtable covers at all, and then its class. So the set a rule begins
 * with need not be a class. It may be the part of one that the subtable covers
 * — the letters of a class that can begin a rule, where the class is also what
 * follows in other rules, with letters that begin none. A font written by
 * class and read back has its rules that way, each beginning with a class
 * narrowed to what its subtable covered; taken for a disagreement, two
 * thousand rules that were one subtable came back as thirteen hundred.
 */

type Sets = readonly (readonly number[])[];

/** The classes of one of the three runs: each set a rule has named, and whose glyphs they are. */
type Sorting = {
  readonly classOf: Map<string, number>;
  readonly setOf: Map<number, string>;
};

const sorting = (): Sorting => ({ classOf: new Map(), setOf: new Map() });

const keyOf = (ids: readonly number[]): string => [...new Set(ids)].sort((a, b) => a - b).join(",");

/**
 * The sets of a run that a sorting has not got yet, where they can be added
 * to it: `null` where one of them shares a glyph with a set already there, or
 * with another of its own, without being that set.
 */
function fresh(into: Sorting, sets: Sets): Map<string, readonly number[]> | null {
  const added = new Map<string, readonly number[]>();
  const claimed = new Set<number>();
  for (const set of sets) {
    const key = keyOf(set);
    if (key === "") return null;
    if (into.classOf.has(key) || added.has(key)) continue;
    for (const id of set) if (into.setOf.has(id) || claimed.has(id)) return null;
    for (const id of set) claimed.add(id);
    added.set(key, set);
  }
  return added;
}

function add(into: Sorting, sets: ReadonlyMap<string, readonly number[]>): void {
  for (const [key, set] of sets) {
    into.classOf.set(key, into.classOf.size + 1);
    for (const id of set) into.setOf.set(id, key);
  }
}

/**
 * The run a rule is about: the classes of what follows its first glyph, and
 * the sets rules begin with, which are kept apart because they are asked more
 * of — see above.
 */
type Run = {
  /** The sets named after the first place: classes, as in any sorting. */
  readonly later: Sorting;
  readonly sets: Map<string, readonly number[]>;
  /** The sets rules begin with, and whose glyphs they are: what the subtable covers. */
  readonly firsts: Map<string, readonly number[]>;
  readonly firstOf: Map<number, string>;
};

const run = (): Run => ({
  later: sorting(),
  sets: new Map(),
  firsts: new Map(),
  firstOf: new Map(),
});

/**
 * The class a set that rules begin with is filed under: one of the classes of
 * what follows, where it is the covered part of it, or `null` where it shares
 * no glyph with any and is a class of its own. `undefined` where it is neither
 * — it lies across classes, or the class has other covered glyphs than these.
 */
function classHolding(
  first: readonly number[],
  setOf: (id: number) => string | undefined,
  sets: (key: string) => readonly number[],
  covered: (id: number) => boolean,
): string | null | undefined {
  const keys = new Set(first.map(setOf));
  if (keys.size === 1 && keys.has(undefined)) return null;
  const [key] = keys;
  if (keys.size !== 1 || key === undefined) return undefined;
  const mine = new Set(first);
  return sets(key).every((id) => !covered(id) || mine.has(id)) ? key : undefined;
}

/** Whether a rule's run agrees with the ones taken so far; and take it, if it does. */
function takeRun(into: Run, input: Sets): boolean {
  const [first, ...rest] = input;
  if (first === undefined || first.length === 0) return false;
  const later = fresh(into.later, rest);
  if (later === null) return false;

  // The sets rules begin with share no glyph, or are the same set.
  const firstKey = keyOf(first);
  const known = into.firsts.has(firstKey);
  if (!known && first.some((id) => into.firstOf.has(id))) return false;

  // And each of them, this one among them, is still a class or the covered
  // part of one, with this rule's classes and its covered glyphs added.
  const added = new Map<number, string>();
  for (const [key, set] of later) for (const id of set) added.set(id, key);
  const setOf = (id: number): string | undefined => into.later.setOf.get(id) ?? added.get(id);
  const sets = (key: string): readonly number[] => into.sets.get(key) ?? later.get(key) ?? [];
  const mine = known ? null : new Set(first);
  const covered = (id: number): boolean => into.firstOf.has(id) || (mine?.has(id) ?? false);
  const all = known ? [...into.firsts.values()] : [...into.firsts.values(), first];
  // Only what this rule could have upset: every set, where it brought a class
  // or covered a glyph that was not there before.
  if (later.size > 0 || !known) {
    for (const set of all) {
      if (classHolding(set, setOf, sets, covered) === undefined) return false;
    }
  }

  add(into.later, later);
  for (const [key, set] of later) into.sets.set(key, set);
  if (!known) {
    into.firsts.set(firstKey, first);
    for (const id of first) into.firstOf.set(id, firstKey);
  }
  return true;
}

/** The classes of a run, numbered: those of what follows, and then the sets begun with that are their own. */
function numbered(r: Run): {
  readonly count: number;
  readonly of: Map<number, number>;
  readonly firstClass: (first: readonly number[]) => number;
  readonly laterClass: (set: readonly number[]) => number;
} {
  const of = new Map<number, number>();
  for (const [id, key] of r.later.setOf) of.set(id, r.later.classOf.get(key)!);
  const own = new Map<string, number>();
  let count = r.later.classOf.size + 1;
  for (const [key, set] of r.firsts) {
    const holding = classHolding(
      set,
      (id) => r.later.setOf.get(id),
      (k) => r.sets.get(k) ?? [],
      (id) => r.firstOf.has(id),
    );
    if (holding === null) {
      own.set(key, count);
      for (const id of set) of.set(id, count);
      count += 1;
    } else if (holding !== undefined) {
      own.set(key, r.later.classOf.get(holding)!);
    }
  }
  return {
    count,
    of,
    firstClass: (first) => own.get(keyOf(first))!,
    laterClass: (set) => r.later.classOf.get(keyOf(set))!,
  };
}

type Group = {
  readonly rules: ChainRule[];
  readonly back: Sorting;
  readonly input: Run;
  readonly ahead: Sorting;
};

const group = (): Group => ({ rules: [], back: sorting(), input: run(), ahead: sorting() });

/** Put a rule with the ones before it, if it agrees with them. */
function take(into: Group, rule: ChainRule): boolean {
  const back = fresh(into.back, rule.backtrack);
  const ahead = fresh(into.ahead, rule.lookahead);
  if (back === null || ahead === null) return false;
  // The run last, since taking it is not undone.
  if (!takeRun(into.input, rule.input)) return false;
  add(into.back, back);
  add(into.ahead, ahead);
  into.rules.push(rule);
  return true;
}

const classDefOf = (s: Sorting): Uint8Array =>
  classDef(new Map([...s.setOf].map(([id, key]) => [id, s.classOf.get(key)!])));

/** One subtable of rules by class: a chaining context, format 2. */
function byClass(g: Group): Uint8Array {
  const classes = (s: Sorting, sets: Sets): number[] =>
    sets.map((set) => s.classOf.get(keyOf(set))!);

  // The rules that begin with each class, in the order written.
  const input = numbered(g.input);
  const count = input.count;
  const beginning: ChainRule[][] = Array.from({ length: count }, () => []);
  for (const rule of g.rules) beginning[input.firstClass(rule.input[0]!)]!.push(rule);

  const ruleBytes = (rule: ChainRule): Uint8Array => {
    const w = new Writer();
    // Nearest first, as the format has what comes before.
    const back = classes(g.back, [...rule.backtrack].reverse());
    w.u16(back.length);
    for (const c of back) w.u16(c);
    // The first of the run is the class the rule is filed under.
    w.u16(rule.input.length);
    for (const set of rule.input.slice(1)) w.u16(input.laterClass(set));
    const ahead = classes(g.ahead, rule.lookahead);
    w.u16(ahead.length);
    for (const c of ahead) w.u16(c);
    w.u16(rule.actions.length);
    for (const action of rule.actions) {
      w.u16(action.at);
      w.u16(action.lookup);
    }
    return w.finish();
  };

  const sets = beginning.map((rules) => {
    if (rules.length === 0) return null;
    const written = rules.map(ruleBytes);
    const w = new Writer();
    w.u16(written.length);
    let at = 2 + written.length * 2;
    for (const bytes of written) {
      w.u16(at);
      at += bytes.length;
    }
    for (const bytes of written) w.bytesOf(bytes);
    return w.finish();
  });

  const covered = coverage(g.rules.flatMap((rule) => rule.input[0]!));
  const defs = [classDefOf(g.back), classDef(input.of), classDefOf(g.ahead)];

  const header = 12 + count * 2;
  let at = header;
  const place = (bytes: Uint8Array | null): number => {
    if (bytes === null) return 0;
    const here = at;
    at += bytes.length;
    return here;
  };
  const coverageAt = place(covered);
  const defsAt = defs.map(place);
  const setsAt = sets.map(place);

  const w = new Writer();
  w.u16(2);
  w.u16(coverageAt);
  for (const where of defsAt) w.u16(where);
  w.u16(count);
  for (const where of setsAt) w.u16(where);
  w.bytesOf(covered);
  for (const def of defs) w.bytesOf(def);
  for (const set of sets) if (set !== null) w.bytesOf(set);
  return w.finish();
}

/**
 * Rules written each by its lists, one after another, with every list they
 * name written once behind them.
 *
 * A rule by its lists is a subtable of its own: how many places, and for each
 * where its list of glyphs is, counted from the subtable's start. Nothing says
 * the list has to be the subtable's own. A row of such rules about the same
 * letters — and the rules that cannot be written by class are rows of exactly
 * that, the same three hundred glyphs named twice in each — point at the one
 * copy: each rule is a few numbers, and the lists follow the last of them.
 *
 * It leans on the subtables of a lookup lying one after another in the file
 * with nothing between, which is how `layout.ts` lays them, extension or not.
 * A list is found by sixteen bits, so a row is ended where its first rule
 * could no longer reach the last list.
 */
function byLists(rules: readonly ChainRule[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  type Placed = {
    readonly rule: ChainRule;
    readonly keys: readonly string[];
    readonly size: number;
  };
  let row: Placed[] = [];
  let lists = new Map<string, { readonly bytes: Uint8Array; readonly at: number }>();
  let heads = 0;
  let pool = 0;

  const flush = (): void => {
    if (row.length === 0) return;
    let at = 0;
    for (const [i, placed] of row.entries()) {
      const { rule, keys } = placed;
      const w = new Writer();
      w.u16(3);
      let taken = 0;
      for (const count of [rule.backtrack.length, rule.input.length, rule.lookahead.length]) {
        w.u16(count);
        for (let k = 0; k < count; k++) w.u16(heads - at + lists.get(keys[taken + k]!)!.at);
        taken += count;
      }
      w.u16(rule.actions.length);
      for (const action of rule.actions) {
        w.u16(action.at);
        w.u16(action.lookup);
      }
      // The lists behind the last of the row, which is the subtable they are
      // written with.
      if (i === row.length - 1) for (const list of lists.values()) w.bytesOf(list.bytes);
      out.push(w.finish());
      at += placed.size;
    }
    row = [];
    lists = new Map();
    heads = 0;
    pool = 0;
  };

  for (const rule of rules) {
    // Nearest first, as the format has what comes before.
    const sets = [...[...rule.backtrack].reverse(), ...rule.input, ...rule.lookahead];
    const keys = sets.map(keyOf);
    const size = 2 + 3 * 2 + sets.length * 2 + 2 + rule.actions.length * 4;
    const added = new Map<string, Uint8Array>();
    for (const [k, key] of keys.entries()) {
      if (!lists.has(key) && !added.has(key)) added.set(key, coverage(sets[k]!));
    }
    const more = [...added.values()].reduce((sum, bytes) => sum + bytes.length, 0);
    if (row.length > 0 && heads + size + pool + more > 0xffff) {
      flush();
      for (const [k, key] of keys.entries()) {
        if (!added.has(key)) added.set(key, coverage(sets[k]!));
      }
    }
    for (const [key, bytes] of added) {
      if (lists.has(key)) continue;
      lists.set(key, { bytes, at: pool });
      pool += bytes.length;
    }
    row.push({ rule, keys, size });
    heads += size;
  }
  flush();
  return out;
}

/** A group written by class: one subtable, or as many as it takes for each to be within reach of itself. */
function written(g: Group): Uint8Array[] {
  try {
    return [byClass(g)];
  } catch (error) {
    if (!(error instanceof TableTooLarge)) throw error;
  }
  // Too many for one: the first half and the second, each sorted afresh.
  const half = Math.ceil(g.rules.length / 2);
  return [...chainSubtables(g.rules.slice(0, half)), ...chainSubtables(g.rules.slice(half))];
}

/**
 * The subtables of a lookup of rules in a context, in the order the rules are
 * to be tried. For substitutions and for positioning alike: the two are the
 * same bytes, pointing at lookups of their own table.
 */
export function chainSubtables(rules: readonly ChainRule[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  // The rules written by their lists, waiting for the row of them to end.
  let alone: ChainRule[] = [];
  const settle = (g: Group): void => {
    // A rule alone is written as it always was: its lists, and no classes.
    if (g.rules.length < 2) {
      alone.push(...g.rules);
      return;
    }
    out.push(...byLists(alone), ...written(g));
    alone = [];
  };

  let current = group();
  for (const rule of rules) {
    if (take(current, rule)) continue;
    settle(current);
    current = group();
    // A rule that does not agree with itself — two of its places sharing
    // some glyphs and not all — is written by its lists.
    if (!take(current, rule)) alone.push(rule);
  }
  settle(current);
  out.push(...byLists(alone));
  return out;
}
