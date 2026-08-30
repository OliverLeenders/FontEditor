import { contourById, randomIds, segmentAt } from "@fonteditor/font-model";
import {
  balanceSegmentAt,
  centreCurrentGlyph,
  convertSegment,
  deleteSelectedPoints,
  insertPointOnSegment,
  nodeHvLocked,
  retractHandle,
  reverseContourAt,
  segmentParameterAt,
  selectAllPoints,
  setNodeHvLock,
  setPointType,
} from "@fonteditor/tools";
import type { HitTarget } from "@fonteditor/view";
import { useEffect, useRef } from "react";

import type { EditorStore } from "../store.js";
import styles from "./ContextMenu.module.css";

export type MenuRequest = {
  /** Where the menu opens, in client coordinates. */
  readonly x: number;
  readonly y: number;
  /** What was under the pointer, or `null` for empty canvas. */
  readonly target: HitTarget | null;
  /** Where the click landed, in design units. */
  readonly point: { x: number; y: number };
};

type Item =
  | { readonly kind: "item"; readonly label: string; readonly run: () => void; readonly checked?: boolean }
  | { readonly kind: "separator" };

/** New points from the menu need ids; the app owns the factory. */
const ids = randomIds();

/**
 * Build the menu for whatever was right-clicked.
 *
 * Which items appear is the whole design: a menu that always shows everything
 * and greys most of it out makes the reader do the work of finding the two
 * things that apply. Each target offers what is true of it, plus the contour
 * operations that are true anywhere on a contour.
 */
function itemsFor(store: EditorStore, request: MenuRequest): Item[] {
  const editor = store.editor;
  const target = request.target;

  if (target === null) {
    return [
      { kind: "item", label: "Select all points", run: () => store.applyTool(selectAllPoints(editor)) },
    ];
  }

  const items: Item[] = [];

  if (target.kind === "node") {
    const { contourId, nodeId } = target;
    const locked = nodeHvLocked(editor, contourId, nodeId);
    items.push(
      {
        kind: "item",
        label: "Corner",
        run: () => store.applyTool(setPointType(editor, "corner", { contourId, nodeId })),
      },
      {
        kind: "item",
        label: "Smooth",
        run: () => store.applyTool(setPointType(editor, "smooth", { contourId, nodeId })),
      },
      { kind: "separator" },
      {
        kind: "item",
        label: "Lock handles to axis",
        checked: locked,
        run: () => store.applyTool(setNodeHvLock(editor, contourId, nodeId, !locked)),
      },
      { kind: "separator" },
      { kind: "item", label: "Reverse contour", run: () => store.applyTool(reverseContourAt(editor, contourId)) },
      { kind: "item", label: "Delete point", run: () => store.applyTool(deleteSelectedPoints(editor)) },
    );
    return items;
  }

  if (target.kind === "handleIn" || target.kind === "handleOut") {
    const { contourId, nodeId } = target;
    const part = target.kind === "handleIn" ? "in" : "out";
    const locked = nodeHvLocked(editor, contourId, nodeId);
    items.push(
      {
        kind: "item",
        label: "Lock handles to axis",
        checked: locked,
        run: () => store.applyTool(setNodeHvLock(editor, contourId, nodeId, !locked)),
      },
      { kind: "separator" },
      {
        kind: "item",
        label: "Corner",
        run: () => store.applyTool(setPointType(editor, "corner", { contourId, nodeId })),
      },
      {
        kind: "item",
        label: "Smooth",
        run: () => store.applyTool(setPointType(editor, "smooth", { contourId, nodeId })),
      },
      { kind: "separator" },
      { kind: "item", label: "Retract handle", run: () => store.applyTool(retractHandle(editor, contourId, nodeId, part)) },
      { kind: "item", label: "Reverse contour", run: () => store.applyTool(reverseContourAt(editor, contourId)) },
    );
    return items;
  }

  if (target.kind === "originLine" || target.kind === "advanceLine") {
    // The margin lines are about the glyph as a whole, so the menu offers the
    // one spacing operation that is tedious to do with two number fields.
    return [
      { kind: "item", label: "Centre glyph", run: () => store.applyTool(centreCurrentGlyph(editor)) },
    ];
  }

  const segment =
    target.kind === "segment" || target.kind === "tunniPoint" || target.kind === "tunniLine"
      ? { contourId: target.contourId, segmentIndex: target.segmentIndex }
      : null;
  if (segment === null) return items;

  // The segment actions are offered for all three segment-bearing targets, not
  // just the curve itself. A Tunni point and its line sit directly on top of the
  // curve they control and win the hit test, so gating these on `kind ===
  // "segment"` meant the likeliest place to right-click a curve was the one
  // place that offered no way to convert it.
  //
  // `status === "flat"` is not the same question: a curve whose handles happen
  // to lie on its chord is also flat. Ask the model what kind of segment it is.
  const glyph = editor.document.glyphs[editor.currentGlyph];
  const c = glyph === undefined ? null : contourById(glyph, segment.contourId);
  const isLine = (c === null ? null : segmentAt(c, segment.segmentIndex))?.kind === "line";

  // Only from the curve. `segmentParameterAt` projects onto the curve, so a
  // click on a Tunni control would yield a valid `t` and insert a point some
  // distance from the cursor — an item named "here" must mean here.
  if (target.kind === "segment") {
    const t = segmentParameterAt(editor, segment, request.point);
    if (t !== null) {
      items.push({
        kind: "item",
        label: "Insert point here",
        run: () => store.applyTool(insertPointOnSegment(editor, segment, t, ids)),
      });
    }
  }

  items.push({
    kind: "item",
    label: isLine ? "Make curve" : "Make line",
    run: () => store.applyTool(convertSegment(editor, segment, isLine ? "curve" : "line")),
  });
  items.push({ kind: "separator" });

  items.push(
    { kind: "item", label: "Balance handles", run: () => store.applyTool(balanceSegmentAt(editor, segment)) },
    { kind: "item", label: "Reverse contour", run: () => store.applyTool(reverseContourAt(editor, segment.contourId)) },
  );
  return items;
}

/**
 * The context menu.
 *
 * Nudged back inside the window when it would open off an edge — a menu you
 * cannot read is worse than one that appears a few pixels from the cursor.
 */
export function ContextMenu({
  store,
  request,
  onClose,
}: {
  store: EditorStore;
  request: MenuRequest;
  onClose: () => void;
}): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  useEffect(() => {
    const menu = ref.current;
    if (menu === null) return;
    const box = menu.getBoundingClientRect();
    const overflowX = Math.max(0, box.right - window.innerWidth + 6);
    const overflowY = Math.max(0, box.bottom - window.innerHeight + 6);
    if (overflowX > 0) menu.style.left = `${request.x - overflowX}px`;
    if (overflowY > 0) menu.style.top = `${request.y - overflowY}px`;
  }, [request]);

  const items = itemsFor(store, request);
  if (items.length === 0) return null;

  return (
    <div
      ref={ref}
      className={styles.menu}
      style={{ left: `${request.x}px`, top: `${request.y}px` }}
      role="menu"
    >
      {items.map((item, index) =>
        item.kind === "separator" ? (
          <div key={`sep-${String(index)}`} className={styles.separator} role="separator" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitemcheckbox"
            aria-checked={item.checked ?? false}
            className={styles.item}
            onClick={() => {
              item.run();
              onClose();
            }}
          >
            <span className={styles.tick} aria-hidden="true">{item.checked === true ? "✓" : ""}</span>
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
