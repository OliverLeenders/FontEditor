import { useEffect, useRef, useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./Snapshots.module.css";
import open from "./OpenFont.module.css";
import { CameraIcon, HistoryIcon, RotateCcwIcon } from "./icons.js";

/**
 * The copies of the font kept beside it, and the way back to one.
 *
 * Undo is a session's memory: it dies with the tab, and it is no help at all
 * when what went wrong went wrong an hour ago or in another window. The editor
 * keeps a copy of the whole font every few minutes of work, and one before
 * anything that replaces the font wholesale, and this is where they are.
 *
 * Restoring keeps a copy of what is open first, so it is itself something to
 * come back from. That is the only reason the button can be pressed without
 * ceremony.
 */
export function Snapshots(): React.JSX.Element {
  const store = useEditorStore();
  const entries = useStoreValue((s) => s.snapshots);
  const reading = useStoreValue((s) => s.ownership === "reading");

  const [open_, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // The list is read from disk when it is about to be looked at: nothing else
  // shows it, and watching it would mean a message per copy for no reader.
  useEffect(() => {
    if (!open_) return;
    void store.refreshSnapshots();
  }, [open_, store]);

  useEffect(() => {
    if (!open_) return;

    const onDown = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open_]);

  const restore = async (at: number): Promise<void> => {
    setBusy(true);
    setSaid(null);
    try {
      const done = await store.restoreSnapshot(at);
      setSaid(
        done === null
          ? "That copy has gone."
          : `Restored ${String(done.glyphs)} glyphs${
              done.problems.length === 0 ? "" : `, ${String(done.problems.length)} unreadable`
            }.`,
      );
    } catch (error) {
      setSaid(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.holder} ref={ref}>
      <button
        type="button"
        className={open.button}
        aria-expanded={open_}
        title="Copies of the whole font, kept as you work"
        onClick={() => setOpen(!open_)}
      >
        <HistoryIcon />
        History
      </button>

      {open_ ? (
        <div className={styles.panel} role="group" aria-label="Snapshots">
          <div className={styles.head}>
            <span>Copies of this font</span>
            <button
              type="button"
              className={styles.keep}
              disabled={busy || reading}
              title={reading ? "Another tab is saving this project" : "Keep one now"}
              onClick={() => void store.snapshot()}
            >
              <CameraIcon />
              Keep one now
            </button>
          </div>

          {entries.length === 0 ? (
            <p className={styles.empty}>
              None yet. One is kept every few minutes of work, and before anything that replaces the
              font.
            </p>
          ) : (
            <ul className={styles.list}>
              {entries.map((entry) => (
                <li key={entry.at} className={styles.row}>
                  <span className={styles.when}>{when(entry.at)}</span>
                  <span className={styles.size}>{entry.glyphs} glyphs</span>
                  <button
                    type="button"
                    className={styles.restore}
                    disabled={busy || reading}
                    title={
                      reading
                        ? "Another tab is saving this project"
                        : "Put this copy back, keeping the one that is open"
                    }
                    onClick={() => void restore(entry.at)}
                  >
                    <RotateCcwIcon />
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}

          {said === null ? null : <p className={styles.said}>{said}</p>}
        </div>
      ) : null}
    </div>
  );
}

/**
 * When a copy was kept, said the way someone looking for one thinks of it.
 *
 * "Twelve minutes ago" is the question being asked; the clock time is what
 * settles it when two copies are close together, so both are shown.
 */
function when(at: number): string {
  const ago = Math.max(0, Date.now() - at);
  const minutes = Math.round(ago / 60000);

  const clock = new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (minutes < 1) return `just now · ${clock}`;
  if (minutes < 60) return `${String(minutes)} min ago · ${clock}`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)} h ago · ${clock}`;
  return new Date(at).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
