import { useEffect, useRef, useState } from "react";

import { desktop } from "../desktop.js";
import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./CloseWarning.module.css";

/**
 * Asked when the desktop window is about to close with a folder behind.
 *
 * The browser has its own dialog for this, shown from `beforeunload`, and its
 * words are its own. The desktop window has none: closing it tears the page
 * down without asking, so the window holds the request and hands it here.
 *
 * What it asks is narrow on purpose. Nothing is about to be lost — the working
 * copy has everything — so it does not say so. What is behind is the UFO folder
 * other tools read, and that is the only thing the three answers are about.
 */
export function CloseWarning(): React.JSX.Element | null {
  const store = useEditorStore();
  const folder = useStoreValue((s) => s.folder.name);
  const family = useStoreValue((s) => s.session.editor.document.info.familyName);

  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const saveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const host = desktop();
    if (host === null) return;

    const onRequest = (): void => {
      void (async () => {
        // The working copy first, whatever happens next: this may be the last
        // moment there is a page to write it from.
        await store.flushNow();
        if (store.unsavedOnDisk) {
          setAsking(true);
          return;
        }
        await host.invoke("close_window");
      })();
    };

    window.addEventListener("typewright:close-requested", onRequest);
    return () => {
      window.removeEventListener("typewright:close-requested", onRequest);
    };
  }, [store]);

  useEffect(() => {
    if (asking) saveRef.current?.focus();
  }, [asking]);

  if (!asking) return null;

  const close = async (): Promise<void> => {
    await desktop()?.invoke("close_window");
  };

  const stay = (): void => {
    setAsking(false);
    setFailed(null);
    void desktop()?.invoke("keep_window_open");
  };

  const saveAndClose = async (): Promise<void> => {
    setBusy(true);
    setFailed(null);
    try {
      await store.saveFolder();
      await close();
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  const name = family.trim() === "" ? "This font" : family;

  return (
    <div
      className={styles.veil}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) stay();
      }}
    >
      <div
        className={styles.card}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="close-warning-title"
        aria-describedby="close-warning-body"
      >
        <h2 id="close-warning-title" className={styles.title}>
          Save to {folder} before closing?
        </h2>
        <p id="close-warning-body" className={styles.body}>
          {name} has changes that are not in {folder} yet. They are kept in Typewright either way —
          this is about the folder other tools read.
        </p>
        {failed === null ? null : (
          <p className={styles.failed} role="alert">
            {failed}
          </p>
        )}
        <div className={styles.actions}>
          <button
            ref={saveRef}
            type="button"
            className={`${styles.button} ${styles.primary}`}
            disabled={busy}
            onClick={() => {
              void saveAndClose();
            }}
          >
            {busy ? "Saving…" : "Save and close"}
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={busy}
            onClick={() => {
              void close();
            }}
          >
            Close without saving
          </button>
          <button type="button" className={styles.button} disabled={busy} onClick={stay}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
