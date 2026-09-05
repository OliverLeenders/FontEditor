import { rotation, scaling, skewing, translation } from "@fonteditor/geometry";
import { type TransformOrigin, transformSelection } from "@fonteditor/tools";
import { useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./TransformPanel.module.css";

/**
 * Move, scale, turn and lean the selected points, by typing a number.
 *
 * Numbers rather than a box with handles to drag, because that is how the work
 * is actually described: a face is slanted twelve degrees, small capitals are
 * scaled to some exact percentage of the capitals, a stem is moved four units.
 * A box you drag is coming, and is a different thing — it answers "about here",
 * which is a question this panel cannot ask and the canvas cannot answer
 * precisely.
 *
 * Every field acts and resets. Typing 110 into a scale and pressing Enter scales
 * once by a tenth and puts 100 back; the field is a verb, not a setting, and a
 * number left sitting in it would suggest the selection is being held at that
 * size when nothing of the sort is true.
 */

/** The nine points of the selection's box, laid out as they sit. */
const ANCHORS: readonly (readonly ["left" | "centre" | "right", "top" | "middle" | "bottom"])[] = [
  ["left", "top"],
  ["centre", "top"],
  ["right", "top"],
  ["left", "middle"],
  ["centre", "middle"],
  ["right", "middle"],
  ["left", "bottom"],
  ["centre", "bottom"],
  ["right", "bottom"],
];

const DEGREES = Math.PI / 180;

export function TransformPanel(): React.JSX.Element {
  const store = useEditorStore();
  const points = useStoreValue(
    (s) => s.session.editor.selection.filter((item) => item.part === "point").length,
  );
  const [origin, setOrigin] = useState<TransformOrigin>({ kind: "box", x: "centre", y: "middle" });
  const idle = points === 0;

  const apply = (transform: Parameters<typeof transformSelection>[1], label: string): void => {
    store.applyTool(transformSelection(store.editor, transform, origin, label));
  };

  const anchored = (x: string, y: string): boolean =>
    origin.kind === "box" && origin.x === x && origin.y === y;

  return (
    <div className={styles.panel}>
      <span className={styles.label}>Transform{idle ? "" : ` · ${String(points)} selected`}</span>

      <div className={styles.about}>
        {/* Where it turns. The nine of the box, and the two a font needs: an
            italic leans about the glyph's origin or the spacing is gone, and a
            shape grows from the baseline rather than from its own middle. */}
        <div className={styles.grid} role="group" aria-label="Transform about">
          {ANCHORS.map(([x, y]) => (
            <button
              key={`${x}-${y}`}
              type="button"
              className={styles.anchor}
              aria-label={`About the ${y} ${x} of the selection`}
              aria-pressed={anchored(x, y)}
              disabled={idle}
              onClick={() => setOrigin({ kind: "box", x, y })}
            />
          ))}
        </div>

        <div className={styles.places}>
          <button
            type="button"
            aria-pressed={origin.kind === "origin"}
            disabled={idle}
            title="The glyph's own origin, which is what slanting an italic turns about"
            onClick={() => setOrigin({ kind: "origin" })}
          >
            Origin
          </button>
          <button
            type="button"
            aria-pressed={origin.kind === "baseline"}
            disabled={idle}
            title="The baseline under the middle of the selection"
            onClick={() => setOrigin({ kind: "baseline" })}
          >
            Baseline
          </button>
        </div>
      </div>

      <div className={styles.row}>
        <Action
          label="Move x"
          neutral={0}
          disabled={idle}
          onApply={(v) => apply(translation(v, 0), "Move")}
        />
        <Action
          label="Move y"
          neutral={0}
          disabled={idle}
          onApply={(v) => apply(translation(0, v), "Move")}
        />
      </div>

      <div className={styles.row}>
        <Action
          label="Scale x %"
          neutral={100}
          disabled={idle}
          onApply={(v) => apply(scaling(v / 100, 1), "Scale")}
        />
        <Action
          label="Scale y %"
          neutral={100}
          disabled={idle}
          onApply={(v) => apply(scaling(1, v / 100), "Scale")}
        />
      </div>

      <div className={styles.row}>
        <Action
          label="Scale %"
          neutral={100}
          disabled={idle}
          onApply={(v) => apply(scaling(v / 100, v / 100), "Scale")}
        />
        <Action
          label="Rotate °"
          neutral={0}
          disabled={idle}
          onApply={(v) => apply(rotation(v * DEGREES), "Rotate")}
        />
      </div>

      <div className={styles.row}>
        <Action
          label="Slant °"
          neutral={0}
          disabled={idle}
          title="Leans the verticals, which is what an italic is"
          onApply={(v) => apply(skewing(v * DEGREES, 0), "Slant")}
        />
        <Action
          label="Lean °"
          neutral={0}
          disabled={idle}
          title="The same on the other axis: leans the horizontals"
          onApply={(v) => apply(skewing(0, v * DEGREES), "Lean")}
        />
      </div>

      <div className={styles.buttons}>
        <button type="button" disabled={idle} onClick={() => apply(scaling(-1, 1), "Flip")}>
          Flip ↔
        </button>
        <button type="button" disabled={idle} onClick={() => apply(scaling(1, -1), "Flip")}>
          Flip ↕
        </button>
        <button
          type="button"
          disabled={idle}
          aria-label="Turn a quarter anticlockwise"
          onClick={() => apply(rotation(90 * DEGREES), "Rotate")}
        >
          ↺ 90°
        </button>
        <button
          type="button"
          disabled={idle}
          aria-label="Turn a quarter clockwise"
          onClick={() => apply(rotation(-90 * DEGREES), "Rotate")}
        >
          ↻ 90°
        </button>
      </div>
    </div>
  );
}

/**
 * A number that does something once and goes back to meaning nothing.
 *
 * Held as text rather than as a number so a half-typed "-" or "1." can sit in
 * the box without being read as a value and applied.
 */
function Action({
  label,
  neutral,
  disabled,
  title,
  onApply,
}: {
  readonly label: string;
  /** What the box shows when it has nothing to say: no move, or no scaling. */
  readonly neutral: number;
  readonly disabled: boolean;
  readonly title?: string;
  readonly onApply: (value: number) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(neutral));

  const run = (): void => {
    const value = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(value) && value !== neutral) onApply(value);
    setDraft(String(neutral));
  };

  return (
    <label className={styles.field}>
      <span className={styles.small}>{label}</span>
      <input
        className={styles.input}
        type="number"
        value={draft}
        disabled={disabled}
        aria-label={label}
        {...(title === undefined ? {} : { title })}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            run();
          }
          if (event.key === "Escape") {
            event.stopPropagation();
            setDraft(String(neutral));
            event.currentTarget.blur();
          }
        }}
        // Blur does not apply. A number typed and then clicked away from is a
        // number the user changed their mind about, and applying it would be an
        // edit nobody asked for.
        onBlur={() => setDraft(String(neutral))}
      />
    </label>
  );
}
