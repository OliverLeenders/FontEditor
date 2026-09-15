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

/**
 * Where the inspector sits: over the drawing, or in a column beside it.
 *
 * Floating is right for a panel you consult; docked is right for one you work
 * out of all day, which is what this turned out to be. Both, because which of
 * the two a person wants depends on how wide their screen is and on whether the
 * letter they are drawing is a `l` or a `W`.
 */
export type InspectorDock = "float" | "left" | "right";

export type InspectorPlacement = {
  /** Where it floats. Kept while docked, so undocking puts it back. */
  readonly x: number;
  readonly y: number;
  readonly open: boolean;
  readonly dock: InspectorDock;
  /** How wide the column is when docked. Ignored while floating. */
  readonly width: number;
  /**
   * Which sections have been folded or unfolded by hand, by name.
   *
   * Only the choices somebody made. A section nobody has touched is absent, and
   * takes whatever the panel thinks sensible — open if it is one of the three
   * you are always using, or if it has anything in it. Storing the choices
   * rather than the state means a section that starts closed and later has an
   * anchor put in it opens itself, and a section you closed stays closed.
   */
  readonly sections: Readonly<Record<string, boolean>>;
};

/** Two panes side by side ("row"), or one above the other ("column"). */
export type SplitOrientation = "row" | "column";

/**
 * How the window is divided when it shows two workspaces.
 *
 * The shape of the split rather than what is in it: side by side suits a
 * drawing beside the proof, stacked suits a wide spacing line under the
 * drawing, and which of those somebody wants is a fact about their screen. The
 * workspaces in the panes are where somebody is, and are not remembered.
 */
export type SplitPlacement = {
  readonly orientation: SplitOrientation;
  /** The first pane's share of the space; the second has the rest. */
  readonly ratio: number;
};

/** The smallest share a pane can be dragged down to, so neither disappears. */
export const MIN_SPLIT_RATIO = 0.2;
export const MAX_SPLIT_RATIO = 0.8;

export const DEFAULT_SPLIT: SplitPlacement = { orientation: "row", ratio: 0.5 };

export type Preferences = {
  readonly theme: ThemeChoice;
  /** How heavy the outline is drawn, in screen pixels. */
  readonly outlineWidth: number;
  /** Show handles only where the work is. */
  readonly autoHideHandles: boolean;
  /**
   * Whether to open the last font without showing the list of fonts first.
   *
   * Off: the list is the program's front door, shown on every start. This is
   * for somebody who works on one font and would rather go straight in.
   */
  readonly skipChooser: boolean;
  /** Let a drag catch on the glyph's own points as well as the font's lines. */
  readonly snapPoints: boolean;
  /** Draw the glyphs either side, from the strip text. */
  readonly showNeighbours: boolean;
  /** Draw the glyph's anchors, and let them be grabbed. */
  readonly showAnchors: boolean;
  /**
   * Draw the curvature comb along the outline.
   *
   * Off by default. It is an instrument rather than part of the drawing: it
   * covers the letter in hairs, which is exactly what you want while judging a
   * join and never while judging a shape.
   */
  readonly showCurvature: boolean;
  /**
   * Show the picture a glyph is traced from, and how strongly.
   *
   * On, because a tracing you have set up is one you meant to see. The strength
   * is a preference and not a property of the picture: how far it should show
   * through depends on what you are doing to the outline over it, and changes
   * several times an hour.
   */
  readonly showImage: boolean;
  readonly imageOpacity: number;
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
  readonly split: SplitPlacement;
};

const KEY = "typewright.preferences";

/**
 * The keys these settings lived under before the editor was named.
 *
 * Read but never written. Someone who used the editor under its old name has
 * their theme and their inspector where they left them, and the first save
 * moves everything to the new key; nothing is migrated eagerly, because a
 * settings file is not worth a startup write.
 */
const OLD_KEY = "fonteditor.preferences";

