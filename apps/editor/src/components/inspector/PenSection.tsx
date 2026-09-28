import { changePen, drawWithPen, selectedPointPen, selectionNib } from "@typewright/tools";

import { useEditorStore, useStoreValue } from "../../useStore.js";
import styles from "../Inspector.module.css";
import { NumberField } from "../NumberField.js";
import { PenIcon } from "../icons.js";
import { Section } from "./Section.js";
import { Field } from "./fields.js";

/**
 * The pen a contour is drawn with, when it is a stroke.
 *
 * A contour with a pen is a skeleton — the path a broad-edged pen is drawn along
 * — and the ink is worked out from it: filled on the canvas, written into the
 * font. Three numbers say everything about the pen: the angle it is held at, how
 * wide it is along that angle, and how thick it is across it — nothing for a broad
 * edge, more for an oval. The angle is read the way a calligrapher reads it, anticlockwise
 * from level, so thirty is a foundational hand and forty-five an italic.
 *
 * Whole contours, as every contour-level setting is. A contour is claimed by any
 * of its points being selected.
 */
export function PenSection(): React.JSX.Element {
  const store = useEditorStore();
  // A string or a pen object from the state; the object is the one stored on the
  // contour, so it is the same reference until the pen changes and the section is
  // not re-rendered by every drag of a point.
  const stroke = useStoreValue((s) => selectionNib(s.session.editor));
  // The pen at the selected points, which is what the numbers describe: the pen is
  // set point by point and blends along each segment from one point to the next.
  const pen = useStoreValue((s) => selectedPointPen(s.session.editor));

  const selected = stroke !== null;
  const drawing = stroke !== null && stroke !== "none";
  const known = pen !== null && pen !== "mixed";
  const partly = pen === "mixed";

  return (
    <Section
      name="pen"
      title="Pen"
      icon={PenIcon}
      relevant={drawing}
      empty={!selected}
      emptyNote="nothing selected"
    >
      <Field label="Draw as" group>
        <div className={styles.segmented}>
          <button
            type="button"
            aria-pressed={stroke === "none"}
            disabled={!selected}
            title="The contour is the edge of the ink"
            onClick={() => store.applyTool(drawWithPen(store.editor, false))}
          >
            Outline
          </button>
          <button
            type="button"
            aria-pressed={drawing && stroke !== "mixed"}
            disabled={!selected}
            title={
              stroke === "mixed"
                ? "Draw all of these with a pen — the one some of them already have"
                : "The contour is the path a pen is drawn along"
            }
            onClick={() => store.applyTool(drawWithPen(store.editor, true))}
          >
            Stroke
          </button>
        </div>
      </Field>

      {/* The numbers only where there is a pen to describe. A mixture shows the
          fields empty rather than hiding them: typing into one gives every point
          selected that number and leaves the rest of each pen as it was. */}
      {pen !== null && (
        <>
          <Field label="Angle">
            <NumberField
              className={styles.input}
              label="Pen angle"
              title="Degrees anticlockwise from level"
              value={known ? pen.angle : null}
              placeholder={partly ? "—" : undefined}
              bigStep={15}
              onCommit={(angle) => store.applyTool(changePen(store.editor, { angle }))}
            />
          </Field>
          <Field label="Width">
            <NumberField
              className={styles.input}
              label="Pen width"
              title="Edge to edge, in design units"
              value={known ? pen.width : null}
              placeholder={partly ? "—" : undefined}
              bounds={{ min: 0 }}
              onCommit={(width) => store.applyTool(changePen(store.editor, { width }))}
            />
          </Field>
          {/* Across the pen. Nothing is a broad edge, the sharpest thicks and thins
              there are; more is an oval, whose thin strokes keep some weight; the
              same as the width is a round pen, the same weight every way. */}
          <Field label="Thickness">
            <NumberField
              className={styles.input}
              label="Pen thickness"
              title="Across the pen: 0 is a broad edge, the width is a round pen"
              value={known ? (pen.thickness ?? 0) : null}
              placeholder={partly ? "—" : undefined}
              bounds={{ min: 0 }}
              onCommit={(thickness) => store.applyTool(changePen(store.editor, { thickness }))}
            />
          </Field>
        </>
      )}
    </Section>
  );
}
