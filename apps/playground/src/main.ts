import { fontDocument, glyphBounds } from "@fonteditor/font-model";
import {
  CanvasSurface,
  DARK_PALETTE,
  LIGHT_PALETTE,
  drawScene,
  scene,
} from "@fonteditor/render";
import {
  type EditorState,
  doubleClick,
  editorState,
  keyDown,
  marqueeRect,
  pointerDown,
  pointerLeave,
  pointerMove,
  pointerUp,
  currentGlyph,
  penPreview,
  type ToolResult,
  tunniSegments,
} from "@fonteditor/tools";
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
  Autosave,
  type AutosaveStatus,
  StorageClient,
  dirtyGlyphs,
  requestPersistence,
} from "@fonteditor/storage";
import { fitRect, panBy, toDesign, zoomAt } from "@fonteditor/view";

import { GUIDES, sampleGlyphs } from "./glyph.js";

/**
 * A harness, not the editor.
 *
 * Its whole job is to turn browser events into the tools' vocabulary and hand
 * the resulting state to the renderer. There is no chrome, no panels and no
 * layout, because the editing surface has not been designed yet — this exists so
 * the parts that *are* built can be driven by hand.
 */

/** Stands in when no glyph resolves, so the renderer always has something. */
const EMPTY = { name: "", unicodes: [] as number[], advance: 0, contours: [] };

const canvas = document.getElementById("surface") as HTMLCanvasElement;
const statusBar = document.getElementById("status") as HTMLDivElement;

let history: EditSession = newSession(
  editorState({
    document: fontDocument(sampleGlyphs()),
    view: { scale: 1, tx: 0, ty: 0 },
  }),
);

/** The editor slice, for readability. The session owns the authoritative copy. */
function current(): EditorState {
  return history.editor;
}

let previewing = false;
let panFrom: { x: number; y: number } | null = null;

let storage: StorageClient | null = null;
/** What the journal has already seen, so a burst only appends what moved. */
let lastJournalled: import("@fonteditor/font-model").FontDocument | null = null;
let storageNote = "connecting";
let recovered = false;

/**
 * Two writes per burst of edits, and the split is the point: the journal goes
 * down immediately so a crash inside the debounce window costs nothing, and the
 * real save batches, then drops the journal it no longer needs.
 */
const autosave = new Autosave({
  journal: async (document) => {
    for (const g of dirtyGlyphs(lastJournalled, document)) await storage?.journal(g);
    lastJournalled = document;
  },
  save: async (document, previous) => {
    await storage?.saveGlyphs(dirtyGlyphs(previous, document));
    await storage?.saveFontInfo(document);
  },
  saved: () => {
    void storage?.clearJournal();
    render();
  },
  failed: (error) => {
    storageNote = `save failed: ${error.message}`;
    render();
  },
});

const surface = new CanvasSurface(canvas, (ctx, size) => {
  drawScene(
    ctx,
    scene({
      glyph: currentGlyph(current()) ?? EMPTY,
      view: current().view,
      viewport: size,
      palette: prefersDark() ? DARK_PALETTE : LIGHT_PALETTE,
      guides: GUIDES,
      tunniSegments: tunniSegments(current()),
      selection: current().selection,
      marquee: marqueeRect(current()),
      penPreview: penPreview(current()),
      options: { showControls: !previewing },
    }),
  );
});

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------

/**
 * The one place screen pixels become design units. Everything below this line
 * works in the font's own coordinates.
 */
function toInput(event: PointerEvent) {
  return {
    point: toDesign(current().view, surface.toCanvasPoint(event)),
    modifiers: {
      shift: event.shiftKey,
      alt: event.altKey,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
    },
  };
}

function apply(outcome: ToolResult): void {
  history = applyToSession(history, outcome);
  // Cheap to call unconditionally: autosave compares by reference, so an
  // unchanged document schedules nothing.
  autosave.commit(current().document);
  surface.invalidate();
  render();
}

/** Change the view without touching the document, so history stays out of it. */
function setEditor(next: EditorState): void {
  history = { ...history, editor: next };
  surface.invalidate();
  render();
}

canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  if (event.button === 1) {
    panFrom = { x: event.clientX, y: event.clientY };
    return;
  }
  if (event.button !== 0) return;
  apply(pointerDown(current(), toInput(event)));
});

canvas.addEventListener("pointermove", (event) => {
  if (panFrom !== null) {
    setEditor({
      ...current(),
      view: panBy(current().view, event.clientX - panFrom.x, event.clientY - panFrom.y),
    });
    panFrom = { x: event.clientX, y: event.clientY };
    return;
  }
  apply(pointerMove(current(), toInput(event)));
});

canvas.addEventListener("pointerup", (event) => {
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (panFrom !== null) {
    panFrom = null;
    return;
  }
  apply(pointerUp(current(), toInput(event)));
});

canvas.addEventListener("pointercancel", () => {
  panFrom = null;
  apply(pointerUp(current()));
});

canvas.addEventListener("pointerleave", () => {
  if (panFrom === null) apply(pointerLeave(current()));
});

canvas.addEventListener("dblclick", (event) => {
  const pointer = event as unknown as PointerEvent;
  apply(doubleClick(current(), toInput(pointer)));
});

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const anchor = surface.toCanvasPoint(event);
    setEditor({
      ...current(),
      view: zoomAt(current().view, anchor, Math.exp(-event.deltaY * 0.0015)),
    });
  },
  { passive: false },
);

