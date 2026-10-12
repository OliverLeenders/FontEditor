import { type EndSerif, type SerifNumber, serifNumbers } from "@typewright/font-model";
import type { PenBlend } from "@typewright/geometry";
import {
  type BlendChannel,
  type EndChoice,
  type EndShape,
  addSerifStyle,
  begin,
  changePen,
  commit,
  drawWithPen,
  result,
  selectedEndSerif,
  selectedEndSerifsDiffer,
  selectedPenBlend,
  selectedPenValue,
  selectedPointPen,
  selectedStrokeEnd,
  selectedStrokeEndShape,
  selectionNib,
  setEndSerifNumber,
  setEndSerifStyle,
  setPenBlend,
  setStrokeEnd,
  setStrokeEndShape,
} from "@typewright/tools";

import { useEditorStore, useStoreValue } from "../../useStore.js";
import styles from "../Inspector.module.css";
import {
  type IconComponent,
  BrushIcon,
  ChevronRightIcon,
  CloseNibIcon,
  CloseSerifIcon,
  CloseStraightIcon,
  CutLevelIcon,
  CutSquareIcon,
  CutUprightIcon,
  LinkIcon,
  SaveIcon,
  SerifBracketIcon,
  SerifCupIcon,
  SerifHeightIcon,
  SerifReachLeftIcon,
  SerifReachRightIcon,
  SerifRoundIcon,
  SerifSlopeIcon,
} from "../icons.js";
import { Section } from "./Section.js";
import { Field, Named, SteppedNumber } from "./fields.js";

/**
 * The pen a contour is drawn with, when it is a stroke.
 *
 * A contour with a pen is a skeleton — the path a broad-edged pen is drawn along
 * — and the ink is worked out from it: filled on the canvas, written into the
 * font. Four numbers say everything about the pen: the angle it is held at, how
 * wide it is along that angle, how thick it is across it — nothing for a broad
 * edge, more for an oval — and how square its corners are. The angle is read the
 * way a calligrapher reads it, anticlockwise from level, so thirty is a
 * foundational hand and forty-five an italic.
 *
 * Outline or Stroke is said of whole contours, claimed by any of their points
 * being selected. The numbers are the pen at the selected points, and the blends
 * how it changes along the segments leaving them: a stroke's pen is set point by
 * point.
 *
 * The section was a row to a number once, and with a serif's seven came to
 * sixteen rows. Numbers that belong together share a row now, each named inside
 * it; what there are a few of is chosen by icon; and a serif's numbers, which
 * all have handles on the canvas, are folded away until they are asked for.
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
  const endShape = useStoreValue((s) => selectedStrokeEndShape(s.session.editor));

  const selected = stroke !== null;
  const drawing = stroke !== null && stroke !== "none";
  // Each number on its own, so a selection whose pens differ in width still shows
  // the angle they share, and typing one number is not undone by the others.
  const angle = useStoreValue((s) => selectedPenValue(s.session.editor, "angle"));
  const width = useStoreValue((s) => selectedPenValue(s.session.editor, "width"));
  const thickness = useStoreValue((s) => selectedPenValue(s.session.editor, "thickness"));
  const squareness = useStoreValue((s) => selectedPenValue(s.session.editor, "squareness"));
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

      {/* The numbers only where there is a pen to describe, two to a row. A
          mixture shows the fields empty rather than hiding them: typing into
          one gives every point selected that number and leaves the rest of each
          pen as it was. */}
      {pen !== null && (
        <Field label="Pen" group>
          <div className={styles.pair}>
            <Named name="Angle" title="Degrees anticlockwise from level">
              <SteppedNumber
                className={styles.input}
                label="Pen angle"
                value={number(angle)}
                placeholder={dash(angle)}
                bigStep={15}
                onCommit={(angle) => store.applyTool(changePen(store.editor, { angle }))}
              />
            </Named>
            <Named name="Width" title="Edge to edge, in design units">
              <SteppedNumber
                className={styles.input}
                label="Pen width"
                value={number(width)}
                placeholder={dash(width)}
                bounds={{ min: 0 }}
                onCommit={(width) => store.applyTool(changePen(store.editor, { width }))}
              />
            </Named>
          </div>
          <div className={styles.pair}>
            {/* Across the pen. Nothing is a broad edge, the sharpest thicks and
                thins there are; more is an oval, whose thin strokes keep some
                weight; the same as the width is a round pen. */}
            <Named name="Thick" title="Across the pen: 0 is a broad edge, the width is a round pen">
              <SteppedNumber
                className={styles.input}
                label="Pen thickness"
                value={number(thickness)}
                placeholder={dash(thickness)}
                bounds={{ min: 0 }}
                onCommit={(thickness) => store.applyTool(changePen(store.editor, { thickness }))}
              />
            </Named>
            {/* Only for a pen with thickness: a broad edge is a line, and has no
                corners to square. As a percentage, as a corner's smoothness is. */}
            {thickness !== 0 && thickness !== null && (
              <Named
                name="Square"
                title="0 is an oval, 100 a rectangle of the pen's width and thickness"
              >
                <SteppedNumber
                  className={styles.input}
                  label="Pen squareness"
                  value={typeof squareness === "number" ? Math.round(squareness * 100) : null}
                  placeholder={dash(squareness)}
                  bigStep={10}
                  bounds={{ min: 0, max: 100 }}
                  onCommit={(percent) =>
                    store.applyTool(changePen(store.editor, { squareness: percent / 100 }))
                  }
                />
              </Named>
            )}
          </div>
        </Field>
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
      {end !== null && <EndField value={end} shape={endShape} />}
    </Section>
  );
}

