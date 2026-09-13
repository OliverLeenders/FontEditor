import {
  type MetricKeys,
  NO_METRIC_KEYS,
  resolvedMetrics,
  setAdvance,
  setLeftSidebearing,
  setRightSidebearing,
  sidebearings,
} from "@typewright/font-model";
import { begin, commit, editCurrentGlyph, result, setMetricKey } from "@typewright/tools";

import { useEditorStore, useStoreValue } from "../../useStore.js";
import styles from "../Inspector.module.css";
import { Stepper } from "../Stepper.js";
import { TypeIcon } from "../icons.js";
import { Section } from "./Section.js";
import { Field } from "./fields.js";

/**
 * What this glyph is, as a font sees it: what it stands for and how wide it is.
 *
 * Always open, because these are the numbers somebody drawing a letter looks at
 * without having to be asked to.
 */
export function GlyphSection(): React.JSX.Element {
  const store = useEditorStore();
  const advance = useStoreValue(
    (s) => s.session.editor.document.glyphs[s.session.editor.currentGlyph]?.advance ?? 0,
  );
  const unicodes = useStoreValue(
    (s) => s.session.editor.document.glyphs[s.session.editor.currentGlyph]?.unicodes ?? EMPTY_CODES,
  );
  // Two selectors rather than one returning an object: a fresh object every time
  // would compare unequal and re-render the panel on every store notification.
  // Measured through the font, so a composite has the sides of the letter it draws.
  const leftBearing = useStoreValue(
    (s) =>
      sidebearings(
        s.session.editor.document.glyphs[s.session.editor.currentGlyph] ?? EMPTY_GLYPH,
        s.session.editor.document,
      )?.left ?? null,
  );
  const rightBearing = useStoreValue(
    (s) =>
      sidebearings(
        s.session.editor.document.glyphs[s.session.editor.currentGlyph] ?? EMPTY_GLYPH,
        s.session.editor.document,
      )?.right ?? null,
  );

  // Three scalars again rather than the keys as an object, for the reason the
  // sidebearings are read one at a time.
  const leftKey = useStoreValue(
    (s) => s.session.editor.document.glyphs[s.session.editor.currentGlyph]?.metricKeys.left ?? "",
  );
  const rightKey = useStoreValue(
    (s) => s.session.editor.document.glyphs[s.session.editor.currentGlyph]?.metricKeys.right ?? "",
  );
  const widthKey = useStoreValue(
    (s) => s.session.editor.document.glyphs[s.session.editor.currentGlyph]?.metricKeys.width ?? "",
  );

  /*
   * What the keys work out to, which is what the font will be compiled with.
   *
   * Shown in place of the stored number rather than beside it: two numbers for
   * one measurement, one of them the one that counts, is a panel that has to be
   * read twice. `null` where the chain cannot be followed - a key naming a
   * glyph that is not there, or one that comes back round - and then the stored
   * number is shown, because that is what a font written now would carry.
   */
  const resolvedAdvance = useStoreValue(
    (s) =>
      resolvedMetrics(s.session.editor.document, s.session.editor.currentGlyph)?.advance ?? null,
  );
  const resolvedLeft = useStoreValue(
    (s) => resolvedMetrics(s.session.editor.document, s.session.editor.currentGlyph)?.left ?? null,
  );
  const resolvedRight = useStoreValue(
    (s) => resolvedMetrics(s.session.editor.document, s.session.editor.currentGlyph)?.right ?? null,
  );

  const shownAdvance = widthKey === "" ? advance : (resolvedAdvance ?? advance);
  const shownLeft = leftKey === "" ? leftBearing : (resolvedLeft ?? leftBearing);
  const shownRight = rightKey === "" ? rightBearing : (resolvedRight ?? rightBearing);

  const commitKey = (which: keyof MetricKeys, from: string): void => {
    store.applyTool(setMetricKey(store.editor, store.editor.currentGlyph, which, from));
  };

  const commitAdvance = (value: number): void => {
    if (!Number.isFinite(value)) return;
    const document = editCurrentGlyph(store.editor, (g) => setAdvance(g, value));
    if (document === null) return;
    store.applyTool(result({ ...store.editor, document }, [begin("Set advance"), commit]));
  };

  /**
   * Both sidebearings commit the same way, and each is one undo step.
   *
   * Sidebearings are derived, so these write through to the advance and the
   * outline; see `setLeftSidebearing` for why the left one moves the advance
   * with it.
   */
  const commitBearing = (side: "left" | "right", value: number): void => {
    if (!Number.isFinite(value)) return;
    const font = store.editor.document;
    const document = editCurrentGlyph(store.editor, (g) =>
      side === "left" ? setLeftSidebearing(g, value, font) : setRightSidebearing(g, value, font),
    );
    if (document === null) return;
    store.applyTool(
      result({ ...store.editor, document }, [
        begin(side === "left" ? "Set left sidebearing" : "Set right sidebearing"),
        commit,
      ]),
    );
  };

  return (
    <Section name="glyph" title="Glyph" icon={TypeIcon}>
      <Field label="Unicode">
        <span className={styles.readonly}>
          {unicodes.length === 0
            ? "—"
            : unicodes.map((u) => `U+${u.toString(16).toUpperCase().padStart(4, "0")}`).join(" ")}
        </span>
      </Field>

      <Field label="Advance">
        <Stepper
          value={Math.round(shownAdvance)}
          label="Advance"
          disabled={widthKey !== ""}
          onStep={(next) => commitAdvance(next)}
        >
          <input
            className={styles.input}
            type="number"
            disabled={widthKey !== ""}
            title={widthKey === "" ? undefined : `Taken from ${widthKey}`}
            value={Math.round(shownAdvance)}
            onChange={(event) => commitAdvance(Number(event.target.value))}
          />
        </Stepper>
      </Field>

      {/* Disabled rather than hidden for a glyph with no outline: a space has
            an advance and no sidebearings, and a field that vanishes reads as a
            bug where a greyed one reads as the fact it is. */}
      <Field label="Sidebearings">
        <div className={styles.pair}>
          <Stepper
            value={shownLeft === null ? null : Math.round(shownLeft)}
            label="left sidebearing"
            disabled={shownLeft === null || leftKey !== ""}
            onStep={(next) => commitBearing("left", next)}
          >
            <input
              className={styles.input}
              type="number"
              aria-label="Left sidebearing"
              title={leftKey === "" ? "Left sidebearing" : `Taken from ${leftKey}`}
              disabled={shownLeft === null || leftKey !== ""}
              value={shownLeft === null ? "" : Math.round(shownLeft)}
              onChange={(event) => commitBearing("left", Number(event.target.value))}
            />
          </Stepper>
          <Stepper
            value={shownRight === null ? null : Math.round(shownRight)}
            label="right sidebearing"
            disabled={shownRight === null || rightKey !== ""}
            onStep={(next) => commitBearing("right", next)}
          >
            <input
              className={styles.input}
              type="number"
              aria-label="Right sidebearing"
              title={rightKey === "" ? "Right sidebearing" : `Taken from ${rightKey}`}
              disabled={shownRight === null || rightKey !== ""}
              value={shownRight === null ? "" : Math.round(shownRight)}
              onChange={(event) => commitBearing("right", Number(event.target.value))}
            />
          </Stepper>
        </div>
      </Field>

      {/* Where the spacing comes from, where it is another glyph's. Three
            fields for the three things there are to say, each a glyph name and
            each empty for the ordinary case. Nothing is checked as it is typed:
            `n` is on the way to `nine`, and a field that refused it would be
            unusable. A key pointing nowhere is reported when the font is
            compiled, which is when it matters. */}
      <Field label="Spaced from">
        <div className={styles.triple}>
          <input
            className={styles.input}
            list="typewright-glyph-names"
            placeholder="left"
            aria-label="Left sidebearing taken from"
            title="Take the left sidebearing from a glyph: o, o+10, |b for its right side, or | for this glyph's right"
            spellCheck={false}
            value={leftKey}
            onChange={(event) => commitKey("left", event.target.value)}
          />
          <input
            className={styles.input}
            list="typewright-glyph-names"
            placeholder="right"
            aria-label="Right sidebearing taken from"
            title="Take the right sidebearing from a glyph: o, o+10, |d for its left side, or | for this glyph's left"
            spellCheck={false}
            value={rightKey}
            onChange={(event) => commitKey("right", event.target.value)}
          />
          <input
            className={styles.input}
            list="typewright-glyph-names"
            placeholder="width"
            aria-label="Advance taken from"
            title="Take the whole advance from a glyph: zero, or zero+20"
            spellCheck={false}
            value={widthKey}
            onChange={(event) => commitKey("width", event.target.value)}
          />
        </div>
      </Field>
    </Section>
  );
}

const EMPTY_CODES: readonly number[] = [];
/** Enough of a glyph for `sidebearings` to answer about, when there is none. */
const EMPTY_GLYPH = {
  name: "",
  unicodes: [],
  advance: 0,
  contours: [],
  components: [],
  anchors: [],
  guides: [],
  image: null,
  kept: [],
  metricKeys: NO_METRIC_KEYS,
  markColor: null,
};
