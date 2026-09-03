import { useEffect, useRef, useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./OpenFont.module.css";

/**
 * "New font", with the confirmation it needs.
 *
 * Discarding a font is not undoable — import and new both replace the history
 * rather than extend it — so it asks first. The question is asked in place
 * rather than through `window.confirm`, which blocks the page, cannot be styled,
 * and is the kind of dialog people dismiss without reading.
 *
 * The confirmation withdraws itself on Escape or on a click elsewhere, so a
 * mis-click leaves nothing armed and waiting.
 */
export function NewFont(): React.JSX.Element {
  const store = useEditorStore();
  const reading = useStoreValue((s) => s.ownership === "reading");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!asking) return;

    const onDown = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) setAsking(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setAsking(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [asking]);

  if (!asking) {
    return (
      <>
        <button
          type="button"
          className={styles.button}
          disabled={busy || reading}
          title={reading ? "Another tab is saving this project" : undefined}
          onClick={() => {
            setFailed(null);
            setAsking(true);
          }}
        >
          {busy ? "Starting…" : "New font"}
        </button>
        {/* A write that failed must say so. The document on screen has already
            been replaced, so silence would leave the editor showing an empty
            font while the old one is still on disk, waiting to come back. */}
        {failed !== null ? (
          <span className={styles.error} role="alert">
            {failed}
          </span>
        ) : null}
      </>
    );
  }

  return (
    <div ref={ref} className={styles.confirm} role="group" aria-label="Discard this font?">
      <span className={styles.note}>Discard this font?</span>
      <button
        type="button"
        className={`${styles.button} ${styles.danger}`}
        autoFocus
        onClick={() => {
          setAsking(false);
          setBusy(true);
          setFailed(null);
          store
            .newFont()
            .catch((error: unknown) =>
              setFailed(
                `Could not start a new font: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        Discard
      </button>
      <button type="button" className={styles.button} onClick={() => setAsking(false)}>
        Keep
      </button>
    </div>
  );
}
