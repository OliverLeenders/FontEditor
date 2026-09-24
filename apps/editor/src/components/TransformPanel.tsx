import { rotation, scaling, skewing, translation } from "@typewright/geometry";
import { type TransformOrigin, transformSelection } from "@typewright/tools";
import { useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./TransformPanel.module.css";
import {
  BaselineIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  OriginIcon,
  RotateLeftIcon,
  RotateRightIcon,
  SlantIcon,
} from "./icons.js";

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

  const apply = (
    transform: Parameters<typeof transformSelection>[1],
    label: string,
    // How far this is a turn, in radians. The box round the selection is held at
    // an angle and has to follow, and only the caller knows: a matrix cannot say
    // whether it was meant as a turn or as a pair of flips.
    turn = 0,
  ): void => {
    store.applyTool(transformSelection(store.editor, transform, origin, label, turn));
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
          {/* Icon and word both: these two are places rather than actions, and
              a place wants naming. */}
          <button
            type="button"
            aria-pressed={origin.kind === "origin"}
            disabled={idle}
            title="The glyph's own origin, which is what slanting an italic turns about"
            onClick={() => setOrigin({ kind: "origin" })}
          >
            <OriginIcon />
            Origin
          </button>
          <button
            type="button"
            aria-pressed={origin.kind === "baseline"}
            disabled={idle}
            title="The baseline under the middle of the selection"
            onClick={() => setOrigin({ kind: "baseline" })}
          >
            <BaselineIcon />
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
          onApply={(v) => apply(rotation(v * DEGREES), "Rotate", v * DEGREES)}
        />
      </div>

      <div className={styles.row}>
        <Action
          label="Slant °"
          neutral={0}
          disabled={idle}
          title="Leans the verticals, which is what an italic is"
          // The one field that gets a drawing, because an italic is a slant and
          // the icon says so faster than the word. The unit stays in the label:
          // no drawing can carry a degree sign.
          icon={<SlantIcon />}
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

      {/* Drawings rather than words: four of them across a panel this narrow
          leaves no room for a label, and the arrows they replace were the one
          thing in the editor not drawn in the toolbar's own hand. Each says what
          it does in its tooltip and to a screen reader. */}
      <div className={styles.buttons}>
        <button
          type="button"
          disabled={idle}
          aria-label="Flip horizontally"
          title="Flip horizontally"
          onClick={() => apply(scaling(-1, 1), "Flip")}
        >
          <FlipHorizontalIcon />
        </button>
        <button
          type="button"
          disabled={idle}
          aria-label="Flip vertically"
          title="Flip vertically"
          onClick={() => apply(scaling(1, -1), "Flip")}
        >
          <FlipVerticalIcon />
        </button>
        <button
          type="button"
          disabled={idle}
          aria-label="Turn a quarter anticlockwise"
          title="Turn a quarter anticlockwise"
          onClick={() => apply(rotation(90 * DEGREES), "Rotate", 90 * DEGREES)}
        >
          <RotateLeftIcon />
        </button>
        <button
          type="button"
          disabled={idle}
          aria-label="Turn a quarter clockwise"
          title="Turn a quarter clockwise"
          onClick={() => apply(rotation(-90 * DEGREES), "Rotate", -90 * DEGREES)}
        >
          <RotateRightIcon />
        </button>
      </div>
    </div>
  );
}

/**
 * A number that does something once and goes back to meaning nothing.
 *
 * Held as text rather than as a number so a half-typed "-" or "1." can sit in
 * the box without being read as a value and applied — and a text box rather
 * than a number one, since the browser's own value sanitising throws that "-"
 * away before anything here can hold on to it.
 */
function Action({
  label,
  neutral,
  disabled,
  title,
  icon,
  onApply,
}: {
  readonly label: string;
  /** What the box shows when it has nothing to say: no move, or no scaling. */
  readonly neutral: number;
  readonly disabled: boolean;
  readonly title?: string;
  /** Shown before the label, where one says more than the words do. */
  readonly icon?: React.ReactNode;
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
      <span className={styles.small}>
        {icon === undefined ? null : <span className={styles.mark}>{icon}</span>}
        {label}
      </span>
      <input
        className={styles.input}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
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
