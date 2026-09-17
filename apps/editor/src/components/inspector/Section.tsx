import { useEffect, useRef, useState } from "react";

import { useEditorStore, useStoreValue } from "../../useStore.js";
import styles from "../Inspector.module.css";
import { ChevronRightIcon, type IconComponent } from "../icons.js";

/**
 * One folding section of the inspector.
 *
 * The panel grew from three fields to a dozen, and a dozen fields is a list
 * somebody scrolls rather than a panel somebody reads. Folding is the answer,
 * and the only question worth thinking about is what a section does before
 * anyone has said anything about it.
 *
 * The answer here: it opens if it is relevant. A section with anchors in it
 * opens, one with none stays out of the way, and the fields you are always
 * using are always open. What is remembered is the *choice* — which section
 * somebody folded or unfolded by hand — rather than the state, so a section
 * nobody has touched keeps following the work, and one you closed stays closed
 * even when it fills up.
 *
 * A section with nothing in it at all is the one case where the remembered
 * choice gives way: a Point section held open by a choice made an hour ago is
 * a column of dashes, and a panel of those says nothing about the glyph. So an
 * empty section folds, and says in its own title bar what it is short of. The
 * choice is not forgotten — it applies again the moment there is something to
 * show — and a click still opens the section, which is how the buttons in an
 * empty Layers or Guides section stay reachable. That click lasts until the
 * section fills or empties again, rather than being remembered as a choice: it
 * was about this moment.
 */
export function Section({
  name,
  title,
  icon: Icon,
  note,
  relevant = true,
  empty = false,
  emptyNote,
  children,
}: {
  /** The key the choice is remembered under. Stable, and not the title. */
  readonly name: string;
  readonly title: string;
  /**
   * What this section is about, as a drawing.
   *
   * Folded, a section is a row of small uppercase words, and eight of those
   * are read one at a time. The icon is what makes the closed panel scannable
   * — the anchor, the ruler, the picture — and it is the same mark wherever
   * else in the app that thing appears.
   */
  readonly icon: IconComponent;
  /** A count or a word shown after the title, when there is one worth showing. */
  readonly note?: string | undefined;
  /** Whether this would open on its own, having heard nothing from anyone. */
  readonly relevant?: boolean;
  /**
   * Nothing to show: no point selected, no anchors, no curve under the caret.
   *
   * What it is short of goes in {@link emptyNote}, which takes the title bar's
   * note while it lasts.
   */
  readonly empty?: boolean;
  /** What the title bar says instead of a count while the section is empty. */
  readonly emptyNote?: string | undefined;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const store = useEditorStore();
  const chosen = useStoreValue((s) => s.inspector.sections[name]);

  // Opened or folded by hand while there was nothing in it. Dropped as soon as
  // the section fills or empties again, so it never outlives what it was about.
  const [now, setNow] = useState<boolean | null>(null);
  const was = useRef(empty);
  useEffect(() => {
    if (was.current !== empty) {
      was.current = empty;
      setNow(null);
    }
  }, [empty]);

  const open = now ?? (empty ? false : (chosen ?? relevant));
  const say = (to: boolean): void => {
    if (empty) setNow(to);
    else store.toggleInspectorSection(name, to);
  };

  const shortOf = empty ? emptyNote : note;

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHead}>
        <button
          type="button"
          className={styles.sectionToggle}
          aria-expanded={open}
          onClick={() => say(!open)}
        >
          <span className={styles.chevron} data-open={open ? "true" : undefined}>
            <ChevronRightIcon />
          </span>
          <span className={styles.sectionIcon}>
            <Icon />
          </span>
          <span className={styles.sectionTitle}>{title}</span>
          {shortOf === undefined || shortOf === "" ? null : (
            <span className={styles.sectionNote} data-empty={empty ? "true" : undefined}>
              {shortOf}
            </span>
          )}
        </button>
      </h2>
      {open ? <div className={styles.sectionBody}>{children}</div> : null}
    </section>
  );
}
