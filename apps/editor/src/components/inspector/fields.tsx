import styles from "../Inspector.module.css";

/**
 * The small pieces every section of the inspector is built from.
 *
 * Here rather than in one of the sections because each is used by several, and
 * a section importing a label out of another section would say the two were
 * related when the only thing they share is the shape of a row.
 */

/** A labelled row: the name of a thing, above the control that changes it. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
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
