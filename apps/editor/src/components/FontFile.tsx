import { canOpenFolders } from "@fonteditor/disk";
import { useEffect, useState } from "react";

import { unsaved } from "../store/index.js";
import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./FontFile.module.css";
import open from "./OpenFont.module.css";

/**
 * The font's own file: a UFO folder on the user's disk.
 *
 * Distinct from Open and Export beside it, and the distinction is the point.
 * Those move a copy — a font read out of a file, an archive written to the
 * downloads folder — and nothing connects the two afterwards. This is the file
 * the work *lives in*: opened once, saved back to the same place, and
 * remembered so the next session starts where this one left off.
 *
 * Saving is always a decision. The working store autosaves and the snapshots
 * accumulate, so nothing is riding on this button; what it does is put the work
 * somewhere other tools can read, which is exactly the kind of thing that
 * should happen when a person says so.
 */
export function FontFile(): React.JSX.Element | null {
  const store = useEditorStore();
  const folder = useStoreValue((s) => s.folder);
  const dirty = useStoreValue((s) => unsaved(s.folder.saved, s.session.editor.document));
  const reading = useStoreValue((s) => s.ownership === "reading");

  const [said, setSaid] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const supported = canOpenFolders();

  // Which folder this editor was working in last time. Only the name: opening it
  // would replace the font just recovered from the working store, and that is a
  // click, not a side effect of starting up.
  useEffect(() => {
    if (!supported) return;
    void store.noteRememberedFolder();
  }, [store, supported]);

  const attempt = async (run: () => Promise<string | null>): Promise<void> => {
    setFailed(null);
    try {
      const message = await run();
      if (message !== null) setSaid(message);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
    }
  };

  const save = (): Promise<void> =>
    attempt(async () => {
      const done = folder.name === null ? await store.saveFolderAs() : await store.saveFolder();
      if (done === null) return null;
      const removed = done.removed === 0 ? "" : `, ${String(done.removed)} removed`;
      return `Saved ${String(done.written)} files to ${done.name}${removed}`;
    });

  // Ctrl-S lives here rather than with the other shortcuts because this is where
  // the answer can be shown. It saves wherever the button would — to the folder
  // if there is one, and otherwise by asking for one.
  useEffect(() => {
    if (!supported) return;

    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      // Saving the page is never what someone wants from a font editor.
      event.preventDefault();
      if (reading || folder.busy) return;
      void save();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  });

  if (!supported) return null;

  const openFolder = (): Promise<void> =>
    attempt(async () => {
      const done = await store.openFolder();
      return done === null ? null : reportOf(done);
    });

  const reopen = (): Promise<void> =>
    attempt(async () => {
      const done = await store.reopenFolder();
      return done === null ? null : reportOf(done);
    });

  const saveAs = (): Promise<void> =>
    attempt(async () => {
      const done = await store.saveFolderAs();
      return done === null ? null : `Saved ${String(done.written)} files to ${done.name}`;
    });

  return (
    <div className={styles.holder}>
      <button
        type="button"
        className={open.button}
        disabled={folder.busy || reading}
        title="Open a .ufo folder from your disk and work in it"
        onClick={() => void openFolder()}
      >
        Open folder…
      </button>

      {folder.name === null && folder.remembered !== null ? (
        <button
          type="button"
          className={open.button}
          disabled={folder.busy || reading}
          title="Open the folder this editor was last working in"
          onClick={() => void reopen()}
        >
          Reopen {folder.remembered}
        </button>
      ) : null}

      {folder.name === null ? null : (
        <>
          <button
            type="button"
            className={open.button}
            disabled={folder.busy || reading || !dirty}
            title={dirty ? `Write the font back to ${folder.name}` : "Nothing has changed"}
            onClick={() => void save()}
          >
            {folder.busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className={open.button}
            disabled={folder.busy || reading}
            title="Write the font to another folder, and work there from now on"
            onClick={() => void saveAs()}
          >
            Save as…
          </button>
          <span className={styles.where} title={`The font is kept in ${folder.name}`}>
            {folder.name}
            <span className={dirty ? styles.dirty : styles.clean}>
              {dirty ? " · unsaved changes" : since(folder.savedAt)}
            </span>
          </span>
        </>
      )}

      {failed !== null ? (
        <span className={styles.error} role="alert">
          {failed}
        </span>
      ) : null}
      {failed === null && said !== null ? <span className={styles.note}>{said}</span> : null}
    </div>
  );
}

function reportOf(done: {
  name: string;
  family: string;
  glyphs: number;
  warnings: readonly string[];
}): string {
  const warnings =
    done.warnings.length === 0
      ? ""
      : ` · ${String(done.warnings.length)} warning${done.warnings.length === 1 ? "" : "s"}`;
  return `${done.family} · ${String(done.glyphs)} glyphs from ${done.name}${warnings}`;
}

/** How long ago the font was written to its folder, said briefly. */
function since(at: number | null): string {
  if (at === null) return " · as opened";
  const minutes = Math.round(Math.max(0, Date.now() - at) / 60000);
  if (minutes < 1) return " · saved";
  if (minutes < 60) return ` · saved ${String(minutes)} min ago`;
  return ` · saved ${String(Math.round(minutes / 60))} h ago`;
}
