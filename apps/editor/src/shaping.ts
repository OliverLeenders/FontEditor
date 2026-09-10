import { NO_POSITIONING, NO_SHAPING, positionerFor, shaperFor } from "@typewright/font-io";
import type { Positioner, Shaper } from "@typewright/view";

/**
 * The shaper the spacing line and the proof set with.
 *
 * One definition for both, so the two views cannot disagree about what the font
 * does — the whole point of a spacing line is that it is the same setting as the
 * proof, one word of it, with the letters movable.
 *
 * Recompiled from the feature source whenever it changes, which is every
 * keystroke in the Features workspace. That is cheap: the source is a few
 * hundred characters and the parse is a tokenizer over it, where the alternative
 * is a stale preview of the rule you are in the middle of writing.
 */
export function shaperFrom(features: string, applyFeatures: boolean): Shaper {
  if (!applyFeatures || features.trim() === "") return NO_SHAPING;
  return shaperFor(features);
}

/**
 * The positioning half, from the same source and under the same switch.
 *
 * Separate from the shaper because the two answer different questions — which
 * glyphs, and where — and the line that sets them wants both. Turning features
 * off turns this off with them: the button says what the font does, and a rule
 * that moved a letter while its substitutions were switched off would be half a
 * font.
 */
export function positionerFrom(features: string, applyFeatures: boolean): Positioner {
  if (!applyFeatures || features.trim() === "") return NO_POSITIONING;
  return positionerFor(features);
}
