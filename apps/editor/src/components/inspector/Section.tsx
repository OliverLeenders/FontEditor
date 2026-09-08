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
 */
export function Section({
  name,
  title,
  icon: Icon,
  note,
  relevant = true,
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
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const store = useEditorStore();
  const chosen = useStoreValue((s) => s.inspector.sections[name]);
  const open = chosen ?? relevant;

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHead}>
        <button
          type="button"
          className={styles.sectionToggle}
          aria-expanded={open}
          onClick={() => store.toggleInspectorSection(name, !open)}
        >
          <span className={styles.chevron} data-open={open ? "true" : undefined}>
            <ChevronRightIcon />
          </span>
          <span className={styles.sectionIcon}>
            <Icon />
          </span>
          <span className={styles.sectionTitle}>{title}</span>
          {note === undefined || note === "" ? null : (
            <span className={styles.sectionNote}>{note}</span>
          )}
        </button>
      </h2>
      {open ? <div className={styles.sectionBody}>{children}</div> : null}
    </section>
  );
}
