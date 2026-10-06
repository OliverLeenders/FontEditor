import { TableTooLarge, Writer, classDef, coverage } from "./gpos.js";
import { type ChainRule, chainContextSubst } from "./gsub.js";

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

type Group = {
  readonly rules: ChainRule[];
  readonly back: Sorting;
  readonly input: Sorting;
  readonly ahead: Sorting;
};

const group = (): Group => ({ rules: [], back: sorting(), input: sorting(), ahead: sorting() });

/** Put a rule with the ones before it, if it agrees with them. */
function take(into: Group, rule: ChainRule): boolean {
  const back = fresh(into.back, rule.backtrack);
  const input = fresh(into.input, rule.input);
  const ahead = fresh(into.ahead, rule.lookahead);
  if (back === null || input === null || ahead === null) return false;
  add(into.back, back);
  add(into.input, input);
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
  const count = g.input.classOf.size + 1;
  const beginning: ChainRule[][] = Array.from({ length: count }, () => []);
  for (const rule of g.rules) beginning[g.input.classOf.get(keyOf(rule.input[0]!))!]!.push(rule);

  const ruleBytes = (rule: ChainRule): Uint8Array => {
    const w = new Writer();
    // Nearest first, as the format has what comes before.
    const back = classes(g.back, [...rule.backtrack].reverse());
    w.u16(back.length);
    for (const c of back) w.u16(c);
    // The first of the run is the class the rule is filed under.
    const input = classes(g.input, rule.input);
    w.u16(input.length);
    for (const c of input.slice(1)) w.u16(c);
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
  const defs = [classDefOf(g.back), classDefOf(g.input), classDefOf(g.ahead)];

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

/** A group as subtables: one, or as many as it takes for each to be within reach of itself. */
function written(g: Group): Uint8Array[] {
  const [only] = g.rules;
  if (only === undefined) return [];
  // A rule alone is written as it always was: its lists, and no classes.
  if (g.rules.length === 1) return [chainContextSubst(only)];
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
  let current = group();
  for (const rule of rules) {
    if (take(current, rule)) continue;
    out.push(...written(current));
    current = group();
    // A rule that does not agree with itself — two of its places sharing
    // some glyphs and not all — is written by its lists.
    if (!take(current, rule)) out.push(chainContextSubst(rule));
  }
  out.push(...written(current));
  return out;
}
