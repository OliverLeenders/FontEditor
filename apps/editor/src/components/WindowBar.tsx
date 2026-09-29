import { useEffect, useRef, useState } from "react";

import type { ThemeChoice } from "../preferences.js";
import { unsaved } from "../store/index.js";
import { useEditorStore, useStoreValue } from "../useStore.js";
import { VERSION } from "../version.js";
import styles from "./WindowBar.module.css";
import { CircleDotIcon, SettingsIcon } from "./icons.js";
import { UndoHistory } from "./UndoHistory.js";

/**
 * The strip along the top of the window: what is open, and the preferences.
 *
 * Outside the panes, which is the whole point of it. A pane's own bars belong
 * to a pane and a split window has two of each, so anything true of the
 * application had nowhere to live and ended up in the drawing toolbar — where
 * the theme, which is a fact about the room you are sitting in, was reached
 * through a button that only exists while a glyph is open, and twice over in a
 * split window.
 *
 * The name of the font is here for the same reason: it was visible only in the
 * Font workspace, so a window showing a drawing beside a proof never said which
 * font it was drawing.
 */
const THEMES: readonly { readonly id: ThemeChoice; readonly label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export function WindowBar({
  historyOpen,
  onHistory,
  onOpenGlyph,
}: {
  /** Whether the undo history is open: held by the window, which Ctrl-Shift-H reaches. */
  readonly historyOpen: boolean;
  readonly onHistory: (open: boolean) => void;
  readonly onOpenGlyph: (name: string) => void;
}): React.JSX.Element {
  const store = useEditorStore();
  const family = useStoreValue((s) => s.session.editor.document.info.familyName);
  const style = useStoreValue((s) => s.session.editor.document.info.styleName);
  const theme = useStoreValue((s) => s.theme);
  // Where the font is kept, which is the question saving asks: said here, on
  // every screen, rather than only in the File menu.
  const folder = useStoreValue((s) => s.folder.name);
  const dirty = useStoreValue((s) => unsaved(s.folder, s.session.editor.document));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Closed by a press anywhere else or by Escape, as the pane's own menu is.
  useEffect(() => {
    if (!open) return;

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
  }, [open]);

  // Ctrl-, the way every other application opens its preferences. Caught on the
  // window rather than on the button, since the button is not where anybody's
  // hands are when they reach for it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "," || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      setOpen((was) => !was);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className={styles.bar}>
      <span className={styles.name}>
        {family}
        {style === "" ? "" : ` ${style}`}
        <span
          className={styles.where}
          title={
            folder === null
              ? "Kept only in this browser until it is saved to a folder (Ctrl-S)"
              : dirty
                ? `Kept in ${folder}; changes not yet saved there (Ctrl-S)`
                : `Kept in ${folder}`
          }
        >
          {" · "}
          {folder ?? "not saved to disk"}
          {folder !== null && dirty ? (
            <span className={styles.dirty} aria-label="unsaved changes">
              <CircleDotIcon />
            </span>
          ) : null}
        </span>
      </span>

      <div className={styles.tools}>
        <UndoHistory open={historyOpen} onOpen={onHistory} onOpenGlyph={onOpenGlyph} />
        <div className={styles.holder} ref={ref}>
          <button
            type="button"
            className={styles.button}
            aria-expanded={open}
            aria-label="Preferences"
            title="Preferences  (Ctrl-,)"
            onClick={() => setOpen((was) => !was)}
          >
            <SettingsIcon />
          </button>

          {open ? (
            <div className={styles.panel} role="group" aria-label="Preferences">
              <div className={styles.row}>
                <span className={styles.label}>Theme</span>
                <div className={styles.choices} role="group" aria-label="Theme">
                  {THEMES.map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      className={styles.choice}
                      aria-pressed={theme === choice.id}
                      onClick={() => store.setTheme(choice.id)}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Which editor this is. Not decoration: a bug report begins with
                the version, and until now the only way to know it was to look
                at where the installer came from. */}
              <div className={styles.row}>
                <span className={styles.label}>Version</span>
                <span className={styles.version}>Typewright {VERSION}</span>
              </div>

              <div className={styles.footer}>
                <span className={styles.note}>
                  Kept in this browser, not in the font. What each canvas shows is in its own View
                  menu.
                </span>
                <button
                  type="button"
                  className={styles.reset}
                  onClick={() => store.setTheme("system")}
                >
                  Reset
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
