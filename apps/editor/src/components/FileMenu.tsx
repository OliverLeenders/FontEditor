import { canOpenFolders } from "@typewright/disk";
import { useEffect, useRef, useState } from "react";

import { unsaved } from "../store/index.js";
import { useEditorStore, useStoreValue } from "../useStore.js";
import { BarMenu } from "./BarMenu.js";
import menu from "./BarMenu.module.css";
import type { Item } from "./MenuItems.js";
import styles from "./OpenFont.module.css";
import {
  CircleDotIcon,
  FilePlusIcon,
  FolderClockIcon,
  FolderOpenIcon,
  FolderOutputIcon,
  SaveIcon,
  TriangleAlertIcon,
  UploadIcon,
} from "./icons.js";

/**
 * The font as a file: opening one, starting one, and writing this one down.
 *
 * Five buttons and a status line used to sit in the bar for this, next to five
 * more for export and six panels — a row of sixteen things with no order to
 * them. They are one menu now, because they are one subject, and because a
 * person opens a font once a session and saves it a few times an hour: this is
 * not what the bar's width is for.
 *
 * Three distinctions worth keeping while reading it. *Open font* reads a copy —
 * a binary or an archive — and nothing connects the two afterwards. *Open
 * folder* opens the file the work lives in, saved back to the same place and
 * remembered for next time. *Export* writes a copy out and is its own menu.
 */
