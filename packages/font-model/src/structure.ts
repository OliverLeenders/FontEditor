import {
  type FontDocument,
  type FontInfo,
  type GlyphName,
  putGlyph,
  removeGlyph,
  renameGlyph,
  setFeatures,
  setGlyphOrder,
  setKerning,
} from "./document.js";
import type { Glyph } from "./glyph.js";
import type { Grid } from "./grid.js";
import { type Kerning, groupNameOf, isGroupKey, renameKernGroup } from "./kerning.js";
import { scaledFont } from "./scale.js";
import { type SerifStyle, sameSerif } from "./serif.js";
import { addedSerifStyle, carriedSerifRemoval, carriedSerifRename } from "./serif-styles.js";

/**
 * What the masters of one typeface have to have in common, and carrying a
 * change to it from one master to the rest.
 *
 * A master is a whole font, and a family is several of them that have to be
 * the same font in everything but the drawing: the same glyphs under the same
 * names and code points, in the same order, with the same features, the same
 * kerning groups and the same family around them. Each is edited through one
 * master, because one master is all that is ever open — so a glyph added while
 * drawing the regular is not in the bold, and a font built from the two has a
 * hole where the bold's should be.
 *
 * The answer here is to say what *changed* in the master being left, and make
 * the same change to the others. Not to make them match it: a font opened with
 * its masters already different keeps those differences until somebody says
 * which master is right — see {@link structuralDifferences}, which is how they
 * are told — and a change is only ever what happened between two moments of
 * one master, which is something that can be known exactly.
 *
 * What stays a master's own is its drawing: outlines, advances, where an anchor
 * sits, how much a pair is kerned by, its style name and weight, its guides.
 *
 * Serif styles are both. That there is a style called Foot is the family's: an
 * end that has it in one master has it in the others, or the serif does not
 * vary. What Foot's numbers are is each master's own, and is how it varies —
 * slight in the light, heavy in the bold. So a style added, renamed or removed
 * is carried, and a style changed is not.
 */

/** The parts of a font's information that are the master's own, and are never carried across. */
const OWN_INFO: ReadonlySet<keyof FontInfo> = new Set([
  "styleName",
  "italicAngle",
  "openTypeOS2WeightClass",
  "openTypeOS2WidthClass",
  "openTypeNamePreferredSubfamilyName",
  "styleMapStyleName",
  // Carried, but as a scale of the whole master rather than as a number: see
  // `unitsPerEm` in the change.
  "unitsPerEm",
]);

/** A change to what the masters share, between two moments of one master. */
export type StructuralChange = {
  /** Glyphs called something else now, as the name they had and the name they have. */
  readonly renamed: readonly (readonly [GlyphName, GlyphName])[];
  readonly removed: readonly GlyphName[];
  /** Glyphs there were not before, whole: another master begins with a copy. */
  readonly added: readonly Glyph[];
  /** Glyphs whose code points changed, with what they are now. */
  readonly unicodes: readonly (readonly [GlyphName, readonly number[]])[];
  /** The order the glyphs are in now, where that changed. */
  readonly order: readonly GlyphName[] | null;
  readonly features: string | null;
  /** The kerning groups as they are now, where they changed, and the ones renamed on the way. */
  readonly groups: {
    readonly first: Kerning["firstGroups"];
    readonly second: Kerning["secondGroups"];
    readonly renamed: readonly (readonly ["first" | "second", string, string])[];
  } | null;
  /** The family's information that changed, a field at a time. */
  readonly info: Partial<FontInfo> | null;
  /** A new em, and whether the drawing was scaled to it or only the number changed. */
  readonly unitsPerEm: { readonly to: number; readonly scaled: boolean } | null;
  readonly grid: Grid | null;
  readonly fixedWidth: { readonly to: number | null } | null;
  readonly nameLigatures: boolean | null;
  /**
   * The serif styles that came, went, or are called something else. One that
   * came is whole, with the numbers it has in the master it came from: another
   * master begins with a copy, as it does of a glyph, and makes it its own.
   */
  readonly serifs: {
    readonly renamed: readonly (readonly [string, string])[];
    readonly removed: readonly string[];
    readonly added: readonly SerifStyle[];
  } | null;
};

