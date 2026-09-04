import { useEffect, useRef, useState } from "react";

import { MAX_OUTLINE_WIDTH, MIN_OUTLINE_WIDTH } from "../limits.js";
import type { ThemeChoice } from "../preferences.js";
import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./PreferencesPanel.module.css";
import { PreferencesIcon } from "./icons.js";

/**
 * The settings that are about you rather than about the font.
 *
 * A popover rather than a dialog over the whole window, because every one of
 * these is judged by looking at the canvas: an outline weight chosen against a
 * covered canvas is a weight chosen blind. It opens beside the work and the work
 * stays visible.
 *
 * Handles and Snap keep their own toolbar buttons and appear here too. A toggle
 * reached every minute earns a button; the panel is where someone finds out it
 * exists at all.
 */
const THEMES: readonly { readonly id: ThemeChoice; readonly label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export function PreferencesPanel(): React.JSX.Element {
  const store = useEditorStore();
  const theme = useStoreValue((s) => s.theme);
  const outlineWidth = useStoreValue((s) => s.outlineWidth);
  const autoHide = useStoreValue((s) => s.autoHideHandles);
  const snapPoints = useStoreValue((s) => s.snapPoints);
  const neighbours = useStoreValue((s) => s.showNeighbours);
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
        aria-label="Preferences"
        title="Theme, outline weight and what the canvas shows"
        onClick={() => setOpen((was) => !was)}
      >
        <PreferencesIcon />
      </button>

      {open ? (
        <div ref={ref} className={styles.panel} role="group" aria-label="Preferences">
          <div className={styles.row}>
            <span className={styles.label}>Theme</span>
            <div className={styles.choices} role="group" aria-label="Theme">
              {THEMES.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  className={styles.choice}
                  aria-pressed={theme === choice.id}
                  onClick={() => store.setTheme(choice.id)}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>

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
                onChange={(event) => store.setOutlineWidth(Number(event.target.value))}
              />
              <span className={styles.value}>{outlineWidth.toFixed(2)}</span>
            </div>
          </div>

          <Switch
            label="Auto-hide handles"
            hint="Show handles only near the work  (H)"
            on={autoHide}
            onChange={() => store.toggleAutoHideHandles()}
          />
          <Switch
            label="Snap to points"
            hint="Drags line up with the glyph's own points  (S)"
            on={snapPoints}
            onChange={() => store.toggleSnapPoints()}
          />
          <Switch
            label="Show neighbours"
            hint="Draw the letters either side, from the strip text"
            on={neighbours}
            onChange={() => store.toggleNeighbours()}
          />

          <div className={styles.footer}>
            <span className={styles.note}>Kept in this browser, not in the font.</span>
            <button type="button" className={styles.reset} onClick={() => store.resetPreferences()}>
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
