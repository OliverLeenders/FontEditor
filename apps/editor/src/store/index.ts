import type { CatalogQuery } from "@fonteditor/catalog";
import {
  canRedoSession,
  canUndoSession,
  redo,
  redoLabelOf,
  undo,
  undoLabelOf,
  apply as applyToSession,
} from "@fonteditor/edit-core";
import {
  type FontDocument,
  type Glyph,
  type GlyphName,
  putGlyph,
  setFeatures,
  setGlyphImage,
} from "@fonteditor/font-model";
import {
  type EditorState,
  type ToolId,
  type ToolResult,
  begin,
  commit,
  currentGlyph,
  result,
  setActiveTool,
} from "@fonteditor/tools";
import type { Axis } from "@fonteditor/font-model";
import type { ViewTransform } from "@fonteditor/view";
import type { DiskFolder } from "@fonteditor/disk";

import { frameGlyph } from "../framing.js";
import { type Decoded, ImageCache } from "../images.js";
import {
  MAX_OUTLINE_WIDTH,
  MAX_PROOF_LEADING,
  MAX_PROOF_SIZE,
  MAX_SPACING_SIZE,
  MIN_OUTLINE_WIDTH,
  MIN_PROOF_LEADING,
  MIN_PROOF_SIZE,
  MIN_SPACING_SIZE,
} from "../limits.js";
import {
  type InspectorPlacement,
  type ThemeChoice,
  clampInspector,
  loadPreferences,
} from "../preferences.js";
import { Persistence, type PersistenceReport } from "../persistence.js";
import {
  type FolderReport,
  type SaveReport,
  forgetOpenFolder,
  noteRememberedFolder,
  openFolder,
  reopenFolder,
  saveFolder,
  saveFolderAs,
} from "./folder.js";
import { type FontHost, type ImportReport, importFont, newFont, showDocument } from "./fonts.js";
import { type AddedImage, addImage, refreshImages, setImageOn } from "./images.js";
import {
  type MasterReport,
  addMaster,
  compareWith,
  moveMaster,
  parkCurrent,
  projectFrom,
  removeMaster,
  renameMaster,
  setAxes,
  switchMaster,
} from "./masters.js";
import { defaults, remember, within } from "./settings.js";
import { NO_FOLDER, type StoreState, initialState } from "./state.js";

// Re-exported so the panels that already read these from the store keep working;
// they live in `limits.ts` because the preferences need them too, and preferences
// are read before this store exists.
export {
  DEFAULT_OUTLINE_WIDTH,
  MAX_OUTLINE_WIDTH,
  MAX_PROOF_SIZE,
  MAX_PROOF_LEADING,
  MAX_SPACING_SIZE,
  MIN_OUTLINE_WIDTH,
  MIN_PROOF_SIZE,
  MIN_PROOF_LEADING,
  MIN_SPACING_SIZE,
} from "../limits.js";
export { DEFAULT_PREFERENCES } from "../preferences.js";
export type { InspectorPlacement, Preferences, ThemeChoice } from "../preferences.js";
export type { Ownership, StorageState } from "../persistence.js";
export type { FolderState, StoreState } from "./state.js";
export type { ImportReport } from "./fonts.js";
export type { FolderReport, SaveReport } from "./folder.js";
export type { MasterReport } from "./masters.js";
export { unsaved } from "./folder.js";

/**
 * How long the font has to be worked on before another copy of it is kept.
 *
 * Long enough that the copies are worth having and few enough to keep — twenty
 * of them at five minutes covers the best part of two hours of work, which is
 * about as far back as anyone reaches before reaching for the file they
 * exported.
 */
const SNAPSHOT_EVERY_MS = 5 * 60 * 1000;

