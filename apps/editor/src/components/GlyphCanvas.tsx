import { CanvasSurface, drawScene } from "@typewright/render";
import {
  type EditorState,
  type ToolOptions,
  BOX_HANDLE_PIXELS,
  doubleClick,
  guideById,
  pickGuide,
  pickTarget,
  keyDown,
  keyUp,
  pointerDown,
  pointerLeave,
  pointerMove,
  pointerUp,
  selectionBox,
  currentGlyph,
} from "@typewright/tools";
import { type GuideId, isHorizontal, isVertical } from "@typewright/font-model";
import {
  type BoxHandle,
  BOX_STEM_PIXELS,
  PICK_TOLERANCE_SCALE,
  boxContains,
  itemForTarget,
  hasItem,
  panBy,
  pickBoxHandle,
  screenTolerance,
  toDesign,
  wheelIntent,
  zoomAt,
} from "@typewright/view";
import { useEffect, useRef } from "react";

import {
  handlesAutoHidden,
  measurableNeighbours,
  neighbourAt,
  neighboursFor,
  sceneFor,
  withinGlyph,
} from "../scene.js";
import type { EditorStore } from "../store/index.js";
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
/** The pick radius the select tool uses, which the cursor has to agree with. */
const HIT_PIXELS = 11;

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
    // Only what is drawn may be grabbed, which is the rule the margins and the
    // Tunni controls already follow.
    anchors: state.showAnchors,
    // Worked out only for the ruler, which is the one tool that reads them, and
    // only while it is the tool in hand: this runs on every pointer move.
    neighbours:
      state.session.editor.activeTool === "measure" ? measurableNeighbours(state) : undefined,
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
      drawScene(
        ctx,
        sceneFor(store.getState(), size, (name) => store.picture(name)),
      );
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

  /** What the pointer is over, by the same rules the tools pick with. */
  // The tool's own answer, not a second one built here: two ideas of what is
  // under the pointer is exactly how a menu comes to offer something the tool
  // will not do, or a cursor to promise a grab that does not happen.
  const targetAt = (point: { x: number; y: number }) =>
    pickTarget(store.editor, point, { ...selectOptions(store), hitPixels: HIT_PIXELS });

  /**
   * Open the glyph beside this one, when the second click landed on it.
   *
   * The neighbours are context — the letters this one will stand next to — and
   * the obvious thing to do with a letter you can see is to go and work on it.
   *
   * Everything about the glyph being edited comes first: anything pickable, and
   * the whole box round its drawing. A glyph may overshoot well outside its own
   * sidebearings, and a double-click on the part that hangs over the next letter
   * is still a double-click on this one.
   */
  const openNeighbour = (point: { x: number; y: number }): boolean => {
    const state = store.getState();
    const editor = store.editor;
    // Only what is drawn may be addressed, which is the same rule the Tunni
    // controls and the margin lines follow.
    if (!state.showNeighbours || editor.activeTool !== "select") return false;

    const glyph = currentGlyph(editor);
    if (glyph === null || withinGlyph(glyph, point)) return false;
    if (targetAt(point) !== null) return false;

    const neighbours = neighboursFor(editor.document, editor.currentGlyph, state.stripText);
    const found = neighbourAt(neighbours, point);
    if (found === null) return false;

    store.setCurrentGlyph(found.glyph.name);
    return true;
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
    if (editor.gesture?.kind === "dragSelection") {
      canvas.style.cursor = "move";
      return;
    }
    if (editor.gesture?.kind === "dragGuide") {
      canvas.style.cursor = guideCursor(editor, editor.gesture.guideId);
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

    // Inside the box, where a drag takes the whole selection with it. Said with
    // the cursor because nothing else says it: the box looks like a thing to
    // grab at its handles, and the space inside it looks like empty canvas.
    const inside = box !== null && boxContains(box, point);

    const glyph = currentGlyph(editor);
    if (glyph === null) {
      canvas.style.cursor = "";
      return;
    }

    const reach = screenTolerance(editor.view, HIT_PIXELS) * (PICK_TOLERANCE_SCALE.originLine ?? 1);
    const near = Math.abs(point.x) <= reach || Math.abs(point.x - glyph.advance) <= reach;

    // A guide crosses the whole canvas, so unlike the margins it can be under
    // the pointer anywhere — which would cost the hit index on every move if it
    // were asked in the same breath. It is not: `pickGuide` is arithmetic over a
    // handful of lines, so an ordinary move over empty canvas still builds
    // nothing, and the index below is built only once a guide is actually there.
    const guideId = pickGuide(editor, point);
    if (!near && !inside && guideId === null) {
      canvas.style.cursor = "";
      return;
    }

    const target = targetAt(point);
    if (target?.kind === "originLine" || target?.kind === "advanceLine") {
      canvas.style.cursor = "ew-resize";
      return;
    }
    // Last of the three, in the order `pointerDown` takes them: a guide loses
    // the press to anything on the outline and to the selection it lies across,
    // so it may only promise a drag where neither of those would take it.
    if (guideId !== null && target === null && !inside) {
      canvas.style.cursor = guideCursor(editor, guideId);
      return;
    }
    // Only where the press would actually move the selection: anything pickable
    // wins the press, so it must not be promised the move cursor.
    canvas.style.cursor = inside && target === null ? "move" : "";
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
        const input = toInput(event as unknown as PointerEvent);
        if (openNeighbour(input.point)) return;
        store.applyTool(doubleClick(store.editor, input));
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        const surface = surfaceRef.current;
        if (surface === null) return;

        // What the menu offers is decided by what is under the pointer, using
        // the same hit index the tools use — so the menu can never offer an
        // action for something the canvas is not actually showing.
        const editor = store.editor;
        const { point } = toInput(event as unknown as PointerEvent);
        const target = targetAt(point);
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
      onKeyUp={(event) => {
        // Held tool keys are given back here — see `keyHold` in the tools.
        store.applyTool(
          keyUp(store.editor, {
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
/**
 * The cursor over a guide, which says which way it will move.
 *
 * A guide is dragged by the same hand as a margin and earns the same promise.
 * Which way depends on the guide: an upright one moves across, a level one up
 * and down, and an angled one — which snaps to nothing and is placed by eye —
 * moves both ways at once.
 */
function guideCursor(editor: EditorState, id: GuideId): string {
  const found = guideById(editor, id);
  if (found === null) return "";
  if (isVertical(found.guide)) return "ew-resize";
  if (isHorizontal(found.guide)) return "ns-resize";
  return "move";
}

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
