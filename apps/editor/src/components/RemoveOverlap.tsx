import { overlapAt, selectedContourIds } from "@typewright/tools";
import { useEffect, useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import { OverlapIcon } from "./icons.js";
import styles from "./Toolbar.module.css";

/** How long the result of the last removal stays on screen. */
const NOTE_MS = 4000;

/**
 * "Overlap": union the contours of the glyph on screen, or the selected ones.
 *
 * What it works on follows the selection, the way the transform panel and the
 * nudge keys do: nothing selected means the glyph, and a selection means the
 * contours it touches. That is what lets a stem drawn as two strokes be merged
 * while the counter beside it is left alone — and it needs no second button,
 * since "everything" is what an empty selection has always meant here.
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
  const chosen = useStoreValue((s) => s.session.editor.selection.length > 0);
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
        className={styles.tool}
        disabled={reading}
        title={
          reading
            ? "Another tab is saving this project"
            : chosen
              ? "Replace the selected contours with their outline"
              : "Replace the overlapping contours with their outline"
        }
        aria-label={chosen ? "Remove overlap in selection" : "Remove overlap"}
        onClick={() => {
          const editor = store.editor;
          const only = selectedContourIds(editor);
          const { outcome, result } = overlapAt(editor, editor.currentGlyph, only);

          if (outcome === "clean") {
            setNote({
              text:
                only === null
                  ? "Nothing was overlapping."
                  : "Nothing was overlapping in the selection.",
              refused: false,
            });
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
        <OverlapIcon />
      </button>
      {note === null ? null : (
        <span className={styles.note} data-refused={note.refused} role="status">
          {note.text}
        </span>
      )}
    </>
  );
}