/**
 * What changed, of what the masters share, between a master as it was and as
 * it is. `null` for nothing.
 *
 * A rename is told from a removal and an addition by the glyph itself: one
 * renamed is the same contours and the same components under another name —
 * the very same, where nothing else was done to it, and the same contours by
 * their ids where it was also redrawn. A glyph with no outline at all is told
 * by its code points. One that cannot be told is taken for a glyph removed and
 * another added, which loses nothing in this master and gives the others a
 * copy of this master's drawing under the new name.
 */
export function structuralChange(base: FontDocument, now: FontDocument): StructuralChange | null {
  if (base === now) return null;

  const gone = base.glyphOrder.filter((name) => !(name in now.glyphs));
  const fresh = now.glyphOrder.filter((name) => !(name in base.glyphs));

  const renamed: [GlyphName, GlyphName][] = [];
  const taken = new Set<GlyphName>();
  for (const to of fresh) {
    const after = now.glyphs[to];
    if (after === undefined) continue;
    const from = gone.find((name) => {
      const before = base.glyphs[name];
      return before !== undefined && !taken.has(name) && sameGlyph(before, after);
    });
    if (from === undefined) continue;
    taken.add(from);
    renamed.push([from, to]);
  }

  const arrived = new Set(renamed.map(([, to]) => to));
  const removed = gone.filter((name) => !taken.has(name));
  const added = fresh
    .filter((name) => !arrived.has(name))
    .map((name) => now.glyphs[name])
    .filter((g): g is Glyph => g !== undefined);

  // Code points, of the glyphs both moments have: under the name they have now.
  const was = new Map(renamed.map(([from, to]) => [to, from]));
  const unicodes: [GlyphName, readonly number[]][] = [];
  for (const name of now.glyphOrder) {
    const after = now.glyphs[name];
    const before = base.glyphs[was.get(name) ?? name];
    if (after === undefined || before === undefined) continue;
    if (before.unicodes !== after.unicodes && !sameList(before.unicodes, after.unicodes)) {
      unicodes.push([name, after.unicodes]);
    }
  }

  // The order, as it would be had nothing but the renames, removals and
  // additions happened: only an order that differs from that was changed.
  const carried = [
    ...base.glyphOrder
      .filter((name) => !removed.includes(name))
      .map((name) => renamed.find(([from]) => from === name)?.[1] ?? name),
    ...added.map((g) => g.name),
  ];
  const order = sameList(carried, now.glyphOrder) ? null : now.glyphOrder;

  const info: Partial<FontInfo> = {};
  if (base.info !== now.info) {
    for (const key of Object.keys(now.info) as (keyof FontInfo)[]) {
      if (OWN_INFO.has(key) || sameJson(base.info[key], now.info[key])) continue;
      Object.assign(info, { [key]: now.info[key] });
    }
  }

  const change: StructuralChange = {
    renamed,
    removed,
    added,
    unicodes,
    order,
    features: base.features === now.features ? null : now.features,
    groups: groupsChanged(base.kerning, now.kerning),
    info: Object.keys(info).length === 0 ? null : info,
    unitsPerEm:
      base.info.unitsPerEm === now.info.unitsPerEm
        ? null
        : { to: now.info.unitsPerEm, scaled: wasScaled(base, now) },
    grid: base.grid === now.grid || sameJson(base.grid, now.grid) ? null : now.grid,
    fixedWidth: base.fixedWidth === now.fixedWidth ? null : { to: now.fixedWidth },
    nameLigatures: base.nameLigatures === now.nameLigatures ? null : now.nameLigatures,
    serifs: serifsChanged(base.serifs, now.serifs),
  };
  return isNothing(change) ? null : change;
}

/**
 * The serif styles that came, went or were renamed between two moments of a
 * master's list. A style gone and one come in its place in the list, or with
 * its numbers, is the one renamed: a rename leaves both as they were.
 */
function serifsChanged(
  base: readonly SerifStyle[],
  now: readonly SerifStyle[],
): StructuralChange["serifs"] {
  if (base === now) return null;
  const gone = base.filter((style) => !now.some((other) => other.name === style.name));
  const fresh = now.filter((style) => !base.some((other) => other.name === style.name));
  const renamed: [string, string][] = [];
  for (const to of fresh) {
    const at = gone.findIndex(
      (from) => base.indexOf(from) === now.indexOf(to) || sameSerif(from, to),
    );
    if (at === -1) continue;
    renamed.push([gone[at]!.name, to.name]);
    gone.splice(at, 1);
  }
  const arrived = new Set(renamed.map(([, to]) => to));
  const added = fresh.filter((style) => !arrived.has(style.name));
  if (renamed.length === 0 && gone.length === 0 && added.length === 0) return null;
  return { renamed, removed: gone.map((style) => style.name), added };
}