/**
 * The editor's state, held outside React.
 *
 * The reason is the canvas. A drag produces pointer events at sixty to a hundred
 * and twenty a second, and every one of them changes the document. With the
 * state in React, each would reconcile the whole tree — tabs, toolbar, inspector
 * and strip — to move one node. Here the canvas subscribes directly and asks the
 * surface to redraw, which costs one canvas frame and no React render at all,
 * while panels subscribe through selectors and wake only when their own slice
 * changes.
 *
 * What it holds is what the interface reads: the session and its history, the
 * camera, and the settings that are not part of the document. Getting any of
 * that to disk belongs to `Persistence`, which this owns but does not
 * second-guess.
 *
 * It lives in the app rather than a package because nothing else consumes it.
 * If a second consumer appears, extract it then.
 */
export class EditorStore {
  private state: StoreState;
  private readonly listeners = new Set<() => void>();
  private readonly disk: Persistence;
  /**
   * The store as the modules below it see it: read the state, change the state,
   * and the few verbs opening a font needs. Built once rather than per call, so
   * passing it costs nothing.
   */
  private readonly host: FontHost;
  /**
   * When the last copy of the whole font was kept, and of what.
   *
   * The document as well as the time: nothing is worth copying twice, and a
   * font left open in a window that is not being touched should not accumulate
   * identical copies of itself.
   */
  private snapshotAt = 0;
  private snapshotted: FontDocument | null = null;
  /**
   * The folder on disk the font is being kept in, if it is.
   *
   * Not in the state: it is a live capability rather than something the
   * interface reads, and the interface reads its name, which is. Keeping the
   * handle out here also means a render can never accidentally hold one open.
   */
  private folderHandle: DiskFolder | null = null;
  /**
   * The pictures, decoded.
   *
   * Outside the state for the reason the folder handle is: a bitmap is not
   * something the interface reads, and a render holding one would keep a
   * twenty-megapixel scan alive after the font that used it was closed.
   */
  private readonly pictures = new ImageCache(
    (name) => this.disk.getImage(name),
    () => {
      // A picture that has finished decoding changes what the canvas should be
      // showing without changing the document, so the listeners are woken
      // directly rather than through a patch.
      for (const listener of this.listeners) listener();
    },
  );

  constructor() {
    // The preferences are read before the state is built, so the very first
    // frame is already in the reader's theme.
    this.state = initialState(loadPreferences());
    this.disk = new Persistence((changes: PersistenceReport) => this.patch(changes));
    this.host = {
      state: () => this.state,
      patch: (changes) => {
        this.patch(changes);
      },
      disk: this.disk,
      keepSnapshot: () => this.snapshot(),
      forgetImage: (name) => {
        this.pictures.forget(name);
      },
      folder: () => this.folderHandle,
      setFolder: (folder, name) => {
        this.folderHandle = folder;
        if (folder === null) this.patch({ folder: NO_FOLDER });
        else this.patch({ folder: { ...this.state.folder, name: name ?? folder.name } });
      },
      showGlyph: (name) => {
        this.setCurrentGlyph(name);
      },
      setCatalogQuery: (changes) => {
        this.setCatalogQuery(changes);
      },
    };
  }

  // ---- subscription ------------------------------------------------------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getState = (): StoreState => this.state;

  /**
   * Change something that is not the document.
   *
   * Public because it already is: every module beside this one — opening a
   * font, the folder on disk, the pictures — is handed exactly this function
   * through `host`, so marking it private here only hid it from the tests that
   * drive the same paths.
   */
  patch(changes: Partial<StoreState>): void {
    this.state = { ...this.state, ...changes };
    for (const listener of this.listeners) listener();
  }

  // ---- reading -----------------------------------------------------------

  get editor(): EditorState {
    return this.state.session.editor;
  }

  glyph(): Glyph | null {
    return currentGlyph(this.editor);
  }

  // ---- tool plumbing -----------------------------------------------------

  /**
   * Fold a tool's output in, and tell autosave in case anything committed.
   *
   * Not while a gesture is in flight. `pending` is exactly "a transaction is
   * open", and every pointer move of a drag produces a new document that is not
   * a step yet — telling autosave about each of them wrote the glyph to the
   * journal a hundred times a second for a state the user has not committed to
   * and undo cannot return to. The commit at the end of the drag says everything
   * those writes were saying, once.
   */
  applyTool(outcome: ToolResult): void {
    const session = applyToSession(this.state.session, outcome);
    if (session.pending === null) {
      this.disk.commit(session.editor.document);
      this.considerSnapshot(session.editor.document);
    }
    // One patch, not two: each one wakes every listener, and a drag would
    // otherwise redraw and re-run every selector twice per pointer event.
    this.patch(
      this.state.saveStatus === this.disk.status
        ? { session }
        : { session, saveStatus: this.disk.status },
    );
  }

