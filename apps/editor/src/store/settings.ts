import { DEFAULT_PREFERENCES, type Preferences, savePreferences } from "../preferences.js";
import type { StoreHost, StoreState } from "./state.js";

/**
 * The settings that outlive the tab, and the one door they are written through.
 *
 * Which parts of the state are preferences is a fact about the state rather
 * than about any of the store's verbs, so it is stated once here. Every setter
 * goes through {@link remember}, so a setting cannot be added to the store and
 * quietly not be remembered — which is what happened to every one of these
 * before this door existed.
 */

/** The preferences as they currently stand, ready to be written. */
export function preferencesOf(s: StoreState): Preferences {
  return {
    theme: s.theme,
    outlineWidth: s.outlineWidth,
    autoHideHandles: s.autoHideHandles,
    snapPoints: s.snapPoints,
    showNeighbours: s.showNeighbours,
    showAnchors: s.showAnchors,
    showCurvature: s.showCurvature,
    showImage: s.showImage,
    imageOpacity: s.imageOpacity,
    applyFeatures: s.applyFeatures,
    spacingSize: s.spacingSize,
    proofSize: s.proofSize,
    proofLeading: s.proofLeading,
    inspector: s.inspector,
  };
}

/** Patch the state and write the preferences that came out of it. */
export function remember(host: StoreHost, changes: Partial<StoreState>): void {
  host.patch(changes);
  savePreferences(preferencesOf(host.state()));
}

/**
 * Everything a reset puts back.
 *
 * The inspector is not in it: where a panel sits is a preference in the sense
 * that it is remembered, but putting it back in the corner is not what anyone
 * means by "reset my preferences" — they mean the drawing settings.
 */
export function defaults(): Partial<StoreState> {
  return {
    theme: DEFAULT_PREFERENCES.theme,
    outlineWidth: DEFAULT_PREFERENCES.outlineWidth,
    autoHideHandles: DEFAULT_PREFERENCES.autoHideHandles,
    snapPoints: DEFAULT_PREFERENCES.snapPoints,
    showNeighbours: DEFAULT_PREFERENCES.showNeighbours,
    showAnchors: DEFAULT_PREFERENCES.showAnchors,
    showCurvature: DEFAULT_PREFERENCES.showCurvature,
    applyFeatures: DEFAULT_PREFERENCES.applyFeatures,
    spacingSize: DEFAULT_PREFERENCES.spacingSize,
    proofSize: DEFAULT_PREFERENCES.proofSize,
    proofLeading: DEFAULT_PREFERENCES.proofLeading,
  };
}

/**
 * A number held inside its limits, or `null` for one that is not a number.
 *
 * `null` rather than a clamped default: a field being typed into passes through
 * states like "" and "-", and the honest answer for those is that there is no
 * value yet, not that the setting should jump to its minimum.
 */
export function within(value: number, min: number, max: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
}
