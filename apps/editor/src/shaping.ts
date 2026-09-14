import { NO_POSITIONING, NO_SHAPING, positionerFor, shaperFor } from "@typewright/font-io";
import type { FontDocument } from "@typewright/font-model";
import type * as ShapingModule from "@typewright/shaping";
import type { Engine, Positioner, Shaper } from "@typewright/view";
import { useEffect, useMemo, useState } from "react";

type Shaping = typeof ShapingModule;

/** The HarfBuzz package, once asked for: one download however many views ask. */
let loading: Promise<Shaping> | null = null;

/**
 * HarfBuzz, for the spacing line and the proof, once it has loaded.
 *
 * `undefined` until then, and whenever the font's features are switched off —
 * the lines are set with the shaper and positioner below in the meantime, so
 * text is on screen straight away and changes to HarfBuzz's setting a moment
 * later. A package that fails to load leaves them set that way, and is asked
 * for again the next time the features are switched on.
 *
 * Imported here rather than at startup because it is half a megabyte of
 * WebAssembly, and a session spent drawing never sets a line of text.
 */
export function useShapingEngine(
  document: FontDocument,
  applyFeatures: boolean,
): Engine | undefined {
  const [shaping, setShaping] = useState<Shaping | null>(null);

  useEffect(() => {
    if (!applyFeatures || shaping !== null) return;
    let live = true;
    loading ??= import("@typewright/shaping");
    void loading.then(
      (loaded) => {
        if (live) setShaping(loaded);
      },
      () => {
        loading = null;
      },
    );
    return () => {
      live = false;
    };
  }, [applyFeatures, shaping]);

  return useMemo(
    () => (applyFeatures && shaping !== null ? shaping.harfBuzzEngine(document) : undefined),
    [applyFeatures, shaping, document],
  );
}

/**
 * The shaper the spacing line and the proof set with until HarfBuzz is there.
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
