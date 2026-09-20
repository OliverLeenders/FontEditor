import { useEffect, useMemo, useRef, useState } from "react";

import { type ShortcutGroup, SHORTCUTS } from "../shortcuts.js";
import styles from "./Shortcuts.module.css";
import { XIcon } from "./icons.js";

/**
 * Every key the editor answers to, one place at a time.
 *
 * The whole list on one sheet was a poster nobody could read: the canvas group
 * is three times the length of any other, so a column layout could not balance
 * around it, and which group followed which came out of how tall they happened
 * to be. Where a key works is the first thing somebody knows about it — "the
 * one in the spacing line", "the pen one" — so that is the navigation, and the
 * page shows one place at a time.
 *
 * The filter is the other half of the same question, asked by people who
 * half-remember the key rather than where it works. It narrows every place at
 * once and says beside each how many it matched, so what is not on this page is
 * still findable without opening every page in turn.
 *
 * It reads and does nothing else: there is no button here that runs a command,
 * since a list you can act from is a command palette, which is a larger thing
 * than a person asking what a key does.
 */
export function Shortcuts({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const [filter, setFilter] = useState("");

  /** Each place, with what the filter leaves of it. */
  const places = useMemo(() => {
    const wanted = filter.trim().toLowerCase();
    return SHORTCUTS.map((group) => ({
      group,
      items:
        wanted === ""
          ? group.items
          : group.items.filter((item) => matches(item.keys, wanted) || matches(item.what, wanted)),
    }));
  }, [filter]);

  const found = places.reduce((count, place) => count + place.items.length, 0);

  // A filter that empties the page moves to one it has not emptied, rather than
  // showing nothing while the answer sits behind another tab.
  useEffect(() => {
    if ((places[at]?.items.length ?? 0) > 0) return;
    const first = places.findIndex((place) => place.items.length > 0);
    if (first >= 0) setAt(first);
  }, [places, at]);

  // Focus lands on the one control, so Escape and Tab both have somewhere to
  // start from and the sheet does not leave the keyboard where the canvas was.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  /** Move along the rail, as a list of tabs is moved along. */
  const step = (to: number): void => {
    const next = Math.max(0, Math.min(places.length - 1, to));
    setAt(next);
    const buttons = railRef.current?.querySelectorAll<HTMLButtonElement>("button");
    buttons?.[next]?.focus();
  };

  const shown = places[at];

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className={styles.head}>
          <h2 className={styles.title}>Keyboard shortcuts</h2>
          <input
            type="search"
            className={styles.filter}
            placeholder="Filter"
            aria-label="Filter the shortcuts"
            spellCheck={false}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            title="Close"
            aria-label="Close the shortcuts"
            onClick={onClose}
          >
            <XIcon />
          </button>
        </div>

        <div className={styles.body}>
          {/* Where the keys work, which is the first thing anybody knows about
              the key they are looking for. */}
          <div
            ref={railRef}
            className={styles.rail}
            role="tablist"
            aria-orientation="vertical"
            aria-label="Where the keys work"
            onKeyDown={(event) => {
              const moves: Record<string, number | undefined> = {
                ArrowDown: at + 1,
                ArrowUp: at - 1,
                Home: 0,
                End: places.length - 1,
              };
              const to = moves[event.key];
              if (to === undefined) return;
              event.preventDefault();
              step(to);
            }}
          >
            {places.map((place, index) => (
              <button
                key={place.group.title}
                type="button"
                role="tab"
                id={tabId(place.group)}
                className={styles.place}
                aria-selected={index === at}
                aria-controls={panelId}
                tabIndex={index === at ? 0 : -1}
                // Emptied by the filter rather than by having nothing in it: the
                // row stays, so the list of places does not change shape under
                // somebody typing.
                data-empty={place.items.length === 0 ? "true" : undefined}
                onClick={() => setAt(index)}
              >
                <span className={styles.placeName}>{place.group.title}</span>
                <span className={styles.placeCount}>{place.items.length}</span>
              </button>
            ))}
          </div>

          <div
            className={styles.page}
            role="tabpanel"
            id={panelId}
            aria-labelledby={shown === undefined ? undefined : tabId(shown.group)}
            tabIndex={0}
          >
            {shown === undefined || shown.items.length === 0 ? (
              <p className={styles.nothing}>
                {found === 0 ? `No key matches “${filter.trim()}”` : "Nothing here matches"}
              </p>
            ) : (
              <>
                <h3 className={styles.pageTitle}>{shown.group.title}</h3>
                {shown.group.note === undefined ? null : (
                  <p className={styles.pageNote}>{shown.group.note}</p>
                )}
                <dl className={styles.items}>
                  {shown.items.map((item) => (
                    <div key={item.keys} className={styles.pair}>
                      <dt className={styles.keys}>
                        {/* One shortcut, and then the other ways of asking for
                            the same thing: drawn apart, since a bullet between
                            two keys reads as part of the key. */}
                        {splitKeys(item.keys).map((alternative, index) => (
                          <span key={alternative} className={styles.alternative}>
                            {index === 0 ? null : <span className={styles.or}>or</span>}
                            {keyParts(alternative).map((part, place) =>
                              part.key ? (
                                <kbd key={`${part.text}${String(place)}`} className={styles.key}>
                                  {part.text}
                                </kbd>
                              ) : (
                                <span
                                  key={`${part.text}${String(place)}`}
                                  className={styles.saying}
                                >
                                  {part.text}
                                </span>
                              ),
                            )}
                          </span>
                        ))}
                      </dt>
                      <dd className={styles.what}>{item.what}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The ids the tabs and the page name each other by. */
const panelId = "shortcuts-page";
const tabId = (group: ShortcutGroup): string =>
  `shortcuts-${group.title.toLowerCase().replace(/[^a-z]+/g, "-")}`;

function matches(text: string, wanted: string): boolean {
  return text.toLowerCase().includes(wanted);
}

/**
 * The ways of asking for one thing, told apart from the keys of one way.
 *
 * `Ctrl-Shift-Z · Ctrl-Y` is two shortcuts for redo; `V P K R E L` is six keys
 * listed together because the sentence beside them lists six tools. The bullet
 * is what separates alternatives, and everything else is left as written.
 */
export function splitKeys(keys: string): string[] {
  return keys
    .split("·")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/** Key names of two words, which a split on spaces would make two keys of. */
const COMPOUND = ["Page Up", "Page Down"];

/**
 * The words in a shortcut that are not keys.
 *
 * Several of these are gestures rather than presses, and a gesture is written
 * as it is said: "Alt-drag a handle", "M held", "click the first point". The
 * keys in those are drawn as keys and the rest as what it is — a sentence — so
 * that a cap on the sheet always means something to press.
 */
const SAYING = new Set(["held", "the", "first", "point", "then", "a", "handle", "corner"]);

/** One way of asking for something, cut into keys to draw and words to read. */
export function keyParts(alternative: string): { text: string; key: boolean }[] {
  const parts: { text: string; key: boolean }[] = [];
  let said: string[] = [];

  const flush = (): void => {
    if (said.length > 0) parts.push({ text: said.join(" "), key: false });
    said = [];
  };

  let rest = alternative;
  while (rest !== "") {
    const compound = COMPOUND.find((name) => rest.startsWith(name));
    if (compound !== undefined) {
      flush();
      parts.push({ text: compound, key: true });
      rest = rest.slice(compound.length).trimStart();
      continue;
    }

    const cut = rest.indexOf(" ");
    const word = cut < 0 ? rest : rest.slice(0, cut);
    rest = cut < 0 ? "" : rest.slice(cut + 1);

    if (SAYING.has(word)) said.push(word);
    else {
      flush();
      parts.push({ text: word, key: true });
    }
  }

  flush();
  return parts;
}
