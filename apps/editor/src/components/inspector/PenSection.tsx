import type { PenBlend } from "@typewright/geometry";
import {
  type BlendChannel,
  type EndChoice,
  changePen,
  drawWithPen,
  selectedPenBlend,
  selectedPenValue,
  selectedPointPen,
  selectedStrokeEnd,
  selectionNib,
  setPenBlend,
  setStrokeEnd,
} from "@typewright/tools";

import { useEditorStore, useStoreValue } from "../../useStore.js";
import styles from "../Inspector.module.css";
import { NumberField } from "../NumberField.js";
import { BrushIcon } from "../icons.js";
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
 * Outline or Stroke is said of whole contours, claimed by any of their points
 * being selected. The numbers are the pen at the selected points, and the blends
 * how it changes along the segments leaving them: a stroke's pen is set point by
 * point.
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
  // How the pen changes along the segments leaving those points, part by part.
  const angleBlend = useStoreValue((s) => selectedPenBlend(s.session.editor, "angle"));
  const shapeBlend = useStoreValue((s) => selectedPenBlend(s.session.editor, "shape"));
  // How the stroke ends at the selected points, where one of them is an end.
  const end = useStoreValue((s) => selectedStrokeEnd(s.session.editor));

  const selected = stroke !== null;
  const drawing = stroke !== null && stroke !== "none";
  // Each number on its own, so a selection whose pens differ in width still shows
  // the angle they share, and typing one number is not undone by the others.
  const angle = useStoreValue((s) => selectedPenValue(s.session.editor, "angle"));
  const width = useStoreValue((s) => selectedPenValue(s.session.editor, "width"));
  const thickness = useStoreValue((s) => selectedPenValue(s.session.editor, "thickness"));
  const number = (v: number | "mixed" | null): number | null => (typeof v === "number" ? v : null);
  const dash = (v: number | "mixed" | null): string | undefined =>
    v === "mixed" ? "—" : undefined;

  return (
    <Section
      name="pen"
      title="Pen"
      icon={BrushIcon}
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
              value={number(angle)}
              placeholder={dash(angle)}
              bigStep={15}
              onCommit={(angle) => store.applyTool(changePen(store.editor, { angle }))}
            />
          </Field>
          <Field label="Width">
            <NumberField
              className={styles.input}
              label="Pen width"
              title="Edge to edge, in design units"
              value={number(width)}
              placeholder={dash(width)}
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
              value={number(thickness)}
              placeholder={dash(thickness)}
              bounds={{ min: 0 }}
              onCommit={(thickness) => store.applyTool(changePen(store.editor, { thickness }))}
            />
          </Field>
        </>
      )}

      {/* How the pen goes from these points' pens to the next points' along each
          segment, for the angle and for the shape. Only where a selected point
          starts a segment of a stroke: the last point of an open one has no
          segment after it to say anything about. */}
      {angleBlend !== null && <BlendField label="Angle blend" channel="angle" value={angleBlend} />}
      {shapeBlend !== null && <BlendField label="Shape blend" channel="shape" value={shapeBlend} />}

      {/* How the stroke ends, where an end of an open one is selected. Beside the
          pen and not in it: a cut is what saves turning the pen to get a flat
          end, and widening the stroke by turning it. */}
      {end !== null && <EndField value={end} />}
    </Section>
  );
}

const ENDS: readonly {
  readonly value: EndChoice;
  readonly label: string;
  readonly title: string;
}[] = [
  { value: "pen", label: "Pen", title: "As the pen leaves it" },
  { value: "square", label: "Square", title: "Cut straight across the path, at this point" },
  { value: 0, label: "Level", title: "Cut level, at this point: a foot standing on a line" },
  { value: 90, label: "Upright", title: "Cut upright, at this point: the end of a bar" },
];

/**
 * Whether an end is the one a button names. A line at an angle is the same line
 * half a turn on, and the knob on the canvas turns it all the way round: level
 * is level at a hundred and eighty as at nought.
 */
function sameEnd(value: EndChoice | "mixed", named: EndChoice): boolean {
  if (typeof value !== "number" || typeof named !== "number") return value === named;
  return (((value - named) % 180) + 180) % 180 === 0;
}

/**
 * How a stroke ends at the selected ends: as the pen leaves it, or cut straight
 * through the point. A cut at an angle shows the angle, to be typed over; level
 * and upright are that angle at nought and ninety.
 */
function EndField({ value }: { readonly value: EndChoice | "mixed" }): React.JSX.Element {
  const store = useEditorStore();
  const set = (choice: EndChoice): void => store.applyTool(setStrokeEnd(store.editor, choice));
  return (
    <>
      <Field label="End" group>
        <div className={styles.segmented}>
          {ENDS.map((e) => (
            <button
              key={e.label}
              type="button"
              aria-pressed={sameEnd(value, e.value)}
              title={e.title}
              onClick={() => set(e.value)}
            >
              {e.label}
            </button>
          ))}
        </div>
      </Field>
      {typeof value === "number" && (
        <Field label="Cut at">
          <NumberField
            className={styles.input}
            label="Cut angle"
            title="Degrees anticlockwise from level"
            value={value}
            bigStep={15}
            onCommit={(angle) => set(angle)}
          />
        </Field>
      )}
    </>
  );
}

const BLENDS: readonly {
  readonly value: PenBlend;
  readonly label: string;
  readonly title: string;
}[] = [
  { value: "linear", label: "Linear", title: "Evenly along the segment" },
  {
    value: "smooth",
    label: "Smooth",
    title: "Along a curve through the pens at all the points, with no corner where a point is",
  },
  { value: "ease", label: "Ease", title: "Slowly away from this point and slowly into the next" },
  { value: "step", label: "Step", title: "This point's pen held until the next point" },
];

/**
 * One row of blend buttons: how one part of the pen changes along the segments
 * leaving the selected points. A mixed selection presses none of them, and
 * pressing one gives it to all.
 */
function BlendField({
  label,
  channel,
  value,
}: {
  readonly label: string;
  readonly channel: BlendChannel;
  readonly value: PenBlend | "mixed";
}): React.JSX.Element {
  const store = useEditorStore();
  return (
    <Field label={label} group>
      <div className={styles.segmented}>
        {BLENDS.map((b) => (
          <button
            key={b.value}
            type="button"
            aria-pressed={value === b.value}
            title={b.title}
            onClick={() => store.applyTool(setPenBlend(store.editor, channel, b.value))}
          >
            {b.label}
          </button>
        ))}
      </div>
    </Field>
  );
}