  // ---- snapshots ---------------------------------------------------------

  /**
   * Keep a copy of the whole font now and then, while it is being worked on.
   *
   * Undo is a session's memory and dies with the tab; autosave keeps up with
   * what just happened, which is exactly no help when what just happened is the
   * thing you want back. A copy every so often is the difference between "an
   * hour ago" being a place you can return to and a thing you remember.
   *
   * Time rather than edit count, and only when the document has actually moved:
   * a font is a megabyte or two of JSON, and the point is to have a few useful
   * copies rather than a thousand identical ones.
   */
  private considerSnapshot(document: FontDocument): void {
    if (document === this.snapshotted) return;
    if (Date.now() - this.snapshotAt < SNAPSHOT_EVERY_MS) return;
    void this.snapshot(document);
  }

  /**
   * Keep a copy now, whatever the clock says.
   *
   * Called before anything that replaces the whole font — opening one, starting
   * a new one, restoring an older copy — because that is the moment a way back
   * is worth most and the moment the editor is about to stop having one.
   */
  async snapshot(document: FontDocument = this.editor.document): Promise<void> {
    this.snapshotAt = Date.now();
    this.snapshotted = document;
    const entries = await this.disk.snapshot(document, this.snapshotAt);
    this.patch({ snapshots: entries });
  }

  /** Read the list back from disk, for whatever is about to show it. */
  async refreshSnapshots(): Promise<void> {
    this.patch({ snapshots: await this.disk.snapshots() });
  }

  /**
   * Put an older copy of the font back on screen and on disk.
   *
   * A copy of what is open is kept first, so restoring is itself something you
   * can come back from — which is the whole reason to trust the button at all.
   *
   * Not undoable, for the reason opening a font is not: a single ctrl-Z that
   * silently swapped the whole font back would be alarming, and the history it
   * restored would describe glyphs that are no longer open.
   */
  async restoreSnapshot(
    at: number,
  ): Promise<{ glyphs: number; problems: readonly string[] } | null> {
    const found = await this.disk.readSnapshot(at);
    if (found === null) return null;

    await this.snapshot();
    showDocument(this.host, found.document, false);
    await this.disk.replaceAll(found.document);
    await this.refreshSnapshots();

    return { glyphs: found.document.glyphOrder.length, problems: found.problems };
  }

  /** Change something that is not the document — the camera, or which glyph. */
  setEditor(editor: EditorState): void {
    this.patch({ session: { ...this.state.session, editor } });
  }

  setView(view: ViewTransform): void {
    this.setEditor({ ...this.editor, view });
  }

  setTool(tool: ToolId): void {
    this.applyTool(setActiveTool(this.editor, tool));
  }

  setCurrentGlyph(name: GlyphName): void {
    if (name === this.editor.currentGlyph) return;
    this.setEditor({
      ...this.editor,
      currentGlyph: name,
      selection: [],
      pen: null,
      focusedSegment: null,
      hoveredSegment: null,
    });
    this.fitGlyph();
  }

  undo(): void {
    this.patch({ session: undo(this.state.session) });
    this.disk.commit(this.state.session.editor.document);
  }

  redo(): void {
    this.patch({ session: redo(this.state.session) });
    this.disk.commit(this.state.session.editor.document);
  }

  canUndo(): boolean {
    return canUndoSession(this.state.session);
  }

  canRedo(): boolean {
    return canRedoSession(this.state.session);
  }

  undoLabel(): string | null {
    return undoLabelOf(this.state.session);
  }

  redoLabel(): string | null {
    return redoLabelOf(this.state.session);
  }

  // ---- view --------------------------------------------------------------

