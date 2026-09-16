import { wheelIntent } from "@typewright/view";
import {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { type Completion, completionsAt, glyphAt } from "../completion.js";
import { type Token, highlightFea } from "../highlight.js";
import { type Edit, closeBrace, indent, newline, outdent } from "../indentation.js";
import { type Match, type SearchOptions, findAll, matchFrom, replaced } from "../search.js";
import styles from "./FeatureSource.module.css";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "./icons.js";

export type FeatureSourceHandle = {
  /** Put the cursor on a line, selected, and scroll it into view. */
  readonly goToLine: (line: number) => void;
};

/** The completion list on screen: what it offers, which is chosen, and where it sits. */
type Popup = {
  readonly from: number;
  readonly to: number;
  readonly items: readonly Completion[];
  readonly index: number;
  readonly line: number;
  readonly column: number;
  /** Opened with Ctrl+Space, so it stays open however little is typed. */
  readonly asked: boolean;
};

type Find = SearchOptions & {
  readonly query: string;
  readonly replacement: string;
  readonly replacing: boolean;
};

type Span = { readonly start: number; readonly end: number };

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
 *
 * Names are completed as they are typed, from a list under the caret that
 * Enter takes from and Escape closes — Tab is left to indent. Ctrl+F finds and
 * Ctrl+H replaces, with the matches marked in a third copy of the text under
 * the colours. A glyph name the font has opens its glyph on Ctrl+click or F12,
 * and is underlined while Ctrl is held over it.
 */
export function FeatureSource({
  value,
  onChange,
  problemLines,
  placeholder,
  size,
  onZoom,
  label = "Feature source",
  names = [],
  isGlyph = () => false,
  onOpenGlyph,
  ref,
}: {
  value: string;
  /** A replacement comes `apart`: its own step, never merged into typing. */
  onChange: (value: string, apart?: boolean) => void;
  problemLines: ReadonlySet<number>;
  placeholder: string;
  /** The size the text is set at, in pixels. */
  size: number;
  /** Ctrl and the wheel, as the factor to scale the size by. */
  onZoom: (factor: number) => void;
  /** What the text box is called, since there is more than one file. */
  label?: string;
  /** The font's glyph names, in its order, to complete from. */
  names?: readonly string[];
  /** Whether the font has a glyph by this name, so that it can be opened. */
  isGlyph?: (name: string) => boolean;
  /** Open a glyph by name. Without it, names do not open. */
  onOpenGlyph?: ((name: string) => void) | undefined;
  ref?: React.Ref<FeatureSourceHandle>;
}): React.JSX.Element {
  const editor = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const shadow = useRef<HTMLDivElement>(null);
  const found = useRef<HTMLDivElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const findField = useRef<HTMLInputElement>(null);
  // The selection an edit leaves, put back once the text it belongs to renders.
  const pending = useRef<{ start: number; end: number } | null>(null);
  // …and scrolled into view as well, for a replacement.
  const revealing = useRef(false);
  // Escape was pressed, so the next Tab moves on rather than indenting.
  const leaving = useRef(false);
  // Where the pointer last was over the text, for Ctrl pressed without moving it.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  // Read by the wheel listener, which is installed once.
  const zoom = useRef(onZoom);
  zoom.current = onZoom;
  const listId = useId();

  const [popup, setPopup] = useState<Popup | null>(null);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const [find, setFind] = useState<Find | null>(null);
  const [current, setCurrent] = useState(0);
  const [findFocus, setFindFocus] = useState(0);
  const [link, setLink] = useState<Span | null>(null);

  const lines = useMemo(() => linesOf(highlightFea(value)), [value]);
  const starts = useMemo(() => lineStarts(value), [value]);
  const matches = useMemo(
    () => (find === null ? [] : findAll(value, find.query, find)),
    [value, find],
  );
  const shown = matches.length === 0 ? -1 : Math.min(current, matches.length - 1);

  useLayoutEffect(() => {
    const at = pending.current;
    const box = area.current;
    if (at === null || box === null) return;
    pending.current = null;
    box.setSelectionRange(at.start, at.end);
    if (revealing.current) {
      revealing.current = false;
      revealIn(box, value, at, measure.current?.getBoundingClientRect().width ?? 0);
    }
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

  // The find field takes the keyboard each time the bar is asked for.
  useEffect(() => {
    if (findFocus === 0) return;
    findField.current?.focus();
    findField.current?.select();
  }, [findFocus]);

  // The chosen completion stays in sight as the arrows move through a long list.
  useLayoutEffect(() => {
    const box = list.current;
    if (popup === null || box === null) return;
    const item = box.children[popup.index];
    if (!(item instanceof HTMLElement)) return;
    if (item.offsetTop < box.scrollTop) box.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = item.offsetTop + item.offsetHeight - box.clientHeight;
    }
  }, [popup]);

  /** Keep the colours, the matches and the numbers under the text as it scrolls. */
  const follow = (): void => {
    const box = area.current;
    if (box === null) return;
    for (const layer of [shadow.current, found.current]) {
      if (layer === null) continue;
      layer.scrollTop = box.scrollTop;
      layer.scrollLeft = box.scrollLeft;
    }
    if (gutter.current !== null) gutter.current.scrollTop = box.scrollTop;
  };

  // A new size moves every line, so the copies underneath catch up at once, and
  // so does a copy of the matches that has just appeared.
  const marking = matches.length > 0;
  useLayoutEffect(follow, [size, marking]);

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

  // ---- completion ---------------------------------------------------------

  const complete = (text: string, caret: number, asked: boolean): void => {
    const offered = completionsAt(text, caret, names, asked);
    if (offered === null) {
      setPopup(null);
      return;
    }
    const box = area.current;
    if (box !== null) setScroll({ top: box.scrollTop, left: box.scrollLeft });
    const { line, column } = placeOf(text, offered.from);
    setPopup({ ...offered, index: 0, line, column, asked });
  };

  const accept = (open: Popup, item: Completion): void => {
    const text = value.slice(0, open.from) + item.label + value.slice(open.to);
    const at = open.from + item.label.length;
    setPopup(null);
    apply({ text, start: at, end: at });
  };

  // ---- opening glyphs -----------------------------------------------------

  /** The name of a glyph the font has at a place; `inside` leaves out the place just past it. */
  const glyphUnder = (offset: number, inside: boolean): (Span & { name: string }) | null => {
    const hit = glyphAt(value, offset);
    if (hit === null || !isGlyph(hit.name)) return null;
    if (inside && offset >= hit.end) return null;
    return hit;
  };

  /** The character under a point on screen, as an offset, or `null` past the end of its line. */
  const offsetAt = (x: number, y: number): number | null => {
    const box = area.current;
    const probe = measure.current;
    if (box === null || probe === null) return null;
    const style = getComputedStyle(box);
    const height = Number.parseFloat(style.lineHeight);
    const width = probe.getBoundingClientRect().width;
    if (!(height > 0) || !(width > 0)) return null;
    const rect = box.getBoundingClientRect();
    const line = Math.floor(
      (y - rect.top - Number.parseFloat(style.paddingTop) + box.scrollTop) / height,
    );
    const column = Math.floor(
      (x - rect.left - Number.parseFloat(style.paddingLeft) + box.scrollLeft) / width,
    );
    const start = starts[line];
    if (start === undefined || column < 0) return null;
    const next = starts[line + 1];
    const end = next === undefined ? value.length : next - 1;
    return start + column < end ? start + column : null;
  };

  const hover = (held: boolean): void => {
    const at = pointer.current;
    const offset = held && at !== null && onOpenGlyph !== undefined ? offsetAt(at.x, at.y) : null;
    const hit = offset === null ? null : glyphUnder(offset, true);
    setLink((was) =>
      hit === null
        ? null
        : was !== null && was.start === hit.start && was.end === hit.end
          ? was
          : { start: hit.start, end: hit.end },
    );
  };

  // ---- find and replace ---------------------------------------------------

  const showMatch = (match: Match): void => {
    const box = area.current;
    if (box === null) return;
    box.setSelectionRange(match.start, match.end);
    revealIn(box, value, match, measure.current?.getBoundingClientRect().width ?? 0);
  };

  const openFind = (replacing: boolean): void => {
    const box = area.current;
    const selected = box === null ? "" : value.slice(box.selectionStart, box.selectionEnd);
    const query = selected !== "" && !selected.includes("\n") ? selected : (find?.query ?? "");
    const next: Find = {
      query,
      replacement: find?.replacement ?? "",
      replacing: replacing || (find?.replacing ?? false),
      matchCase: find?.matchCase ?? false,
      wholeWord: find?.wholeWord ?? false,
    };
    setFind(next);
    setCurrent(Math.max(0, matchFrom(findAll(value, query, next), box?.selectionStart ?? 0)));
    setFindFocus((n) => n + 1);
  };

  const changeFind = (next: Find): void => {
    setFind(next);
    if (find !== null && next.query === find.query && next.matchCase === find.matchCase) {
      if (next.wholeWord === find.wholeWord) return;
    }
    const hits = findAll(value, next.query, next);
    const index = matchFrom(hits, area.current?.selectionStart ?? 0);
    setCurrent(Math.max(0, index));
    if (index >= 0) showMatch(hits[index]!);
  };

  const step = (by: number): void => {
    if (matches.length === 0) return;
    const index = (shown + by + matches.length) % matches.length;
    setCurrent(index);
    showMatch(matches[index]!);
  };

  const replaceCurrent = (): void => {
    if (find === null || shown < 0) return;
    const match = matches[shown]!;
    const text = replaced(value, [match], find.replacement);
    if (text === value) {
      step(1);
      return;
    }
    const after = findAll(text, find.query, find);
    const index = matchFrom(after, match.start + find.replacement.length);
    setCurrent(Math.max(0, index));
    if (index >= 0) {
      pending.current = after[index]!;
      revealing.current = true;
    }
    onChange(text, true);
  };

  // One change, so one undo takes every replacement back.
  const replaceEvery = (): void => {
    if (find === null || matches.length === 0) return;
    setCurrent(0);
    onChange(replaced(value, matches, find.replacement), true);
  };

  const closeFind = (): void => {
    setFind(null);
    area.current?.focus();
  };

  return (
    <div
      ref={editor}
      className={styles.editor}
      style={{ fontSize: `${String(size)}px` }}
      onKeyDown={(event) => {
        const modified = (event.ctrlKey || event.metaKey) && !event.altKey;
        const key = event.key.toLowerCase();
        if (modified && (key === "f" || key === "h")) {
          event.preventDefault();
          openFind(key === "h");
        }
      }}
    >
      {find === null ? null : (
        <FindBar
          find={find}
          count={matches.length}
          current={shown}
          field={findField}
          onChange={changeFind}
          onStep={step}
          onReplace={replaceCurrent}
          onReplaceAll={replaceEvery}
          onClose={closeFind}
        />
      )}
      <div className={styles.panes}>
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
          <span ref={measure} className={styles.measure} aria-hidden="true">
            0
          </span>
          {marking ? (
            <div ref={found} className={styles.found} aria-hidden="true">
              {foundRows(value, starts, matches, shown)}
            </div>
          ) : null}
          <div ref={shadow} className={styles.shadow} aria-hidden="true">
            {lines.map((tokens, index) => {
              let at = starts[index] ?? 0;
              return (
                <div
                  key={index}
                  className={styles.row}
                  data-problem={problemLines.has(index + 1) ? "" : undefined}
                >
                  {tokens.length === 0
                    ? // An empty line still needs its height.
                      " "
                    : tokens.map((token, n) => {
                        const start = at;
                        at += token.text.length;
                        return (
                          <span
                            key={n}
                            data-kind={token.kind}
                            data-link={link !== null && link.start === start ? "" : undefined}
                          >
                            {dotted(token.text)}
                          </span>
                        );
                      })}
                </div>
              );
            })}
          </div>
          <textarea
            ref={area}
            className={styles.area}
            value={value}
            wrap="off"
            aria-label={label}
            aria-autocomplete="list"
            aria-controls={popup === null ? undefined : listId}
            aria-activedescendant={popup === null ? undefined : `${listId}-${String(popup.index)}`}
            data-link={link === null ? undefined : ""}
            spellCheck={false}
            placeholder={placeholder}
            onChange={(event) => {
              const box = event.currentTarget;
              const text = box.value;
              // A character typed, rather than a paste or a cut: the list offers
              // itself as a word is written, and follows it once open.
              const typed = text.length === value.length + 1;
              onChange(text);
              if (typed || popup !== null)
                complete(text, box.selectionStart, popup?.asked ?? false);
            }}
            onScroll={(event) => {
              follow();
              if (popup !== null) {
                setScroll({
                  top: event.currentTarget.scrollTop,
                  left: event.currentTarget.scrollLeft,
                });
              }
            }}
            onBlur={() => {
              setPopup(null);
              setLink(null);
            }}
            onClick={(event) => {
              setPopup(null);
              if (!(event.ctrlKey || event.metaKey) || onOpenGlyph === undefined) return;
              const hit = glyphUnder(event.currentTarget.selectionStart, false);
              if (hit !== null) onOpenGlyph(hit.name);
            }}
            onMouseMove={(event) => {
              pointer.current = { x: event.clientX, y: event.clientY };
              if (event.ctrlKey || event.metaKey) hover(true);
              else if (link !== null) setLink(null);
            }}
            onMouseLeave={() => {
              pointer.current = null;
              setLink(null);
            }}
            onKeyUp={(event) => {
              if (event.key === "Control" || event.key === "Meta") setLink(null);
            }}
            onKeyDown={(event) => {
              const box = event.currentTarget;
              const { selectionStart: start, selectionEnd: end } = box;
              const plain = !event.ctrlKey && !event.metaKey && !event.altKey;

              if (event.key === "Control" || event.key === "Meta") {
                hover(true);
                return;
              }

              if (popup !== null) {
                const count = popup.items.length;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const by = event.key === "ArrowDown" ? 1 : -1;
                  setPopup({ ...popup, index: (popup.index + by + count) % count });
                  return;
                }
                if (event.key === "Enter" && plain && !event.shiftKey) {
                  event.preventDefault();
                  accept(popup, popup.items[popup.index]!);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setPopup(null);
                  return;
                }
                // Moving the caret away, or any other key that is not a
                // character, is leaving the word the list was for.
                if (event.key.length > 1 && event.key !== "Backspace" && event.key !== "Shift") {
                  setPopup(null);
                }
              }

              if (event.ctrlKey && !event.altKey && event.key === " ") {
                event.preventDefault();
                complete(value, start, true);
                return;
              }

              if (event.key === "F12" && plain) {
                const hit = glyphUnder(start, false);
                if (hit !== null && onOpenGlyph !== undefined) {
                  event.preventDefault();
                  onOpenGlyph(hit.name);
                }
                return;
              }

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
          {popup === null ? null : (
            <ul
              ref={list}
              id={listId}
              role="listbox"
              aria-label="Completions"
              className={styles.completions}
              style={{
                left: `calc(1rem + ${String(popup.column)}ch - ${String(scroll.left)}px)`,
                top: `calc(0.8rem + ${String(popup.line + 1)} * 1.6em - ${String(scroll.top)}px)`,
              }}
            >
              {popup.items.map((item, index) => (
                <li
                  key={`${item.kind}-${item.label}`}
                  id={`${listId}-${String(index)}`}
                  role="option"
                  aria-selected={index === popup.index}
                  className={styles.completion}
                  // Pressed without taking the keyboard from the text.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    accept(popup, item);
                  }}
                >
                  <span>{item.label}</span>
                  <span className={styles.kind}>{item.kind}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Find, and replace: a bar over the source.
 *
 * Enter and Shift+Enter in the find field go to the next and previous match,
 * Enter in the replace field replaces the one shown, and Escape in either
 * closes the bar and gives the keyboard back to the text.
 */
function FindBar({
  find,
  count,
  current,
  field,
  onChange,
  onStep,
  onReplace,
  onReplaceAll,
  onClose,
}: {
  find: Find;
  count: number;
  current: number;
  field: React.Ref<HTMLInputElement>;
  onChange: (next: Find) => void;
  onStep: (by: number) => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const leave = (event: React.KeyboardEvent): boolean => {
    if (event.key !== "Escape") return false;
    event.preventDefault();
    onClose();
    return true;
  };

  return (
    <div className={styles.find} role="search" aria-label="Find in the source">
      <div className={styles.findRow}>
        <input
          ref={field}
          className={styles.findField}
          aria-label="Find"
          placeholder="Find"
          spellCheck={false}
          value={find.query}
          onChange={(event) => onChange({ ...find, query: event.target.value })}
          onKeyDown={(event) => {
            if (leave(event) || event.key !== "Enter") return;
            event.preventDefault();
            onStep(event.shiftKey ? -1 : 1);
          }}
        />
        <span className={styles.findCount} aria-live="polite">
          {find.query === ""
            ? ""
            : count === 0
              ? "No results"
              : `${String(current + 1)} of ${String(count)}`}
        </span>
        <button
          type="button"
          className={styles.findButton}
          aria-label="Previous match"
          title="Previous match (Shift-Enter)"
          disabled={count === 0}
          onClick={() => onStep(-1)}
        >
          <ChevronUpIcon />
        </button>
        <button
          type="button"
          className={styles.findButton}
          aria-label="Next match"
          title="Next match (Enter)"
          disabled={count === 0}
          onClick={() => onStep(1)}
        >
          <ChevronDownIcon />
        </button>
        <button
          type="button"
          className={styles.findButton}
          aria-label="Match case"
          title="Match case"
          aria-pressed={find.matchCase}
          onClick={() => onChange({ ...find, matchCase: !find.matchCase })}
        >
          Aa
        </button>
        <button
          type="button"
          className={`${styles.findButton} ${styles.word}`}
          aria-label="Whole word"
          title="Whole word"
          aria-pressed={find.wholeWord}
          onClick={() => onChange({ ...find, wholeWord: !find.wholeWord })}
        >
          ab
        </button>
        {find.replacing ? null : (
          <button
            type="button"
            className={styles.findButton}
            title="Replace (Ctrl-H)"
            onClick={() => onChange({ ...find, replacing: true })}
          >
            Replace…
          </button>
        )}
        <button
          type="button"
          className={`${styles.findButton} ${styles.findClose}`}
          aria-label="Close find"
          title="Close (Escape)"
          onClick={onClose}
        >
          <XIcon />
        </button>
      </div>
      {find.replacing ? (
        <div className={styles.findRow}>
          <input
            className={styles.findField}
            aria-label="Replace with"
            placeholder="Replace with"
            spellCheck={false}
            value={find.replacement}
            onChange={(event) => onChange({ ...find, replacement: event.target.value })}
            onKeyDown={(event) => {
              if (leave(event) || event.key !== "Enter") return;
              event.preventDefault();
              onReplace();
            }}
          />
          <button
            type="button"
            className={styles.findButton}
            disabled={count === 0}
            onClick={onReplace}
          >
            Replace
          </button>
          <button
            type="button"
            className={styles.findButton}
            disabled={count === 0}
            onClick={onReplaceAll}
          >
            Replace all
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Where every line starts. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) {
    starts.push(at + 1);
  }
  return starts;
}

/** The line and the column an offset is at, counting a tab to its next stop of four. */
function placeOf(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;
  let column = 0;
  for (const ch of before.slice(lineStart))
    column = ch === "\t" ? column + 4 - (column % 4) : column + 1;
  return { line: before.split("\n").length - 1, column };
}

/** Scroll a text box just enough to show a span, if it is out of sight. */
function revealIn(box: HTMLTextAreaElement, text: string, span: Span, charWidth: number): void {
  const height = Number.parseFloat(getComputedStyle(box).lineHeight);
  const { line, column } = placeOf(text, span.start);
  if (Number.isFinite(height) && height > 0) {
    const top = line * height;
    if (top < box.scrollTop || top + 2 * height > box.scrollTop + box.clientHeight) {
      box.scrollTop = Math.max(0, top - 2 * height);
    }
  }
  if (charWidth > 0) {
    const left = column * charWidth;
    if (left < box.scrollLeft || left + 4 * charWidth > box.scrollLeft + box.clientWidth) {
      box.scrollLeft = Math.max(0, left - box.clientWidth / 2);
    }
  }
}

/** The text again, invisible, with each match marked and the one shown marked apart. */
function foundRows(
  text: string,
  starts: readonly number[],
  matches: readonly Match[],
  current: number,
): React.ReactNode[] {
  let next = 0;
  return starts.map((start, line) => {
    const following = starts[line + 1];
    const end = following === undefined ? text.length : following - 1;
    const parts: React.ReactNode[] = [];
    let at = start;
    while (next < matches.length && matches[next]!.start < end) {
      const match = matches[next]!;
      if (match.start >= start) {
        parts.push(text.slice(at, match.start));
        const stop = Math.min(match.end, end);
        parts.push(
          <mark key={next} data-current={next === current ? "" : undefined}>
            {text.slice(match.start, stop)}
          </mark>,
        );
        at = stop;
      }
      next += 1;
    }
    parts.push(text.slice(at, end) || (parts.length === 0 ? " " : ""));
    return (
      <div key={line} className={styles.row}>
        {parts}
      </div>
    );
  });
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
