import { type CatalogQuery, DEFAULT_QUERY } from "@fonteditor/catalog";
import { importFont as parseFontFile, importUfo, looksLikeUfo } from "@fonteditor/font-io";
import {
  type EditSession,
  apply as applyToSession,
  canRedoSession,
  canUndoSession,
  redo,
  redoLabelOf,
  session as newSession,
  undo,
  undoLabelOf,
} from "@fonteditor/edit-core";
import {
  type FontDocument,
  type Glyph,
  type GlyphName,
  DEFAULT_FONT_INFO,
  fontDocument,
  glyph,
  randomIds,
  setFeatures,
} from "@fonteditor/font-model";
import type { AutosaveStatus } from "@fonteditor/storage";
import {
  type EditorState,
  type ToolId,
  type ToolResult,
  begin,
  commit,
  currentGlyph,
  editorState,
  result,
  setActiveTool,
} from "@fonteditor/tools";
import type { ViewTransform } from "@fonteditor/view";

import { frameGlyph } from "./framing.js";
import {
  MAX_OUTLINE_WIDTH,
  MAX_PROOF_LEADING,
  MAX_PROOF_SIZE,
  MAX_SPACING_SIZE,
  MIN_OUTLINE_WIDTH,
  MIN_PROOF_LEADING,
  MIN_PROOF_SIZE,
  MIN_SPACING_SIZE,
} from "./limits.js";
import {
  DEFAULT_PREFERENCES,
  type InspectorPlacement,
  type Preferences,
  type ThemeChoice,
  clampInspector,
  loadPreferences,
  savePreferences,
} from "./preferences.js";
import {
  type Ownership,
  Persistence,
  type PersistenceReport,
  type StorageState,
} from "./persistence.js";
import { starterFont } from "./sample.js";

/**
 * What the proof shows before anyone types anything.
 *
 * Lowercase, because that is what a text face is judged on and what most fonts
 * here will have first. It says what it is rather than being a pangram: a
 * pangram exercises the alphabet, which is the glyph browser's job, where a
 * proof is for reading.
 */
const PROOF_TEXT = [
  "handgloves and the shape of the space between them",
  "no one reads a letter, they read a line of them",
  "",
  "the only way to know whether a font works is to set it and look",
].join(String.fromCharCode(10));

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
} from "./limits.js";
export { DEFAULT_PREFERENCES } from "./preferences.js";
export type { InspectorPlacement, Preferences, ThemeChoice } from "./preferences.js";

