import type { SetOperation } from "@typewright/font-model";
import {
  type CombineReport,
  type OverlapDone,
  combineAt,
  overlapAt,
  selectedContourIds,
} from "@typewright/tools";
import { useEffect, useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import { ExcludeIcon, IntersectIcon, OverlapIcon, SubtractIcon } from "./icons.js";
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
 *
 * The three set operations are here rather than in a component of their own
 * because they share that note, and only one sentence can be true at a time —
 * two notes side by side, one of them stale, would be worse than either.
 */
/**
 * What each set operation says when it worked.
 *
 * No count, unlike the union's. The union answers a question you cannot see the
 * answer to — whether anything overlapped at all — where a subtraction is plain
 * on the canvas the moment it happens, and a number beside it would be noise.
 */
const SAID: Record<SetOperation, string> = {
  subtract: "Subtracted the selected shape.",
  intersect: "Kept what both shapes cover.",
  exclude: "Kept what only one shape covers.",
};

/** What each one is for, on the button. */
const TITLES: Record<SetOperation, string> = {
  subtract: "Take the selected shape away from the others",
  intersect: "Keep only what the selection and the others both cover",
  exclude: "Keep what the selection and the others do not share",
};

/** What each one is called, for a screen reader and for a test. */
const NAMES: Record<SetOperation, string> = {
  subtract: "Subtract",
  intersect: "Intersect",
  exclude: "Exclude",
};

const ICONS: Record<SetOperation, () => React.JSX.Element> = {
  subtract: SubtractIcon,
  intersect: IntersectIcon,
  exclude: ExcludeIcon,
};

/**
 * What was done, as a sentence.
 *
 * Two clauses at most: where the overlap was, and what had to be decomposed to
 * reach it. The second is left out when there was nothing to decompose, which is
 * every glyph drawn as contours alone.
 */
function said(done: OverlapDone): string {
  const places =
    done.places === 1
      ? "Removed overlap at 1 place"
      : `Removed overlap at ${String(done.places)} places`;
  if (done.decomposed === 0) return `${places}.`;
  const parts =
    done.decomposed === 1
      ? "1 component decomposed"
      : `${String(done.decomposed)} components decomposed`;
  return `${places}, ${parts}.`;
}

/**
 * What an operation's ending reads as.
 *
 * "They do not overlap" is not a refusal and is not an error: two shapes set
 * apart are a selection that meant something else, and the honest answer is to
 * say so and leave the drawing alone. Nothing left over is a decline, because it
 * is nearly always the wrong shape selected as the tool, and an empty glyph is a
 * poor way to discover that.
 */
function reported(outcome: CombineReport): string {
  if (outcome === "apart") return "They do not overlap.";
  if (outcome === "empty") return "Nothing would be left — not done.";
  if (outcome === "refused") return "Edges lie along each other — left alone.";
  return SAID[outcome.operation];
}

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
            // Places rather than crossings: two shapes set flush against each
            // other share a stretch of edge that crosses nothing, and it is
            // resolved along with everything that does. Components that had to
            // become outlines are said out loud, because that is a thing done to
            // the glyph beyond joining its edges.
            text: said(outcome),
            refused: false,
          });
        }}
      >
        <OverlapIcon />
      </button>

      {(["subtract", "intersect", "exclude"] as const).map((operation) => (
        <button
          key={operation}
          type="button"
          className={styles.tool}
          // Nothing selected means there is no tool, and these are the operations
          // that need one. Disabled rather than hidden: a control that comes and
          // goes is a control nobody finds twice.
          disabled={reading || !chosen}
          title={
            reading
              ? "Another tab is saving this project"
              : chosen
                ? TITLES[operation]
                : `${TITLES[operation]} — select the shape first`
          }
          aria-label={NAMES[operation]}
          onClick={() => {
            const editor = store.editor;
            const tool = selectedContourIds(editor);
            if (tool === null) return;

            const { outcome, result } = combineAt(editor, editor.currentGlyph, operation, tool);
            const text = reported(outcome);
            if (typeof outcome !== "string") store.applyTool(result);
            setNote({ text, refused: typeof outcome === "string" && outcome !== "apart" });
          }}
        >
          {ICONS[operation]()}
        </button>
      ))}

      {note === null ? null : (
        <span className={styles.note} data-refused={note.refused} role="status">
          {note.text}
        </span>
      )}
    </>
  );
}
