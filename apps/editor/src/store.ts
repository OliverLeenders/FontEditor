import { type CatalogQuery, DEFAULT_QUERY } from "@fonteditor/catalog";
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
  glyphBounds,
} from "@fonteditor/font-model";
import {
  Autosave,
  type AutosaveStatus,
  StorageClient,
  dirtyGlyphs,
  requestPersistence,
} from "@fonteditor/storage";
import {
  type EditorState,
  type ToolId,
  type ToolResult,
  currentGlyph,
  editorState,
  setActiveTool,
} from "@fonteditor/tools";
import { type ViewTransform, fitRect } from "@fonteditor/view";

import { starterFont } from "./sample.js";

export type StorageState = "connecting" | "ready" | "unavailable";

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
  /** What the glyph strip is showing, as typed. */
  readonly stripText: string;
  /** Space held: draw the shape without any controls. */
  readonly previewing: boolean;
  readonly inspector: { readonly x: number; readonly y: number; readonly open: boolean };
  /** What the glyph browser is filtered to. Not undoable, so it lives out here. */
  readonly catalogQuery: CatalogQuery;
  readonly viewport: { readonly width: number; readonly height: number };
};

const INSPECTOR_KEY = "fonteditor.inspector";

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
 * It lives in the app rather than a package because nothing else consumes it.
 * If a second consumer appears, extract it then.
 */
export class EditorStore {
  private state: StoreState;
  private readonly listeners = new Set<() => void>();

  private storageClient: StorageClient | null = null;
  private lastJournalled: FontDocument | null = null;
  private readonly autosave: Autosave;

  constructor() {
    this.state = {
      session: newSession(editorState({ document: starterFont(), view: { scale: 1, tx: 0, ty: 0 } })),
      saveStatus: "idle",
      storage: "connecting",
      storageDetail: "",
      recovered: false,
      stripText: "hello",
      catalogQuery: DEFAULT_QUERY,
      previewing: false,
      inspector: loadInspector(),
      viewport: { width: 0, height: 0 },
    };

    this.autosave = new Autosave({
      journal: async (document) => {
        for (const g of dirtyGlyphs(this.lastJournalled, document)) {
          await this.storageClient?.journal(g);
        }
        this.lastJournalled = document;
      },
      save: async (document, previous) => {
        await this.storageClient?.saveGlyphs(dirtyGlyphs(previous, document));
        await this.storageClient?.saveFontInfo(document);
      },
      saved: () => {
        void this.storageClient?.clearJournal();
        this.patch({ saveStatus: this.autosave.status });
      },
      failed: (error) => {
        this.patch({ saveStatus: "failed", storageDetail: error.message });
      },
    });
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
    this.autosave.commit(session.editor.document);
    if (this.state.saveStatus !== this.autosave.status) {
      this.patch({ saveStatus: this.autosave.status });
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
    this.autosave.commit(this.state.session.editor.document);
  }

  redo(): void {
    this.patch({ session: redo(this.state.session) });
    this.autosave.commit(this.state.session.editor.document);
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
    const { width, height } = this.state.viewport;
    if (glyph === null || width === 0 || height === 0) return;

    // Frame the em box rather than the outline, so switching glyphs does not
    // rescale the canvas under you — an `l` and an `o` should sit at the same
    // size, the way they will on the page.
    const { ascender, descender } = this.editor.document.info;
    const box = glyphBounds(glyph) ?? { minX: 0, minY: 0, maxX: glyph.advance, maxY: 0 };
    const fitted = fitRect(
      {
        minX: Math.min(0, box.minX),
        maxX: Math.max(glyph.advance, box.maxX),
        minY: Math.min(descender, box.minY),
        maxY: Math.max(ascender, box.maxY),
      },
      width,
      height,
      60,
    );
    if (fitted !== null) this.setView(fitted);
  }

  setPreviewing(previewing: boolean): void {
    if (previewing !== this.state.previewing) this.patch({ previewing });
  }

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

  setStripText(stripText: string): void {
    this.patch({ stripText });
  }

  moveInspector(x: number, y: number): void {
    const inspector = { ...this.state.inspector, ...clampInspector(x, y) };
    this.patch({ inspector });
    saveInspector(inspector);
  }

  /** Pull the inspector back into view — after a resize, or a restore from a larger window. */
  reclampInspector(): void {
    const { x, y } = clampInspector(this.state.inspector.x, this.state.inspector.y);
    if (x === this.state.inspector.x && y === this.state.inspector.y) return;
    const inspector = { ...this.state.inspector, x, y };
    this.patch({ inspector });
    saveInspector(inspector);
  }

  toggleInspector(): void {
    const inspector = { ...this.state.inspector, open: !this.state.inspector.open };
    this.patch({ inspector });
    saveInspector(inspector);
  }

  // ---- storage -----------------------------------------------------------

  /**
   * Open the store and adopt whatever is there.
   *
   * Everything above works without storage, and everything here may fail: a
   * browser without OPFS should still give a usable editor that simply cannot
   * remember anything.
   */
  async connectStorage(worker: Worker): Promise<void> {
    try {
      const client = new StorageClient(worker);
      this.storageClient = client;
      await client.open("project");

      const loaded = await client.load();
      if (loaded.kind === "loaded") {
        const editor: EditorState = {
          ...this.editor,
          document: loaded.document,
          currentGlyph: loaded.document.glyphOrder[0] ?? "",
        };
        this.patch({
          session: { ...this.state.session, editor },
          recovered: loaded.recovered,
        });
        for (const problem of loaded.problems) console.warn("[storage]", problem);
        this.fitGlyph();
      }

      // Only a document read back from the glyph files is genuinely on disk. One
      // recovered from the journal is ahead of them, and the starter font shown
      // when the store is empty has never been written at all.
      const onDisk = loaded.kind === "loaded" && !loaded.recovered;
      this.autosave.markLoaded(this.editor.document, !onDisk);
      if (!onDisk) await this.autosave.flush();

      this.patch({ storage: "ready", saveStatus: this.autosave.status });
      if (!(await requestPersistence())) {
        console.info("[storage] persistence not granted; the browser may evict this data");
      }
    } catch (error) {
      this.storageClient = null;
      this.patch({
        storage: "unavailable",
        storageDetail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  flush(): void {
    void this.autosave.flush();
  }
}

/**
 * Keep enough of the panel on screen to grab it again.
 *
 * A floating panel that can be dragged fully off the edge is a floating panel
 * you cannot get back — and the position is remembered, so it would still be
 * gone after a reload.
 */
function clampInspector(x: number, y: number): { x: number; y: number } {
  const grip = 80;
  const maxX = Math.max(0, window.innerWidth - grip);
  const maxY = Math.max(0, window.innerHeight - 28);
  return {
    x: Math.min(Math.max(0, x), maxX),
    y: Math.min(Math.max(0, y), maxY),
  };
}

function loadInspector(): StoreState["inspector"] {
  try {
    const raw = localStorage.getItem(INSPECTOR_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<StoreState["inspector"]>;
      const placed = clampInspector(
        typeof parsed.x === "number" ? parsed.x : 24,
        typeof parsed.y === "number" ? parsed.y : 24,
      );
      return { ...placed, open: parsed.open !== false };
    }
  } catch {
    // Private window, cleared site data, or storage blocked. A default is fine.
  }
  return { x: 24, y: 24, open: true };
}

function saveInspector(inspector: StoreState["inspector"]): void {
  try {
    localStorage.setItem(INSPECTOR_KEY, JSON.stringify(inspector));
  } catch {
    // Losing a remembered panel position is not worth interrupting anyone for.
  }
}
