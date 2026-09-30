import type { OffsetJoin } from "@typewright/font-model";
import { type ReshapeReport, offsetAt, selectedContourIds, simplifyAt } from "@typewright/tools";
import { useEffect, useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import { BarMenu } from "./BarMenu.js";
import { NumberField } from "./NumberField.js";
import { OffsetIcon, SparklesIcon } from "./icons.js";
import styles from "./Reshape.module.css";
import bar from "./Toolbar.module.css";

/** How long the result of the last one stays on screen. */
const NOTE_MS = 4000;

/**
 * How far the outline may move when points are taken out, as a fraction of the em.
 *
 * A thousandth: on a thousand-unit em that is one unit, which is a tenth of the
 * width of a hairline and a great deal less than the grid the font is rounded to
 * on the way out. It is not offered as a setting because nobody has an opinion
 * about it — what people have opinions about is whether the point was needed, and
 * the answer to that is the same at any of the numbers anybody would type.
 */
const SIMPLIFY_FRACTION = 1 / 1000;

/**
 * Offset and simplify: the two operations that change one outline rather than
 * combining two.
 *
 * Offset asks for numbers, so it opens a panel. Simplify does not, so it is a
 * button: it takes out the points the outline does not need, and the tolerance it
 * works to is a thousandth of the em, which is stated in the tooltip rather than
 * asked for. Both follow the selection the way everything in this bar does —
 * nothing selected is the whole glyph.
 *
 * They share a note with each other but not with the union's, because they sit at
 * the other end of the bar and a sentence should appear beside the button that
 * caused it.
 */
export function Reshape(): React.JSX.Element {
  const store = useEditorStore();
  const reading = useStoreValue((s) => s.ownership === "reading");
  const chosen = useStoreValue((s) => s.session.editor.selection.length > 0);
  const unitsPerEm = useStoreValue((s) => s.session.editor.document.info.unitsPerEm);

  const [x, setX] = useState(10);
  const [y, setY] = useState(10);
  const [join, setJoin] = useState<OffsetJoin>("round");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (note === null) return;
    const timer = window.setTimeout(() => setNote(null), NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [note]);

  const apply = (what: "offset" | "simplify"): void => {
    const editor = store.editor;
    const only = selectedContourIds(editor);
    const { outcome, result } =
      what === "offset"
        ? offsetAt(editor, editor.currentGlyph, { x, y, join }, only)
        : simplifyAt(editor, editor.currentGlyph, unitsPerEm * SIMPLIFY_FRACTION, only);

    if (outcome !== "nothing") store.applyTool(result);
    setNote(said(outcome, what, only !== null));
  };

  return (
    <>
      <BarMenu
        label="Offset"
        icon={OffsetIcon}
        look="tool"
        title={
          reading
            ? "Another tab is saving this project"
            : chosen
              ? "Move the selected outlines outwards or inwards"
              : "Move the outlines outwards or inwards"
        }
        disabled={reading}
        panelLabel="Offset"
        panelClassName={styles.panel}
        closeOnOutside={false}
      >
        <div className={styles.rows}>
          <label className={styles.row}>
            <span className={styles.name}>Horizontal</span>
            <NumberField
              value={x}
              onCommit={setX}
              label="Horizontal distance"
              className={styles.field}
              bigStep={10}
            />
          </label>
          <label className={styles.row}>
            <span className={styles.name}>Vertical</span>
            <NumberField
              value={y}
              onCommit={setY}
              label="Vertical distance"
              className={styles.field}
              bigStep={10}
            />
          </label>

          {/* Two numbers rather than one, because a letter thickened for weight
              wants more on the stems than on the thins — and because an ellipse is
              a squashed circle, which is one line of arithmetic away from the
              circle the offset already uses. */}
          <fieldset className={styles.joins}>
            <legend className={styles.name}>Corners</legend>
            {(["round", "miter", "bevel"] as const).map((kind) => (
              <label key={kind} className={styles.join}>
                <input
                  type="radio"
                  name="offset-join"
                  value={kind}
                  checked={join === kind}
                  onChange={() => setJoin(kind)}
                />
                {JOIN_NAMES[kind]}
              </label>
            ))}
          </fieldset>

          <button type="button" className={styles.apply} onClick={() => apply("offset")}>
            Offset
          </button>
        </div>
      </BarMenu>

      <button
        type="button"
        className={bar.tool}
        disabled={reading}
        title={
          reading
            ? "Another tab is saving this project"
            : "Take out the points the outline does not need, keeping corners and extremes"
        }
        aria-label={chosen ? "Simplify selection" : "Simplify"}
        onClick={() => apply("simplify")}
      >
        <SparklesIcon />
      </button>

      {note === null ? null : (
        <span className={bar.note} role="status">
          {note}
        </span>
      )}
    </>
  );
}

const JOIN_NAMES: Record<OffsetJoin, string> = {
  round: "Round",
  miter: "Mitre",
  bevel: "Flat",
};

/**
 * What happened, as a sentence.
 *
 * "Nothing" means different things for the two of them and both are worth saying
 * plainly: an outline with no points to spare is a tidy drawing rather than a
 * failure, and an offset that could do nothing is nearly always an open contour or
 * a distance of zero.
 */
function said(outcome: ReshapeReport, what: "offset" | "simplify", scoped: boolean): string {
  if (outcome === "nothing") {
    if (what === "simplify") {
      return scoped
        ? "The selected outlines need every point they have."
        : "The outline needs every point it has.";
    }
    return "Nothing here can be offset.";
  }
  if (outcome.kind === "offset") {
    return outcome.contours === 1
      ? "Offset 1 outline."
      : `Offset ${String(outcome.contours)} outlines.`;
  }
  return outcome.points === 1 ? "Took out 1 point." : `Took out ${String(outcome.points)} points.`;
}
