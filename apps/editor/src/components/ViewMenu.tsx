import { useEffect, useRef, useState } from "react";

import { MAX_OUTLINE_WIDTH, MIN_OUTLINE_WIDTH } from "../limits.js";
import { usePane } from "../pane.js";
import { viewOf } from "../scene.js";
import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./ViewMenu.module.css";
import { PreferencesIcon } from "./icons.js";

/**
 * What this canvas shows, and how heavily it is drawn.
 *
 * A popover rather than a dialog over the whole window, because every one of
 * these is judged by looking at the canvas: an outline weight chosen against a
 * covered canvas is a weight chosen blind. It opens beside the work and the
 * work stays visible.
 *
 * Per pane, so a split window can draw with the comb on beside a clean copy of
 * the same letter. What is true of the whole application — the theme — is in
 * the window bar's preferences instead, since a window in two minds about
 * whether it is dark is not a thing anybody wants.
 *
 * Handles and Snap keep their own toolbar buttons and appear here too. A toggle
 * reached every minute earns a button; the menu is where someone finds out it
 * exists at all.
 */
export function ViewMenu(): React.JSX.Element {
  const store = useEditorStore();
  const pane = usePane();
  const outlineWidth = useStoreValue((s) => viewOf(s, pane).outlineWidth);
  const autoHide = useStoreValue((s) => viewOf(s, pane).autoHideHandles);
  const snapPoints = useStoreValue((s) => viewOf(s, pane).snapPoints);
  const neighbours = useStoreValue((s) => viewOf(s, pane).showNeighbours);
  const anchors = useStoreValue((s) => viewOf(s, pane).showAnchors);
  const curvature = useStoreValue((s) => viewOf(s, pane).showCurvature);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div className={styles.holder}>
      <button
        type="button"
        className={styles.button}
        aria-expanded={open}
        aria-label="View"
        title="Outline weight and what this canvas shows"
        onClick={() => setOpen((was) => !was)}
      >
        <PreferencesIcon />
      </button>

      {open ? (
        <div ref={ref} className={styles.panel} role="group" aria-label="View">
          <div className={styles.row}>
            <span className={styles.label}>Outline</span>
            <div className={styles.slide}>
              <input
                type="range"
                className={styles.range}
                min={MIN_OUTLINE_WIDTH}
                max={MAX_OUTLINE_WIDTH}
                step={0.25}
                value={outlineWidth}
                aria-label="Outline thickness"
                onChange={(event) => store.setOutlineWidth(Number(event.target.value), pane)}
              />
              <span className={styles.value}>{outlineWidth.toFixed(2)}</span>
            </div>
          </div>

          <Switch
            label="Auto-hide handles"
            hint="Show handles only near the work  (H)"
            on={autoHide}
            onChange={() => store.toggleAutoHideHandles(pane)}
          />
          <Switch
            label="Snap to points"
            hint="Drags line up with the glyph's own points  (S)"
            on={snapPoints}
            onChange={() => store.toggleSnapPoints(pane)}
          />
          <Switch
            label="Show neighbours"
            hint="Draw the letters either side, from the strip text"
            on={neighbours}
            onChange={() => store.toggleNeighbours(pane)}
          />
          <Switch
            label="Show anchors"
            hint="The places accents attach, named on hover"
            on={anchors}
            onChange={() => store.toggleAnchors(pane)}
          />
          <Switch
            label="Curvature comb"
            hint="How tightly the outline turns · a step at a join is a break"
            on={curvature}
            onChange={() => store.toggleCurvature(pane)}
          />

          <div className={styles.footer}>
            <span className={styles.note}>Kept in this browser, not in the font.</span>
            <button type="button" className={styles.reset} onClick={() => store.resetView(pane)}>
              Reset
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Switch({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint: string;
  on: boolean;
  onChange: () => void;
}): React.JSX.Element {
  return (
    <label className={styles.row} title={hint}>
      <span className={styles.label}>{label}</span>
      <input type="checkbox" className={styles.check} checked={on} onChange={onChange} />
    </label>
  );
}