  /**
   * Record the canvas size. Called from inside the render callback, which is why
   * the early return matters more than it looks.
   *
   * Without it every frame patched the state with a fresh viewport object, which
   * notified the canvas, which invalidated, which drew another frame — a loop
   * that redrew continuously at sixty frames a second and re-ran every React
   * selector with it. Precisely the cost the store exists to avoid.
   */
  setViewport(width: number, height: number): void {
    const { viewport } = this.state;
    if (viewport.width === width && viewport.height === height) return;

    // The first *useful* size, not merely the first non-zero one. A canvas
    // measured before the page has laid out is zero, which the surface reports
    // as 1×1 — and fitting a glyph to a one-pixel window is a zoom nobody wants.
    // Worse, the real size arriving a frame later then counted as "not the
    // first", so the view stayed at that nonsense and the glyph opened off
    // screen until somebody pressed ctrl-0.
    const useful = width > 1 && height > 1;
    const wasUseful = viewport.width > 1 && viewport.height > 1;
    this.patch({ viewport: { width, height } });
    if (useful && !wasUseful) this.fitGlyph();
  }

  fitGlyph(): void {
    const glyph = this.glyph();
    if (glyph === null) return;

    const { width, height } = this.state.viewport;
    const fitted = frameGlyph(glyph, this.editor.document.info, width, height);
    if (fitted !== null) this.setView(fitted);
  }

  setPreviewing(previewing: boolean): void {
    if (previewing !== this.state.previewing) this.patch({ previewing });
  }

  // ---- opening a font ----------------------------------------------------

  /** Start a new, empty font, discarding whatever is open. */
  async newFont(): Promise<void> {
    await newFont(this.host);
  }

  /** Replace the document with a font read from a file. */
  async importFont(bytes: ArrayBuffer, fileName = ""): Promise<ImportReport> {
    return await importFont(this.host, bytes, fileName);
  }

  // ---- masters ------------------------------------------------------------

  /** Go to another master, parking the one being drawn on the way. */
  async switchMaster(id: string): Promise<MasterReport | null> {
    return await switchMaster(this.host, id);
  }

  /** Add one, drawn from the master in front of you. */
  async addMaster(id: string, name: string, location: Record<string, number>): Promise<void> {
    await addMaster(this.host, id, name, location);
  }

  async removeMaster(id: string): Promise<void> {
    await removeMaster(this.host, id);
  }

  async renameMaster(id: string, name: string): Promise<void> {
    await renameMaster(this.host, id, name);
  }

  async moveMaster(id: string, location: Record<string, number>): Promise<void> {
    await moveMaster(this.host, id, location);
  }

  async setAxes(axes: readonly Axis[]): Promise<void> {
    await setAxes(this.host, axes);
  }

  /** What cannot be interpolated between this master and another. */
  async compareWith(id: string): Promise<Awaited<ReturnType<typeof compareWith>>> {
    return await compareWith(this.host, id);
  }

  // ---- the font's folder on disk -----------------------------------------

  /** Open a UFO folder the user picks, replacing what is open. */
  async openFolder(): Promise<FolderReport | null> {
    return await openFolder(this.host);
  }

  /** Open the folder this editor was last working in. */
  async reopenFolder(): Promise<FolderReport | null> {
    return await reopenFolder(this.host);
  }

  /** Write the font back to its folder. */
  async saveFolder(): Promise<SaveReport> {
    return await saveFolder(this.host);
  }

  /** Write the font to a folder the user picks, and work there from now on. */
  async saveFolderAs(): Promise<SaveReport | null> {
    return await saveFolderAs(this.host);
  }

  /** Stop pointing at a folder, and stop remembering it. */
  async forgetFolder(): Promise<void> {
    await forgetOpenFolder(this.host);
  }

  /** On the way in: say which folder this editor was last working in. */
  async noteRememberedFolder(): Promise<void> {
    await noteRememberedFolder(this.host);
  }

  // ---- the pictures a font is traced from --------------------------------

  /** The decoded picture behind a name, or `null` while it is being read. */
  picture(name: string): Decoded | null {
    return this.pictures.get(name);
  }

