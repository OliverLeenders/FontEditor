import type { GlyphName } from "./document.js";

/**
 * Kerning: the space added or removed between two particular glyphs.
 *
 * Sidebearings space a glyph against everything; kerning corrects the pairs
 * that then look wrong. `A` and `V` lean away from each other and need pulling
 * together; almost nothing else in the alphabet does.
 *
 * Mostly it is written between *groups* rather than individual glyphs, because
 * every round letter behaves the same way against every stem and spelling that
 * out is thousands of pairs by hand. A pair's two sides may each be a glyph or a
 * group, and the most specific match wins — which is how a single exception is
 * expressed without disturbing the class it belongs to.
 */

/** A reference to a group rather than a glyph, in a pair's key. */
export const GROUP_PREFIX = "@";

/**
 * Groups are scoped to the side they appear on.
 *
 * `O` on the left of a pair and `O` on the right are different sets — the left
 * one is about what the letter's right flank looks like, the right one about its
 * left flank — and a font that used one set for both would kern `OO` against
 * itself wrongly. UFO makes the same split with its `public.kern1` and
 * `public.kern2` prefixes.
 */
export type Kerning = {
  readonly firstGroups: Readonly<Record<string, readonly GlyphName[]>>;
  readonly secondGroups: Readonly<Record<string, readonly GlyphName[]>>;
  /**
   * Values, keyed first side then second. A key naming a group is written with
   * a leading `@`, which no legal glyph name may begin with.
   */
  readonly pairs: Readonly<Record<string, Readonly<Record<string, number>>>>;
};

export const EMPTY_KERNING: Kerning = { firstGroups: {}, secondGroups: {}, pairs: {} };

export function groupKey(name: string): string {
  return GROUP_PREFIX + name;
}

export function isGroupKey(key: string): boolean {
  return key.startsWith(GROUP_PREFIX);
}

export function groupNameOf(key: string): string {
  return isGroupKey(key) ? key.slice(GROUP_PREFIX.length) : key;
}

// ---------------------------------------------------------------------------
// lookup
// ---------------------------------------------------------------------------

/**
 * Group membership turned inside out, so a lookup is two map reads.
 *
 * Built once and reused, because kerning is asked for while a line of text is
 * being laid out — once per adjacent pair, on every frame — and scanning every
 * group for every pair would make a long proof crawl.
 *
 * A glyph belongs to at most one group per side. Fonts that break that rule
 * exist; the first group listed wins, which is what other tools do and is at
 * least predictable.
 */
export type KernIndex = {
  readonly kerning: Kerning;
  readonly firstOf: ReadonlyMap<GlyphName, string>;
  readonly secondOf: ReadonlyMap<GlyphName, string>;
};

export function kernIndex(kerning: Kerning): KernIndex {
  const firstOf = new Map<GlyphName, string>();
  const secondOf = new Map<GlyphName, string>();

  for (const [name, glyphs] of Object.entries(kerning.firstGroups)) {
    for (const glyph of glyphs) if (!firstOf.has(glyph)) firstOf.set(glyph, name);
  }
  for (const [name, glyphs] of Object.entries(kerning.secondGroups)) {
    for (const glyph of glyphs) if (!secondOf.has(glyph)) secondOf.set(glyph, name);
  }

  return { kerning, firstOf, secondOf };
}

/**
 * The value for a pair of glyphs, or zero.
 *
 * Specificity decides, not order: a pair naming both glyphs beats one naming a
 * glyph and a group, which beats one naming two groups. That ordering is what
 * makes an exception possible — `T` against `A` can be corrected without
 * touching the class `A` belongs to, and without the class then overriding it.
 */
export function kernValue(index: KernIndex, left: GlyphName, right: GlyphName): number {
  const { pairs } = index.kerning;
  const leftGroup = index.firstOf.get(left);
  const rightGroup = index.secondOf.get(right);

  const firsts = leftGroup === undefined ? [left] : [left, groupKey(leftGroup)];
  const seconds = rightGroup === undefined ? [right] : [right, groupKey(rightGroup)];

  for (const first of firsts) {
    for (const second of seconds) {
      const value = pairs[first]?.[second];
      if (value !== undefined) return value;
    }
  }
  return 0;
}

/** Which pair actually applied, for an interface that has to explain itself. */
export type KernMatch = {
  readonly first: string;
  readonly second: string;
  readonly value: number;
  /** True when a group was involved, so editing it moves more than this pair. */
  readonly grouped: boolean;
};