window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    if (!previewing) {
      previewing = true;
      surface.invalidate();
    }
    return;
  }
  if (event.key === "0" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    fitGlyph();
    return;
  }
  // Page through glyphs until the real glyph strip exists.
  if (!event.ctrlKey && !event.metaKey && (event.key === "PageDown" || event.key === "PageUp")) {
    event.preventDefault();
    const order = current().document.glyphOrder;
    const at = order.indexOf(current().currentGlyph);
    const next = order[(at + (event.key === "PageDown" ? 1 : order.length - 1)) % order.length];
    if (next !== undefined) {
      setEditor({ ...current(), currentGlyph: next, selection: [], pen: null, focusedSegment: null });
      fitGlyph();
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    history = event.shiftKey ? redo(history) : undo(history);
    surface.invalidate();
    render();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
    event.preventDefault();
    history = redo(history);
    surface.invalidate();
    render();
    return;
  }
  if (event.key.startsWith("Arrow") || event.key === "Escape" || event.key === "Backspace") {
    event.preventDefault();
  }
  apply(
    keyDown(current(), {
      key: event.key,
      modifiers: {
        shift: event.shiftKey,
        alt: event.altKey,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
      },
    }),
  );
});

window.addEventListener("keyup", (event) => {
  if (event.code === "Space" && previewing) {
    previewing = false;
    surface.invalidate();
  }
});

if (window.matchMedia) {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => surface.invalidate());
}

// ---------------------------------------------------------------------------
// status readout
// ---------------------------------------------------------------------------

function render(): void {
  const editor = current();
  const hovered = editor.hoveredSegment;
  const focused = editor.focusedSegment;
  const undoable = canUndoSession(history) ? undoLabelOf(history) : null;
  const redoable = canRedoSession(history) ? redoLabelOf(history) : null;

  statusBar.innerHTML = [
    `<b>sel</b> ${editor.selection.length}`,
    `<b>hover</b> ${hovered === null ? "—" : `seg ${hovered.segmentIndex}`}`,
    `<b>focus</b> ${focused === null ? "—" : `seg ${focused.segmentIndex}`}`,
    `<b>zoom</b> ${(editor.view.scale * 100).toFixed(0)}%`,
    `<b>undo</b> ${undoable ?? "—"}`,
    `<b>redo</b> ${redoable ?? "—"}`,
    `<b>steps</b> ${history.history.index}/${history.history.entries.length}`,
    `<b>glyph</b> ${editor.currentGlyph} ${current().document.glyphOrder.indexOf(editor.currentGlyph) + 1}/${current().document.glyphOrder.length}`,
    `<b>tool</b> ${editor.activeTool}`,
    `<b>saved</b> ${savedLabel(autosave.status)}`,
    recovered ? "<b>recovered unsaved work from the journal</b>" : "",
    "p pen · v select · click for a corner, drag for a smooth point",
    "pen: click the first point to close · enter or esc to finish · backspace takes one back",
    "ctrl-z undoes · ctrl-shift-z redoes",
    "shift extends · alt breaks smooth · arrows nudge",
    "pgup/pgdn switches glyph · space previews · wheel zooms · middle-drag pans · ctrl-0 fits",
  ].join("<span></span>");
}

/**
 * Frame the glyph in whatever space the status bar leaves.
 *
 * The bar's height is measured rather than assumed — it wraps to two lines on a
 * narrow window, and a hardcoded guess put a third of the glyph behind it.
 */
function fitGlyph(): void {
  const box = glyphBounds(currentGlyph(current()) ?? EMPTY);
  if (box === null) return;
  const chrome = statusBar.getBoundingClientRect().height;
  const fitted = fitRect(box, surface.size.width, surface.size.height - chrome, 70);
  if (fitted !== null) setEditor({ ...current(), view: fitted });
  else {
    surface.invalidate();
    render();
  }
}

function savedLabel(status: AutosaveStatus): string {
  if (storageNote !== "ok") return storageNote;
  return status === "idle" ? "up to date" : status;
}

/**
 * Open the store, and adopt whatever was there.
 *
 * Everything before this point already works without storage, and everything
 * here is allowed to fail: a browser with no OPFS, or one that refuses a worker,
 * should still give a usable editor that simply cannot remember anything.
 */
async function initStorage(): Promise<void> {
  try {
    const worker = new Worker(new URL("./storage.worker.ts", import.meta.url), {
      type: "module",
    });
    storage = new StorageClient(worker);
    await storage.open("project");

    const loaded = await storage.load();
    if (loaded.kind === "loaded") {
      history = { ...history, editor: { ...current(), document: loaded.document } };
      recovered = loaded.recovered;
      for (const problem of loaded.problems) console.warn("[storage]", problem);
      fitGlyph();
    }

    // Only a document read back from the glyph files is genuinely on disk. One
    // recovered from the journal is newer than the files, and the starter font
    // shown when the store is empty has never been written at all — both have to
    // be flushed, or nothing is saved until the user happens to touch something.
    const onDisk = loaded.kind === "loaded" && !loaded.recovered;
    autosave.markLoaded(current().document, !onDisk);
    if (!onDisk) await autosave.flush();
    storageNote = "ok";

    const persisted = await requestPersistence();
    if (!persisted) {
      console.info("[storage] persistence not granted; the browser may evict this data");
    }
  } catch (error) {
    storage = null;
    storageNote = `unavailable (${error instanceof Error ? error.message : String(error)})`;
  }
  surface.invalidate();
  render();
}

function prefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

// Fitting needs a laid-out canvas. At module evaluation the element still
// reports its intrinsic 300×150, which is smaller than the padding — `fitRect`
// correctly refuses that, and the view silently stayed at 1:1. One frame later
// the real size is known.
window.addEventListener("beforeunload", () => {
  // A best-effort last write. The journal already covers this window, so losing
  // the race here costs nothing.
  void autosave.flush();
});

render();
surface.start();
requestAnimationFrame(fitGlyph);
void initStorage();