/** The key the inspector's position used before it moved in here. */
const OLD_INSPECTOR_KEY = "fonteditor.inspector";

/** How wide a docked inspector is, in pixels, and how far it may be dragged. */
export const DOCK_WIDTH = 264;
export const MIN_DOCK_WIDTH = 200;
export const MAX_DOCK_WIDTH = 460;

export const DEFAULT_PLACEMENT: InspectorPlacement = {
  x: 24,
  y: 24,
  open: true,
  dock: "float",
  width: DOCK_WIDTH,
  sections: {},
};

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  outlineWidth: DEFAULT_OUTLINE_WIDTH,
  autoHideHandles: true,
  skipChooser: false,
  snapPoints: true,
  showNeighbours: true,
  showAnchors: true,
  showCurvature: false,
  showImage: true,
  imageOpacity: 0.5,
  applyFeatures: true,
  spacingSize: 128,
  proofSize: 32,
  proofLeading: 1.4,
  inspector: DEFAULT_PLACEMENT,
  split: DEFAULT_SPLIT,
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
  const stored = read(KEY) ?? read(OLD_KEY);
  const raw: Record<string, unknown> = stored ?? {};

  const inspector = (raw["inspector"] ?? read(OLD_INSPECTOR_KEY) ?? {}) as Record<string, unknown>;
  const split = (raw["split"] ?? {}) as Record<string, unknown>;

  return {
    theme: isTheme(raw["theme"]) ? raw["theme"] : DEFAULT_PREFERENCES.theme,
    outlineWidth: number(raw["outlineWidth"], DEFAULT_OUTLINE_WIDTH, {
      min: MIN_OUTLINE_WIDTH,
      max: MAX_OUTLINE_WIDTH,
    }),
    autoHideHandles: boolean(raw["autoHideHandles"], DEFAULT_PREFERENCES.autoHideHandles),
    skipChooser: boolean(raw["skipChooser"], DEFAULT_PREFERENCES.skipChooser),
    snapPoints: boolean(raw["snapPoints"], DEFAULT_PREFERENCES.snapPoints),
    showNeighbours: boolean(raw["showNeighbours"], DEFAULT_PREFERENCES.showNeighbours),
    showAnchors: boolean(raw["showAnchors"], DEFAULT_PREFERENCES.showAnchors),
    showCurvature: boolean(raw["showCurvature"], DEFAULT_PREFERENCES.showCurvature),
    showImage: boolean(raw["showImage"], DEFAULT_PREFERENCES.showImage),
    imageOpacity: number(raw["imageOpacity"], DEFAULT_PREFERENCES.imageOpacity, {
      min: 0.05,
      max: 1,
    }),
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
      dock: isDock(inspector["dock"]) ? inspector["dock"] : DEFAULT_PLACEMENT.dock,
      width: number(inspector["width"], DEFAULT_PLACEMENT.width, {
        min: MIN_DOCK_WIDTH,
        max: MAX_DOCK_WIDTH,
      }),
      sections: sectionsOf(inspector["sections"]),
    },
    split: {
      orientation: isOrientation(split["orientation"])
        ? split["orientation"]
        : DEFAULT_SPLIT.orientation,
      ratio: number(split["ratio"], DEFAULT_SPLIT.ratio, {
        min: MIN_SPLIT_RATIO,
        max: MAX_SPLIT_RATIO,
      }),
    },
  };
}

const isDock = (value: unknown): value is InspectorDock =>
  value === "float" || value === "left" || value === "right";

const isOrientation = (value: unknown): value is SplitOrientation =>
  value === "row" || value === "column";

/** The folded-by-hand choices, keeping only what this can make sense of. */
function sectionsOf(raw: unknown): Record<string, boolean> {
  if (typeof raw !== "object" || raw === null) return {};

  const out: Record<string, boolean> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "boolean") out[name] = value;
  }
  return out;
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