function isNothing(change: StructuralChange): boolean {
  return (
    change.renamed.length === 0 &&
    change.removed.length === 0 &&
    change.added.length === 0 &&
    change.unicodes.length === 0 &&
    change.order === null &&
    change.features === null &&
    change.groups === null &&
    change.info === null &&
    change.unitsPerEm === null &&
    change.grid === null &&
    change.fixedWidth === null &&
    change.nameLigatures === null &&
    change.serifs === null
  );
}

/** Whether a glyph under a new name is one that was there under an old one. */
function sameGlyph(before: Glyph, after: Glyph): boolean {
  if (before.contours === after.contours && before.components === after.components) return true;
  if (before.contours.length > 0 || after.contours.length > 0) {
    return (
      before.contours.length === after.contours.length &&
      before.contours.every((c, i) => c.id === after.contours[i]?.id)
    );
  }
  if (before.components.length > 0 || after.components.length > 0) {
    return (
      before.components.length === after.components.length &&
      before.components.every((c, i) => c.base === after.components[i]?.base)
    );
  }
  return before.unicodes.length > 0 && sameList(before.unicodes, after.unicodes);
}

/** Whether the drawing went with the em: an advance that is what it was, scaled. */
function wasScaled(base: FontDocument, now: FontDocument): boolean {
  const k = now.info.unitsPerEm / base.info.unitsPerEm;
  if (!Number.isFinite(k) || k <= 0) return false;
  for (const name of base.glyphOrder) {
    const before = base.glyphs[name];
    const after = now.glyphs[name];
    if (before === undefined || after === undefined || before.advance === 0) continue;
    return Math.abs(after.advance - before.advance * k) <= 1;
  }
  return false;
}

function groupsChanged(base: Kerning, now: Kerning): StructuralChange["groups"] {
  if (base.firstGroups === now.firstGroups && base.secondGroups === now.secondGroups) return null;
  if (
    sameJson(base.firstGroups, now.firstGroups) &&
    sameJson(base.secondGroups, now.secondGroups)
  ) {
    return null;
  }

  // A group under a new name with the glyphs it had is the group renamed, and
  // the pairs kerned against it go with it.
  const renamed: ["first" | "second", string, string][] = [];
  for (const side of ["first", "second"] as const) {
    const before = side === "first" ? base.firstGroups : base.secondGroups;
    const after = side === "first" ? now.firstGroups : now.secondGroups;
    const gone = Object.keys(before).filter((name) => !(name in after));
    for (const to of Object.keys(after).filter((name) => !(name in before))) {
      const at = gone.findIndex((from) => sameList(before[from] ?? [], after[to] ?? []));
      if (at === -1) continue;
      renamed.push([side, gone[at]!, to]);
      gone.splice(at, 1);
    }
  }
  return { first: now.firstGroups, second: now.secondGroups, renamed };
}

/**
 * A master with a change made in another master made in it too.
 *
 * Every part of it is safe to make twice and safe to make to a master that
 * does not need it — a glyph already renamed is left, one already there is not
 * added again — because the masters may not have been the same to begin with,
 * and a change is carried to them as they are.
 *
 * `sparse` is a master that draws only some glyphs, as a layer of another: it
 * follows a glyph's name, its code points and its going, and nothing else —
 * what it does not draw is not added to it, and its information is the master's
 * it is a layer of.
 */
