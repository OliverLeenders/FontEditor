import { currentGlyph } from "@typewright/tools";
import { useRef, useState } from "react";

import { glyphsTracing } from "../store/images.js";
import { useEditorStore, useStoreValue } from "../useStore.js";
import { BarMenu } from "./BarMenu.js";
import styles from "./Tracing.module.css";
import { ImageIcon } from "./icons.js";

/** What the picker offers. Whatever a browser will decode, and nothing else. */
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif";

/**
 * The pictures this font is traced from.
 *
 * The list is of the *font's* pictures, not this glyph's, which is the whole
 * arrangement: one scan of an alphabet sheet is added once and every letter
 * traces from the same file. So each row says how many glyphs are using it, and
 * the button on it puts it behind the letter in front of you.
 *
 * Where it then sits is a separate question, answered by dragging on the canvas
 * or by the numbers in the inspector — and, for a sheet of many letters, by the
 * sheet view.
 */
export function Tracing(): React.JSX.Element {
  const store = useEditorStore();
  const images = useStoreValue((s) => s.images);
  const current = useStoreValue((s) => currentGlyph(s.session.editor)?.image ?? null);
  const glyph = useStoreValue((s) => s.session.editor.currentGlyph);
  const showing = useStoreValue((s) => s.showImage);
  const opacity = useStoreValue((s) => s.imageOpacity);
  const reading = useStoreValue((s) => s.ownership === "reading");
  const editor = useStoreValue((s) => s.session.editor);

  const [said, setSaid] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const add = async (file: File): Promise<void> => {
    setFailed(null);
    try {
      const done = await store.addImage(file);
      setSaid(
        `${done.name} · ${kilobytes(done.bytes)}${done.replaced ? " · replaced what was there" : ""}`,
      );
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <BarMenu
      label="Tracing"
      icon={ImageIcon}
      title="Pictures this font is traced from"
      panelClassName={styles.panel}
      panelLabel="Tracing"
      // Read when the panel is about to show them, as the history list is:
      // nothing else looks at this, and watching it would mean a message per
      // picture for no reader.
      onOpen={() => void store.refreshImages()}
    >
      <div className={styles.head}>
        <span>Pictures in this font</span>
        <button
          type="button"
          className={styles.add}
          disabled={reading}
          title={reading ? "Another tab is saving this project" : "Add a picture"}
          onClick={() => fileRef.current?.click()}
        >
          Add…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className={styles.file}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) void add(file);
            // Cleared so choosing the same file twice fires a second change.
            event.target.value = "";
          }}
        />
      </div>

      {/* How strongly it shows through, which changes several times an
              hour: heavy while finding the shape, faint while finishing it. */}
      <label className={styles.strength}>
        <input
          type="checkbox"
          checked={showing}
          onChange={() => store.toggleImage()}
          aria-label="Show the picture behind the glyph"
        />
        <span>Show</span>
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={opacity}
          disabled={!showing}
          aria-label="How strongly the picture shows through"
          onChange={(event) => store.setImageOpacity(Number(event.target.value))}
        />
        <span className={styles.percent}>{Math.round(opacity * 100)}%</span>
      </label>

      {images.length === 0 ? (
        <p className={styles.empty}>
          None yet. A scan of a whole alphabet is one picture: add it once, and put it behind each
          letter in turn.
        </p>
      ) : (
        <ul className={styles.list}>
          {images.map((entry) => {
            const using = glyphsTracing(editor, entry.name);
            const here = current?.name === entry.name;
            return (
              <li key={entry.name} className={styles.row} data-here={here ? "true" : undefined}>
                <span className={styles.name} title={entry.name}>
                  {entry.name}
                  {store.pictureBroken(entry.name) ? (
                    <span className={styles.broken}> · cannot be shown</span>
                  ) : null}
                </span>
                <span className={styles.count} title={using.join(" ")}>
                  {using.length === 0
                    ? "unused"
                    : `${String(using.length)} glyph${using.length === 1 ? "" : "s"}`}
                </span>
                <button
                  type="button"
                  className={styles.use}
                  disabled={reading}
                  title={here ? `Stop tracing ${glyph} from this` : `Trace ${glyph} from this`}
                  onClick={() => store.setImage(here ? null : entry.name)}
                >
                  {here ? "Remove" : "Use here"}
                </button>
                <button
                  type="button"
                  className={styles.drop}
                  disabled={reading}
                  title={`Take ${entry.name} out of the font${using.length === 0 ? "" : `, and out of ${String(using.length)} glyphs`}`}
                  aria-label={`Delete ${entry.name}`}
                  onClick={() => void store.removeImage(entry.name)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {failed !== null ? (
        <p className={styles.error} role="alert">
          {failed}
        </p>
      ) : null}
      {failed === null && said !== null ? <p className={styles.said}>{said}</p> : null}
    </BarMenu>
  );
}

/** A file size as somebody reads it, which is never in bytes past a thousand. */
function kilobytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
