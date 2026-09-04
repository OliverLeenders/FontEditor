import type { ToolId } from "@fonteditor/tools";

import { useEditorStore, useStoreValue } from "../useStore.js";
import {
  EllipseIcon,
  FitIcon,
  HandlesIcon,
  type IconComponent,
  KnifeIcon,
  MeasureIcon,
  PenIcon,
  RectIcon,
  RedoIcon,
  SelectIcon,
  SnapIcon,
  UndoIcon,
} from "./icons.js";
import { PreferencesPanel } from "./PreferencesPanel.js";
import { RemoveOverlap } from "./RemoveOverlap.js";
import styles from "./Toolbar.module.css";

type ToolButton = {
  readonly id: ToolId | null;
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly icon: IconComponent;
};

/**
 * The tools.
 *
 * Icons rather than the letters that were here before. The letter had one real
 * virtue — it taught the keyboard shortcut for free — so the shortcut is now
 * carried by every tooltip instead, and the tooltip is the only place it is
 * written. A row of six letters says nothing about what any of them do until you
 * have learned all six.
 */
const TOOLS: readonly ToolButton[] = [
  { id: "select", key: "V", label: "Select", hint: "Select and edit  (V)", icon: SelectIcon },
  { id: "pen", key: "P", label: "Pen", hint: "Draw contours  (P)", icon: PenIcon },
  { id: "knife", key: "K", label: "Knife", hint: "Cut across the outline  (K)", icon: KnifeIcon },
  {
    id: "rect",
    key: "R",
    label: "Rectangle",
    hint: "Draw a rectangle  (R) · shift for a square, alt from the centre",
    icon: RectIcon,
  },
  {
    id: "ellipse",
    key: "E",
    label: "Ellipse",
    hint: "Draw an ellipse  (E) · shift for a circle, alt from the centre",
    icon: EllipseIcon,
  },
  {
    id: "measure",
    key: "M",
    label: "Measure",
    hint: "Measure across a stem  (M) · click to pin",
    icon: MeasureIcon,
  },
];

export function Toolbar(): React.JSX.Element {
  const store = useEditorStore();
  const activeTool = useStoreValue((s) => s.session.editor.activeTool);
  const scale = useStoreValue((s) => s.session.editor.view.scale);
  const autoHide = useStoreValue((s) => s.autoHideHandles);
  const snapPoints = useStoreValue((s) => s.snapPoints);
  const undoLabel = useStoreValue((s) => (canUndo(s) ? store.undoLabel() : null));
  const redoLabel = useStoreValue((s) => (canRedo(s) ? store.redoLabel() : null));

  return (
    <div className={styles.bar}>
      <div className={styles.group} role="group" aria-label="Tools">
        {TOOLS.map((tool) => (
          <button
            key={tool.key}
            type="button"
            className={styles.tool}
            aria-pressed={tool.id !== null && tool.id === activeTool}
            disabled={tool.id === null}
            title={tool.hint}
            aria-label={tool.label}
            onClick={() => tool.id !== null && store.setTool(tool.id)}
          >
            <tool.icon />
          </button>
        ))}
      </div>

      <div className={styles.divider} />

      <div className={styles.group} role="group" aria-label="History">
        {/* The tooltip is doing more work than before: it is the only place the
            step being undone is named, now that the button is an arrow. */}
        <button
          type="button"
          className={styles.tool}
          disabled={undoLabel === null}
          title={undoLabel === null ? "Nothing to undo" : `Undo ${undoLabel}  (Ctrl-Z)`}
          aria-label="Undo"
          onClick={() => store.undo()}
        >
          <UndoIcon />
        </button>
        <button
          type="button"
          className={styles.tool}
          disabled={redoLabel === null}
          title={redoLabel === null ? "Nothing to redo" : `Redo ${redoLabel}  (Ctrl-Shift-Z)`}
          aria-label="Redo"
          onClick={() => store.redo()}
        >
          <RedoIcon />
        </button>
      </div>

      <div className={styles.divider} />

      <button
        type="button"
        className={`${styles.tool} ${styles.toggle}`}
        aria-pressed={autoHide}
        title={autoHide ? "Handles show near the work  (H)" : "All handles always shown  (H)"}
        aria-label="Handles"
        onClick={() => store.toggleAutoHideHandles()}
      >
        <HandlesIcon />
      </button>

      {/* The metric lines are not part of this and are always live: the canvas
          draws them, so catching on one explains itself. This is for the lines
          the glyph's own points make, which it does not draw yet. */}
      <button
        type="button"
        className={`${styles.tool} ${styles.toggle}`}
        aria-pressed={snapPoints}
        title={
          snapPoints
            ? "Drags line up with the glyph's own points  (S) · hold ctrl to override"
            : "Drags line up with the font's lines only  (S)"
        }
        aria-label="Snap"
        onClick={() => store.toggleSnapPoints()}
      >
        <SnapIcon />
      </button>

      <div className={styles.divider} />

      <RemoveOverlap />

      <div className={styles.spacer} />

      <button
        type="button"
        className={styles.tool}
        title="Fit the glyph in the window  (Ctrl-0)"
        aria-label="Fit"
        onClick={() => store.fitGlyph()}
      >
        <FitIcon />
      </button>
      <span className={styles.zoom}>{Math.round(scale * 100)}%</span>

      <div className={styles.divider} />

      <PreferencesPanel />
    </div>
  );
}

// Declared out of line so the selectors above stay single expressions.
const canUndo = (s: { session: { pending: unknown; history: { index: number } } }): boolean =>
  s.session.pending === null && s.session.history.index > 0;
const canRedo = (s: {
  session: { pending: unknown; history: { index: number; entries: readonly unknown[] } };
}): boolean =>
  s.session.pending === null && s.session.history.index < s.session.history.entries.length;
