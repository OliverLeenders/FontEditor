import { CanvasSurface, drawScene } from "@fonteditor/render";
import {
  type ToolOptions,
  BOX_HANDLE_PIXELS,
  doubleClick,
  handleVisibility,
  keyDown,
  pointerDown,
  pointerLeave,
  pointerMove,
  pointerUp,
  selectionBox,
  tunniSegments,
} from "@fonteditor/tools";
import {
  type BoxHandle,
  BOX_STEM_PIXELS,
  PICK_TOLERANCE_SCALE,
  buildHitIndex,
  itemForTarget,
  hasItem,
  panBy,
  pick,
  pickBoxHandle,
  screenTolerance,
  toDesign,
  wheelIntent,
  zoomAt,
} from "@fonteditor/view";
import { useEffect, useRef } from "react";

import { handlesAutoHidden, sceneFor } from "../scene.js";
import type { EditorStore } from "../store.js";
import { watchScheme } from "../scheme.js";
import { useEditorStore } from "../useStore.js";
import type { MenuRequest } from "./ContextMenu.js";
import styles from "./GlyphCanvas.module.css";

/**
 * The canvas, and the one component that deliberately never re-renders.
 *
 * It subscribes to the store imperatively and asks the surface to redraw. A drag
 * therefore costs one canvas frame per animation frame and no React work at all
 * — no reconciliation of the tabs, the toolbar, the inspector or the strip,
 * sixty times a second, to move a single node.
 */
/**
 * What the select tool needs from the interface: what it may pick, and where a
 * drag may land. Read from the same rules the renderer draws by.
 */
/** The pick radius the select tool uses, which the cursor has to agree with. */
const HIT_PIXELS = 11;

function selectOptions(store: EditorStore): ToolOptions {
  const state = store.getState();
  return {
    autoHideHandles: handlesAutoHidden(state),
    snapExtremes: state.snapPoints,
    snapNeighbours: state.snapPoints,
  };
}