  /** Whether a picture is in the font but cannot be shown. */
  pictureBroken(name: string): boolean {
    return this.pictures.broken(name);
  }

  /** Put a file in the font's pictures, replacing one of the same name. */
  async addImage(file: File): Promise<AddedImage> {
    return await addImage(this.host, file);
  }

  /** Every picture in the font, for an export that has to carry them. */
  async allImages(): Promise<Map<string, Uint8Array>> {
    return await this.disk.allImages();
  }

  /** Read the list of pictures back from the store. */
  async refreshImages(): Promise<void> {
    await refreshImages(this.host);
  }

  /** Put a picture behind the current glyph, or take away the one there. */
  setImage(name: string | null): void {
    const next = setImageOn(this.editor, name);
    if (next === null) return;
    this.applyTool(result(next, [begin("Trace from a picture"), commit]));
  }

  /**
   * Take a picture out of the font.
   *
   * Every glyph tracing from it stops, in the same step, because a glyph
   * pointing at a file that is not there would draw nothing and say nothing.
   */
  async removeImage(name: string): Promise<void> {
    let editor = this.editor;
    for (const glyph of editor.document.glyphOrder) {
      const found = editor.document.glyphs[glyph];
      if (found?.image?.name !== name) continue;
      const document = putGlyph(editor.document, setGlyphImage(found, null));
      editor = { ...editor, document };
    }
    if (editor !== this.editor) {
      this.applyTool(result(editor, [begin("Remove a picture"), commit]));
    }

    await this.disk.removeImage(name);
    this.pictures.forget(name);
    await this.refreshImages();
  }

  // ---- settings ----------------------------------------------------------

  setCatalogQuery(changes: Partial<CatalogQuery>): void {
    const catalogQuery = { ...this.state.catalogQuery, ...changes };
    const current = this.state.catalogQuery;
    if (
      catalogQuery.set === current.set &&
      catalogQuery.search === current.search &&
      catalogQuery.order === current.order
    ) {
      return;
    }
    this.patch({ catalogQuery });
  }

  toggleAutoHideHandles(): void {
    this.remember({ autoHideHandles: !this.state.autoHideHandles });
  }

  toggleSnapPoints(): void {
    this.remember({ snapPoints: !this.state.snapPoints });
  }

  setTheme(theme: ThemeChoice): void {
    if (theme === this.state.theme) return;
    this.remember({ theme });
  }

  setOutlineWidth(outlineWidth: number): void {
    const held = within(outlineWidth, MIN_OUTLINE_WIDTH, MAX_OUTLINE_WIDTH);
    if (held !== null) this.remember({ outlineWidth: held });
  }

  setSpacingText(spacingText: string): void {
    this.patch({ spacingText });
  }

  setSpacingMode(spacingMode: "space" | "kern"): void {
    if (spacingMode !== this.state.spacingMode) this.patch({ spacingMode });
  }

  /**
   * Replace the font's feature source.
   *
   * An edit to the document like any other, so it is undoable and saved — the
   * feature file is part of the font rather than a setting about it.
   */
  setFeatures(features: string): void {
    const document = setFeatures(this.editor.document, features);
    if (document === this.editor.document) return;
    this.applyTool(result({ ...this.editor, document }, [begin("Edit features"), commit]));
  }

  setProofText(proofText: string): void {
    this.patch({ proofText });
  }

  setProofSize(proofSize: number): void {
    const held = within(proofSize, MIN_PROOF_SIZE, MAX_PROOF_SIZE);
    if (held !== null) this.remember({ proofSize: held });
  }

  setProofLeading(proofLeading: number): void {
    const held = within(proofLeading, MIN_PROOF_LEADING, MAX_PROOF_LEADING);
    if (held !== null) this.remember({ proofLeading: held });
  }

  setSpacingSize(spacingSize: number): void {
    const held = within(spacingSize, MIN_SPACING_SIZE, MAX_SPACING_SIZE);
    if (held !== null) this.remember({ spacingSize: held });
  }

  toggleNeighbours(): void {
    this.remember({ showNeighbours: !this.state.showNeighbours });
  }

