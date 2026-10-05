import { type HistoryEntry, glyphsChanged } from "@typewright/edit-core";
import { useEffect, useRef } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./UndoHistory.module.css";
import { UndoIcon } from "./icons.js";

/**
 * Every step undo can take back, and every step redo can put back, as a list:
 * press one to go straight there.
 *
 * Undo is a line walked one step at a time, which is right for the last slip
 * and wrong for "before I started on the bowls" — twenty presses of Ctrl-Z with
 * nothing to say where each one landed. Here the steps are named, each with the
 * glyph it changed and how long ago, newest at the top as they are in every
 * editor's history. The steps undone stay in the list, fainter, until the next
 * edit discards them, which is when redo would lose them too.
 *
 * In the window's own bar rather than a pane's, since the history is the
 * font's: a width set on the spacing line and a rule typed in the feature file
 * are steps of the same list as a point moved in the drawing. Going to a step
 * that changed another glyph than the open one opens that glyph, so what the
 * step did is on screen.
 */

/** How long ago, in the fewest characters that say it. */
export function ago(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 10) return "now";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

/** The glyphs a step changed, as a row has room for: the first, and how many more. */
export function glyphsSaid(entry: HistoryEntry): string {
  const names = glyphsChanged(entry);
  if (names.length === 0) return "";
  return names.length === 1 ? names[0]! : `${names[0]!} +${names.length - 1}`;
}

export function UndoHistory({
  open,
  onOpen,
  onOpenGlyph,
}: {
  readonly open: boolean;
  readonly onOpen: (open: boolean) => void;
  /** Opens a glyph a step changed, the way the window opens one from elsewhere. */
  readonly onOpenGlyph: (name: string) => void;
}): React.JSX.Element {
  const store = useEditorStore();
  const history = useStoreValue((s) => s.session.history);
  const busy = useStoreValue((s) => s.session.pending !== null);
  const ref = useRef<HTMLDivElement>(null);
  const here = useRef<HTMLButtonElement>(null);

  // Closed by a press anywhere else or by Escape, as the preferences are.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onOpen(false);
    };
    // Escape closes the list and goes no further: opened by its key from the
    // canvas, the canvas still has the keyboard and would drop the selection.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, onOpen]);

  // Opened on where the font is now, which in a long history is not the top.
  useEffect(() => {
    if (open) here.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  /**
   * Go to the state after `index` steps. The step that made that state is the
   * one whose glyph is opened — or, for the state before the first step, the
   * first step, which is what going there takes back.
   */
  const goTo = (index: number): void => {
    // The glyph on screen before going there, which is what says whether the
    // step's own glyph still has to be opened.
    const was = store.editor.currentGlyph;
    store.goToStep(index);
    const entry = history.entries[Math.max(0, index - 1)];
    if (entry === undefined) return;
    // Of the glyphs the step changed, the ones the font has where it now
    // stands: a step that made a glyph changed it, and gone back past, there
    // is no such glyph to open.
    const document = store.editor.document;
    const names = glyphsChanged(entry).filter((name) => document.glyphs[name] !== undefined);
    if (names.length > 0 && !names.includes(was)) onOpenGlyph(names[0]!);
  };

  const now = Date.now();
  const rows = history.entries.map((entry, i) => ({ entry, index: i + 1 })).reverse();
  // A stack at its limit has let its oldest steps go, so its bottom is not the
  // font as it was opened.
  const trimmed = history.entries.length >= history.limit;

  return (
    <div className={styles.holder} ref={ref}>
      <button
        type="button"
        className={styles.button}
        aria-expanded={open}
        aria-label="Undo history"
        title="Undo history  (Ctrl-Shift-H)"
        onClick={() => onOpen(!open)}
      >
        <UndoIcon />
      </button>

      {open ? (
        <div className={styles.panel} role="group" aria-label="Undo history">
          <div className={styles.head}>Undo history</div>
          {history.entries.length === 0 ? (
            <p className={styles.empty}>Nothing to undo yet.</p>
          ) : (
            <ol className={styles.list}>
              {rows.map(({ entry, index }) => (
                <li key={index}>
                  <button
                    type="button"
                    ref={index === history.index ? here : undefined}
                    className={styles.row}
                    data-undone={index > history.index ? "true" : undefined}
                    aria-current={index === history.index ? "step" : undefined}
                    disabled={busy}
                    onClick={() => goTo(index)}
                  >
                    <span className={styles.label}>{entry.label}</span>
                    <span className={styles.glyph}>{glyphsSaid(entry)}</span>
                    <span className={styles.when}>{ago(entry.at, now)}</span>
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  ref={history.index === 0 ? here : undefined}
                  className={`${styles.row} ${styles.start}`}
                  aria-current={history.index === 0 ? "step" : undefined}
                  disabled={busy}
                  onClick={() => goTo(0)}
                >
                  <span className={styles.label}>
                    {trimmed ? "Before the oldest step kept" : "As opened"}
                  </span>
                </button>
              </li>
            </ol>
          )}
          <p className={styles.note}>
            The last {history.limit} steps, while this font is open. Copies of the whole font are
            under History in the Font workspace.
          </p>
        </div>
      ) : null}
    </div>
  );
}
