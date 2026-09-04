import { NO_SHAPING, shaperFor } from "@fonteditor/font-io";
import type { Shaper } from "@fonteditor/view";

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
