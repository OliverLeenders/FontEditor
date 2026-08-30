import type { ToolId } from "@fonteditor/tools";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./Toolbar.module.css";

type ToolButton = {
  readonly id: ToolId | null;
  readonly key: string;
  readonly label: string;
  readonly hint: string;
};

/**
 * The tools, with the ones that do not exist yet shown disabled.
 *
 * `V` and `P` are real. The rest are placed so the rail's eventual shape is
 * visible and honestly marked — the earlier mockups had a letter in this row
 * that stood for nothing, which is the failure being avoided here.
 */
const TOOLS: readonly ToolButton[] = [
  { id: "select", key: "V", label: "Select", hint: "Select and edit  (V)" },
  { id: "pen", key: "P", label: "Pen", hint: "Draw contours  (P)" },
  { id: null, key: "K", label: "Knife", hint: "Knife — not built yet" },
  { id: null, key: "R", label: "Rectangle", hint: "Rectangle — not built yet" },
  { id: null, key: "E", label: "Ellipse", hint: "Ellipse — not built yet" },
  { id: null, key: "M", label: "Measure", hint: "Measure — not built yet" },
];

export function Toolbar(): JSX.Element {
  const store = useEditorStore();
  const activeTool = useStoreValue((s) => s.session.editor.activeTool);
  const scale = useStoreValue((s) => s.session.editor.view.scale);
  const autoHide = useStoreValue((s) => s.autoHideHandles);
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
            {tool.key}
          </button>
        ))}
      </div>

      <div className={styles.divider} />

      <div className={styles.group} role="group" aria-label="History">
        <button
          type="button"
          className={styles.action}
          disabled={undoLabel === null}
          title={undoLabel === null ? "Nothing to undo" : `Undo ${undoLabel}  (Ctrl-Z)`}
          onClick={() => store.undo()}
        >
          Undo
        </button>
        <button
          type="button"
          className={styles.action}
          disabled={redoLabel === null}
          title={redoLabel === null ? "Nothing to redo" : `Redo ${redoLabel}  (Ctrl-Shift-Z)`}
          onClick={() => store.redo()}
        >
          Redo
        </button>
      </div>

      <div className={styles.divider} />

      <button
        type="button"
        className={styles.action}
        aria-pressed={autoHide}
        title={
          autoHide
            ? "Handles show near the work  (H)"
            : "All handles always shown  (H)"
        }
        onClick={() => store.toggleAutoHideHandles()}
      >
        Handles
      </button>

      <div className={styles.spacer} />

      <button
        type="button"
        className={styles.action}
        title="Fit the glyph in the window  (Ctrl-0)"
        onClick={() => store.fitGlyph()}
      >
        Fit
      </button>
      <span className={styles.zoom}>{Math.round(scale * 100)}%</span>
    </div>
  );
}

// Declared out of line so the selectors above stay single expressions.
const canUndo = (s: { session: { pending: unknown; history: { index: number } } }): boolean =>
  s.session.pending === null && s.session.history.index > 0;
const canRedo = (s: {
  session: { pending: unknown; history: { index: number; entries: readonly unknown[] } };
}): boolean => s.session.pending === null && s.session.history.index < s.session.history.entries.length;
