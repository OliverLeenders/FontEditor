import { NO_METRIC_KEYS, contourById, randomIds, segmentAt } from "@typewright/font-model";
import {
  addGuideAt,
  addPointsAtTurns,
  guideById,
  moveGuideToScope,
  pickGuide,
  removeGuideAt,
  addAnchorAt,
  attachComponent,
  harmoniseSelection,
  nodeCanHarmonise,
  attachmentFor,
  balanceSegmentAt,
  centreCurrentGlyph,
  decomposeCurrentGlyph,
  freeAnchorName,
  removeAnchorAt,
  removeComponent,
  extractHandles,
  extractSegmentHandles,
  convertSegment,
  deleteSelectedPoints,
  insertPointOnSegment,
  nodeCanBeTangent,
  selectContour,
  nodeHasMissingHandle,
  nodeHvLocked,
  retractHandle,
  reverseContourAt,
  segmentHasMissingHandle,
  segmentParameterAt,
  turnsMissing,
  roundGlyphAt,
  roundSelection,
  selectAllPoints,
  setNodeHvLock,
  setPointType,
  unroundedSelected,
  currentGlyph,
} from "@typewright/tools";
import type { HitTarget } from "@typewright/view";
import { useEffect, useRef } from "react";

import type { EditorStore } from "../store/index.js";
import styles from "./ContextMenu.module.css";
import { type Item, MenuItems } from "./MenuItems.js";
import {
  AnchorIcon,
  CentreGlyphIcon,
  CirclePlusIcon,
  ComponentIcon,
  DistributeCentreIcon,
  ExternalLinkIcon,
  GridIcon,
  IterationCcwIcon,
  LockIcon,
  MaximizeIcon,
  MinimizeIcon,
  MinusIcon,
  FrameIcon,
  GuideAcrossIcon,
  GuideUpIcon,
  SelectAllIcon,
  SplineIcon,
  TrashIcon,
  UngroupIcon,
  WavesIcon,
  PointIcon,
} from "./icons.js";

export type MenuRequest = {
  /** Where the menu opens, in client coordinates. */
  readonly x: number;
  readonly y: number;
  /** What was under the pointer, or `null` for empty canvas. */
  readonly target: HitTarget | null;
  /** Where the click landed, in design units. */
  readonly point: { x: number; y: number };
};

/**
 * What a menu is made of, shared with the bar menus.
 *
 * Re-exported rather than moved out of sight: `itemsFor` below builds these,
 * and a caller reading this file should not have to go looking for the shape
 * of what it returns.
 */
export type { Item };

/** New points from the menu need ids; the app owns the factory. */
const ids = randomIds();