/** The angles a cut is nearly always wanted at, each one press away. */
const CUTS: readonly {
  readonly value: Exclude<EndChoice, "pen">;
  readonly label: string;
  readonly title: string;
  readonly icon: IconComponent;
}[] = [
  {
    value: 0,
    label: "Level",
    title: "Cut level, at this point: a foot standing on a line",
    icon: CutLevelIcon,
  },
  {
    value: 90,
    label: "Upright",
    title: "Cut upright, at this point: the end of a bar",
    icon: CutUprightIcon,
  },
  {
    value: "square",
    label: "Square",
    title: "Cut straight across the path, at this point",
    icon: CutSquareIcon,
  },
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

const CLOSINGS: readonly {
  readonly value: EndShape;
  readonly label: string;
  readonly title: string;
  readonly icon: IconComponent;
}[] = [
  {
    value: "straight",
    label: "Straight",
    title: "Straight: the cut itself, a straight edge and a sharp corner at each side",
    icon: CloseStraightIcon,
  },
  {
    value: "nib",
    label: "Nib",
    title:
      "Nib: half the pen's own shape, laid along the cut and as wide as the stroke — the end the pen would leave turned that way",
    icon: CloseNibIcon,
  },
  {
    value: "serif",
    label: "Serif",
    title: "Serif: a serif standing on the cut, measured from the stroke's own edges",
    icon: CloseSerifIcon,
  },
];

/**
 * How a stroke ends at the selected ends: as the pen leaves it, or cut straight
 * through the point, at an angle that is typed or is one of three that are
 * nearly always the one wanted. Square to the path is not an angle, and shows
 * none.
 */
function EndField({
  value,
  shape,
}: {
  readonly value: EndChoice | "mixed";
  readonly shape: EndShape | "mixed" | null;
}): React.JSX.Element {
  const store = useEditorStore();
  const set = (choice: EndChoice): void => store.applyTool(setStrokeEnd(store.editor, choice));
  const close = (with_: EndShape): void => store.applyTool(setStrokeEndShape(store.editor, with_));
  const cut = value !== "pen" && value !== "mixed";
  return (
    <>
      <Field label="End" group>
        <div className={`${styles.segmented} ${styles.endRow}`}>
          <button
            type="button"
            aria-pressed={value === "pen"}
            title="As the pen leaves it"
            onClick={() => set("pen")}
          >
            Pen
          </button>
          <button
            type="button"
            aria-pressed={cut}
            title="Cut straight through this point: square to the path until an angle is given"
            onClick={() => {
              if (!cut) set("square");
            }}
          >
            Cut
          </button>
          <SteppedNumber
            className={styles.input}
            label="Cut angle"
            title="The cut's angle, in degrees anticlockwise from level"
            value={typeof value === "number" ? value : null}
            placeholder={value === "mixed" ? "—" : undefined}
            bigStep={15}
            onCommit={(angle) => set(angle)}
          />
          {CUTS.map((c) => (
            <button
              key={c.label}
              type="button"
              className={styles.iconChoice}
              aria-label={c.label}
              aria-pressed={sameEnd(value, c.value)}
              title={c.title}
              onClick={() => set(c.value)}
            >
              <c.icon />
            </button>
          ))}
        </div>
      </Field>
      {/* What a cut end is closed with, where there is a cut to close. */}
      {shape !== null && (
        <Field label="Closed with" group>
          <div className={styles.segmented}>
            {CLOSINGS.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-label={c.label}
                aria-pressed={shape === c.value}
                title={c.title}
                onClick={() => close(c.value)}
              >
                <c.icon />
              </button>
            ))}
          </div>
        </Field>
      )}
      {shape === "serif" && <SerifFields />}
    </>
  );
}

