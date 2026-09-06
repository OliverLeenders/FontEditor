import {
  DEFAULT_OUTLINE_WIDTH,
  MAX_OUTLINE_WIDTH,
  MAX_PROOF_LEADING,
  MAX_PROOF_SIZE,
  MAX_SPACING_SIZE,
  MIN_OUTLINE_WIDTH,
  MIN_PROOF_LEADING,
  MIN_PROOF_SIZE,
  MIN_SPACING_SIZE,
} from "./limits.js";

/**
 * The settings that describe the reader rather than the font.
 *
 * They survive a reload, they never enter the undo stack, and none of them is
 * written into an `.otf` or a `.ufo`. That is the whole test for what belongs
 * here: change one and the exported font is byte for byte the same.
 *
 * Kept in `localStorage` rather than in the project, so they are per browser
 * rather than per font. A dark theme and a heavier outline are facts about the
 * screen you are sitting at, and having them arrive with an imported font would
 * be a stranger deciding how your editor looks.
 *
 * The two workspace texts are deliberately *not* here. They are the thing you
 * are working on rather than a setting, and a proof that reopens holding
 * yesterday's paragraph has quietly stopped being the one you just typed.
 */

/**
 * Which palette to use.
 *
 * "system" is not a third look: it is the absence of a choice, and follows the
 * operating system as the editor always has.
 */
export type ThemeChoice = "system" | "light" | "dark";

export type InspectorPlacement = {
  readonly x: number;
  readonly y: number;
  readonly open: boolean;
};

export type Preferences = {
  readonly theme: ThemeChoice;
  /** How heavy the outline is drawn, in screen pixels. */
  readonly outlineWidth: number;
  /** Show handles only where the work is. */
  readonly autoHideHandles: boolean;
  /** Let a drag catch on the glyph's own points as well as the font's lines. */
  readonly snapPoints: boolean;
  /** Draw the glyphs either side, from the strip text. */
  readonly showNeighbours: boolean;
  /** Draw the glyph's anchors, and let them be grabbed. */
  readonly showAnchors: boolean;
  /**
   * Apply the font's own features to the spacing line and the proof.
   *
   * On, because a proof is judged as it would be set. Off is for the moment you
   * want to see the letters a ligature is standing in for.
   */
  readonly applyFeatures: boolean;
  readonly spacingSize: number;
  readonly proofSize: number;
  readonly proofLeading: number;
  readonly inspector: InspectorPlacement;
};

const KEY = "fonteditor.preferences";

/** The key the inspector's position used before it moved in here. */
const OLD_INSPECTOR_KEY = "fonteditor.inspector";

export const DEFAULT_PLACEMENT: InspectorPlacement = { x: 24, y: 24, open: true };

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  outlineWidth: DEFAULT_OUTLINE_WIDTH,
  autoHideHandles: true,
  snapPoints: true,
  showNeighbours: true,
  showAnchors: true,
  applyFeatures: true,
  spacingSize: 128,
  proofSize: 32,
  proofLeading: 1.4,
  inspector: DEFAULT_PLACEMENT,
};

/**
 * Keep enough of the panel on screen to grab it again.
 *
 * A floating panel that can be dragged fully off the edge is a floating panel
 * you cannot get back — and the position is remembered, so it would still be
 * gone after a reload.
 */
export function clampInspector(x: number, y: number): { x: number; y: number } {
  const grip = 80;
  const maxX = Math.max(0, window.innerWidth - grip);
  const maxY = Math.max(0, window.innerHeight - 28);
  return {
    x: Math.min(Math.max(0, x), maxX),
    y: Math.min(Math.max(0, y), maxY),
  };
}

/**
 * Read the preferences, field by field.
 *
 * Never trusts the shape it finds. What is in storage was written by an older
 * version of this editor, or by a half-finished write, or by nothing at all —
 * so every field is checked on its own and a bad one falls back to its default
 * rather than taking the rest of the settings down with it.
 */
export function loadPreferences(): Preferences {
  const stored = read(KEY);
  const raw: Record<string, unknown> = stored ?? {};

  const inspector = (raw["inspector"] ?? read(OLD_INSPECTOR_KEY) ?? {}) as Record<string, unknown>;

  return {
    theme: isTheme(raw["theme"]) ? raw["theme"] : DEFAULT_PREFERENCES.theme,
    outlineWidth: number(raw["outlineWidth"], DEFAULT_OUTLINE_WIDTH, {
      min: MIN_OUTLINE_WIDTH,
      max: MAX_OUTLINE_WIDTH,
    }),
    autoHideHandles: boolean(raw["autoHideHandles"], DEFAULT_PREFERENCES.autoHideHandles),
    snapPoints: boolean(raw["snapPoints"], DEFAULT_PREFERENCES.snapPoints),
    showNeighbours: boolean(raw["showNeighbours"], DEFAULT_PREFERENCES.showNeighbours),
    showAnchors: boolean(raw["showAnchors"], DEFAULT_PREFERENCES.showAnchors),
    applyFeatures: boolean(raw["applyFeatures"], DEFAULT_PREFERENCES.applyFeatures),
    spacingSize: number(raw["spacingSize"], DEFAULT_PREFERENCES.spacingSize, {
      min: MIN_SPACING_SIZE,
      max: MAX_SPACING_SIZE,
    }),
    proofSize: number(raw["proofSize"], DEFAULT_PREFERENCES.proofSize, {
      min: MIN_PROOF_SIZE,
      max: MAX_PROOF_SIZE,
    }),
    proofLeading: number(raw["proofLeading"], DEFAULT_PREFERENCES.proofLeading, {
      min: MIN_PROOF_LEADING,
      max: MAX_PROOF_LEADING,
    }),
    inspector: {
      x: number(inspector["x"], DEFAULT_PLACEMENT.x, {}),
      y: number(inspector["y"], DEFAULT_PLACEMENT.y, {}),
      open: boolean(inspector["open"], DEFAULT_PLACEMENT.open),
    },
  };
}

export function savePreferences(preferences: Preferences): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(preferences));
  } catch {
    // A private window, cleared site data, or storage switched off. Losing a
    // remembered outline weight is not worth interrupting anyone for.
  }
}

function read(key: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const isTheme = (value: unknown): value is ThemeChoice =>
  value === "system" || value === "light" || value === "dark";

const boolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

function number(value: unknown, fallback: number, bounds: { min?: number; max?: number }): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const low = bounds.min ?? Number.NEGATIVE_INFINITY;
  const high = bounds.max ?? Number.POSITIVE_INFINITY;
  return Math.min(high, Math.max(low, value));
}
