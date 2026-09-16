import type { CatalogQuery } from "@typewright/catalog";
import { type ExtraLayer, placeMarks, readMarks } from "@typewright/font-io";
import {
  canRedoSession,
  canUndoSession,
  redo,
  redoLabelOf,
  undo,
  undoLabelOf,
  apply as applyToSession,
} from "@typewright/edit-core";
import {
  type FontDocument,
  type Glyph,
  type GlyphName,
  orderedGlyphs,
  putGlyph,
  randomIds,
  setFeatures,
  setGlyphImage,
} from "@typewright/font-model";
import {
  type EditorState,
  type ToolId,
  type ToolResult,
  begin,
  commit,
  currentGlyph,
  result,
  setActiveTool,
} from "@typewright/tools";
import { type Axis, orderedMasters } from "@typewright/font-model";
import type { ViewTransform } from "@typewright/view";
import { type DiskFolder, FIRST_PROJECT } from "@typewright/disk";

import { frameGlyph } from "../framing.js";
import { type Decoded, ImageCache } from "../images.js";
import {
  MAX_FEATURE_SIZE,
  MAX_OUTLINE_WIDTH,
  MAX_PROOF_LEADING,
  MAX_PROOF_SIZE,
  MAX_SPACING_SIZE,
  MIN_FEATURE_SIZE,
  MIN_OUTLINE_WIDTH,
  MIN_PROOF_LEADING,
  MIN_PROOF_SIZE,
  MIN_SPACING_SIZE,
} from "../limits.js";
import { type InspectorDock, type ThemeChoice, loadPreferences } from "../preferences.js";
import { Persistence, type PersistenceReport } from "../persistence.js";
import {
  type FolderReport,
  type SaveReport,
  forgetOpenFolder,
  openFolder,
  reopenFolder,
  saveFolder,
  saveFolderAs,
  unsaved,
} from "./folder.js";
import { type FontHost, type ImportReport, importFont, newFont, showDocument } from "./fonts.js";
import {
  dockInspector,
  moveInspector,
  reclampInspector,
  resizeInspector,
  toggleInspector,
  toggleInspectorSection,
} from "./inspector.js";
import { type SplitChanges, placeSplit } from "./split.js";
import {
  type Arrival,
  arrive,
  chosenOnReload,
  forgetProject,
  sweepForgotten,
  noteProjects,
  requestedArrival,
  showChooser,
  startProject,
  switchTo,
} from "./projects.js";
import { type AddedImage, addImage, refreshImages, setImageOn } from "./images.js";
import {
  type MasterReport,
  addInstance,
  addMaster,
  compareWith,
  moveInstance,
  moveMaster,
  loadSources,
  parkCurrent,
  projectFrom,
  removeInstance,
  removeMaster,
  renameInstance,
  renameMaster,
  setInstanceFamily,
  setAxes,
  switchMaster,
} from "./masters.js";
import { defaults, remember, within } from "./settings.js";
import { Snapshots } from "./snapshots.js";
import { NO_FOLDER, type ProjectSummary, type StoreState, initialState } from "./state.js";

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
export type {
  InspectorDock,
  InspectorPlacement,
  Preferences,
  ThemeChoice,
} from "../preferences.js";
export { DOCK_WIDTH, MAX_DOCK_WIDTH, MIN_DOCK_WIDTH } from "../preferences.js";
export type { Ownership, StorageState } from "../persistence.js";
export type { FolderState, StoreState } from "./state.js";
export type { ImportReport } from "./fonts.js";
export type { FolderReport, SaveReport } from "./folder.js";
export type { MasterReport } from "./masters.js";
export { unsaved } from "./folder.js";

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
  /** Copies of the whole font, kept as it is worked on. See `snapshots.ts`. */
  private readonly snapshots: Snapshots;
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
    this.snapshots = new Snapshots(this.host);
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
      this.snapshots.consider(session.editor.document);
    }
    // One patch, not two: each one wakes every listener, and a drag would
    // otherwise redraw and re-run every selector twice per pointer event.
    this.patch(
      this.state.saveStatus === this.disk.status
        ? { session }
        : { session, saveStatus: this.disk.status },
    );
  }

  /**
   * Replace the font's feature source.
   *
   * An edit to the document like any other, so it is undoable and saved — the
   * feature file is part of the font rather than a setting about it.
   */
  setFeatures(features: string, apart = false): void {
    const document = setFeatures(this.editor.document, features);
    if (document === this.editor.document) return;
    // Typing merges into one step; a replacement stands apart, so that undo
    // takes back exactly the replacement.
    this.applyTool(result({ ...this.editor, document }, [begin("Edit features", !apart), commit]));
  }

  /** Ids for the anchors a Marks file adds. */
  private readonly markIds = randomIds();

  /**
   * Put what a Marks file says into the anchors of the master being edited.
   *
   * Only when the whole file reads cleanly: a file read in half would take away
   * the anchors on the lines it could not read. A change is one step, so undo
   * takes back what was typed, and a reading that moves nothing is no step.
   */
  setMarks(text: string, apart = false): void {
    const document = this.editor.document;
    const reading = readMarks(text, (name) => name in document.glyphs);
    if (reading.problems.length > 0) return;
    let next = document;
    for (const g of placeMarks(orderedGlyphs(document), reading, this.markIds)) {
      next = putGlyph(next, g);
    }
    if (next === document) return;
    this.applyTool(
      result({ ...this.editor, document: next }, [begin("Edit marks", !apart), commit]),
    );
  }

  // ---- snapshots ---------------------------------------------------------

  /** Keep a copy of the whole font now, whatever the clock says. */
  async snapshot(document: FontDocument = this.editor.document): Promise<void> {
    await this.snapshots.keep(document);
  }

  /** Read the list of copies back, for whatever is about to show it. */
  async refreshSnapshots(): Promise<void> {
    await this.snapshots.refresh();
  }

  /** Put an older copy of the font back on screen and on disk. */
  async restoreSnapshot(
    at: number,
  ): Promise<{ glyphs: number; problems: readonly string[] } | null> {
    return await this.snapshots.restore(at);
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

  /**
   * The glyph before or after this one, in the font's own order.
   *
   * That order rather than alphabetical or by codepoint: it is what the browser
   * shows, what a UFO stores, and what the designer arranged. Stops at either
   * end rather than wrapping — arriving back at `A` from `z` reads as a bug the
   * first three times it happens.
   */
  stepGlyph(by: number): void {
    const order = this.editor.document.glyphOrder;
    const at = order.indexOf(this.editor.currentGlyph);
    if (at === -1) return;

    const next = order[at + by];
    if (next !== undefined) this.setCurrentGlyph(next);
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

  // ---- the styles named between the masters -------------------------------

  async addInstance(id: string, name: string, location: Record<string, number>): Promise<void> {
    await addInstance(this.host, id, name, location);
  }

  async removeInstance(id: string): Promise<void> {
    await removeInstance(this.host, id);
  }

  async renameInstance(id: string, name: string): Promise<void> {
    await renameInstance(this.host, id, name);
  }

  async moveInstance(id: string, location: Record<string, number>): Promise<void> {
    await moveInstance(this.host, id, location);
  }

  async setInstanceFamily(id: string, familyName: string): Promise<void> {
    await setInstanceFamily(this.host, id, familyName);
  }

  /**
   * Show an instance at a place in the designspace, or stop showing one.
   *
   * The masters are read in on the way, because interpolation needs them all
   * and they live on disk one file each. Doing it here rather than on opening a
   * font means a designspace of six masters costs six fonts of memory only when
   * somebody asks to see between them.
   */
  async setPreview(location: Record<string, number> | null): Promise<void> {
    if (location === null) {
      this.patch({ preview: null });
      return;
    }
    await loadSources(this.host);
    this.patch({ preview: location });
  }

  /**
   * Every master's document, for an export that has to carry them all.
   *
   * The parked ones are read in on the way, and the open one is what is on the
   * screen rather than what was last parked.
   */
  async allMasters(): Promise<
    { name: string; location: Record<string, number>; document: FontDocument }[]
  > {
    await loadSources(this.host);
    const project = this.state.project;

    return orderedMasters(project).flatMap((m) => {
      const document = m.id === project.current ? this.editor.document : project.sources[m.id];
      return document === undefined ? [] : [{ name: m.name, location: m.location, document }];
    });
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

  /** Read the open font's folder again, replacing what is in the editor. */
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

  /**
   * Save where Ctrl-S means to: to the folder if there is one, and otherwise by
   * asking for one.
   *
   * One method rather than the choice written twice, because the shortcut and
   * the File menu item are the same instruction and must not drift apart. The
   * shortcut lives on the window in `App`, so it works in every workspace
   * rather than only where the menu happens to be mounted.
   */
  async saveToFolder(): Promise<SaveReport | null> {
    return this.host.state().folder.name === null
      ? await saveFolderAs(this.host)
      : await saveFolder(this.host);
  }

  /**
   * Whether a save to disk could happen now.
   *
   * Asked by the Ctrl-S shortcut, which lives on the window and therefore has
   * no render of its own to read these from: a save while one is already
   * running would write the folder twice over, and a tab that is only reading
   * must not write at all.
   */
  get canSaveToFolder(): boolean {
    const state = this.host.state();
    return !state.folder.busy && state.ownership !== "reading";
  }

  /** Stop pointing at a folder, and stop remembering it. */
  async forgetFolder(): Promise<void> {
    await forgetOpenFolder(this.host);
  }

  // ---- which font is open -------------------------------------------------

  /**
   * What to do with the editor's first moment: open a font, or offer the list.
   *
   * A reload asking for a particular font wins over both. That is how the
   * chooser opens anything at all — see `switchTo`. After that, a window opened
   * for a font or for the list of fonts gets what it was opened for.
   */
  decideArrival(skipChooser: boolean): Promise<Arrival> {
    // Decided once per page, however many times it is asked. Reading which font
    // a reload was sent to open also clears that note, so asking twice would
    // get two different answers — and React asks twice in development, running
    // every effect, cancelling it, and running it again. The first run took the
    // note and was cancelled; the second found nothing and put the chooser back.
    this.arrival ??= (async (): Promise<Arrival> => {
      const chosen = await chosenOnReload();
      if (chosen !== null) return { kind: "open", id: chosen };
      const requested = await requestedArrival();
      if (requested !== null) return requested;
      return await arrive(skipChooser);
    })();
    return this.arrival;
  }

  private arrival: Promise<Arrival> | null = null;

  /**
   * Put the list of fonts on screen with none of them open yet.
   *
   * The startup case, and the reason `current` is null: nothing has been
   * loaded, no lock taken, no folder linked. Answering the question is what
   * starts the editor.
   */
  offerProjects(all: readonly ProjectSummary[]): void {
    this.patch({ projects: { all, current: null, showing: true, arriving: false } });
  }

  /**
   * Whether the font has changes the folder on disk does not have.
   *
   * Not "unsaved work" — the working copy has everything, and always has. This
   * is the narrower and more useful question: whether closing now would leave
   * the file other tools read behind the font in the editor.
   */
  get unsavedOnDisk(): boolean {
    return this.state.folder.name !== null && unsaved(this.state.folder, this.editor.document);
  }

  /** Say which font is open, and what else there is to open. */
  async noteProjects(current: string | null): Promise<void> {
    await noteProjects(this.host, current);
  }

  /** Show the list of fonts, or put it away. */
  showProjects(showing: boolean): void {
    showChooser(this.host, showing);
  }

  /** Open one of them, which reloads into it. */
  openProject(id: string): void {
    switchTo(id);
  }

  /** Start a font that has no folder yet, and open it. */
  async startProject(name: string): Promise<void> {
    await startProject(name);
  }

  /** Delete the working copies of fonts that are no longer on the list. */
  async sweepForgotten(): Promise<void> {
    await sweepForgotten();
  }

  /** Take a font off the list. The folder on disk is not touched. */
  async forgetProject(id: string): Promise<void> {
    await forgetProject(this.host, id);
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

  /**
   * The layers of the source this editor does not edit.
   *
   * For an export that has to carry them: a UFO written without them is one
   * whose `layercontents.plist` lists only the layer we edit, which every other
   * tool reads as the designer's sketch having been deleted.
   */
  layers(): readonly ExtraLayer[] {
    return this.state.layers;
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

  /** Whether to skip the chooser and open the last font. */
  setSkipChooser(skip: boolean): void {
    this.remember({ skipChooser: skip });
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

  /** How the spacing line is set: which way it runs, and whose rules it chooses. */
  setSpacingTextSettings(spacingTextSettings: StoreState["spacingTextSettings"]): void {
    this.remember({ spacingTextSettings });
  }

  setSpacingMode(spacingMode: "space" | "kern"): void {
    if (spacingMode !== this.state.spacingMode) this.patch({ spacingMode });
  }

  setProofText(proofText: string): void {
    this.patch({ proofText });
  }

  /** The same three choices for the proof, remembered apart from the line's. */
  setProofTextSettings(proofTextSettings: StoreState["proofTextSettings"]): void {
    this.remember({ proofTextSettings });
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

  /** The size the feature source is set at, from Ctrl and the wheel. */
  setFeatureSize(featureSize: number): void {
    const held = within(featureSize, MIN_FEATURE_SIZE, MAX_FEATURE_SIZE);
    if (held !== null) this.remember({ featureSize: Math.round(held * 10) / 10 });
  }

  /** How a split window is divided: side by side or stacked, and where. */
  placeSplit(changes: SplitChanges): void {
    placeSplit(this.host, changes);
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

  // ---- where the inspector is -------------------------------------------

  moveInspector(x: number, y: number): void {
    moveInspector(this.host, x, y);
  }

  reclampInspector(): void {
    reclampInspector(this.host);
  }

  resizeInspector(width: number): void {
    resizeInspector(this.host, width);
  }

  dockInspector(dock: InspectorDock): void {
    dockInspector(this.host, dock);
  }

  toggleInspectorSection(name: string, open: boolean): void {
    toggleInspectorSection(this.host, name, open);
  }

  toggleInspector(): void {
    toggleInspector(this.host);
  }

  // ---- storage -----------------------------------------------------------

  /**
   * Open the store and adopt whatever is there.
   *
   * Everything above works without storage, and opening it may fail: a browser
   * without OPFS should still give a usable editor that simply cannot remember
   * anything, which is why nothing here is allowed to throw.
   */
  async connectStorage(worker: Worker, project: string = FIRST_PROJECT): Promise<void> {
    const loaded = await this.disk.open(worker, project);
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

    // The layers of the source, if this project was opened from one. They are
    // not in the document, so nothing above brings them back — and the save
    // that would write the font without them is exactly the one after a reload.
    this.patch({ layers: await this.disk.layers() });

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

  /**
   * Everything `flush` does, awaited.
   *
   * For the desktop window's close, which happens after this returns and takes
   * the page with it — where `flush` only starts the writes and trusts the page
   * to be there when they finish.
   */
  async flushNow(): Promise<void> {
    await this.disk.flushNow();
    await parkCurrent(this.host);
  }

  flush(): void {
    this.disk.flush();
    // The parked copy of the open master, brought up to date. It is what every
    // other master is compared against and what a switch reads back, and it is
    // stale for exactly as long as this tab has been drawing.
    void parkCurrent(this.host);
  }
}