/** A serif's numbers, in the rows they are shown in: what belongs together, together. */
const SERIF_ROWS: readonly (readonly {
  readonly key: SerifNumber;
  readonly name: string;
  readonly title: string;
  readonly icon: IconComponent;
  /** Shown as a percentage, where the number is a share of something. */
  readonly percent?: boolean;
}[])[] = [
  [
    {
      key: "left",
      name: "Serif reach left",
      title:
        "Reach left: how far the serif goes past the stroke's left edge, in units. 0 for none on that side.",
      icon: SerifReachLeftIcon,
    },
    {
      key: "right",
      name: "Serif reach right",
      title:
        "Reach right: how far the serif goes past the stroke's right edge, in units. 0 for none on that side.",
      icon: SerifReachRightIcon,
    },
  ],
  [
    {
      key: "height",
      name: "Serif height",
      title: "Height: how far up the stroke the serif goes where it meets it, in units",
      icon: SerifHeightIcon,
    },
    {
      key: "cup",
      name: "Serif cup",
      title: "Cup: how far the middle of the serif's foot is hollowed, in units",
      icon: SerifCupIcon,
    },
  ],
  [
    {
      key: "bracket",
      name: "Serif bracket",
      title:
        "Bracket, in per cent: how much of the corner between serif and stroke is a curve — 0 none, 100 out to the tip",
      icon: SerifBracketIcon,
      percent: true,
    },
    {
      key: "slope",
      name: "Serif slope",
      title:
        "Slope, in per cent: how much thinner the serif is at its tip — 0 a slab, 100 a wedge that comes to a point",
      icon: SerifSlopeIcon,
      percent: true,
    },
    {
      key: "round",
      name: "Serif round tips",
      title:
        "Round tips, in per cent: how much of each tip is rounded off — 0 square, 100 half a circle",
      icon: SerifRoundIcon,
      percent: true,
    },
  ],
];

/** The name the serif's folded numbers are remembered under, with the inspector's sections. */
const SERIF_NUMBERS_FOLD = "pen-serif-numbers";

/**
 * The serif on the selected ends: which of the font's styles it is, and its
 * numbers.
 *
 * The numbers are folded away until asked for: every one of them has a handle
 * on the canvas, and a serif that follows a style is usually left to. A number
 * typed here is this end's own from then on and stays when the style is changed
 * in Font info; the button beside the style takes them back. A serif with no
 * style is all its own numbers, and the same button makes it a style of the
 * font, which is how a style is usually come by: drawn on a letter first.
 */