/** Stands in when the current glyph has gone, so the labels stay readable. */
const EMPTY_GLYPH = {
  name: "",
  unicodes: [],
  advance: 0,
  contours: [],
  components: [],
  anchors: [],
  guides: [],
  image: null,
  kept: [],
  metricKeys: NO_METRIC_KEYS,
  markColor: null,
  layers: {},
};

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
      icon: GridIcon,
      // Offered even with nothing out of place, so the menu does not change
      // shape between two glyphs that look the same.
      disabled: editor.selection.length === 0,
      run: () => store.applyTool(roundSelection(editor)),
    },
    {
      kind: "item",
      label: "Round this glyph",
      icon: GridIcon,
      run: () => store.applyTool(roundGlyphAt(editor, editor.currentGlyph)),
    },
  ];

  // A guide is picked up only where nothing on the outline is, and the same
  // rule decides whether this menu is about one.
  const overGuide = target === null ? pickGuide(editor, request.point) : null;
  if (overGuide !== null) return guideItems(store, overGuide);

  if (target === null) {
    return [
      {
        kind: "item",
        label: "Select all points",
        icon: SelectAllIcon,
        run: () => store.applyTool(selectAllPoints(editor)),
      },
      // Placed where the click was, which is the only thing "here" can mean —
      // and named for what it will most likely be, since an accent over a
      // letter is what most anchors are.
      {
        kind: "item",
        label: `Add anchor here (${freeAnchorName(currentGlyph(editor) ?? EMPTY_GLYPH)})`,
        icon: AnchorIcon,
        run: () => store.applyTool(addAnchorAt(editor, request.point, ids)),
      },
      { kind: "separator" },
      // Level and upright, which is what almost every guide is, and both scopes
      // because the scope is the decision: the x-height belongs to the typeface
      // and this letter's diagonal belongs to the letter.
      {
        kind: "item",
        label: "Add horizontal guide",
        icon: GuideAcrossIcon,
        run: () => store.applyTool(addGuideAt(editor, request.point, 0, "glyph", ids)),
      },
      {
        kind: "item",
        label: "Add vertical guide",
        icon: GuideUpIcon,
        run: () => store.applyTool(addGuideAt(editor, request.point, 90, "glyph", ids)),
      },
      {
        kind: "item",
        label: "Add horizontal guide, for the whole font",
        icon: GuideAcrossIcon,
        run: () => store.applyTool(addGuideAt(editor, request.point, 0, "font", ids)),
      },
      {
        kind: "item",
        label: "Add vertical guide, for the whole font",
        icon: GuideUpIcon,
        run: () => store.applyTool(addGuideAt(editor, request.point, 90, "font", ids)),
      },
      { kind: "separator" },
      ...rounding,
    ];
  }

  const items: Item[] = [];

  if (target.kind === "node") {
    const { contourId, nodeId } = target;
    const harmonises = nodeCanHarmonise(editor, contourId, nodeId);
    const locked = nodeHvLocked(editor, contourId, nodeId);
    items.push(
      {
        kind: "item",
        label: "Select contour",
        icon: SelectAllIcon,
        run: () => store.applyTool(selectContour(editor, contourId)),
      },
      { kind: "separator" },
      {
        kind: "item",
        label: "Corner",
        icon: PointIcon,
        run: () => store.applyTool(setPointType(editor, "corner", { contourId, nodeId })),
      },
      {
        kind: "item",
        label: "Smooth",
        icon: PointIcon,
        run: () => store.applyTool(setPointType(editor, "smooth", { contourId, nodeId })),
      },
      // Offered only where it would be true, which is the same rule the model
      // refuses on. A menu item that did nothing would teach nothing.
      ...(nodeCanBeTangent(editor, contourId, nodeId)
        ? [
            {
              kind: "item" as const,
              label: "Tangent",
              icon: PointIcon,
              run: () => store.applyTool(setPointType(editor, "tangent", { contourId, nodeId })),
            },
          ]
        : []),
      // Offered only where it would move the point. A join between anything but
      // two curves has no two curvatures to reconcile, and one already
      // harmonious is already where this would put it.
      ...(harmonises
        ? [
            {
              kind: "item" as const,
              label: "Harmonise",
              icon: WavesIcon,
              run: () =>
                store.applyTool(
                  harmoniseSelection({
                    ...editor,
                    selection: [{ contourId, nodeId, part: "point" }],
                  }),
                ),
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
        icon: MaximizeIcon,
        run: () => store.applyTool(extractHandles(editor, contourId, nodeId)),
      });
    }

    items.push(
      {
        kind: "item",
        label: "Lock handles to axis",
        icon: LockIcon,
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
        icon: IterationCcwIcon,
        run: () => store.applyTool(reverseContourAt(editor, contourId)),
      },
      {
        kind: "item",
        label: "Delete point",
        icon: TrashIcon,
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
        icon: LockIcon,
        checked: locked[part],
        run: () => store.applyTool(setNodeHvLock(editor, contourId, nodeId, part, !locked[part])),
      },
      {
        kind: "item",
        label: "Lock both handles to axis",
        icon: LockIcon,
        checked: locked.in && locked.out,
        run: () =>
          store.applyTool(
            setNodeHvLock(editor, contourId, nodeId, "both", !(locked.in && locked.out)),
          ),
      },
      { kind: "separator" },
      {
        kind: "item",
        label: "Select contour",
        icon: SelectAllIcon,
        run: () => store.applyTool(selectContour(editor, contourId)),
      },
      { kind: "separator" },
      {
        kind: "item",
        label: "Corner",
        icon: PointIcon,
        run: () => store.applyTool(setPointType(editor, "corner", { contourId, nodeId })),
      },
      {
        kind: "item",
        label: "Smooth",
        icon: PointIcon,
        run: () => store.applyTool(setPointType(editor, "smooth", { contourId, nodeId })),
      },
      ...(nodeCanBeTangent(editor, contourId, nodeId)
        ? [
            {
              kind: "item" as const,
              label: "Tangent",
              icon: PointIcon,
              run: () => store.applyTool(setPointType(editor, "tangent", { contourId, nodeId })),
            },
          ]
        : []),
      { kind: "separator" },
      {
        kind: "item",
        label: "Retract handle",
        icon: MinimizeIcon,
        run: () => store.applyTool(retractHandle(editor, contourId, nodeId, part)),
      },
    );
    if (nodeHasMissingHandle(editor, contourId, nodeId)) {
      items.push({
        kind: "item",
        label: "Extract handles",
        icon: MaximizeIcon,
        run: () => store.applyTool(extractHandles(editor, contourId, nodeId)),
      });
    }
    items.push({
      kind: "item",
      label: "Reverse contour",
      icon: IterationCcwIcon,
      run: () => store.applyTool(reverseContourAt(editor, contourId)),
    });
    return items;
  }

  if (target.kind === "component") {
    const { componentId } = target;
    const placed = currentGlyph(editor)?.components.find((c) => c.id === componentId);
    const aligns = attachmentFor(editor, componentId) !== null;

    return [
      {
        kind: "item",
        label: placed === undefined ? "Open glyph" : `Open ${placed.base}`,
        icon: ExternalLinkIcon,
        disabled: placed === undefined,
        run: () => {
          if (placed !== undefined) store.setCurrentGlyph(placed.base);
        },
      },
      {
        kind: "item",
        label: "Align to anchors",
        icon: AnchorIcon,
        // Shown as unavailable rather than hidden: whether it applies is a fact
        // about the two glyphs — a letter with no `top`, an accent with no
        // `_top` — and worth being able to see the absence of.
        disabled: !aligns,
        run: () => store.applyTool(attachComponent(editor, componentId)),
      },
      { kind: "separator" },
      {
        kind: "item",
        label: "Decompose glyph",
        icon: UngroupIcon,
        run: () => store.applyTool(decomposeCurrentGlyph(editor, ids)),
      },
      {
        kind: "item",
        label: "Remove component",
        icon: ComponentIcon,
        run: () => store.applyTool(removeComponent(editor, componentId)),
      },
    ];
  }

  if (target.kind === "anchor") {
    // Renaming is a text field's job, and the inspector has one. What a menu
    // can do well is take the thing away.
    return [
      {
        kind: "item",
        label: "Remove anchor",
        icon: TrashIcon,
        run: () => store.applyTool(removeAnchorAt(editor, target.anchorId)),
      },
    ];
  }

  if (target.kind === "originLine" || target.kind === "advanceLine") {
    // The margin lines are about the glyph as a whole, so the menu offers the
    // one spacing operation that is tedious to do with two number fields.
    return [
      {
        kind: "item",
        label: "Centre glyph",
        icon: CentreGlyphIcon,
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

  items.push(
    {
      kind: "item",
      label: "Select contour",
      icon: SelectAllIcon,
      run: () => store.applyTool(selectContour(editor, segment.contourId)),
    },
    { kind: "separator" },
  );

  // The segment actions are offered for all three segment-bearing targets, not
  // just the curve itself. A Tunni point and its line sit directly on top of the
  // curve they control and win the hit test, so gating these on `kind ===
  // "segment"` meant the likeliest place to right-click a curve was the one
  // place that offered no way to convert it.
  //
  // `status === "flat"` is not the same question: a curve whose handles happen
  // to lie on its chord is also flat. Ask the model what kind of segment it is.
  const glyph = currentGlyph(editor);
  const c = glyph === null ? null : contourById(glyph, segment.contourId);
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
        icon: CirclePlusIcon,
        run: () => store.applyTool(insertPointOnSegment(editor, segment, t, ids)),
      });
    }
  }

  // Where the curve turns, on this segment. Offered only where there is a turn
  // with no point on it already: an item that would do nothing is worse than no
  // item, since the only way to find that out is to try it.
  const extremes = turnsMissing(editor, segment, "extreme");
  if (extremes > 0) {
    items.push({
      kind: "item",
      label: extremes === 1 ? "Add point at extreme" : "Add points at extremes",
      icon: FrameIcon,
      run: () => store.applyTool(addPointsAtTurns(editor, segment, "extreme", ids)),
    });
  }

  const bends = turnsMissing(editor, segment, "inflection");
  if (bends > 0) {
    items.push({
      kind: "item",
      label: bends === 1 ? "Add point at inflection" : "Add points at inflections",
      icon: WavesIcon,
      run: () => store.applyTool(addPointsAtTurns(editor, segment, "inflection", ids)),
    });
  }

  items.push({
    kind: "item",
    label: isLine ? "Make curve" : "Make line",
    icon: isLine ? SplineIcon : MinusIcon,
    run: () => store.applyTool(convertSegment(editor, segment, isLine ? "curve" : "line")),
  });

  // A curve with one control point on its anchor draws as a curve, so the menu
  // above offers only "Make line" — which is how a retracted handle became
  // unrecoverable.
  if (segmentHasMissingHandle(editor, segment)) {
    items.push({
      kind: "item",
      label: "Extract handles",
      icon: MaximizeIcon,
      run: () => store.applyTool(extractSegmentHandles(editor, segment)),
    });
  }

  items.push({ kind: "separator" });

  items.push(
    {
      kind: "item",
      label: "Balance handles",
      icon: DistributeCentreIcon,
      run: () => store.applyTool(balanceSegmentAt(editor, segment)),
    },
    {
      kind: "item",
      label: "Reverse contour",
      icon: IterationCcwIcon,
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
      <MenuItems items={items} onChose={onClose} />
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

/**
 * The menu for a guide: where it belongs, and taking it away.
 *
 * Short on purpose. Moving one is a drag, naming it is the inspector, and the
 * only two things worth a menu are the two that are awkward anywhere else —
 * changing its scope, and deleting a line you cannot select by clicking through.
 */
function guideItems(store: EditorStore, id: string): Item[] {
  const editor = store.editor;
  const found = guideById(editor, id);
  if (found === null) return [];
  return [
    {
      kind: "item",
      label:
        found.scope === "glyph"
          ? "Give this guide to the whole font"
          : "Keep this guide in this glyph",
      icon: FrameIcon,
      run: () =>
        store.applyTool(moveGuideToScope(editor, id, found.scope === "glyph" ? "font" : "glyph")),
    },
    { kind: "separator" },
    {
      kind: "item",
      label: "Delete guide",
      icon: TrashIcon,
      run: () => store.applyTool(removeGuideAt(editor, id)),
    },
  ];
}