export function applyStructure(
  document: FontDocument,
  change: StructuralChange,
  sparse = false,
): FontDocument {
  let next = document;

  for (const [from, to] of change.renamed) {
    if (!(from in next.glyphs) || to in next.glyphs) continue;
    next = renameGlyph(next, from, to) ?? next;
  }
  for (const name of change.removed) {
    if (name in next.glyphs) next = removeGlyph(next, name) ?? next;
  }
  for (const [name, unicodes] of change.unicodes) {
    const g = next.glyphs[name];
    if (g !== undefined && !sameList(g.unicodes, unicodes))
      next = putGlyph(next, { ...g, unicodes });
  }
  // A serif style's name is on the ends that have it, in whatever master
  // draws them: a master that is a layer of another follows that much.
  for (const [from, to] of change.serifs?.renamed ?? []) next = carriedSerifRename(next, from, to);
  for (const name of change.serifs?.removed ?? []) next = carriedSerifRemoval(next, name);
  if (sparse) return next;

  for (const style of change.serifs?.added ?? []) next = addedSerifStyle(next, style) ?? next;
  for (const g of change.added) {
    if (!(g.name in next.glyphs)) next = putGlyph(next, g);
  }
  if (change.order !== null) next = ordered(next, change.order);
  if (change.features !== null && next.features !== change.features) {
    next = setFeatures(next, change.features);
  }
  if (change.groups !== null) next = setKerning(next, regrouped(next.kerning, change.groups));

  if (change.unitsPerEm !== null && next.info.unitsPerEm !== change.unitsPerEm.to) {
    next = change.unitsPerEm.scaled
      ? scaledFont(next, change.unitsPerEm.to)
      : { ...next, info: { ...next.info, unitsPerEm: change.unitsPerEm.to } };
  }
  if (change.info !== null) next = { ...next, info: { ...next.info, ...change.info } };
  if (change.grid !== null) next = { ...next, grid: change.grid };
  if (change.fixedWidth !== null) next = { ...next, fixedWidth: change.fixedWidth.to };
  if (change.nameLigatures !== null) next = { ...next, nameLigatures: change.nameLigatures };

  return next;
}

/**
 * A master's glyphs in another's order: those the order names, as it names
 * them, and then whatever this master has that the order does not, as they
 * stood.
 */
function ordered(document: FontDocument, order: readonly GlyphName[]): FontDocument {
  const named = order.filter((name) => name in document.glyphs);
  const seen = new Set(named);
  const rest = document.glyphOrder.filter((name) => !seen.has(name));
  const next = [...named, ...rest];
  return sameList(next, document.glyphOrder) ? document : setGlyphOrder(document, next);
}

/**
 * A master's kerning with another's groups: the groups as given, and the pairs
 * as they were, save those kerned against a group that is no longer there.
 */
function regrouped(kerning: Kerning, groups: NonNullable<StructuralChange["groups"]>): Kerning {
  let next = kerning;
  for (const [side, from, to] of groups.renamed) next = renameKernGroup(next, side, from, to);

  const pairs: Record<string, Record<string, number>> = {};
  for (const [first, row] of Object.entries(next.pairs)) {
    if (isGroupKey(first) && !(groupNameOf(first) in groups.first)) continue;
    const kept: Record<string, number> = {};
    for (const [second, value] of Object.entries(row)) {
      if (isGroupKey(second) && !(groupNameOf(second) in groups.second)) continue;
      kept[second] = value;
    }
    if (Object.keys(kept).length > 0) pairs[first] = kept;
  }
  return { firstGroups: groups.first, secondGroups: groups.second, pairs };
}

// ---------------------------------------------------------------------------
// masters that already differ
// ---------------------------------------------------------------------------

/**
 * How two masters differ in what they should share.
 *
 * For masters that were never the same, or have come apart: a family read from
 * files drawn in another program, one from before changes were carried across,
 * a window that closed before one could be. Nothing here is put right by
 * itself, because nothing says which master is right; each part can be copied
 * one way or the other by whoever knows.
 */
export type StructureDifferences = {
  /** Glyphs this master has and the other does not. */
  readonly onlyHere: readonly GlyphName[];
  /** Glyphs the other has and this one does not. */
  readonly onlyThere: readonly GlyphName[];
  /** Glyphs both have, with different code points. */
  readonly unicodes: readonly GlyphName[];
  /** Whether the glyphs both have are in a different order. */
  readonly order: boolean;
  readonly features: boolean;
  readonly groups: boolean;
  /** The family's information that differs, by field. */
  readonly info: readonly (keyof FontInfo)[];
  readonly unitsPerEm: boolean;
  /** Serif styles this master has a name for and the other has not. */
  readonly serifsOnlyHere: readonly string[];
  /** Serif styles the other has a name for and this one has not. */
  readonly serifsOnlyThere: readonly string[];
};

/** The parts of {@link StructureDifferences}, as what can be copied across. */
export type StructurePart = keyof StructureDifferences;

