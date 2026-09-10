import { type CatalogQuery, DEFAULT_QUERY } from "@typewright/catalog";
import type { WrittenFile } from "@typewright/disk";
import type { ExtraLayer } from "@typewright/font-io";
import { type EditSession, session as newSession } from "@typewright/edit-core";
import { editorState } from "@typewright/tools";
import {
  type FontDocument,
  type FontProject,
  type Location,
  project,
} from "@typewright/font-model";
import type { AutosaveStatus, ImageEntry, SnapshotEntry } from "@typewright/storage";

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
  /**
   * The axes, the masters, and which one is being drawn.
   *
   * The documents of the masters that are not open are on disk rather than in
   * here: this is the arrangement, and `session.editor.document` is the drawing.
   * A font with one master is a project with one master, which is what every
   * font starts as.
   */
  readonly project: FontProject;
  /**
   * Where the instance being previewed sits, or `null` for none.
   *
   * A place in the designspace rather than a master: the whole point of a
   * preview is to see the weights nobody drew.
   */
  readonly preview: Location | null;
  /** The font's own folder on the user's disk, and where saving it stands. */
  readonly folder: FolderState;
  /**
   * The pictures the font is traced from, as the store holds them.
   *
   * Names and sizes only — the bytes are in the working store and the decoded
   * bitmaps are in a cache beside this. Read when something is about to show
   * the list, which is the only time anybody wants it.
   */
  readonly images: readonly ImageEntry[];
  /**
   * The layers of the source that are not the one being drawn.
   *
   * Held whole rather than as a listing, because nothing here ever wants part
   * of one: they arrive when a font is opened and leave when a UFO is written,
   * and in between the editor has no way to look at them and no business doing
   * so. Beside the document rather than in it, for the reason the pictures are
   * — a second set of glyphs is the size of the first, and the document is a
   * value history copies on every edit.
   *
   * Here as well as in the working store, and that is deliberate: the store may
   * be unavailable — a private window, a browser that refuses OPFS — and a save
   * that dropped somebody's sketch layer because their browser would not keep a
   * file is the bug this whole arrangement exists to stop.
   */
  readonly layers: readonly ExtraLayer[];
  /** Draw the picture behind the glyph at all, and how strongly. */
  readonly showImage: boolean;
  readonly imageOpacity: number;
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
 * Where the font stands with respect to a folder on the user's disk.
 *
 * Separate from `saveStatus`, which is the working store's, because the two
 * answer different questions and mean different things. Autosave says "your
 * work is safe in this browser"; this says "the file other tools can read is
 * this far behind", and only a person pressing Save moves it.
 */
export type FolderState = {
  /** The folder being worked in, once one is open. */
  readonly name: string | null;
  /** A folder this editor worked in before, waiting to be opened again. */
  readonly remembered: string | null;
  /**
   * The document as it was last written there.
   *
   * The document itself rather than a flag: it is immutable, so comparing it
   * with the one on screen answers "has anything changed since the save"
   * exactly, and survives an undo back to what was saved.
   */
  readonly saved: FontDocument | null;
  readonly savedAt: number | null;
  readonly busy: boolean;
  /**
   * How far through writing the files it is, while it is writing them.
   *
   * `null` when nothing is being written. A count rather than a fraction: the
   * writer knows exactly how many files it will write, and a number that moves
   * is proof something is happening where a bar of unknown length is not.
   */
  readonly progress: { readonly done: number; readonly total: number } | null;
  /**
   * What the last save left in the folder, as a checksum per file.
   *
   * So the next save can write only what differs. Held here rather than read
   * back off the disk because reading a file to find out whether it needs
   * writing costs as much as writing it — and because this is a record of what
   * this editor put there, which is the thing worth comparing against.
   *
   * Empty after a reload, which makes the next save write everything once. That
   * is the honest answer: a folder this session has not written to is somebody
   * else's, whatever the session before it did.
   */
  readonly written: ReadonlyMap<string, WrittenFile>;
  /**
   * Whether anything has looked at the folder this session.
   *
   * False for a folder picked up from the last session on the way in: the
   * record of what is in it is a belief until something reads it, and a save
   * under that belief checks each file it means to skip.
   */
  readonly checked: boolean;
  readonly problem: string | null;
};

export const NO_FOLDER: FolderState = {
  name: null,
  remembered: null,
  saved: null,
  savedAt: null,
  busy: false,
  progress: null,
  written: new Map(),
  checked: true,
  problem: null,
};

/**
 * The state a store opens with: the starter font, and the reader's own settings.
 *
 * The preferences are read before this rather than inside it, so the very first
 * frame is already in the reader's theme rather than flashing the default and
 * correcting itself.
 */
export function initialState(preferences: Preferences): StoreState {
  const starter = starterFont();
  return {
    session: newSession(editorState({ document: starter, view: { scale: 1, tx: 0, ty: 0 } })),
    saveStatus: "idle",
    storage: "connecting",
    storageDetail: "",
    recovered: false,
    snapshots: [],
    project: project(starter),
    preview: null,
    folder: NO_FOLDER,
    images: [],
    layers: [],
    showImage: preferences.showImage,
    imageOpacity: preferences.imageOpacity,
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
