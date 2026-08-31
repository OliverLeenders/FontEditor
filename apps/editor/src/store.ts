import { type CatalogQuery, DEFAULT_QUERY } from "@fonteditor/catalog";
import { importFont as parseFontFile } from "@fonteditor/font-io";
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
} from "@fonteditor/font-model";
import type { AutosaveStatus } from "@fonteditor/storage";
import {
  type EditorState,
  type ToolId,
  type ToolResult,
  currentGlyph,
  editorState,
  setActiveTool,
} from "@fonteditor/tools";
import type { ViewTransform } from "@fonteditor/view";

import { frameGlyph } from "./framing.js";
import {
  type InspectorPlacement,
  clampInspector,
  loadInspector,
  saveInspector,
} from "./inspectorPlacement.js";
import {
  type Ownership,
  Persistence,
  type PersistenceReport,
  type StorageState,
} from "./persistence.js";
import { starterFont } from "./sample.js";

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
    this.state = {
      session: newSession(editorState({ document: starterFont(), view: { scale: 1, tx: 0, ty: 0 } })),
      saveStatus: "idle",
      storage: "connecting",
      storageDetail: "",
      recovered: false,
      ownership: "owner",
      stripText: "hello",
      catalogQuery: DEFAULT_QUERY,
      showNeighbours: true,
      autoHideHandles: true,
      snapPoints: true,
      spacingText: "nonno",
      spacingSize: 128,
      spacingMode: "space",
      previewing: false,
      inspector: loadInspector(),
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

  /** Fold a tool's output in, and tell autosave in case anything committed. */
  applyTool(outcome: ToolResult): void {
    const session = applyToSession(this.state.session, outcome);
    this.patch({ session });
    this.disk.commit(session.editor.document);
    if (this.state.saveStatus !== this.disk.status) {
      this.patch({ saveStatus: this.disk.status });
    }
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
   * Deliberately *not* an undoable edit. Undo is for the shape you are drawing;
   * a single ctrl-Z that silently swapped the whole font back would be alarming
   * rather than useful, and the history it restored would describe glyphs that
   * are no longer open. The session starts again on the new font.
   */
  async importFont(bytes: ArrayBuffer): Promise<{
    family: string;
    glyphs: number;
    warnings: string[];
  }> {
    const { document, warnings } = parseFontFile(bytes, randomIds());
    await this.adoptDocument(document);

    return {
      family: `${document.info.familyName} ${document.info.styleName}`.trim(),
      glyphs: document.glyphOrder.length,
      warnings: warnings.map((w) => (w.glyph === null ? w.message : `${w.glyph}: ${w.message}`)),
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
    this.patch({ autoHideHandles: !this.state.autoHideHandles });
  }

  toggleSnapPoints(): void {
    this.patch({ snapPoints: !this.state.snapPoints });
  }

  setSpacingText(spacingText: string): void {
    this.patch({ spacingText });
  }

  setSpacingMode(spacingMode: "space" | "kern"): void {
    if (spacingMode !== this.state.spacingMode) this.patch({ spacingMode });
  }

  setSpacingSize(spacingSize: number): void {
    if (!Number.isFinite(spacingSize)) return;
    this.patch({ spacingSize: Math.min(400, Math.max(8, spacingSize)) });
  }

  toggleNeighbours(): void {
    this.patch({ showNeighbours: !this.state.showNeighbours });
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
    this.patch({ inspector });
    saveInspector(inspector);
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