export function GlyphCanvas({
  onContextMenu,
}: {
  onContextMenu: (request: MenuRequest) => void;
}): React.JSX.Element {
  const store = useEditorStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<CanvasSurface | null>(null);
  const panFrom = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const surface = new CanvasSurface(canvas, (ctx, size) => {
      store.setViewport(size.width, size.height);
      drawScene(ctx, sceneFor(store.getState(), size));
    });
    surfaceRef.current = surface;
    surface.start();

    const unsubscribe = store.subscribe(() => surface.invalidate());
    const onScheme = (): void => surface.invalidate();
    const stopWatching = watchScheme(onScheme);

    return () => {
      unsubscribe();
      stopWatching();
      surface.destroy();
      surfaceRef.current = null;
    };
  }, [store]);

  /**
   * The wheel, on a listener of its own rather than React's `onWheel`.
   *
   * React attaches wheel handlers passively, and a passive handler cannot call
   * `preventDefault` — so ctrl-wheel would zoom the browser's own page around
   * the editor while the canvas zoomed the glyph. This has to be non-passive to
   * take the gesture away from the browser.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const onWheel = (event: WheelEvent): void => {
      const surface = surfaceRef.current;
      if (surface === null) return;
      event.preventDefault();

      const intent = wheelIntent(event);
      if (intent.kind === "zoom") {
        store.setView(zoomAt(store.editor.view, surface.toCanvasPoint(event), intent.factor));
        return;
      }
      store.setView(panBy(store.editor.view, intent.dx, intent.dy));
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [store]);

  /** The one place screen pixels become design units. */
  const toInput = (event: React.PointerEvent<HTMLCanvasElement> | PointerEvent) => {
    const surface = surfaceRef.current;
    const view = store.editor.view;
    const point = surface === null ? { x: 0, y: 0 } : toDesign(view, surface.toCanvasPoint(event));
    return {
      point,
      modifiers: {
        shift: event.shiftKey,
        alt: event.altKey,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
      },
    };
  };

  /**
   * The cursor over the margin lines.
   *
   * Those two lines are the only thing on the canvas that is dragged along one
   * axis, and the only thing whose grabbable area gives no sign of itself: a
   * node looks like a handle you can take hold of, and a line the height of the
   * window looks like a rule. The cursor is what says otherwise.
   *
   * Checked in two steps, so an ordinary move costs two subtractions. The
   * distance to each line is arithmetic — they are vertical and unbounded, so
   * only the horizontal gap counts — and only when the pointer is within reach
   * of one is the hit index built to ask what would actually be picked there. A
   * node sitting on the origin wins that pick, and must therefore leave the
   * cursor alone: a cursor promising one thing while the click does another is
   * worse than no cursor at all.
   */
  const marginCursor = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    const surface = surfaceRef.current;
    if (canvas === null || surface === null) return;

    const editor = store.editor;
    // Only the select tool drags a margin. Under the knife or the pen the lines
    // are scenery, and a resize cursor over them would be an offer that is not
    // being made.
    if (editor.activeTool !== "select") {
      canvas.style.cursor = "";
      return;
    }

    // Mid-drag the answer is already known, and the pointer has usually left the
    // line by then — the whole point of the drag is that the line follows it.
    if (editor.gesture?.kind === "dragMargin") {
      canvas.style.cursor = "ew-resize";
      return;
    }
    if (editor.gesture?.kind === "transformBox") {
      canvas.style.cursor = cursorForHandle(editor.gesture.handle);
      return;
    }

    const point = toDesign(editor.view, surface.toCanvasPoint(event));

    // The box before the margins, in the same order the tool takes them: its
    // handles sit over everything else, so the cursor has to say so.
    const box = selectionBox(editor);
    if (box !== null) {
      const handle = pickBoxHandle(
        box,
        point,
        screenTolerance(editor.view, BOX_HANDLE_PIXELS),
        screenTolerance(editor.view, BOX_STEM_PIXELS),
      );
      if (handle !== null) {
        canvas.style.cursor = cursorForHandle(handle);
        return;
      }
    }

    const glyph = editor.document.glyphs[editor.currentGlyph];
    if (glyph === undefined) {
      canvas.style.cursor = "";
      return;
    }

    const reach = screenTolerance(editor.view, HIT_PIXELS) * (PICK_TOLERANCE_SCALE.originLine ?? 1);
    const near = Math.abs(point.x) <= reach || Math.abs(point.x - glyph.advance) <= reach;
    if (!near) {
      canvas.style.cursor = "";
      return;
    }

    const target = pick(
      buildHitIndex(glyph, tunniSegments(editor), {
        margins: true,
        handles: handleVisibility(editor, selectOptions(store)),
      }),
      point,
      screenTolerance(editor.view, HIT_PIXELS),
    );
    const onMargin = target?.kind === "originLine" || target?.kind === "advanceLine";
    canvas.style.cursor = onMargin ? "ew-resize" : "";
  };

  return (
    <canvas
      ref={canvasRef}
      className={styles.canvas}
      tabIndex={0}
      aria-label="Glyph editing canvas"
      onPointerDown={(event) => {
        // Belt as well as braces. The stylesheet stops a selection being
        // *painted*, and this stops one being *started* — which also keeps the
        // browser from deciding a drag is a text drag partway through.
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        if (event.button === 1) {
          panFrom.current = { x: event.clientX, y: event.clientY };
          return;
        }
        if (event.button !== 0) return;
        store.applyTool(pointerDown(store.editor, toInput(event), selectOptions(store)));
      }}
      onPointerMove={(event) => {
        const from = panFrom.current;
        if (from !== null) {
          store.setView(panBy(store.editor.view, event.clientX - from.x, event.clientY - from.y));
          panFrom.current = { x: event.clientX, y: event.clientY };
          return;
        }
        marginCursor(event);
        store.applyTool(pointerMove(store.editor, toInput(event), selectOptions(store)));
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (panFrom.current !== null) {
          panFrom.current = null;
          return;
        }
        store.applyTool(pointerUp(store.editor, toInput(event), selectOptions(store)));
      }}
      onPointerCancel={() => {
        panFrom.current = null;
        store.applyTool(pointerUp(store.editor, undefined, selectOptions(store)));
      }}
      onPointerLeave={(event) => {
        // The cursor belongs to the canvas, so it goes back with the pointer.
        event.currentTarget.style.cursor = "";
        if (panFrom.current === null) store.applyTool(pointerLeave(store.editor));
      }}
      onDoubleClick={(event) => {
        store.applyTool(doubleClick(store.editor, toInput(event as unknown as PointerEvent)));
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        const surface = surfaceRef.current;
        if (surface === null) return;

        // What the menu offers is decided by what is under the pointer, using
        // the same hit index the tools use — so the menu can never offer an
        // action for something the canvas is not actually showing.
        const editor = store.editor;
        const glyph = editor.document.glyphs[editor.currentGlyph];
        const { point } = toInput(event as unknown as PointerEvent);
        const target =
          glyph === undefined
            ? null
            : pick(
                buildHitIndex(glyph, tunniSegments(editor), {
                  margins: true,
                  handles: handleVisibility(editor, selectOptions(store)),
                }),
                point,
                screenTolerance(editor.view, HIT_PIXELS),
              );
        // Right-clicking selects what it lands on, the way every editor does —
        // and it is what makes the menu's selection-based actions ("Delete
        // point") act on the thing you actually clicked. An existing multi
        // selection is left alone, so a right-click cannot silently shrink it.
        const item = target === null ? null : itemForTarget(target);
        if (item !== null && !hasItem(editor.selection, item)) {
          store.setEditor({ ...editor, selection: [item] });
        }

        onContextMenu({ x: event.clientX, y: event.clientY, target, point });
      }}
      onKeyDown={(event) => {
        // Tool keys and Escape belong to the tools; the application's own
        // shortcuts are handled higher up, on the window.
        if (event.ctrlKey || event.metaKey) return;
        if (event.key.startsWith("Arrow") || event.key === "Backspace") event.preventDefault();
        store.applyTool(
          keyDown(store.editor, {
            key: event.key,
            modifiers: {
              shift: event.shiftKey,
              alt: event.altKey,
              ctrl: event.ctrlKey,
              meta: event.metaKey,
            },
          }),
        );
      }}
    />
  );
}

/**
 * What the pointer looks like over a box handle.
 *
 * The four diagonals and the two axes are what CSS offers and what everyone
 * recognises. Turning has no cursor of its own anywhere in CSS, so it borrows
 * the crosshair: not a picture of what it does, but distinct from the eight
 * beside it, which is the job.
 */
function cursorForHandle(handle: BoxHandle): string {
  if (handle.action === "rotate") return "crosshair";

  switch (handle.at) {
    case "topLeft":
    case "bottomRight":
      return "nwse-resize";
    case "topRight":
    case "bottomLeft":
      return "nesw-resize";
    case "top":
    case "bottom":
      return "ns-resize";
    case "left":
    case "right":
      return "ew-resize";
  }
}