export function kernMatch(index: KernIndex, left: GlyphName, right: GlyphName): KernMatch | null {
  const { pairs } = index.kerning;
  const leftGroup = index.firstOf.get(left);
  const rightGroup = index.secondOf.get(right);

  const firsts = leftGroup === undefined ? [left] : [left, groupKey(leftGroup)];
  const seconds = rightGroup === undefined ? [right] : [right, groupKey(rightGroup)];

  for (const first of firsts) {
    for (const second of seconds) {
      const value = pairs[first]?.[second];
      if (value !== undefined) {
        return { first, second, value, grouped: isGroupKey(first) || isGroupKey(second) };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// editing
// ---------------------------------------------------------------------------

/**
 * Set a pair's value.
 *
 * Zero removes the entry rather than storing it. A stored zero and no entry at
 * all mean the same thing to a renderer, but not to a person reading the file or
 * to a class-based lookup, where an explicit zero is a real exception meaning
 * "these two, specifically, are not kerned". Both are needed, so writing zero
 * clears and {@link setKernException} is how you say the other thing.
 */
export function setKern(k: Kerning, first: string, second: string, value: number): Kerning {
  if (value === 0) return clearKern(k, first, second);
  if (k.pairs[first]?.[second] === value) return k;

  return {
    ...k,
    pairs: { ...k.pairs, [first]: { ...k.pairs[first], [second]: value } },
  };
}

/** Store a value even when it is zero, which is how an exception is written. */
export function setKernException(k: Kerning, first: string, second: string): Kerning {
  if (k.pairs[first]?.[second] === 0) return k;
  return { ...k, pairs: { ...k.pairs, [first]: { ...k.pairs[first], [second]: 0 } } };
}

export function clearKern(k: Kerning, first: string, second: string): Kerning {
  const row = k.pairs[first];
  if (row === undefined || !(second in row)) return k;

  const nextRow = { ...row };
  delete nextRow[second];

  const pairs = { ...k.pairs };
  // A row with nothing left in it is removed, so the file does not accumulate
  // empty dictionaries as pairs are tried and abandoned.
  if (Object.keys(nextRow).length === 0) delete pairs[first];
  else pairs[first] = nextRow;

  return { ...k, pairs };
}

export function setKernGroup(
  k: Kerning,
  side: "first" | "second",
  name: string,
  glyphs: readonly GlyphName[],
): Kerning {
  const key = side === "first" ? "firstGroups" : "secondGroups";
  return { ...k, [key]: { ...k[key], [name]: [...glyphs] } };
}

/**
 * Remove a group, and every pair that referred to it.
 *
 * Leaving the pairs would leave rules that can never match, which read as
 * kerning that mysteriously does nothing.
 */
export function removeKernGroup(k: Kerning, side: "first" | "second", name: string): Kerning {
  const key = side === "first" ? "firstGroups" : "secondGroups";
  if (!(name in k[key])) return k;

  const groups = { ...k[key] };
  delete groups[name];

  const reference = groupKey(name);
  const pairs: Record<string, Record<string, number>> = {};
  for (const [first, row] of Object.entries(k.pairs)) {
    if (side === "first" && first === reference) continue;
    const kept: Record<string, number> = {};
    for (const [second, value] of Object.entries(row)) {
      if (side === "second" && second === reference) continue;
      kept[second] = value;
    }
    if (Object.keys(kept).length > 0) pairs[first] = kept;
  }

  return { ...k, [key]: groups, pairs };
}

/**
 * Rename a group, carrying its pairs with it.
 *
 * Pairs name a group by its name, so a rename that touched only the group list
 * would leave every rule pointing at something that is no longer there. Refuses
 * a name already taken on that side rather than quietly merging two groups.
 */
export function renameKernGroup(
  k: Kerning,
  side: "first" | "second",
  from: string,
  to: string,
): Kerning {
  if (from === to) return k;
  const key = side === "first" ? "firstGroups" : "secondGroups";
  if (!(from in k[key]) || to in k[key]) return k;

  // Rebuilt in place rather than deleted and appended, so renaming a group does
  // not move it to the end of a list someone is reading down.
  const groups: Record<string, readonly GlyphName[]> = {};
  for (const [name, glyphs] of Object.entries(k[key])) groups[name === from ? to : name] = glyphs;

  const was = groupKey(from);
  const now = groupKey(to);
  const pairs: Record<string, Record<string, number>> = {};
  for (const [first, row] of Object.entries(k.pairs)) {
    const kept: Record<string, number> = {};
    for (const [second, value] of Object.entries(row)) {
      kept[side === "second" && second === was ? now : second] = value;
    }
    pairs[side === "first" && first === was ? now : first] = kept;
  }

  return { ...k, [key]: groups, pairs };
}

/**
 * Which group a glyph sits in on one side, or `null`.
 *
 * The first group listed, matching how `kernIndex` resolves a glyph that an
 * imported font put in two.
 */
export function kernGroupOf(k: Kerning, side: "first" | "second", glyph: GlyphName): string | null {
  const key = side === "first" ? "firstGroups" : "secondGroups";
  for (const [name, glyphs] of Object.entries(k[key])) if (glyphs.includes(glyph)) return name;
  return null;
}

/**
 * Put a glyph in a group, taking it out of whichever group on that side held it.
 *
 * A glyph in two groups on one side kerns differently depending on which group
 * is read first. Importing tolerates that, because such fonts exist; nothing
 * made here should write one.
 */
export function addToKernGroup(
  k: Kerning,
  side: "first" | "second",
  name: string,
  glyph: GlyphName,
): Kerning {
  const key = side === "first" ? "firstGroups" : "secondGroups";
  if (!(name in k[key])) return k;

  const groups: Record<string, readonly GlyphName[]> = {};
  let changed = false;
  for (const [each, glyphs] of Object.entries(k[key])) {
    if (each === name) {
      if (glyphs.includes(glyph)) groups[each] = glyphs;
      else {
        groups[each] = [...glyphs, glyph];
        changed = true;
      }
    } else if (glyphs.includes(glyph)) {
      groups[each] = glyphs.filter((one) => one !== glyph);
      changed = true;
    } else groups[each] = glyphs;
  }

  return changed ? { ...k, [key]: groups } : k;
}

/** Take a glyph out of a group, leaving the group and its pairs in place. */
export function removeFromKernGroup(
  k: Kerning,
  side: "first" | "second",
  name: string,
  glyph: GlyphName,
): Kerning {
  const key = side === "first" ? "firstGroups" : "secondGroups";
  const glyphs = k[key][name];
  if (glyphs === undefined || !glyphs.includes(glyph)) return k;
  return { ...k, [key]: { ...k[key], [name]: glyphs.filter((one) => one !== glyph) } };
}

/** How many pairs name a group, so deleting it can say what that costs. */
export function kernGroupPairCount(k: Kerning, side: "first" | "second", name: string): number {
  const reference = groupKey(name);
  let n = 0;
  for (const [first, row] of Object.entries(k.pairs)) {
    if (side === "first") {
      if (first === reference) n += Object.keys(row).length;
      continue;
    }
    for (const second of Object.keys(row)) if (second === reference) n++;
  }
  return n;
}

/** Every pair as a flat list, for writing files and for counting. */
export function kernPairs(k: Kerning): Array<{ first: string; second: string; value: number }> {
  const out: Array<{ first: string; second: string; value: number }> = [];
  for (const [first, row] of Object.entries(k.pairs)) {
    for (const [second, value] of Object.entries(row)) out.push({ first, second, value });
  }
  return out;
}

export function kernPairCount(k: Kerning): number {
  let n = 0;
  for (const row of Object.values(k.pairs)) n += Object.keys(row).length;
  return n;
}

/**
 * Rename a glyph everywhere the kerning mentions it.
 *
 * Two places, and missing either loses work silently. A glyph is named directly
 * on both sides of a pair, and it is named again as a member of any group it
 * belongs to — so a rename that only fixed the pairs would leave the group
 * pointing at nothing, and the pair rules that apply through that group would
 * quietly stop applying to the glyph.
 *
 * Group *names* are untouched: a group is not a glyph, and one called "O" that
 * happens to contain a glyph called "O" is a coincidence rather than a link.
 */
export function renameGlyphInKerning(k: Kerning, from: GlyphName, to: GlyphName): Kerning {
  if (from === to) return k;

  const inGroups = (groups: Kerning["firstGroups"]): Kerning["firstGroups"] => {
    let changed = false;
    const next: Record<string, readonly GlyphName[]> = {};
    for (const [name, members] of Object.entries(groups)) {
      if (!members.includes(from)) {
        next[name] = members;
        continue;
      }
      changed = true;
      // Renaming onto a name the group already holds must not list it twice.
      next[name] = [...new Set(members.map((m) => (m === from ? to : m)))];
    }
    return changed ? next : groups;
  };

  const side = (key: string): string => (key === from ? to : key);

  let pairsChanged = false;
  const pairs: Record<string, Record<string, number>> = {};
  for (const [first, row] of Object.entries(k.pairs)) {
    const nextFirst = side(first);
    if (nextFirst !== first) pairsChanged = true;

    // Merged rather than replaced: renaming onto a name that already has kerning
    // brings two rows together, and the one being renamed wins the overlap —
    // it is the glyph that is moving, so its values are the ones in hand.
    const row2: Record<string, number> = { ...pairs[nextFirst] };
    for (const [second, value] of Object.entries(row)) {
      const nextSecond = side(second);
      if (nextSecond !== second) pairsChanged = true;
      row2[nextSecond] = value;
    }
    pairs[nextFirst] = row2;
  }

  const firstGroups = inGroups(k.firstGroups);
  const secondGroups = inGroups(k.secondGroups);
  if (!pairsChanged && firstGroups === k.firstGroups && secondGroups === k.secondGroups) return k;

  return { firstGroups, secondGroups, pairs: pairsChanged ? pairs : k.pairs };
}
