import { roundCoordinates, unroundedCount } from "@fonteditor/tools";
import { useEffect, useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./OpenFont.module.css";

/** How long the result of the last round stays on screen. */
const NOTE_MS = 4000;

/**
 * "Round coordinates", over the whole font.
 *
 * The count is worked out when the button is pressed rather than shown on it.
 * Answering "how many glyphs are unrounded" means walking every node of every
 * glyph, and a label that answered it continuously would do that walk after
 * every edit — for a number nobody is looking at while they draw.
 *
 * So the answer is given afterwards instead, which is also when it is worth
 * something: the edit is one undo step, and the note is what says whether that
 * step is worth undoing.
 */
export function RoundCoordinates(): React.JSX.Element {
  const store = useEditorStore();
  const reading = useStoreValue((s) => s.ownership === "reading");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (note === null) return;
    const timer = window.setTimeout(() => setNote(null), NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [note]);

  return (
    <>
      <button
        type="button"
        className={styles.button}
        disabled={reading}
        title={
          reading
            ? "Another tab is saving this project"
            : "Put every coordinate in the font on whole units"
        }
        onClick={() => {
          const count = unroundedCount(store.editor);
          if (count === 0) {
            setNote("Every coordinate was already whole.");
            return;
          }
          store.applyTool(roundCoordinates(store.editor));
          setNote(count === 1 ? "Rounded 1 glyph." : `Rounded ${String(count)} glyphs.`);
        }}
      >
        Round coordinates
      </button>
      {note === null ? null : (
        <span className={styles.note} role="status">
          {note}
        </span>
      )}
    </>
  );
}