  toggleAnchors(): void {
    this.remember({ showAnchors: !this.state.showAnchors });
  }

  toggleImage(): void {
    this.remember({ showImage: !this.state.showImage });
  }

  setImageOpacity(value: number): void {
    const opacity = within(value, 0.05, 1);
    if (opacity !== null) this.remember({ imageOpacity: opacity });
  }

  toggleCurvature(): void {
    this.remember({ showCurvature: !this.state.showCurvature });
  }

  toggleApplyFeatures(): void {
    this.remember({ applyFeatures: !this.state.applyFeatures });
  }

  /** Put every preference back where it started. */
  resetPreferences(): void {
    this.remember(defaults());
  }

  /** Every setting is written through one door: see `settings.ts`. */
  private remember(changes: Partial<StoreState>): void {
    remember(this.host, changes);
  }

  setStripText(stripText: string): void {
    this.patch({ stripText });
  }

  moveInspector(x: number, y: number): void {
    this.placeInspector({ ...this.state.inspector, ...clampInspector(x, y) });
  }

  /** Pull the inspector back into view — after a resize, or a restore from a larger window. */
  reclampInspector(): void {
    const { x, y } = clampInspector(this.state.inspector.x, this.state.inspector.y);
    if (x === this.state.inspector.x && y === this.state.inspector.y) return;
    this.placeInspector({ ...this.state.inspector, x, y });
  }

  toggleInspector(): void {
    this.placeInspector({ ...this.state.inspector, open: !this.state.inspector.open });
  }

  private placeInspector(inspector: InspectorPlacement): void {
    this.remember({ inspector });
  }

  // ---- storage -----------------------------------------------------------

  /**
   * Open the store and adopt whatever is there.
   *
   * Everything above works without storage, and opening it may fail: a browser
   * without OPFS should still give a usable editor that simply cannot remember
   * anything, which is why nothing here is allowed to throw.
   */
  async connectStorage(worker: Worker): Promise<void> {
    const loaded = await this.disk.open(worker);
    if (loaded === null) return;

    if (loaded.kind === "loaded") {
      // The session is still the one the constructor made, so this swaps the
      // document into it rather than starting a new history over nothing.
      this.patch({
        session: {
          ...this.state.session,
          editor: {
            ...this.editor,
            document: loaded.document,
            currentGlyph: loaded.document.glyphOrder[0] ?? "",
          },
        },
        recovered: loaded.recovered,
        // The axes and the masters, if this project has any. What was loaded is
        // the master that was open when the tab last closed; the rest stay
        // parked until they are asked for.
        project: projectFrom(await this.disk.getDesignspace(), loaded.document),
      });
      this.fitGlyph();
    }

    // Only a document read back from the glyph files is genuinely on disk. One
    // recovered from the journal is ahead of them, and the starter font shown
    // when the store is empty has never been written at all.
    const onDisk = loaded.kind === "loaded" && !loaded.recovered;
    await this.disk.settle(this.editor.document, !onDisk);
  }

  /**
   * Take the project over from whichever tab holds it.
   *
   * The document is reloaded afterwards rather than kept: the owning tab may
   * have changed anything at all, including replacing the font, and writing this
   * tab's stale copy over it is the exact bug this whole mechanism exists to
   * stop.
   */
  async takeOver(): Promise<void> {
    if (!(await this.disk.steal())) return;

    const loaded = await this.disk.reload();
    if (loaded === null || loaded.kind !== "loaded") return;

    showDocument(this.host, loaded.document, loaded.recovered);
    this.disk.markLoaded(loaded.document, loaded.recovered);
    // The other tab may have added or removed masters as readily as glyphs.
    this.patch({
      saveStatus: this.disk.status,
      project: projectFrom(await this.disk.getDesignspace(), loaded.document),
    });
  }

  flush(): void {
    this.disk.flush();
    // The parked copy of the open master, brought up to date. It is what every
    // other master is compared against and what a switch reads back, and it is
    // stale for exactly as long as this tab has been drawing.
    void parkCurrent(this.host);
  }
}
