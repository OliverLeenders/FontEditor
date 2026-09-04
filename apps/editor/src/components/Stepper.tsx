import { useEffect, useRef } from "react";

import { type StepBounds, canStep, stepValue } from "../stepping.js";
import styles from "./Stepper.module.css";
import { ChevronDownIcon, ChevronUpIcon } from "./icons.js";

/**
 * The up and down beside a number field.
 *
 * Ours rather than the browser's. The platform's spinners are eleven pixels of
 * arrow drawn to a different grid than everything around them, and they are the
 * one control in the editor that no token reaches — which is why a dark editor
 * had a white box in the corner of every number field.
 *
 * It wraps a field rather than replacing it. Each caller keeps its own input and
 * its own idea of when a value is committed — the inspector's fields apply as
 * you type because the canvas is showing the result, and the font info fields
 * wait for you to finish. A stepper that owned the input would have to pick one.
 */

/** How long a press waits before it starts repeating, and how fast it then goes. */
const HOLD_DELAY_MS = 400;
const REPEAT_MS = 60;

export function Stepper({
  value,
  step = 1,
  bigStep,
  bounds = {},
  disabled = false,
  label,
  onStep,
  children,
}: {
  /** The value the arrows work from, or `null` when there is nothing to step. */
  readonly value: number | null;
  readonly step?: number;
  /** The step with shift held. Ten times, unless a caller says otherwise. */
  readonly bigStep?: number;
  readonly bounds?: StepBounds;
  readonly disabled?: boolean;
  /** Named for the screen reader: "Advance", "Ascender". */
  readonly label: string;
  readonly onStep: (next: number) => void;
  /** The field itself. */
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const repeat = useRef<number | null>(null);

  // A press that ends outside the button, or during a re-render that takes the
  // button away, must not leave a timer running on a value nobody is watching.
  useEffect(() => stopOn(repeat), []);

  // One handle for both phases of a press: the delay before it repeats is a
  // timeout and the repeat is an interval, and whichever is pending has to go.
  const stop = (): void => {
    if (repeat.current !== null) {
      window.clearTimeout(repeat.current);
      window.clearInterval(repeat.current);
    }
    repeat.current = null;
  };

  const press = (direction: 1 | -1, big: boolean): void => {
    if (value === null || disabled) return;
    const size = big ? (bigStep ?? step * 10) : step;

    // The first step happens on the press rather than after the delay, so a
    // single click is immediate and only a held button repeats.
    let at = stepValue(value, size, direction, bounds);
    onStep(at);

    stop();
    repeat.current = window.setTimeout(() => {
      repeat.current = window.setInterval(() => {
        const next = stepValue(at, size, direction, bounds);
        if (next === at) {
          stop();
          return;
        }
        at = next;
        onStep(at);
      }, REPEAT_MS);
    }, HOLD_DELAY_MS);
  };

  const arrow = (direction: 1 | -1): React.JSX.Element => {
    const dead = disabled || value === null || !canStep(value, step, direction, bounds);
    return (
      <button
        type="button"
        className={styles.arrow}
        tabIndex={-1}
        disabled={dead}
        aria-label={`${direction > 0 ? "Increase" : "Decrease"} ${label}`}
        title={`${direction > 0 ? "Increase" : "Decrease"} — hold shift for ten`}
        onPointerDown={(event) => {
          // The field keeps the focus: stepping is an adjustment to the value
          // being edited, not a move away from it.
          event.preventDefault();
          press(direction, event.shiftKey);
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
      >
        {direction > 0 ? <ChevronUpIcon /> : <ChevronDownIcon />}
      </button>
    );
  };

  return (
    <div className={styles.holder}>
      {children}
      {/* Out of the tab order: the arrow keys already step a number field, and
          two more stops on the way to the next field would be two more for
          something a keyboard user can already do. Each button still names
          itself, so a pointer user on a screen reader is told what it is. */}
      <span className={styles.arrows}>
        {arrow(1)}
        {arrow(-1)}
      </span>
    </div>
  );
}

/** Clear a pending press when the component goes away mid-hold. */
function stopOn(timer: React.RefObject<number | null>): () => void {
  return () => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    window.clearInterval(timer.current);
  };
}
