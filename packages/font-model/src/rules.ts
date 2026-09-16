import type { Axis, KeptXml, Location } from "./designspace.js";

/**
 * Glyphs that are swapped for others in part of the designspace.
 *
 * The dollar sign whose stroke closes up at the heavy weights, the `g` that
 * drops its second storey when condensed: a shape that cannot be reached by
 * moving points, so another glyph is drawn and put in its place where the
 * design needs it. A designspace says where with *conditions* — a range on each
 * of some axes — and a variable font carries the same thing as a feature that
 * only applies in that region.
 *
 * Conditions are in design coordinates, as masters are.
 */

export type RuleId = string;

/** A range on one axis. An end left open reaches as far as the axis does. */
export type RuleCondition = {
  readonly tag: string;
  readonly min: number | null;
  readonly max: number | null;
};

export type Rule = {
  readonly id: RuleId;
  readonly name: string;
  /**
   * Where the rule applies: anywhere *any* set holds, and a set holds where
   * *every* range in it does. Most rules have one set.
   */
  readonly conditionSets: readonly (readonly RuleCondition[])[];
  /** The glyph drawn by default, and the one put in its place. */
  readonly swaps: readonly (readonly [from: string, to: string])[];
  readonly kept?: KeptXml;
};

/**
 * When the swaps happen, which is a question about the other features.
 *
 * First, before anything else in the font sees the text — so a ligature or a
 * small cap is looked up on the swapped glyph, and has to have been written for
 * it. Last, after everything else, so the swap is the final word. A variable
 * font says which by the feature the rules are compiled into: `rvrn` or `rclt`.
 */
export type RulesProcessing = "first" | "last";

export function rule(
  id: RuleId,
  name: string,
  conditionSets: readonly (readonly RuleCondition[])[] = [[]],
  swaps: readonly (readonly [string, string])[] = [],
): Rule {
  return { id, name, conditionSets, swaps };
}

/** Whether one range holds at a location. An axis the location omits is at its default. */
export function conditionHolds(
  axes: readonly Axis[],
  condition: RuleCondition,
  at: Location,
): boolean {
  const axis = axes.find((a) => a.tag === condition.tag);
  const value = at[condition.tag] ?? axis?.default ?? 0;
  if (condition.min !== null && value < condition.min) return false;
  if (condition.max !== null && value > condition.max) return false;
  return true;
}

/**
 * Whether a rule applies at a location.
 *
 * A rule with no condition sets applies nowhere, and a set with no ranges in it
 * holds everywhere — which is how fontTools reads both, and so how every build
 * does.
 */
export function ruleApplies(axes: readonly Axis[], r: Rule, at: Location): boolean {
  return r.conditionSets.some((set) => set.every((c) => conditionHolds(axes, c, at)));
}

/** Every swap in effect at a location, in the order the rules give them. */
export function swapsAt(
  axes: readonly Axis[],
  rules: readonly Rule[],
  at: Location,
): (readonly [string, string])[] {
  return rules.filter((r) => ruleApplies(axes, r, at)).flatMap((r) => r.swaps);
}
