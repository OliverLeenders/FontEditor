import { overlapAt } from "@fonteditor/tools";
import { useEffect, useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./Toolbar.module.css";

/** How long the result of the last removal stays on screen. */
const NOTE_MS = 4000;

/**
 * "Overlap": union the contours of the glyph on screen.
 *
 * The result is said afterwards rather than predicted on the button, for the
 * same reason the font-wide rounding says its count afterwards — working out
 * whether anything overlaps means intersecting every curve against every other,
 * and a label that answered continuously would do that after every drag.
 *
 * The refusal is the reason this has a note at all. Two edges lying exactly
 * along each other cannot be resolved, and a button that silently did nothing
 * there would read as a broken button rather than as a shape the tool declines
 * to guess at.
 */
export function RemoveOverlap(): React.JSX.Element {
  const store = useEditorStore();
  const reading = useStoreValue((s) => s.ownership === "reading");
  const [note, setNote] = useState<{ text: string; refused: boolean } | null>(null);

  useEffect(() => {
    if (note === null) return;
    const timer = window.setTimeout(() => setNote(null), NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [note]);

  return (
    <>
      <button
        type="button"
        className={styles.action}
        disabled={reading}
        title={
          reading
            ? "Another tab is saving this project"
            : "Replace the overlapping contours with their outline"
        }
        onClick={() => {
          const editor = store.editor;
          const { outcome, result } = overlapAt(editor, editor.currentGlyph);

          if (outcome === "clean") {
            setNote({ text: "Nothing was overlapping.", refused: false });
            return;
          }
          if (outcome === "refused") {
            setNote({ text: "Edges lie along each other — left alone.", refused: true });
            return;
          }

          store.applyTool(result);
          setNote({
            text:
              outcome === 1
                ? "Removed overlap at 1 crossing."
                : `Removed overlap at ${String(outcome)} crossings.`,
            refused: false,
          });
        }}
      >
        Overlap
      </button>
      {note === null ? null : (
        <span className={styles.note} data-refused={note.refused} role="status">
          {note.text}
        </span>
      )}
    </>
  );
}
