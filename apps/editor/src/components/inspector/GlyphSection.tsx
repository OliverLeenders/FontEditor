import {
  setAdvance,
  setLeftSidebearing,
  setRightSidebearing,
  sidebearings,
} from "@fonteditor/font-model";
import { begin, commit, editCurrentGlyph, result } from "@fonteditor/tools";

import { useEditorStore, useStoreValue } from "../../useStore.js";
import styles from "../Inspector.module.css";
import { Stepper } from "../Stepper.js";
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
  const leftBearing = useStoreValue(
    (s) =>
      sidebearings(s.session.editor.document.glyphs[s.session.editor.currentGlyph] ?? EMPTY_GLYPH)
        ?.left ?? null,
  );
  const rightBearing = useStoreValue(
    (s) =>
      sidebearings(s.session.editor.document.glyphs[s.session.editor.currentGlyph] ?? EMPTY_GLYPH)
        ?.right ?? null,
  );

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
    const document = editCurrentGlyph(store.editor, (g) =>
      side === "left" ? setLeftSidebearing(g, value) : setRightSidebearing(g, value),
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
    <Section name="glyph" title="Glyph">
      <Field label="Unicode">
        <span className={styles.readonly}>
          {unicodes.length === 0
            ? "—"
            : unicodes.map((u) => `U+${u.toString(16).toUpperCase().padStart(4, "0")}`).join(" ")}
        </span>
      </Field>

      <Field label="Advance">
        <Stepper value={Math.round(advance)} label="Advance" onStep={(next) => commitAdvance(next)}>
          <input
            className={styles.input}
            type="number"
            value={Math.round(advance)}
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
            value={leftBearing === null ? null : Math.round(leftBearing)}
            label="left sidebearing"
            disabled={leftBearing === null}
            onStep={(next) => commitBearing("left", next)}
          >
            <input
              className={styles.input}
              type="number"
              aria-label="Left sidebearing"
              title="Left sidebearing"
              disabled={leftBearing === null}
              value={leftBearing === null ? "" : Math.round(leftBearing)}
              onChange={(event) => commitBearing("left", Number(event.target.value))}
            />
          </Stepper>
          <Stepper
            value={rightBearing === null ? null : Math.round(rightBearing)}
            label="right sidebearing"
            disabled={rightBearing === null}
            onStep={(next) => commitBearing("right", next)}
          >
            <input
              className={styles.input}
              type="number"
              aria-label="Right sidebearing"
              title="Right sidebearing"
              disabled={rightBearing === null}
              value={rightBearing === null ? "" : Math.round(rightBearing)}
              onChange={(event) => commitBearing("right", Number(event.target.value))}
            />
          </Stepper>
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
};