export type { Ownership, StorageState };

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

  constructor() {
    // Read once, before anything renders, so the first frame is already in the
    // reader's theme rather than flashing the default and correcting itself.
    const preferences = loadPreferences();

    this.state = {
      session: newSession(
        editorState({ document: starterFont(), view: { scale: 1, tx: 0, ty: 0 } }),
      ),
      saveStatus: "idle",
      storage: "connecting",
      storageDetail: "",
      recovered: false,
      ownership: "owner",
      stripText: "hello",
      catalogQuery: DEFAULT_QUERY,
      showNeighbours: preferences.showNeighbours,
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

    this.disk = new Persistence((changes: PersistenceReport) => this.patch(changes));
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

  /**
   * Start a new, empty font, discarding whatever is open.
   *
   * Empty means genuinely empty apart from `.notdef`, which every font needs and
   * which no one wants to remember to make. Destructive, so the caller is
   * expected to have asked first; the store's job is to do it cleanly rather
   * than to second-guess it.
   */
  async newFont(): Promise<void> {
    const document = fontDocument([glyph(".notdef", { advance: 500 })], DEFAULT_FONT_INFO);
    await this.adoptDocument(document);
  }

  /**
   * Replace the document with a font read from a file.
   *
   * Which reader is used comes from the file's name rather than from sniffing
   * its bytes: a UFO is a zip and a zip could be anything, so the only honest
   * way to know one is that it was offered as one. Being wrong is cheap — the
   * UFO reader says what it could not find.
   *
   * Deliberately *not* an undoable edit. Undo is for the shape you are drawing;
   * a single ctrl-Z that silently swapped the whole font back would be alarming
   * rather than useful, and the history it restored would describe glyphs that
   * are no longer open. The session starts again on the new font.
   */
  async importFont(
    bytes: ArrayBuffer,
    fileName = "",
  ): Promise<{
    family: string;
    glyphs: number;
    warnings: string[];
  }> {
    const read = looksLikeUfo(fileName)
      ? await this.readUfo(bytes)
      : (() => {
          const parsed = parseFontFile(bytes, randomIds());
          return {
            document: parsed.document,
            warnings: parsed.warnings.map((w) =>
              w.glyph === null ? w.message : `${w.glyph}: ${w.message}`,
            ),
          };
        })();

    await this.adoptDocument(read.document);

    const { info, glyphOrder } = read.document;
    return {
      family: `${info.familyName} ${info.styleName}`.trim(),
      glyphs: glyphOrder.length,
      warnings: read.warnings,
    };
  }

  private async readUfo(
    bytes: ArrayBuffer,
  ): Promise<{ document: FontDocument; warnings: string[] }> {
    const out = await importUfo(bytes, randomIds());
    // A UFO that cannot be read is reported rather than half-adopted: there is
    // no partial font to fall back on the way a damaged glyph has one.
    if ("reason" in out) throw new Error(out.reason);

    return {
      document: out.document,
      warnings: out.warnings.map((w) =>
        w.glyph === null ? w.message : `${w.glyph}: ${w.message}`,
      ),
    };
  }

  /**
   * Make a document the one being edited, on screen and on disk.
   *
   * Shared by opening a font and by starting a new one, because they differ only
   * in where the document came from. The history is replaced rather than
   * appended to, for the reason `importFont` gives.
   */
  private async adoptDocument(document: FontDocument): Promise<void> {
    this.showDocument(document, false);
    this.setCatalogQuery(DEFAULT_QUERY);
    await this.disk.replaceAll(document);
  }

  /** Put a document on screen, starting its history over. */
  private showDocument(document: FontDocument, recovered: boolean): void {
    this.patch({
      session: newSession(editorState({ document, view: this.editor.view })),
      recovered,
    });
    this.setCurrentGlyph(document.glyphOrder[0] ?? "");
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
    if (!Number.isFinite(outlineWidth)) return;
    this.remember({
      outlineWidth: Math.min(MAX_OUTLINE_WIDTH, Math.max(MIN_OUTLINE_WIDTH, outlineWidth)),
    });
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
    if (!Number.isFinite(proofSize)) return;
    this.remember({ proofSize: Math.min(MAX_PROOF_SIZE, Math.max(MIN_PROOF_SIZE, proofSize)) });
  }

  setProofLeading(proofLeading: number): void {
    if (!Number.isFinite(proofLeading)) return;
    this.remember({
      proofLeading: Math.min(MAX_PROOF_LEADING, Math.max(MIN_PROOF_LEADING, proofLeading)),
    });
  }

  setSpacingSize(spacingSize: number): void {
    if (!Number.isFinite(spacingSize)) return;
    this.remember({
      spacingSize: Math.min(MAX_SPACING_SIZE, Math.max(MIN_SPACING_SIZE, spacingSize)),
    });
  }

  toggleNeighbours(): void {
    this.remember({ showNeighbours: !this.state.showNeighbours });
  }

  toggleApplyFeatures(): void {
    this.remember({ applyFeatures: !this.state.applyFeatures });
  }

  /** Put every preference back where it started. */
  resetPreferences(): void {
    this.remember({
      theme: DEFAULT_PREFERENCES.theme,
      outlineWidth: DEFAULT_PREFERENCES.outlineWidth,
      autoHideHandles: DEFAULT_PREFERENCES.autoHideHandles,
      snapPoints: DEFAULT_PREFERENCES.snapPoints,
      showNeighbours: DEFAULT_PREFERENCES.showNeighbours,
      applyFeatures: DEFAULT_PREFERENCES.applyFeatures,
      spacingSize: DEFAULT_PREFERENCES.spacingSize,
      proofSize: DEFAULT_PREFERENCES.proofSize,
      proofLeading: DEFAULT_PREFERENCES.proofLeading,
    });
  }

  /**
   * Patch the state and write the preferences that came out of it.
   *
   * One door, so a setting cannot be added to the store and quietly not be
   * remembered — which is what happened to every one of these before now.
   */
  private remember(changes: Partial<StoreState>): void {
    this.patch(changes);
    savePreferences(this.preferences());
  }

  private preferences(): Preferences {
    const s = this.state;
    return {
      theme: s.theme,
      outlineWidth: s.outlineWidth,
      autoHideHandles: s.autoHideHandles,
      snapPoints: s.snapPoints,
      showNeighbours: s.showNeighbours,
      applyFeatures: s.applyFeatures,
      spacingSize: s.spacingSize,
      proofSize: s.proofSize,
      proofLeading: s.proofLeading,
      inspector: s.inspector,
    };
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

    this.showDocument(loaded.document, loaded.recovered);
    this.disk.markLoaded(loaded.document, loaded.recovered);
    this.patch({ saveStatus: this.disk.status });
  }

  flush(): void {
    this.disk.flush();
  }
}
