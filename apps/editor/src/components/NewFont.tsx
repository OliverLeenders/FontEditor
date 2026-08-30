import { useEffect, useRef, useState } from "react";

import { useEditorStore } from "../useStore.js";
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
export function NewFont(): JSX.Element {
  const store = useEditorStore();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
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
      <button
        type="button"
        className={styles.button}
        disabled={busy}
        onClick={() => setAsking(true)}
      >
        New font
      </button>
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
          void store.newFont().finally(() => setBusy(false));
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
