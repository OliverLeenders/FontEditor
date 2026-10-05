import {
  type FillPlan,
  detachedComposites,
  planFill,
  reattachComposites,
  roundCoordinates,
  takeFill,
  tidyOutlines,
  unroundedCount,
  untidyCount,
} from "@typewright/tools";
import { useEffect, useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import { BarMenu } from "./BarMenu.js";
import type { Item } from "./MenuItems.js";
import styles from "./OpenFont.module.css";
import { AnchorIcon, BlendIcon, EqualApproximatelyIcon, MopIcon, SplineIcon } from "./icons.js";

/** How long the result of the last tidy stays on screen. */
const NOTE_MS = 4000;

/**
 * The edits that are done to the whole font at once.
 *
 * Each of them is the same kind of thing: a sweep over the font that is one
 * undo step and that nobody does while drawing. As a loose button in the bar,
 * rounding read like a primary action, which it is not.
 *
 * One of them asks first. Filling a font as its file did reads each contour's
 * direction as the file meant it, which is right for a glyph as it came in and
 * wrong for one redrawn here since — so it says how many glyphs it would
 * change, and which, and changes them when it is told to.
 */
export function CleanUpMenu(): React.JSX.Element {
  const store = useEditorStore();
  const reading = useStoreValue((s) => s.ownership === "reading");
  const [note, setNote] = useState<string | null>(null);
  /** What filling as the file did would change, shown and waiting to be taken or let go. */
  const [fill, setFill] = useState<FillPlan | null>(null);

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
      icon: EqualApproximatelyIcon,
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
    {
      // For after a letter's anchor has moved: composites keep their accents
      // where they were put until asked, so a hand-nudged accent is never
      // overwritten by somebody dragging an anchor on a different glyph.
      kind: "item",
      label: "Re-attach accents",
      icon: AnchorIcon,
      disabled: reading,
      run: () => {
        const count = detachedComposites(store.editor).length;
        if (count === 0) {
          setNote("Every accent was already on its anchors.");
          return;
        }
        store.applyTool(reattachComposites(store.editor));
        setNote(count === 1 ? "Re-attached 1 glyph." : `Re-attached ${String(count)} glyphs.`);
      },
    },
    { kind: "separator" },
    {
      // For a font read from a font file before reading one left these out: a
      // point on the point before it, and a handle on its own point. Neither
      // draws anything, so nothing changes shape.
      kind: "item",
      label: "Tidy imported outlines",
      hint: "points that sit on one another, and handles of no length; no shape changes",
      icon: SplineIcon,
      disabled: reading,
      run: () => {
        setFill(null);
        const count = untidyCount(store.editor);
        if (count === 0) {
          setNote("There was nothing to tidy.");
          return;
        }
        store.applyTool(tidyOutlines(store.editor));
        setNote(count === 1 ? "Tidied 1 glyph." : `Tidied ${String(count)} glyphs.`);
      },
    },
    {
      kind: "item",
      label: "Fill as the font file did…",
      hint: "for glyphs built of overlapping pieces; says what it would change first",
      icon: BlendIcon,
      disabled: reading,
      run: () => {
        const plan = planFill(store.editor);
        if (plan.redrawn.length === 0) {
          setFill(null);
          setNote(
            plan.left.length === 0
              ? "Every glyph already fills as its file did."
              : `${glyphs(plan.left.length)} fill differently and could not be redrawn.`,
          );
          return;
        }
        setNote(null);
        setFill(plan);
      },
    },
  ];

  return (
    <div className={styles.zone}>
      <BarMenu
        label="Clean up"
        icon={MopIcon}
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
      {fill === null ? null : (
        <span
          className={styles.confirm}
          role="group"
          aria-label="Fill as the font file did?"
          title={fill.redrawn.join(", ")}
        >
          <span className={styles.note}>
            {glyphs(fill.redrawn.length)} would be redrawn: {some(fill.redrawn)}
          </span>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              store.applyTool(takeFill(store.editor, fill));
              setNote(`Redrew ${glyphs(fill.redrawn.length)}.`);
              setFill(null);
            }}
          >
            Redraw them
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              setFill(null);
            }}
          >
            Cancel
          </button>
        </span>
      )}
    </div>
  );
}

/** So many glyphs, as it is said. */
const glyphs = (n: number): string => (n === 1 ? "1 glyph" : `${String(n)} glyphs`);

/** The first few of a list of names, and how many more there are. */
function some(names: readonly string[]): string {
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${shown} and ${String(names.length - 3)} more` : shown;
}