function SerifFields(): React.JSX.Element | null {
  const store = useEditorStore();
  // The serif as the end has it, the same object until it changes; a new one
  // made here at every look would be a change at every look.
  const found = useStoreValue((s) => selectedEndSerif(s.session.editor));
  const mixed = useStoreValue((s) => selectedEndSerifsDiffer(s.session.editor));
  const fontStyles = useStoreValue((s) => s.session.editor.document.serifs);
  const unfolded = useStoreValue((s) => s.inspector.sections[SERIF_NUMBERS_FOLD]) === true;
  if (found === null) return null;
  const serif: EndSerif = found;
  const own = serif.own ?? [];

  const saveAsStyle = (): void => {
    store.applyTool(result(store.editor, [begin("New serif style")]));
    const before = new Set(store.editor.document.serifs.map((style) => style.name));
    store.applyTool(
      result(addSerifStyle(store.editor, { name: "Serif", ...serifNumbers(serif) }).state),
    );
    const made = store.editor.document.serifs.find((style) => !before.has(style.name));
    if (made !== undefined) {
      store.applyTool(result(setEndSerifStyle(store.editor, made.name).state));
    }
    store.applyTool(result(store.editor, [commit]));
  };

  return (
    <Field label="Serif" group>
      <div className={styles.styleRow}>
        <select
          className={styles.input}
          aria-label="Serif style"
          title="One of the font's serif styles, which are changed in Font info, or numbers of this end's own"
          value={mixed ? "\u0000mixed" : (serif.style ?? "")}
          onChange={(event) =>
            store.applyTool(
              setEndSerifStyle(store.editor, event.target.value === "" ? null : event.target.value),
            )
          }
        >
          {mixed && <option value={"\u0000mixed"}>—</option>}
          <option value="">Own numbers</option>
          {fontStyles.map((style) => (
            <option key={style.name} value={style.name}>
              {style.name}
            </option>
          ))}
        </select>
        {serif.style === undefined ? (
          <button
            type="button"
            className={styles.rowAction}
            aria-label="Save as style"
            title="Save as style: make these numbers a serif style of the font, and give it to this end"
            onClick={saveAsStyle}
          >
            <SaveIcon />
          </button>
        ) : own.length > 0 ? (
          <button
            type="button"
            className={styles.rowAction}
            aria-label="Follow style"
            title="Follow style: take back the numbers set on this end, and follow the style again"
            onClick={() => store.applyTool(setEndSerifStyle(store.editor, serif.style ?? null))}
          >
            <LinkIcon />
          </button>
        ) : null}
      </div>
      <button
        type="button"
        className={styles.fold}
        aria-expanded={unfolded}
        title="The serif's numbers, which are also dragged by its handles on the canvas"
        onClick={() => store.toggleInspectorSection(SERIF_NUMBERS_FOLD, !unfolded)}
      >
        <span className={styles.chevron} data-open={unfolded ? "true" : undefined}>
          <ChevronRightIcon />
        </span>
        Numbers
      </button>
      {unfolded &&
        SERIF_ROWS.map((row) => (
          <div key={row[0]!.key} className={row.length === 3 ? styles.triple : styles.pair}>
            {row.map((field) => (
              <Named
                key={field.key}
                icon={field.icon}
                own={own.includes(field.key)}
                title={
                  own.includes(field.key)
                    ? `${field.title}. Set on this end: the style's is not followed.`
                    : field.title
                }
              >
                <SteppedNumber
                  className={styles.input}
                  label={field.name}
                  value={
                    field.percent === true
                      ? Math.round(serif[field.key] * 100)
                      : Math.round(serif[field.key] * 100) / 100
                  }
                  bigStep={10}
                  bounds={field.percent === true ? { min: 0, max: 100 } : { min: 0 }}
                  onCommit={(value) =>
                    store.applyTool(
                      setEndSerifNumber(
                        store.editor,
                        field.key,
                        field.percent === true ? value / 100 : value,
                      ),
                    )
                  }
                />
              </Named>
            ))}
          </div>
        ))}
    </Field>
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
