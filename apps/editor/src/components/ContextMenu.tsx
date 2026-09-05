import { contourById, randomIds, segmentAt } from "@fonteditor/font-model";
import {
  balanceSegmentAt,
  centreCurrentGlyph,
  extractHandles,
  extractSegmentHandles,
  convertSegment,
  deleteSelectedPoints,
  insertPointOnSegment,
  nodeCanBeTangent,
  nodeHasMissingHandle,
  nodeHvLocked,
  retractHandle,
  reverseContourAt,
  segmentHasMissingHandle,
  segmentParameterAt,
  roundGlyphAt,
  roundSelection,
  selectAllPoints,
  setNodeHvLock,
  setPointType,
  unroundedSelected,
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

export type Item =
  | {
      readonly kind: "item";
      readonly label: string;
      readonly run: () => void;
      readonly checked?: boolean;
      /** Shown but not usable, for an action that is real here and not now. */
      readonly disabled?: boolean;
    }
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
export function itemsFor(store: EditorStore, request: MenuRequest): Item[] {
  const editor = store.editor;
  const target = request.target;

  const rounding: Item[] = [
    {
      kind: "item",
      label: `Round selection${editor.selection.length === 0 ? "" : ` (${String(unroundedSelected(editor))})`}`,
      // Offered even with nothing out of place, so the menu does not change
      // shape between two glyphs that look the same.
      disabled: editor.selection.length === 0,
      run: () => store.applyTool(roundSelection(editor)),
    },
    {
      kind: "item",
      label: "Round this glyph",
      run: () => store.applyTool(roundGlyphAt(editor, editor.currentGlyph)),
    },
  ];

  if (target === null) {
    return [
      {
        kind: "item",
        label: "Select all points",
        run: () => store.applyTool(selectAllPoints(editor)),
      },
      { kind: "separator" },
      ...rounding,
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
      // Offered only where it would be true, which is the same rule the model
      // refuses on. A menu item that did nothing would teach nothing.
      ...(nodeCanBeTangent(editor, contourId, nodeId)
        ? [
            {
              kind: "item" as const,
              label: "Tangent",
              run: () => store.applyTool(setPointType(editor, "tangent", { contourId, nodeId })),
            },
          ]
        : []),
      { kind: "separator" },
    );

    // Only where there is something to pull out. A control point that sits on
    // its anchor cannot be seen or clicked, so this is the only way back to it.
    if (nodeHasMissingHandle(editor, contourId, nodeId)) {
      items.push({
        kind: "item",
        label: "Extract handles",
        run: () => store.applyTool(extractHandles(editor, contourId, nodeId)),
      });
    }

    items.push(
      {
        kind: "item",
        label: "Lock handles to axis",
        // Checked only when both are, since that is what this item sets. A node
        // with one handle locked shows unchecked, and using it locks the pair.
        checked: locked.in && locked.out,
        run: () =>
          store.applyTool(
            setNodeHvLock(editor, contourId, nodeId, "both", !(locked.in && locked.out)),
          ),
      },
      { kind: "separator" },
      {
        kind: "item",
        label: "Reverse contour",
        run: () => store.applyTool(reverseContourAt(editor, contourId)),
      },
      {
        kind: "item",
        label: "Delete point",
        run: () => store.applyTool(deleteSelectedPoints(editor)),
      },
      { kind: "separator" },
      ...rounding,
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
        label: "Lock this handle to axis",
        checked: locked[part],
        run: () => store.applyTool(setNodeHvLock(editor, contourId, nodeId, part, !locked[part])),
      },
      {
        kind: "item",
        label: "Lock both handles to axis",
        checked: locked.in && locked.out,
        run: () =>
          store.applyTool(
            setNodeHvLock(editor, contourId, nodeId, "both", !(locked.in && locked.out)),
          ),
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
      ...(nodeCanBeTangent(editor, contourId, nodeId)
        ? [
            {
              kind: "item" as const,
              label: "Tangent",
              run: () => store.applyTool(setPointType(editor, "tangent", { contourId, nodeId })),
            },
          ]
        : []),
      { kind: "separator" },
      {
        kind: "item",
        label: "Retract handle",
        run: () => store.applyTool(retractHandle(editor, contourId, nodeId, part)),
      },
    );
    if (nodeHasMissingHandle(editor, contourId, nodeId)) {
      items.push({
        kind: "item",
        label: "Extract handles",
        run: () => store.applyTool(extractHandles(editor, contourId, nodeId)),
      });
    }
    items.push({
      kind: "item",
      label: "Reverse contour",
      run: () => store.applyTool(reverseContourAt(editor, contourId)),
    });
    return items;
  }

  if (target.kind === "originLine" || target.kind === "advanceLine") {
    // The margin lines are about the glyph as a whole, so the menu offers the
    // one spacing operation that is tedious to do with two number fields.
    return [
      {
        kind: "item",
        label: "Centre glyph",
        run: () => store.applyTool(centreCurrentGlyph(editor)),
      },
    ];
  }

  // The curve and its two Tunni controls, which are the three kinds that name a
  // segment. The last test is what narrows the type even though the compiler can
  // already see it is the only kind left — take it away and the properties below
  // stop being reachable.
  const segment =
    target.kind === "segment" ||
    target.kind === "tunniPoint" ||
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    target.kind === "tunniLine"
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

  // A curve with one control point on its anchor draws as a curve, so the menu
  // above offers only "Make line" — which is how a retracted handle became
  // unrecoverable.
  if (segmentHasMissingHandle(editor, segment)) {
    items.push({
      kind: "item",
      label: "Extract handles",
      run: () => store.applyTool(extractSegmentHandles(editor, segment)),
    });
  }

  items.push({ kind: "separator" });

  items.push(
    {
      kind: "item",
      label: "Balance handles",
      run: () => store.applyTool(balanceSegmentAt(editor, segment)),
    },
    {
      kind: "item",
      label: "Reverse contour",
      run: () => store.applyTool(reverseContourAt(editor, segment.contourId)),
    },
  );
  return items;
}

/**
 * The context menu.
 *
 * Nudged back inside the window when it would open off an edge — a menu you
 * cannot read is worse than one that appears a few pixels from the cursor.
 */
/**
 * A menu at a point, with what it holds decided by whoever opened it.
 *
 * Separated from `itemsFor` so the glyph browser can use the same menu for its
 * own items. The dismissal rules and the flip away from a screen edge are the
 * parts nobody should write twice.
 */
export function Menu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: readonly Item[];
  onClose: () => void;
}): React.JSX.Element | null {
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
    if (overflowX > 0) menu.style.left = `${String(x - overflowX)}px`;
    if (overflowY > 0) menu.style.top = `${String(y - overflowY)}px`;
  }, [x, y, items]);

  if (items.length === 0) return null;

  return (
    <div
      ref={ref}
      className={styles.menu}
      style={{ left: `${String(x)}px`, top: `${String(y)}px` }}
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
            disabled={item.disabled ?? false}
            className={styles.item}
            onClick={() => {
              item.run();
              onClose();
            }}
          >
            <span className={styles.tick} aria-hidden="true">
              {item.checked === true ? "✓" : ""}
            </span>
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

/** The canvas's menu: what was right-clicked decides what it offers. */
export function ContextMenu({
  store,
  request,
  onClose,
}: {
  store: EditorStore;
  request: MenuRequest;
  onClose: () => void;
}): React.JSX.Element | null {
  return <Menu x={request.x} y={request.y} items={itemsFor(store, request)} onClose={onClose} />;
}
