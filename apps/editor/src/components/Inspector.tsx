import { setAdvance, setNodeType, updateContour } from "@fonteditor/font-model";
import { begin, commit, editCurrentGlyph, result } from "@fonteditor/tools";
import { useRef } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./Inspector.module.css";

/**
 * The floating inspector: glyph identity, advance, and the selected points.
 *
 * Draggable and dismissible, with its position remembered, because it sits over
 * the canvas rather than reserving space beside it. That is the trade the layout
 * made — nearly all the screen goes to the work, and in exchange the panel can
 * land on top of what you are editing until you move it.
 */
export function Inspector(): JSX.Element | null {
  const store = useEditorStore();
  const open = useStoreValue((s) => s.inspector.open);
  const x = useStoreValue((s) => s.inspector.x);
  const y = useStoreValue((s) => s.inspector.y);
  const glyphName = useStoreValue((s) => s.session.editor.currentGlyph);
  const advance = useStoreValue((s) => s.session.editor.document.glyphs[s.session.editor.currentGlyph]?.advance ?? 0);
  const unicodes = useStoreValue(
    (s) => s.session.editor.document.glyphs[s.session.editor.currentGlyph]?.unicodes ?? EMPTY_CODES,
  );
  const selectionCount = useStoreValue((s) => s.session.editor.selection.length);
  const pointType = useStoreValue(selectedPointType);

  const drag = useRef<{ dx: number; dy: number } | null>(null);
  if (!open) return null;

  const commitAdvance = (value: number): void => {
    if (!Number.isFinite(value)) return;
    const document = editCurrentGlyph(store.editor, (g) => setAdvance(g, value));
    if (document === null) return;
    store.applyTool(result({ ...store.editor, document }, [begin("Set advance"), commit]));
  };

  const applyPointType = (type: "corner" | "smooth"): void => {
    let editor = store.editor;
    // Every selected on-curve point, one contour operation at a time.
    for (const item of editor.selection) {
      if (item.part !== "point") continue;
      const document = editCurrentGlyph(editor, (g) =>
        updateContour(g, item.contourId, (c) => setNodeType(c, item.nodeId, type)),
      );
      if (document !== null) editor = { ...editor, document };
    }
    if (editor !== store.editor) {
      store.applyTool(result(editor, [begin("Set point type", false), commit]));
    }
  };

  return (
    <aside
      className={styles.panel}
      style={{ left: `${x}px`, top: `${y}px` }}
      aria-label="Glyph inspector"
    >
      <header
        className={styles.grip}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { dx: event.clientX - x, dy: event.clientY - y };
        }}
        onPointerMove={(event) => {
          const from = drag.current;
          if (from === null) return;
          store.moveInspector(
            Math.max(0, event.clientX - from.dx),
            Math.max(0, event.clientY - from.dy),
          );
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          drag.current = null;
        }}
      >
        <span className={styles.title}>{glyphName || "no glyph"}</span>
        <button
          type="button"
          className={styles.dismiss}
          title="Hide the inspector  (I)"
          aria-label="Hide the inspector"
          onClick={() => store.toggleInspector()}
        >
          ×
        </button>
      </header>

      <div className={styles.body}>
        <Field label="Unicode">
          <span className={styles.readonly}>
            {unicodes.length === 0
              ? "—"
              : unicodes.map((u) => `U+${u.toString(16).toUpperCase().padStart(4, "0")}`).join(" ")}
          </span>
        </Field>

        <Field label="Advance">
          <input
            className={styles.input}
            type="number"
            value={Math.round(advance)}
            onChange={(event) => commitAdvance(Number(event.target.value))}
          />
        </Field>

        <div className={styles.rule} />

        <Field label={selectionCount === 0 ? "Point" : `Point · ${selectionCount} selected`}>
          <div className={styles.segmented}>
            <button
              type="button"
              aria-pressed={pointType === "corner"}
              disabled={selectionCount === 0}
              onClick={() => applyPointType("corner")}
            >
              Corner
            </button>
            <button
              type="button"
              aria-pressed={pointType === "smooth"}
              disabled={selectionCount === 0}
              onClick={() => applyPointType("smooth")}
            >
              Smooth
            </button>
          </div>
        </Field>
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      {children}
    </label>
  );
}

const EMPTY_CODES: readonly number[] = [];

/**
 * The type shared by every selected on-curve point, or `null` when they differ —
 * so a mixed selection shows neither button pressed rather than lying about one.
 */
function selectedPointType(s: {
  session: { editor: { currentGlyph: string; selection: readonly { contourId: string; nodeId: string; part: string }[]; document: { glyphs: Record<string, { contours: readonly { id: string; nodes: readonly { id: string; type: string }[] }[] }> } } };
}): string | null {
  const editor = s.session.editor;
  const glyph = editor.document.glyphs[editor.currentGlyph];
  if (glyph === undefined) return null;

  let found: string | null = null;
  for (const item of editor.selection) {
    if (item.part !== "point") continue;
    const contour = glyph.contours.find((c) => c.id === item.contourId);
    const node = contour?.nodes.find((n) => n.id === item.nodeId);
    if (node === undefined) continue;
    if (found === null) found = node.type;
    else if (found !== node.type) return null;
  }
  return found;
}
