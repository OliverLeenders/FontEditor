import { useEffect, useRef } from "react";

import { SHORTCUTS } from "../shortcuts.js";
import styles from "./Shortcuts.module.css";
import { XIcon } from "./icons.js";

/**
 * Every key the editor answers to, on one sheet.
 *
 * Over the whole editor rather than beside a workspace, because the keys are
 * grouped by where they work and most of them are somewhere other than wherever
 * the question mark was pressed. It reads and does nothing else: there is no
 * button here that runs a command, since a list you can act from is a command
 * palette, which is a larger thing than a person asking what a key does.
 *
 * Escape closes it and the backdrop closes it, the two things every panel here
 * already does.
 */
export function Shortcuts({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null);

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

        <div className={styles.groups}>
          {SHORTCUTS.map((group) => (
            <section key={group.title} className={styles.group}>
              <h3 className={styles.groupTitle}>{group.title}</h3>
              {group.note === undefined ? null : <p className={styles.groupNote}>{group.note}</p>}
              <dl className={styles.items}>
                {group.items.map((item) => (
                  <div key={item.keys} className={styles.pair}>
                    <dt className={styles.keys}>{item.keys}</dt>
                    <dd className={styles.what}>{item.what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
