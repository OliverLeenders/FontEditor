import { measureAngle } from "@fonteditor/font-model";
import { shownMeasurement } from "@fonteditor/tools";

import { useStoreValue } from "../useStore.js";
import styles from "./StatusBar.module.css";

/**
 * A quiet line of facts: what is selected, what is saved, what went wrong.
 *
 * The editing facts are shown only while editing. A selection count and a hint
 * about dragging Tunni points are not merely useless in the glyph browser, they
 * are wrong — they describe a canvas that is not on screen.
 */
export function StatusBar({ workspace }: { workspace: "glyph" | "font" }): JSX.Element {
  const selection = useStoreValue((s) => s.session.editor.selection.length);
  const tool = useStoreValue((s) => s.session.editor.activeTool);
  const saveStatus = useStoreValue((s) => s.saveStatus);
  const storage = useStoreValue((s) => s.storage);
  const detail = useStoreValue((s) => s.storageDetail);
  const recovered = useStoreValue((s) => s.recovered);
  const glyphCount = useStoreValue((s) => s.session.editor.document.glyphOrder.length);

  // Three scalar selectors rather than one returning the measurement: it is a
  // fresh object every time, and comparing it by identity would re-render this
  // line on every store notification.
  const measured = useStoreValue((s) =>
    s.session.editor.activeTool === "measure"
      ? (shownMeasurement(s.session.editor)?.distance ?? null)
      : null,
  );
  const measuredAngle = useStoreValue((s) => {
    if (s.session.editor.activeTool !== "measure") return null;
    const m = shownMeasurement(s.session.editor);
    return m === null ? null : measureAngle(m);
  });
  const pinned = useStoreValue((s) => s.session.editor.measure !== null);

  const saved =
    storage === "unavailable"
      ? `not saving — ${detail}`
      : storage === "connecting"
        ? "connecting"
        : saveStatus === "idle"
          ? "saved"
          : saveStatus;

  const editing = workspace === "glyph";

  return (
    <div className={styles.bar}>
      <span>
        <b>{glyphCount}</b> glyphs
      </span>
      {editing ? (
        <span>
          <b>{selection}</b> selected
        </span>
      ) : null}
      {editing ? <span>{tool}</span> : null}
      {/* The number itself is on the canvas beside what it measures. What is
          here is what would clutter the drawing: the angle it was taken at, and
          whether it is following the pointer or has been pinned. */}
      {measured === null ? null : (
        <span className={styles.measure}>
          <b>{Math.round(measured * 10) / 10}</b> units at{" "}
          {Math.round((measuredAngle ?? 0) * 10) / 10}&deg;
          {pinned ? " · pinned" : null}
        </span>
      )}
      <span
        className={storage === "unavailable" || saveStatus === "failed" ? styles.warn : undefined}
      >
        {saved}
      </span>
      {recovered ? <span className={styles.warn}>recovered unsaved work</span> : null}
      <span className={styles.hints}>
        {editing
          ? "drag the Tunni point · double-click it to balance · space previews · ctrl-0 fits"
          : "double-click a glyph to edit it · arrow keys move · enter opens · delete removes"}
      </span>
    </div>
  );
}
