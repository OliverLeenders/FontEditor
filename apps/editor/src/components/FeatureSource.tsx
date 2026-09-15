import { wheelIntent } from "@typewright/view";
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";

import { type Token, highlightFea } from "../highlight.js";
import { type Edit, closeBrace, indent, newline, outdent } from "../indentation.js";
import styles from "./FeatureSource.module.css";

export type FeatureSourceHandle = {
  /** Put the cursor on a line, selected, and scroll it into view. */
  readonly goToLine: (line: number) => void;
};

/**
 * The feature source: a text box with the file coloured underneath it.
 *
 * The text box is the editor — typing, selecting, the caret, the clipboard and
 * everything the browser already does for text — with its own letters made
 * transparent. Under it lies the same text cut into coloured pieces, in the same
 * font at the same size and scrolled with it, so what shows through is the file
 * in colour with a working caret on top. Nothing is installed for it, and the
 * content security policy has nothing to say about a span. Each space shows as
 * a faint dot, which in a monospaced font is exactly as wide as the space it
 * stands for, so indentation can be counted rather than guessed at.
 *
 * Tab indents rather than leaving, since indenting is what a tab means in a
 * source file: four spaces to the next stop, or a level onto every selected
 * line, and Shift+Tab takes one off. Escape and then Tab leaves the box the way
 * Tab leaves any other field, so the key is not a trap for anyone on a
 * keyboard. Enter keeps the indentation, deeper after a `{`, and a `}` typed on
 * an indented line goes back a level.
 *
 * Lines are numbered in a gutter beside it, and the lines the compiler has a
 * problem with are marked there and underlined in the text. Ctrl and the wheel
 * set the text larger or smaller, as they set the type in the spacing line and
 * the proof.
 */
export function FeatureSource({
  value,
  onChange,
  problemLines,
  placeholder,
  size,
  onZoom,
  label = "Feature source",
  ref,
}: {
  value: string;
  onChange: (value: string) => void;
  problemLines: ReadonlySet<number>;
  placeholder: string;
  /** The size the text is set at, in pixels. */
  size: number;
  /** Ctrl and the wheel, as the factor to scale the size by. */
  onZoom: (factor: number) => void;
  /** What the text box is called, since there is more than one file. */
  label?: string;
  ref?: React.Ref<FeatureSourceHandle>;
}): React.JSX.Element {
  const editor = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const shadow = useRef<HTMLDivElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  // The selection an edit leaves, put back once the text it belongs to renders.
  const pending = useRef<{ start: number; end: number } | null>(null);
  // Escape was pressed, so the next Tab moves on rather than indenting.
  const leaving = useRef(false);
  // Read by the wheel listener, which is installed once.
  const zoom = useRef(onZoom);
  zoom.current = onZoom;

  const lines = useMemo(() => linesOf(highlightFea(value)), [value]);

  useLayoutEffect(() => {
    const at = pending.current;
    const box = area.current;
    if (at === null || box === null) return;
    pending.current = null;
    box.setSelectionRange(at.start, at.end);
  }, [value]);

  // Non-passive, because a ctrl-wheel this does not claim is one the browser
  // uses to zoom the whole editor. A plain wheel is left to scroll the text.
  useEffect(() => {
    const element = editor.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent): void => {
      const intent = wheelIntent(event);
      if (intent.kind !== "zoom") return;
      event.preventDefault();
      zoom.current(intent.factor);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  /** Keep the colours and the numbers under the text as it scrolls. */
  const follow = (): void => {
    const box = area.current;
    if (box === null) return;
    if (shadow.current !== null) {
      shadow.current.scrollTop = box.scrollTop;
      shadow.current.scrollLeft = box.scrollLeft;
    }
    if (gutter.current !== null) gutter.current.scrollTop = box.scrollTop;
  };

  // A new size moves every line, so the copy underneath catches up at once.
  useLayoutEffect(follow, [size]);

  useImperativeHandle(
    ref,
    () => ({
      goToLine(line: number) {
        const box = area.current;
        if (box === null) return;
        let start = 0;
        for (let n = 1; n < line; n += 1) {
          const next = value.indexOf("\n", start);
          if (next === -1) break;
          start = next + 1;
        }
        const stop = value.indexOf("\n", start);
        box.focus();
        box.setSelectionRange(start, stop === -1 ? value.length : stop);
        const height = Number.parseFloat(getComputedStyle(box).lineHeight);
        // Two lines of what comes before, so the line is read in its context.
        if (Number.isFinite(height)) box.scrollTop = Math.max(0, (line - 3) * height);
        follow();
      },
    }),
    [value],
  );

  const apply = (edit: Edit): void => {
    if (edit.text === value) {
      area.current?.setSelectionRange(edit.start, edit.end);
      return;
    }
    pending.current = { start: edit.start, end: edit.end };
    onChange(edit.text);
  };

  return (
    <div ref={editor} className={styles.editor} style={{ fontSize: `${String(size)}px` }}>
      <div ref={gutter} className={styles.gutter} aria-hidden="true">
        {lines.map((_, index) => (
          <div
            key={index}
            className={styles.number}
            data-problem={problemLines.has(index + 1) ? "" : undefined}
          >
            {index + 1}
          </div>
        ))}
      </div>
      <div className={styles.text}>
        <div ref={shadow} className={styles.shadow} aria-hidden="true">
          {lines.map((tokens, index) => (
            <div
              key={index}
              className={styles.row}
              data-problem={problemLines.has(index + 1) ? "" : undefined}
            >
              {tokens.length === 0
                ? // An empty line still needs its height.
                  " "
                : tokens.map((token, at) => (
                    <span key={at} data-kind={token.kind}>
                      {dotted(token.text)}
                    </span>
                  ))}
            </div>
          ))}
        </div>
        <textarea
          ref={area}
          className={styles.area}
          value={value}
          wrap="off"
          aria-label={label}
          spellCheck={false}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onScroll={follow}
          onKeyDown={(event) => {
            const box = event.currentTarget;
            const { selectionStart: start, selectionEnd: end } = box;
            const plain = !event.ctrlKey && !event.metaKey && !event.altKey;

            if (event.key === "Escape") {
              leaving.current = true;
              return;
            }
            if (event.key === "Tab") {
              if (leaving.current || !plain) {
                leaving.current = false;
                return;
              }
              event.preventDefault();
              apply(event.shiftKey ? outdent(value, start, end) : indent(value, start, end));
              return;
            }
            leaving.current = false;

            if (event.key === "Enter" && plain && !event.shiftKey) {
              event.preventDefault();
              apply(newline(value, start, end));
              return;
            }
            if (event.key === "}" && plain) {
              const edit = closeBrace(value, start, end);
              if (edit === null) return;
              event.preventDefault();
              apply(edit);
            }
          }}
        />
      </div>
    </div>
  );
}

/** A dot for every space, and the rest as written. */
function dotted(text: string): React.ReactNode {
  if (!text.includes(" ")) return text;
  return text.split(/( +)/).map((part, index) =>
    part.startsWith(" ") ? (
      <span key={index} className={styles.space}>
        {"·".repeat(part.length)}
      </span>
    ) : (
      part
    ),
  );
}

/** The pieces, a line at a time, with the newlines between them dropped. */
function linesOf(tokens: readonly Token[]): Token[][] {
  const lines: Token[][] = [[]];
  for (const token of tokens) {
    if (token.kind === "newline") lines.push([]);
    else lines[lines.length - 1]!.push(token);
  }
  return lines;
}