export function FileMenu(): React.JSX.Element {
  const store = useEditorStore();
  const folder = useStoreValue((s) => s.folder);
  const dirty = useStoreValue((s) => unsaved(s.folder.saved, s.session.editor.document));
  const reading = useStoreValue((s) => s.ownership === "reading");

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const folders = canOpenFolders();

  /** Run something that can fail, and say what happened either way. */
  const attempt = async (run: () => Promise<string | null>): Promise<void> => {
    setFailed(null);
    setBusy(true);
    try {
      const message = await run();
      if (message !== null) setSaid(message);
    } catch (error) {
      setSaid(null);
      setFailed(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const read = (file: File): Promise<void> =>
    attempt(async () => {
      setSaid(`Reading ${file.name}…`);
      const done = await store.importFont(await file.arrayBuffer(), file.name);
      const warnings =
        done.warnings.length === 0
          ? ""
          : ` · ${String(done.warnings.length)} warning${done.warnings.length === 1 ? "" : "s"}`;
      return `${done.family} · ${String(done.glyphs)} glyphs${warnings}`;
    });

  const save = (): Promise<void> =>
    attempt(async () => {
      const done = folder.name === null ? await store.saveFolderAs() : await store.saveFolder();
      if (done === null) return null;
      const removed = done.removed === 0 ? "" : `, ${String(done.removed)} removed`;
      return `Saved ${String(done.written)} files to ${done.name}${removed}`;
    });

  // Ctrl-S lives here rather than with the other shortcuts because this is
  // where the answer can be shown. It saves wherever the menu item would — to
  // the folder if there is one, and otherwise by asking for one.
  useEffect(() => {
    if (!folders) return;

    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      // Saving the page is never what someone wants from a font editor.
      event.preventDefault();
      if (reading || folder.busy || busy) return;
      void save();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  });

  const working = busy || folder.busy || reading;

  const items: Item[] = [
    {
      kind: "item",
      label: "New font…",
      icon: FilePlusIcon,
      disabled: working,
      run: () => setAsking(true),
    },
    {
      kind: "item",
      label: "Open font…",
      icon: UploadIcon,
      disabled: working,
      run: () => inputRef.current?.click(),
    },
  ];

  items.push({ kind: "separator" });
  items.push({
    kind: "item",
    label: "Fonts…",
    icon: FolderClockIcon,
    note: "switch between the fonts you have open",
    disabled: working,
    run: () => {
      store.showProjects(true);
    },
  });

  if (folders) {
    items.push({ kind: "separator" });
    items.push({
      kind: "item",
      label: "Open folder…",
      icon: FolderOpenIcon,
      disabled: working,
      run: () =>
        void attempt(async () => {
          const done = await store.openFolder();
          return done === null ? null : reportOf(done);
        }),
    });

    // Read the folder again, throwing away what is in the editor for what is on
    // disk. Not the same as opening it: the folder is already open, and the
    // reason to do this is that something else has changed it — a pull, another
    // tool, an edit by hand — which is precisely when there is no picker to go
    // through and nothing to pick.
    if (folder.name !== null) {
      items.push({
        kind: "item",
        label: `Re-read ${folder.name}`,
        icon: FolderClockIcon,
        note: "discards changes not saved to it",
        disabled: working,
        run: () =>
          void attempt(async () => {
            const done = await store.reopenFolder();
            return done === null ? null : reportOf(done);
          }),
      });
    }

    items.push({ kind: "separator" });
    items.push({
      kind: "item",
      label: folder.name === null ? "Save to a folder…" : "Save",
      icon: SaveIcon,
      note: "Ctrl-S",
      disabled: working || (folder.name !== null && !dirty),
      run: () => void save(),
    });
    items.push({
      kind: "item",
      label: "Save as…",
      icon: FolderOutputIcon,
      disabled: working,
      run: () =>
        void attempt(async () => {
          const done = await store.saveFolderAs();
          return done === null ? null : `Saved ${String(done.written)} files to ${done.name}`;
        }),
    });
  }

  return (
    <div
      className={dragging ? `${styles.zone} ${styles.dragging}` : styles.zone}
      onDragOver={(event) => {
        // Without preventDefault the browser navigates to the file, which
        // throws away the session.
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file !== undefined) void read(file);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className={styles.input}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) void read(file);
          // Cleared so choosing the same file twice fires a second change.
          event.target.value = "";
        }}
      />

      <BarMenu
        label="File"
        icon={FolderOpenIcon}
        title="Open, start, and save this font"
        panelLabel="File"
        items={items}
        // Unsaved is the one thing here that must not hide behind a fold: it is
        // the state a person needs to see rather than to go looking for.
        badge={
          dirty && folder.name !== null ? (
            <span className={styles.dirtyMark} title={`Not yet written to ${folder.name}`}>
              <CircleDotIcon />
            </span>
          ) : undefined
        }
      >
        {folder.name === null ? null : (
          <p className={menu.footer}>
            <strong>{folder.name}</strong>
            {dirty ? "unsaved changes" : since(folder.savedAt)}
          </p>
        )}
      </BarMenu>

      {/* Discarding a font is not undoable — new and import both replace the
          history rather than extend it — so it asks first, and asks in place
          rather than through a `window.confirm` nobody reads. */}
      {asking ? (
        <span className={styles.confirm} role="group" aria-label="Discard this font?">
          <span className={styles.note}>
            <TriangleAlertIcon />
            Discard this font?
          </span>
          <button
            type="button"
            className={`${styles.button} ${styles.danger}`}
            autoFocus
            onClick={() => {
              setAsking(false);
              void attempt(async () => {
                await store.newFont();
                return "Started a new font";
              });
            }}
          >
            Discard
          </button>
          <button type="button" className={styles.button} onClick={() => setAsking(false)}>
            Keep
          </button>
        </span>
      ) : null}

      {failed !== null ? (
        <span className={styles.error} role="alert">
          {failed}
        </span>
      ) : null}
      {failed === null && said !== null ? (
        <span className={styles.note} role="status">
          {said}
        </span>
      ) : null}
    </div>
  );
}

/**
 * What the picker offers: the binary formats, a zipped UFO, and a family.
 *
 * `.zip` has to be in the list for either of the last two to be selectable at
 * all, which does mean the picker will show archives that are not fonts. The
 * alternative is a button per format, and a wrong file is answered immediately
 * by the reader rather than being a state anyone gets stuck in.
 */
const ACCEPT = ".ttf,.otf,.woff,.ufoz,.zip,font/ttf,font/otf,font/woff";

/** What opening a folder found, said in one line. */
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

/** How long ago the font was written, for the line under the menu. */
function since(at: number | null): string {
  // Nothing has been written yet, which is not the same as being out of date:
  // what is on disk is exactly what was opened.
  if (at === null) return "as opened";

  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return "saved just now";
  if (minutes < 60) return `saved ${String(minutes)} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `saved ${String(hours)} h ago`;
  return `saved ${new Date(at).toLocaleDateString()}`;
}
