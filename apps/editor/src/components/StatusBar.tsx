import { useStoreValue } from "../useStore.js";
import styles from "./StatusBar.module.css";

/** A quiet line of facts: what is selected, what is saved, what went wrong. */
export function StatusBar(): JSX.Element {
  const selection = useStoreValue((s) => s.session.editor.selection.length);
  const tool = useStoreValue((s) => s.session.editor.activeTool);
  const saveStatus = useStoreValue((s) => s.saveStatus);
  const storage = useStoreValue((s) => s.storage);
  const detail = useStoreValue((s) => s.storageDetail);
  const recovered = useStoreValue((s) => s.recovered);
  const glyphCount = useStoreValue((s) => s.session.editor.document.glyphOrder.length);

  const saved =
    storage === "unavailable"
      ? `not saving — ${detail}`
      : storage === "connecting"
        ? "connecting"
        : saveStatus === "idle"
          ? "saved"
          : saveStatus;

  return (
    <div className={styles.bar}>
      <span><b>{glyphCount}</b> glyphs</span>
      <span><b>{selection}</b> selected</span>
      <span>{tool}</span>
      <span className={storage === "unavailable" || saveStatus === "failed" ? styles.warn : undefined}>
        {saved}
      </span>
      {recovered ? <span className={styles.warn}>recovered unsaved work</span> : null}
      <span className={styles.hints}>
        drag the Tunni point · double-click it to balance · space previews · ctrl-0 fits
      </span>
    </div>
  );
}
