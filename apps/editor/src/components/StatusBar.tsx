import { measureAngle } from "@fonteditor/font-model";
import { shownMeasurement } from "@fonteditor/tools";

import { measurableNeighbours } from "../scene.js";
import { useStoreValue } from "../useStore.js";
import styles from "./StatusBar.module.css";
import type { AutosaveStatus } from "@fonteditor/storage";

import type { StorageState } from "../store/index.js";
import type { ViewId } from "./TabBar.js";
import {
  CircleCheckIcon,
  CloudOffIcon,
  HistoryIcon,
  KeyboardIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
} from "./icons.js";

/**
 * A quiet line of facts: what is selected, what is saved, what went wrong.
 *
 * The editing facts are shown only while editing. A selection count and a hint
 * about dragging Tunni points are not merely useless in the glyph browser, they
 * are wrong — they describe a canvas that is not on screen. Which is why the
 * hint follows the workspace by name rather than by whether it is the glyph
 * one: every other workspace used to be told it was the glyph browser, and
 * offered to open a letter by double-clicking something that was not there.
 */
export function StatusBar({ workspace }: { workspace: ViewId }): React.JSX.Element {
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
      ? (shownMeasurement(s.session.editor, { neighbours: measurableNeighbours(s) })?.distance ??
        null)
      : null,
  );
  const measuredAngle = useStoreValue((s) => {
    if (s.session.editor.activeTool !== "measure") return null;
    const m = shownMeasurement(s.session.editor, { neighbours: measurableNeighbours(s) });
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
      {/* Saving is the one fact on this line somebody looks for rather than
          reads, so it is a shape before it is a word. */}
      <span
        className={`${styles.state} ${
          storage === "unavailable" || saveStatus === "failed" ? styles.warn : ""
        }`}
      >
        <SaveMark storage={storage} saveStatus={saveStatus} />
        {saved}
      </span>
      {recovered ? (
        <span className={`${styles.state} ${styles.warn}`}>
          <HistoryIcon />
          recovered unsaved work
        </span>
      ) : null}
      <span className={styles.hints}>
        {HINTS[workspace] === "" ? null : <KeyboardIcon />}
        {/* The words in their own box, because a flex row cannot put an
            ellipsis on a bare run of text. */}
        <span className={styles.hintText}>{HINTS[workspace]}</span>
      </span>
    </div>
  );
}

/**
 * What each workspace has to say for itself.
 *
 * Spacing, Features and Proof say nothing here: each carries its own line of
 * instructions where the work is, and a second set at the bottom of the window
 * would be either a repetition or a disagreement.
 */
const HINTS: Record<ViewId, string> = {
  glyph: "hold M to measure a stem · L lays a ruler across · space previews · ctrl-0 fits",
  font: "double-click a glyph to edit it · arrow keys move · enter opens · delete removes",
  spacing: "",
  features: "",
  proof: "",
};

/**
 * The saving state, drawn.
 *
 * Four states and four shapes: nothing is being kept, something is on its way,
 * something failed, everything is where it should be. The word beside it says
 * which, and this says at a glance whether to care.
 */
function SaveMark({
  storage,
  saveStatus,
}: {
  storage: StorageState;
  saveStatus: AutosaveStatus;
}): React.JSX.Element {
  if (storage === "unavailable") return <CloudOffIcon />;
  if (storage === "connecting" || saveStatus === "saving") return <LoaderCircleIcon />;
  if (saveStatus === "failed") return <TriangleAlertIcon />;
  return <CircleCheckIcon />;
}
