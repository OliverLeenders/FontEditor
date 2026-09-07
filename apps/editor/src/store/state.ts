import { type CatalogQuery, DEFAULT_QUERY } from "@fonteditor/catalog";
import { type EditSession, session as newSession } from "@fonteditor/edit-core";
import { editorState } from "@fonteditor/tools";
import type { AutosaveStatus, SnapshotEntry } from "@fonteditor/storage";

import type { InspectorPlacement, Preferences, ThemeChoice } from "../preferences.js";
import type { Ownership, StorageState } from "../persistence.js";
import { starterFont } from "../sample.js";
import { PROOF_TEXT } from "../specimens.js";

/**
 * The shape of everything the interface reads, and where it starts.
 *
 * Its own module because it is read far more often than it is changed: the
 * scene builder, every selector and every panel names this type, and none of
 * them cares how the store's methods are written.
 */

/**
 * Everything the interface reads, in one immutable value.
 *
 * Replaced wholesale on every change, so a selector comparing with `Object.is`
 * sees exactly the slices that moved.
 */
export type StoreState = {
  readonly session: EditSession;
  readonly saveStatus: AutosaveStatus;
  readonly storage: StorageState;
  readonly storageDetail: string;
  readonly recovered: boolean;
  /**
   * The copies of the whole font kept beside it, newest first.
   *
   * Read on demand rather than watched: the list is what someone looks at while
   * deciding whether they have lost something, and until they ask there is
   * nothing to show.
   */
  readonly snapshots: readonly SnapshotEntry[];
  /** Only the owning tab writes. A second tab shows the font and saves nothing. */
  readonly ownership: Ownership;
  /** What the glyph strip is showing, as typed. */
  readonly stripText: string;
  /** Space held: draw the shape without any controls. */
  readonly previewing: boolean;
  readonly inspector: InspectorPlacement;
  /** Which palette to draw with, or "system" to follow the reader's machine. */
  readonly theme: ThemeChoice;
  /** What the glyph browser is filtered to. Not undoable, so it lives out here. */
  readonly catalogQuery: CatalogQuery;
  /** Draw the glyphs either side, from the strip text, for judging spacing. */
  readonly showNeighbours: boolean;
  readonly showAnchors: boolean;
  readonly showCurvature: boolean;
  /** Show handles only where the work is. On by default; the canvas is calmer. */
  readonly autoHideHandles: boolean;
  /**
   * Let a drag catch on the glyph's own points as well as the font's lines.
   *
   * The metric lines are always live and need no setting: the canvas draws them,
   * so catching on one explains itself. These do not draw yet, which is what the
   * switch is for.
   */
  readonly snapPoints: boolean;
  /** Apply the font's features when setting the spacing line and the proof. */
  readonly applyFeatures: boolean;
  /**
   * How heavy the outline is drawn, in screen pixels.
   *
   * A preference rather than a fact about the font: a hairline is right for
   * judging a curve against the grid, and a heavier stroke is right for reading
   * the shape across the room.
   */
  readonly outlineWidth: number;
  /**
   * The spacing workspace's own text and type size.
   *
   * Its own, not the glyph strip's: spacing wants strings like "nonno" that
   * would be odd sitting under the drawing canvas, and the two views want
   * different text at the same time. Seeded from the strip so nothing is retyped.
   */
  readonly spacingText: string;
  readonly spacingSize: number;
  /** Whether the spacing view's arrows adjust a glyph or the gap before it. */
  readonly spacingMode: "space" | "kern";
  /**
   * The proof's own text, size and leading.
   *
   * Its own again, for the reason spacing has its own: a proof wants paragraphs
   * and the spacing view wants "nonno", and having to retype one to see the
   * other would make comparing them a chore rather than a glance.
   */
  readonly proofText: string;
  readonly proofSize: number;
  /** Line spacing as a multiple of the em, which is how type is set. */
  readonly proofLeading: number;
  readonly viewport: { readonly width: number; readonly height: number };
};

/**
 * The state a store opens with: the starter font, and the reader's own settings.
 *
 * The preferences are read before this rather than inside it, so the very first
 * frame is already in the reader's theme rather than flashing the default and
 * correcting itself.
 */
export function initialState(preferences: Preferences): StoreState {
  return {
    session: newSession(editorState({ document: starterFont(), view: { scale: 1, tx: 0, ty: 0 } })),
    saveStatus: "idle",
    storage: "connecting",
    storageDetail: "",
    recovered: false,
    snapshots: [],
    ownership: "owner",
    stripText: "hello",
    catalogQuery: DEFAULT_QUERY,
    showNeighbours: preferences.showNeighbours,
    showAnchors: preferences.showAnchors,
    showCurvature: preferences.showCurvature,
    autoHideHandles: preferences.autoHideHandles,
    snapPoints: preferences.snapPoints,
    applyFeatures: preferences.applyFeatures,
    outlineWidth: preferences.outlineWidth,
    spacingText: "nonno",
    spacingSize: preferences.spacingSize,
    spacingMode: "space",
    proofText: PROOF_TEXT,
    proofSize: preferences.proofSize,
    proofLeading: preferences.proofLeading,
    previewing: false,
    inspector: preferences.inspector,
    theme: preferences.theme,
    viewport: { width: 0, height: 0 },
  };
}

/**
 * What the parts below the store need of it: read the state, change the state.
 *
 * Narrow on purpose. A module that opens a font or writes a preference has no
 * business reaching into the class for anything else, and saying so in a type
 * means it cannot.
 */
export type StoreHost = {
  state(): StoreState;
  patch(changes: Partial<StoreState>): void;
};
