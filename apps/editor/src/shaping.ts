import {
  DEFAULT_FEATURES,
  NO_POSITIONING,
  NO_SHAPING,
  positionerFor,
  shaperFor,
} from "@typewright/font-io";
import type { FontDocument } from "@typewright/font-model";
import type * as ShapingModule from "@typewright/shaping";
import {
  type Engine,
  type Positioner,
  type Shaper,
  type TextSettings,
  featureTagsFor,
  READ_FROM_TEXT,
} from "@typewright/view";
import { useEffect, useMemo, useState } from "react";

type Shaping = typeof ShapingModule;

/**
 * Whether a font has anything for a shaper to do: a feature file, kerning, or
 * anchors for marks to attach by.
 *
 * What the Features switch is offered for. It used to ask for a feature file
 * alone, which left a font with kerning and anchors and no `.fea` with the
 * switch greyed out — and, where it had been left off, HarfBuzz never set the
 * accents it could have placed.
 */
export function hasSomethingToShape(document: FontDocument): boolean {
  if (document.features.trim() !== "") return true;
  if (Object.keys(document.kerning.pairs).length > 0) return true;
  return Object.values(document.glyphs).some((g) => g.anchors.length > 0);
}

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
  settings: TextSettings = READ_FROM_TEXT,
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
    () =>
      applyFeatures && shaping !== null ? shaping.harfBuzzEngine(document, settings) : undefined,
    [applyFeatures, shaping, document, settings],
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
 *
 * Which features run comes from the line's own settings: what a text renderer
 * turns on by itself, plus and minus whatever has been switched in the bar. This
 * shaper knows nothing of alternate indices, so a rule offering a choice of
 * several takes the first of them; HarfBuzz, a moment later, sets the same line
 * the way the exported font would.
 */
export function shaperFrom(
  features: string,
  applyFeatures: boolean,
  settings: TextSettings = READ_FROM_TEXT,
): Shaper {
  if (!applyFeatures || features.trim() === "") return NO_SHAPING;
  return shaperFor(features, featureTagsFor(DEFAULT_FEATURES, settings.features));
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
export function positionerFrom(
  features: string,
  applyFeatures: boolean,
  settings: TextSettings = READ_FROM_TEXT,
): Positioner {
  if (!applyFeatures || features.trim() === "") return NO_POSITIONING;
  return positionerFor(features, featureTagsFor(DEFAULT_FEATURES, settings.features));
}
