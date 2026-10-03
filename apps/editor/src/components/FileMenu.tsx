import { ufoFolderName } from "@typewright/font-io";
import { canOpenFolders } from "@typewright/disk";
import { useRef, useState } from "react";

import { desktop } from "../desktop.js";
import { areSvgFiles, readSvgFiles } from "../svgImport.js";
import { familyStemOf } from "../store/family-folder.js";
import { keptAsFamily } from "../store/folder.js";
import { unsaved } from "../store/index.js";
import { useEditorStore, useStoreValue } from "../useStore.js";
import { openWindow } from "../windows.js";
import { BarMenu } from "./BarMenu.js";
import menu from "./BarMenu.module.css";
import type { Item } from "./MenuItems.js";
import styles from "./OpenFont.module.css";
import {
  AppWindowIcon,
  CircleDotIcon,
  FilePlusIcon,
  FolderClockIcon,
  FolderOpenIcon,
  FolderOutputIcon,
  ImageIcon,
  SaveIcon,
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
 * Three distinctions worth keeping while reading it. *Import font file* reads
 * a copy — a binary or an archive — as a new font, and nothing connects the two
 * afterwards. *Open UFO folder* opens the file the work lives in, saved back to
 * the same place and remembered for next time. *Export* writes a copy out and
 * is its own menu.
 */
export function FileMenu(): React.JSX.Element {
  const store = useEditorStore();
  const folder = useStoreValue((s) => s.folder);
  const dirty = useStoreValue((s) => unsaved(s.folder, s.session.editor.document));
  const reading = useStoreValue((s) => s.ownership === "reading");
  // A font drawn more than once is kept as a family: a designspace and a UFO
  // for each master, in a folder of their own.
  const family = useStoreValue((s) => keptAsFamily(s));

  const inputRef = useRef<HTMLInputElement>(null);
  const svgInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

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

  /**
   * SVG files as glyphs, added to the font that is open rather than replacing
   * it. What came of it is said in the status bar, where it is said for a drop
   * on the grid too, so this line is cleared rather than saying it twice.
   */
  const readSvgs = (files: readonly File[]): Promise<void> =>
    attempt(async () => {
      store.importSvgs(await readSvgFiles(files));
      setSaid(null);
      return null;
    });

  // The same instruction as Ctrl-S, through the same store method: the shortcut
  // itself lives on the window in `App`, because this component is mounted only
  // in the font view and the key has to work in every workspace.
  const save = (): Promise<void> =>
    attempt(async () => {
      const done = await store.saveToFolder();
      return done === null ? null : savedSays(done);
    });

  const working = busy || folder.busy || reading;

  /*
   * Four groups, each named for what happens to files. The fonts kept in this
   * browser: a new one, or another of them. A font from outside: a UFO folder,
   * which is worked on where it is and saved back to; a font file, which is
   * read in as a copy; SVG files, which become glyphs. Saving to a folder. And
   * another window.
   *
   * The names used to be "New font…", "Open font…", "Fonts…" and "Open
   * folder…": four ways to a font, none saying how they differed — which ones
   * kept the font that was open, and which one wrote back to what it opened.
   */
  const items: Item[] = [
    {
      kind: "item",
      label: "New font",
      icon: FilePlusIcon,
      // A font of its own, beside this one: this one stays on the list of
      // fonts, so starting another throws nothing away and asks nothing.
      hint: "Start another font. This one stays in this browser, under Switch font",
      disabled: working,
      run: () => void store.startProject(),
    },
    {
      kind: "item",
      label: "Switch font…",
      icon: FolderClockIcon,
      hint: "The fonts kept in this browser: open another, or forget one",
      disabled: working,
      run: () => {
        store.showProjects(true);
      },
    },
    { kind: "separator" },
  ];

  if (folders) {
    items.push({
      kind: "item",
      label: "Open UFO folder…",
      icon: FolderOpenIcon,
      hint: "A font's .ufo, or a family's folder with its designspace: worked on where it is, and saved back to",
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
        hint: folder.family
          ? `Read ${folder.name} from disk again, every master of it, discarding changes not saved to it`
          : `Read ${folder.name} from disk again, discarding changes not saved to it`,
        disabled: working,
        run: () =>
          void attempt(async () => {
            const done = await store.reopenFolder();
            return done === null ? null : reportOf(done);
          }),
      });
    }
  }

  items.push({
    kind: "item",
    label: "Import font file…",
    icon: UploadIcon,
    hint: "A TTF, OTF, WOFF, zipped UFO or family, opened as a new font. This one stays in this browser, under Switch font",
    disabled: working,
    run: () => inputRef.current?.click(),
  });
  items.push({
    kind: "item",
    label: "Import SVGs as glyphs…",
    icon: ImageIcon,
    hint: "A glyph for each SVG file, named for the file: an icon set, added to this font",
    disabled: working,
    run: () => svgInputRef.current?.click(),
  });

  if (folders) {
    // Saving names the file it makes: a font is kept on disk as a UFO of its own,
    // in whatever folder is picked to hold it.
    //
    // A family is kept as a folder of its own instead — its designspace and a
    // UFO for each master — and a font saved as one UFO that has since gained
    // a master has to be given one: the UFO it came from is one master's, and
    // a browser gives no way from a folder to the one it is in.
    const stem = familyStemOf(store.editor.document);
    const kept = family
      ? `a folder of its own, ${stem}/, with a designspace and a UFO for each master`
      : ufoFolderName(store.editor.document);
    // The folder a save goes to without asking, where there is one that can
    // take the font as it is now.
    const into = folder.name !== null && (!family || folder.family) ? folder.name : null;
    const placed = into !== null;
    items.push({ kind: "separator" });
    items.push({
      kind: "item",
      label: placed ? "Save" : "Save to folder…",
      icon: SaveIcon,
      keys: "Ctrl-S",
      hint: placed
        ? `Write the changes to ${into}`
        : folder.name === null
          ? `Choose a folder to keep this font in, as ${kept}`
          : `This font has more than one master now, and ${folder.name} is one master's. Choose a folder to keep the family in, as ${kept}`,
      disabled: working || (placed && !dirty),
      run: () => void save(),
    });
    items.push({
      kind: "item",
      label: "Save to another folder…",
      icon: FolderOutputIcon,
      hint: `Keep this font in another folder, as ${kept}, and work there from now on`,
      disabled: working,
      run: () =>
        void attempt(async () => {
          const done = await store.saveFolderAs();
          return done === null ? null : savedSays(done);
        }),
    });
  }

  items.push({ kind: "separator" });
  items.push({
    kind: "item",
    label: "Open another window",
    icon: AppWindowIcon,
    // A browser keeps Ctrl-Shift-N for a private window and never passes it on,
    // so only the desktop application has the key to offer.
    ...(desktop() === null ? {} : { keys: "Ctrl-Shift-N" }),
    hint: "Another window, on the list of fonts: for a second font beside this one",
    run: () => {
      openWindow("fonts");
    },
  });

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
        const dropped = [...event.dataTransfer.files];
        // Pictures are added to this font; anything else is a font to open.
        if (areSvgFiles(dropped)) void readSvgs(dropped);
        else if (dropped[0] !== undefined) void read(dropped[0]);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={FONT_FILES}
        className={styles.input}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) void read(file);
          // Cleared so choosing the same file twice fires a second change.
          event.target.value = "";
        }}
      />

      <input
        ref={svgInputRef}
        type="file"
        accept=".svg,image/svg+xml"
        multiple
        className={styles.input}
        onChange={(event) => {
          const picked = [...(event.target.files ?? [])];
          if (picked.length > 0) void readSvgs(picked);
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
 * What the picker offers: the binary formats, a zipped UFO, a family, and a
 * Macintosh font in a StuffIt archive.
 *
 * `.zip` has to be in the list for the middle two to be selectable at all,
 * which does mean the picker will show archives that are not fonts. The
 * alternative is a button per format, and a wrong file is answered immediately
 * by the reader rather than being a state anyone gets stuck in.
 */
export const FONT_FILES = ".ttf,.otf,.woff,.ufoz,.zip,.sit,font/ttf,font/otf,font/woff";

/**
 * What a save did, said in one line — and what it has to say besides: that a
 * font is kept as a family from now on, that a master's UFO was taken out. A
 * save says these once, and nowhere else.
 */
function savedSays(done: {
  name: string;
  written: number;
  removed: number;
  notes: readonly string[];
}): string {
  const removed = done.removed === 0 ? "" : `, ${String(done.removed)} removed`;
  const notes = done.notes.length === 0 ? "" : ` · ${done.notes.join(" · ")}`;
  return `Saved ${String(done.written)} files to ${done.name}${removed}${notes}`;
}

/** What opening a folder found, said in one line. */
function reportOf(done: {
  name: string;
  family: string;
  glyphs: number;
  warnings: readonly string[];
  master: string | null;
}): string {
  const warnings =
    done.warnings.length === 0
      ? ""
      : ` · ${String(done.warnings.length)} warning${done.warnings.length === 1 ? "" : "s"}`;
  // Said where it is so, since it is not what reading a folder used to do.
  const into =
    done.master === null ? "" : ` into ${done.master}; the other masters are as they were`;
  return `${done.family} · ${String(done.glyphs)} glyphs from ${done.name}${into}${warnings}`;
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
