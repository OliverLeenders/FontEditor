import type { Opening as OpeningState, OpeningStep } from "../store/state.js";
import { useStoreValue } from "../useStore.js";
import styles from "./Opening.module.css";

/**
 * A font on its way in.
 *
 * Covers the stage, as the list of fonts does, for the seconds a large font
 * takes to read and draw: nothing behind it is true yet — the font that was
 * open is on its way out, or nothing was — and a page that only sat there would
 * read as one that had stopped. It says which font, which step, and how far the
 * step has got where that can be counted.
 */
export function Opening(): React.JSX.Element | null {
  const opening = useStoreValue((s) => s.opening);
  if (opening === null) return null;

  const counted = opening.total > 0;
  return (
    <div className={styles.pane} role="status" aria-busy="true">
      <div className={styles.sheet}>
        <h1 className={styles.title}>{opening.name === "" ? "Opening" : opening.name}</h1>
        <div
          className={styles.bar}
          role="progressbar"
          aria-label="Opening the font"
          aria-valuemin={0}
          aria-valuemax={counted ? opening.total : undefined}
          aria-valuenow={counted ? opening.done : undefined}
          data-counted={counted ? "" : undefined}
        >
          <div
            className={styles.fill}
            style={
              counted ? { width: `${String((100 * opening.done) / opening.total)}%` } : undefined
            }
          />
        </div>
        <p className={styles.step}>{said(opening)}</p>
      </div>
    </div>
  );
}

const STEPS: Record<OpeningStep, string> = {
  files: "Reading files",
  glyphs: "Reading glyphs",
  parsing: "Reading the font",
  drawing: "Drawing the glyphs",
};

/** The step in words, with how far it has got where it has a count. */
function said(opening: OpeningState): string {
  const step = STEPS[opening.step];
  if (opening.total <= 0) return `${step}…`;
  return `${step} · ${opening.done.toLocaleString("en")} of ${opening.total.toLocaleString("en")}`;
}
