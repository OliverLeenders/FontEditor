import { glyphBounds } from "@fonteditor/font-model";
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
  type ToolResult,
  tunniSegments,
} from "@fonteditor/tools";
import { fitRect, panBy, toDesign, zoomAt } from "@fonteditor/view";

import { GUIDES, sampleGlyph } from "./glyph.js";

/**
 * A harness, not the editor.
 *
 * Its whole job is to turn browser events into the tools' vocabulary and hand
 * the resulting state to the renderer. There is no chrome, no panels and no
 * layout, because the editing surface has not been designed yet — this exists so
 * the parts that *are* built can be driven by hand.
 */

const canvas = document.getElementById("surface") as HTMLCanvasElement;
const statusBar = document.getElementById("status") as HTMLDivElement;

let state: EditorState = editorState({
  glyph: sampleGlyph(),
  view: { scale: 1, tx: 0, ty: 0 },
});

let previewing = false;
let panFrom: { x: number; y: number } | null = null;

const surface = new CanvasSurface(canvas, (ctx, size) => {
  drawScene(
    ctx,
    scene({
      glyph: state.glyph,
      view: state.view,
      viewport: size,
      palette: prefersDark() ? DARK_PALETTE : LIGHT_PALETTE,
      guides: GUIDES,
      tunniSegments: tunniSegments(state),
      selection: state.selection,
      marquee: marqueeRect(state),
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
    point: toDesign(state.view, surface.toCanvasPoint(event)),
    modifiers: {
      shift: event.shiftKey,
      alt: event.altKey,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
    },
  };
}

function apply(outcome: ToolResult): void {
  state = outcome.state;
  // edit-core will consume these. Until it exists, seeing them in the console is
  // the cheapest way to check the transaction boundaries land where they should.
  for (const effect of outcome.effects) {
    console.debug("[effect]", effect.kind, "label" in effect ? effect.label : "");
  }
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
  apply(pointerDown(state, toInput(event)));
});

canvas.addEventListener("pointermove", (event) => {
  if (panFrom !== null) {
    state = {
      ...state,
      view: panBy(state.view, event.clientX - panFrom.x, event.clientY - panFrom.y),
    };
    panFrom = { x: event.clientX, y: event.clientY };
    surface.invalidate();
    return;
  }
  apply(pointerMove(state, toInput(event)));
});

canvas.addEventListener("pointerup", (event) => {
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (panFrom !== null) {
    panFrom = null;
    return;
  }
  apply(pointerUp(state, toInput(event)));
});

canvas.addEventListener("pointercancel", () => {
  panFrom = null;
  apply(pointerUp(state));
});

canvas.addEventListener("pointerleave", () => {
  if (panFrom === null) apply(pointerLeave(state));
});

canvas.addEventListener("dblclick", (event) => {
  const pointer = event as unknown as PointerEvent;
  apply(doubleClick(state, toInput(pointer)));
});

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const anchor = surface.toCanvasPoint(event);
    state = { ...state, view: zoomAt(state.view, anchor, Math.exp(-event.deltaY * 0.0015)) };
    surface.invalidate();
    render();
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
  if (event.key.startsWith("Arrow") || event.key === "Escape") event.preventDefault();
  apply(
    keyDown(state, {
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
  const hovered = state.hoveredSegment;
  const focused = state.focusedSegment;
  statusBar.innerHTML = [
    `<b>sel</b> ${state.selection.length}`,
    `<b>hover</b> ${hovered === null ? "—" : `seg ${hovered.segmentIndex}`}`,
    `<b>focus</b> ${focused === null ? "—" : `seg ${focused.segmentIndex}`}`,
    `<b>zoom</b> ${(state.view.scale * 100).toFixed(0)}%`,
    `<b>gesture</b> ${state.gesture?.kind ?? "—"}`,
    "shift extends · alt breaks smooth · arrows nudge · esc cancels",
    "space previews · wheel zooms · middle-drag pans · ctrl-0 fits",
  ].join("<span></span>");
}

/**
 * Frame the glyph in whatever space the status bar leaves.
 *
 * The bar's height is measured rather than assumed — it wraps to two lines on a
 * narrow window, and a hardcoded guess put a third of the glyph behind it.
 */
function fitGlyph(): void {
  const box = glyphBounds(state.glyph);
  if (box === null) return;
  const chrome = statusBar.getBoundingClientRect().height;
  const fitted = fitRect(box, surface.size.width, surface.size.height - chrome, 70);
  if (fitted !== null) state = { ...state, view: fitted };
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
render();
surface.start();
requestAnimationFrame(fitGlyph);
