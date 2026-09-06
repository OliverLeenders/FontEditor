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
import { type Glyph, type GlyphName, setFeatures } from "@fonteditor/font-model";
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
import type { ViewTransform } from "@fonteditor/view";

import { frameGlyph } from "../framing.js";
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
import { type FontHost, type ImportReport, importFont, newFont, showDocument } from "./fonts.js";
import { defaults, remember, within } from "./settings.js";
import { type StoreState, initialState } from "./state.js";

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
export type { StoreState } from "./state.js";
export type { ImportReport } from "./fonts.js";

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

  private patch(changes: Partial<StoreState>): void {
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
    if (session.pending === null) this.disk.commit(session.editor.document);
    // One patch, not two: each one wakes every listener, and a drag would
    // otherwise redraw and re-run every selector twice per pointer event.
    this.patch(
      this.state.saveStatus === this.disk.status
        ? { session }
        : { session, saveStatus: this.disk.status },
    );
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

    const first = viewport.width === 0;
    this.patch({ viewport: { width, height } });
    if (first) this.fitGlyph();
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
    this.patch({ saveStatus: this.disk.status });
  }

  flush(): void {
    this.disk.flush();
  }
}