export function structuralDifferences(
  here: FontDocument,
  there: FontDocument,
): StructureDifferences {
  const onlyHere = here.glyphOrder.filter((name) => !(name in there.glyphs));
  const onlyThere = there.glyphOrder.filter((name) => !(name in here.glyphs));
  const both = here.glyphOrder.filter((name) => name in there.glyphs);

  return {
    onlyHere,
    onlyThere,
    unicodes: both.filter(
      (name) => !sameList(here.glyphs[name]?.unicodes ?? [], there.glyphs[name]?.unicodes ?? []),
    ),
    order: !sameList(
      both,
      there.glyphOrder.filter((name) => name in here.glyphs),
    ),
    features: here.features !== there.features,
    groups:
      !sameJson(here.kerning.firstGroups, there.kerning.firstGroups) ||
      !sameJson(here.kerning.secondGroups, there.kerning.secondGroups),
    info: (Object.keys(here.info) as (keyof FontInfo)[]).filter(
      // By what it says: some of it is lists, and a master read back from where
      // it is parked holds other lists of the same things.
      (key) => !OWN_INFO.has(key) && !sameJson(here.info[key], there.info[key]),
    ),
    unitsPerEm: here.info.unitsPerEm !== there.info.unitsPerEm,
    serifsOnlyHere: here.serifs
      .filter((style) => !there.serifs.some((other) => other.name === style.name))
      .map((style) => style.name),
    serifsOnlyThere: there.serifs
      .filter((style) => !here.serifs.some((other) => other.name === style.name))
      .map((style) => style.name),
  };
}

/** Whether two masters agree in everything they should share. */
export function sameStructure(differences: StructureDifferences): boolean {
  return (
    differences.onlyHere.length === 0 &&
    differences.onlyThere.length === 0 &&
    differences.unicodes.length === 0 &&
    !differences.order &&
    !differences.features &&
    !differences.groups &&
    differences.info.length === 0 &&
    !differences.unitsPerEm &&
    differences.serifsOnlyHere.length === 0 &&
    differences.serifsOnlyThere.length === 0
  );
}

/**
 * One part of what two masters differ in, as the change that makes `to` agree
 * with `from` in it.
 *
 * A change, so that it is made by the same hand that carries any other across:
 * {@link applyStructure}. For `onlyThere` and `serifsOnlyThere` the masters
 * are the other way round — it is the open master that gains the glyphs or the
 * styles — which is the caller's to arrange; this only ever copies from the
 * first to the second.
 */
export function structureCopy(
  from: FontDocument,
  to: FontDocument,
  part: Exclude<StructurePart, "onlyThere" | "serifsOnlyThere">,
): StructuralChange {
  const nothing: StructuralChange = {
    renamed: [],
    removed: [],
    added: [],
    unicodes: [],
    order: null,
    features: null,
    groups: null,
    info: null,
    unitsPerEm: null,
    grid: null,
    fixedWidth: null,
    nameLigatures: null,
    serifs: null,
  };
  const differences = structuralDifferences(from, to);

  switch (part) {
    case "onlyHere":
      return {
        ...nothing,
        added: differences.onlyHere
          .map((name) => from.glyphs[name])
          .filter((g): g is Glyph => g !== undefined),
        // Where they sit in the master they come from, among its other glyphs.
        order: from.glyphOrder,
      };
    case "unicodes":
      return {
        ...nothing,
        unicodes: differences.unicodes.map((name) => [name, from.glyphs[name]?.unicodes ?? []]),
      };
    case "order":
      return { ...nothing, order: from.glyphOrder };
    case "features":
      return { ...nothing, features: from.features };
    case "groups":
      return {
        ...nothing,
        groups: { first: from.kerning.firstGroups, second: from.kerning.secondGroups, renamed: [] },
      };
    case "info": {
      const info: Partial<FontInfo> = {};
      for (const key of differences.info) Object.assign(info, { [key]: from.info[key] });
      return { ...nothing, info };
    }
    case "serifsOnlyHere":
      return {
        ...nothing,
        serifs: {
          renamed: [],
          removed: [],
          added: from.serifs.filter((style) => differences.serifsOnlyHere.includes(style.name)),
        },
      };
    case "unitsPerEm":
      // Scaled: a master whose em is made another's has to keep its shapes the
      // size they were on the page.
      return { ...nothing, unitsPerEm: { to: from.info.unitsPerEm, scaled: true } };
  }
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a === b || (a.length === b.length && a.every((it, i) => it === b[i]));
}

/** Whether two plain values are the same, by what they would be written as. */
function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
