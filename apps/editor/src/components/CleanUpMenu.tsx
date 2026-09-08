import { roundCoordinates, unroundedCount } from "@fonteditor/tools";
import { useEffect, useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import { BarMenu } from "./BarMenu.js";
import type { Item } from "./MenuItems.js";
import styles from "./OpenFont.module.css";
import { GridIcon, SprayIcon } from "./icons.js";

/** How long the result of the last tidy stays on screen. */
const NOTE_MS = 4000;

/**
 * The edits that are done to the whole font at once.
 *
 * One so far, and a menu for one thing looks like an odd shape — but this is
 * where "remove every overlap" and "delete the glyphs nothing refers to" go,
 * and each of them is the same kind of thing: a sweep over the font that is one
 * undo step and that nobody does while drawing. As a loose button in the bar,
 * rounding read like a primary action, which it is not.
 */
export function CleanUpMenu(): React.JSX.Element {
  const store = useEditorStore();
  const reading = useStoreValue((s) => s.ownership === "reading");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (note === null) return;
    const timer = window.setTimeout(() => setNote(null), NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [note]);

  /*
   * The count is worked out when the item is chosen rather than shown on it.
   * Answering "how many glyphs are unrounded" means walking every node of every
   * glyph, and a label that answered it continuously would do that walk after
   * every edit — for a number nobody is looking at while they draw.
   *
   * So the answer is given afterwards instead, which is also when it is worth
   * something: the edit is one undo step, and the note is what says whether
   * that step is worth undoing.
   */
  const items: Item[] = [
    {
      kind: "item",
      label: "Round coordinates",
      icon: GridIcon,
      disabled: reading,
      run: () => {
        const count = unroundedCount(store.editor);
        if (count === 0) {
          setNote("Every coordinate was already whole.");
          return;
        }
        store.applyTool(roundCoordinates(store.editor));
        setNote(count === 1 ? "Rounded 1 glyph." : `Rounded ${String(count)} glyphs.`);
      },
    },
  ];

  return (
    <div className={styles.zone}>
      <BarMenu
        label="Clean up"
        icon={SprayIcon}
        title="Edits made to the whole font at once"
        panelLabel="Clean up"
        disabled={reading}
        items={items}
      />
      {note === null ? null : (
        <span className={styles.note} role="status">
          {note}
        </span>
      )}
    </div>
  );
}
