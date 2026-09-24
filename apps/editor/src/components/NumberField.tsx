import { useEffect, useRef, useState } from "react";

import { type StepBounds, stepValue } from "../stepping.js";

/**
 * A box holding a number, which is not the same thing as a number.
 *
 * The fields in the inspector apply as they are typed, because the canvas is
 * showing the result and waiting for Enter would be waiting to see what you are
 * doing. Written the obvious way — the model's number in, `Number(text)` out —
 * that made the box unusable for anything but nudging what was already there.
 * Clear it to type a new value and the empty box is read as zero, which is
 * written straight back and fills the box with `0`. Type a minus to begin a
 * negative and the box holds nothing a number can be made of, so nothing is
 * written, and the field re-renders from the model and eats the character.
 *
 * So the text being typed is kept here, and only a text that *is* a number is
 * committed. An empty box, a lone `-`, a trailing `.` are all real states on the
 * way to a number and none of them changes the font. What the box shows follows
 * the model again as soon as the two disagree about the number — an undo, a drag
 * on the canvas, a value the model rounded — and settles back to the model's own
 * spelling when the field is left.
 *
 * The box is a text box rather than `type="number"`, which sounds backwards and
 * is the point: a number input refuses to hold what a half-typed number looks
 * like. The browser's own value sanitising throws away a lone `-` before any of
 * this can see it, and no amount of state here can put it back. What a number
 * input gives in return is the arrow keys, so those are handled below — with
 * shift for ten, which the browser's own never offered.
 */
export function NumberField({
  value,
  onCommit,
  label,
  title,
  className,
  disabled = false,
  step = 1,
  bigStep,
  bounds = {},
  placeholder,
}: {
  /** The number the model holds, or `null` where there is none to show. */
  readonly value: number | null;
  /** Called with every number the box becomes, as it is typed. */
  readonly onCommit: (next: number) => void;
  /** Named for the screen reader: "Left sidebearing", "X position". */
  readonly label: string;
  readonly title?: string | undefined;
  readonly className?: string | undefined;
  readonly disabled?: boolean;
  /** What an arrow key moves by, and what shift-arrow does; ten times, by default. */
  readonly step?: number;
  readonly bigStep?: number;
  readonly bounds?: StepBounds;
  readonly placeholder?: string | undefined;
}): React.JSX.Element {
  const [draft, setDraft] = useState(() => textOf(value));
  const input = useRef<HTMLInputElement>(null);

  /**
   * Follow the model, without taking the words out of anybody's mouth.
   *
   * Three cases. A draft that is not a number at all — empty, a lone `-`, a
   * trailing `.` — is somebody midway through typing one, and is left alone
   * until the field is left. A draft that *is* the model's number is left
   * exactly as typed, so `007` and `12.` and `-0` survive being written.
   * Anything else means the model has moved since — an undo, a drag on the
   * canvas, a rounding — and the box follows it.
   */
  useEffect(() => {
    const parsed = parse(draft);
    if (parsed === null || parsed === value) return;
    setDraft(textOf(value));
  }, [value, draft]);

  const take = (text: string): void => {
    setDraft(text);
    const parsed = parse(text);
    if (parsed !== null && parsed !== value) onCommit(parsed);
  };

  const arrow = (direction: 1 | -1, big: boolean): void => {
    // From the model's number rather than the draft's: an arrow adjusts what
    // the font holds, and a half-typed box has no number to adjust.
    if (value === null) return;
    onCommit(stepValue(value, big ? (bigStep ?? step * 10) : step, direction, bounds));
  };

  return (
    <input
      ref={input}
      className={className}
      type="text"
      // The numeric keypad where there is one, and no autocorrect anywhere.
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      aria-label={label}
      title={title}
      disabled={disabled}
      placeholder={placeholder}
      value={draft}
      // Leaving settles the box to the model's own spelling of what it holds,
      // which is what turns a half-typed `-` or an emptied box back into a
      // number rather than leaving it looking like an edit in progress.
      onBlur={() => setDraft(textOf(value))}
      onChange={(event) => take(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          arrow(event.key === "ArrowUp" ? 1 : -1, event.shiftKey);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          // Already committed as it was typed; this is the box saying so, by
          // settling to the model's spelling of what it now holds.
          setDraft(textOf(value));
          return;
        }
        if (event.key === "Escape") {
          // The edit rather than the panel: the box goes back to the number the
          // model has, and the keyboard stays where it is.
          event.stopPropagation();
          setDraft(textOf(value));
          input.current?.blur();
        }
      }}
    />
  );
}

/** The model's number as a box shows it, and nothing for a box with none. */
function textOf(value: number | null): string {
  return value === null ? "" : String(value);
}

/**
 * The number a box holds, or `null` when it holds something else.
 *
 * `null` for everything on the way to a number as much as for nonsense: an
 * empty box, `-`, `.`, `-.` are all states a person passes through and none of
 * them is a value to write.
 */
function parse(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
