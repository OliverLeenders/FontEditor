import { CanvasSurface, drawScene } from "@fonteditor/render";
import {
  type ToolOptions,
  doubleClick,
  handleVisibility,
  keyDown,
  pointerDown,
  pointerLeave,
  pointerMove,
  pointerUp,
  tunniSegments,
} from "@fonteditor/tools";
import {
  buildHitIndex,
  itemForTarget,
  hasItem,
  panBy,
  pick,
  screenTolerance,
  toDesign,
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
      onPointerLeave={() => {
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
                screenTolerance(editor.view, 11),
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
      onWheel={(event) => {
        const surface = surfaceRef.current;
        if (surface === null) return;
        const anchor = surface.toCanvasPoint(event.nativeEvent);
        store.setView(zoomAt(store.editor.view, anchor, Math.exp(-event.deltaY * 0.0015)));
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
