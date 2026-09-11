import styles from "../Inspector.module.css";

/**
 * The small pieces every section of the inspector is built from.
 *
 * Here rather than in one of the sections because each is used by several, and
 * a section importing a label out of another section would say the two were
 * related when the only thing they share is the shape of a row.
 */

/**
 * A labelled row: the name of a thing, above the control that changes it.
 *
 * A `<label>` by default, which is what names a field whose control has no name
 * of its own — the advance box is called "Advance" because of it. But a label
 * names the *first* control inside it and only that one, so a row of buttons
 * wrapped in one had its first button announced as the whole row: "Type Corner
 * Smooth Tangent" for a button that says Corner. A row of several controls is a
 * `group` instead, named by the same words, and each control keeps its own name.
 */
export function Field({
  label,
  group = false,
  children,
}: {
  label: string;
  /** The row holds several controls, each named for itself. */
  group?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  if (group) {
    return (
      <div className={styles.field} role="group" aria-label={label}>
        <span className={styles.label} aria-hidden="true">
          {label}
        </span>
        {children}
      </div>
    );
  }

  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      {children}
    </label>
  );
}

/**
 * A coordinate as a field should show it.
 *
 * Not rounded, unlike the advance and the sidebearings: this field exists to set
 * an exact position, and a display that rounded 106.402 to 106 would write 106
 * back the moment anything else in the panel was touched. Two decimals is enough
 * to see that a number is not whole without showing the floating-point tail.
 */
export function shown(v: number): number {
  return Math.round(v * 100) / 100;
}
