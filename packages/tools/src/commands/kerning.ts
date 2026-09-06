import {
  type KernMatch,
  type Kerning,
  type GlyphName,
  addToKernGroup,
  kernGroupOf,
  kernGroupPairCount,
  kernIndex,
  kernMatch,
  groupKey,
  removeFromKernGroup,
  removeKernGroup,
  renameKernGroup,
  setKern,
  setKernGroup,
  setKerning,
} from "@fonteditor/font-model";
import { type ToolResult, begin, commit, result } from "../effects.js";
import { type EditorState } from "../state.js";
import { done } from "./shared.js";

/**
 * Commands about kerning: the pairs themselves, and the classes they are
 * written between.
 */

/**
 * Change the kerning between two glyphs by a step.
 *
 * Written to whichever pair already governs them, so nudging a pair that is
 * kerned by a class adjusts the class — which is what a designer means by
 * "these are too far apart" when the two letters are examples of a category.
 * Making it an exception instead is a deliberate act, and a separate one:
 * `breakOutKern`.
 *
 * With no rule yet, a new one is written between whatever classes the two sides
 * belong to, and only falls back to the glyph itself where a side is in no
 * class. That is what putting a letter in a class is for — the alternative is a
 * font whose classes are filled in and never used, and a designer correcting
 * the same gap once for every member of them.
 */
export function nudgeKern(
  state: EditorState,
  left: GlyphName,
  right: GlyphName,
  delta: number,
): ToolResult {
  if (delta === 0) return result(state);

  const index = kernIndex(state.document.kerning);
  const existing = kernMatch(index, left, right);
  const first = existing?.first ?? classOf(index.firstOf, left);
  const second = existing?.second ?? classOf(index.secondOf, right);
  const value = (existing?.value ?? 0) + delta;

  const kerning = setKern(state.document.kerning, first, second, value);
  if (kerning === state.document.kerning) return result(state);

  return result({ ...state, document: setKerning(state.document, kerning) }, [
    begin(`Kern ${first} ${second}`),
    commit,
  ]);
}

/** A pair key: the glyph's class where it has one, and the glyph where it has not. */
function classOf(of: ReadonlyMap<GlyphName, string>, glyphName: GlyphName): string {
  const group = of.get(glyphName);
  return group === undefined ? glyphName : groupKey(group);
}

/**
 * Pin a pair at its current value, breaking it out of the class governing it.
 *
 * The way to correct one pair without disturbing the category it belongs to.
 * Does nothing when the pair is already its own, since there is nothing to
 * break out of.
 */
export function breakOutKern(state: EditorState, left: GlyphName, right: GlyphName): ToolResult {
  const index = kernIndex(state.document.kerning);
  const existing = kernMatch(index, left, right);
  if (existing === null || !existing.grouped) return result(state);

  const kerning = setKern(state.document.kerning, left, right, existing.value);
  return done(
    state,
    { ...state, document: setKerning(state.document, kerning) },
    `Kern ${left} ${right} separately`,
  );
}

/** What governs a pair right now, for an interface that has to explain itself. */
export function kerningFor(
  state: EditorState,
  left: GlyphName,
  right: GlyphName,
): KernMatch | null {
  return kernMatch(kernIndex(state.document.kerning), left, right);
}

/**
 * Which side of a pair a group belongs to, in the words the interface uses.
 *
 * "First" and "second" are the file formats' words. What a designer is choosing
 * is whether the group describes a letter's trailing flank or its leading one.
 */
export type KernSide = "first" | "second";

/** Names may be written into a UFO's group keys, so keep them to plain text. */
const GROUP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * What is wrong with a group name, or `null`.
 *
 * `current` is the name being renamed, so a group is not told its own name is
 * taken.
 */
export function kernGroupProblem(
  kerning: Kerning,
  side: KernSide,
  name: string,
  current?: string,
): string | null {
  if (name.trim() === "") return "A group needs a name";
  if (!GROUP_NAME.test(name)) {
    return "Letters, digits, dot, dash and underscore, starting with a letter or digit";
  }
  const groups = side === "first" ? kerning.firstGroups : kerning.secondGroups;
  if (name !== current && name in groups) return `There is already a ${name} on this side`;
  return null;
}

/** Start a group with no members. */
export function addKernGroup(state: EditorState, side: KernSide, name: string): ToolResult {
  if (kernGroupProblem(state.document.kerning, side, name) !== null) return result(state);
  const kerning = setKernGroup(state.document.kerning, side, name, []);
  return done(
    state,
    { ...state, document: setKerning(state.document, kerning) },
    `New group ${name}`,
  );
}

/** Rename a group, carrying its pairs with it. */
export function renameKernGroupTo(
  state: EditorState,
  side: KernSide,
  from: string,
  to: string,
): ToolResult {
  if (kernGroupProblem(state.document.kerning, side, to, from) !== null) return result(state);
  const kerning = renameKernGroup(state.document.kerning, side, from, to);
  if (kerning === state.document.kerning) return result(state);
  return done(
    state,
    { ...state, document: setKerning(state.document, kerning) },
    `Rename ${from} to ${to}`,
  );
}

/**
 * Delete a group and every pair that named it.
 *
 * The pairs go because a rule naming a group that is gone can never match, and
 * kerning that silently does nothing is worse than kerning that is absent. How
 * many are about to go is `kernGroupPairs`, so the button can say so first.
 */
export function deleteKernGroup(state: EditorState, side: KernSide, name: string): ToolResult {
  const kerning = removeKernGroup(state.document.kerning, side, name);
  if (kerning === state.document.kerning) return result(state);
  return done(
    state,
    { ...state, document: setKerning(state.document, kerning) },
    `Delete group ${name}`,
  );
}

/** How many pairs deleting this group would take with it. */
export function kernGroupPairs(state: EditorState, side: KernSide, name: string): number {
  return kernGroupPairCount(state.document.kerning, side, name);
}

/**
 * Put a glyph in a group, taking it out of whichever group on that side held it.
 *
 * Moving rather than joining: a glyph in two groups on one side kerns by
 * whichever is read first, which is a rule nobody wrote and nobody can see.
 */
export function putGlyphInKernGroup(
  state: EditorState,
  side: KernSide,
  name: string,
  glyphName: GlyphName,
): ToolResult {
  if (!(glyphName in state.document.glyphs)) return result(state);
  const kerning = addToKernGroup(state.document.kerning, side, name, glyphName);
  if (kerning === state.document.kerning) return result(state);
  return done(
    state,
    { ...state, document: setKerning(state.document, kerning) },
    `Add ${glyphName} to ${name}`,
  );
}

/** Take a glyph out of a group, leaving the group and its pairs alone. */
export function takeGlyphFromKernGroup(
  state: EditorState,
  side: KernSide,
  name: string,
  glyphName: GlyphName,
): ToolResult {
  const kerning = removeFromKernGroup(state.document.kerning, side, name, glyphName);
  if (kerning === state.document.kerning) return result(state);
  return done(
    state,
    { ...state, document: setKerning(state.document, kerning) },
    `Remove ${glyphName} from ${name}`,
  );
}

/** Which group holds a glyph on one side, for an interface that says so. */
export function kernGroupHolding(
  state: EditorState,
  side: KernSide,
  glyphName: GlyphName,
): string | null {
  return kernGroupOf(state.document.kerning, side, glyphName);
}
