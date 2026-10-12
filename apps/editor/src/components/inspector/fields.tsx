import styles from "../Inspector.module.css";
import { NumberField } from "../NumberField.js";
import { Stepper } from "../Stepper.js";
import type { IconComponent } from "../icons.js";

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
 * A control named inside its own row: a word or an icon before it, where a row
 * to itself and a label above was a line of the panel for every number.
 */
export function Named({
  name,
  icon: Icon,
  title,
  own = false,
  children,
}: {
  readonly name?: string;
  readonly icon?: IconComponent;
  readonly title: string;
  /** Set on this thing itself, where the rest follow something shared. */
  readonly own?: boolean;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className={styles.named} title={title} data-own={own ? "true" : undefined}>
      <span className={styles.naming} aria-hidden="true">
        {Icon === undefined ? name : <Icon />}
      </span>
      {children}
    </label>
  );
}

/**
 * A number with its arrows: the field every number in the inspector is, with
 * the up and down that come when it is reached for. One step is what an arrow
 * key is, and the arrows commit as typing does.
 */
export function SteppedNumber(props: React.ComponentProps<typeof NumberField>): React.JSX.Element {
  const { value, label, disabled = false, step, bigStep, bounds, onCommit } = props;
  return (
    <Stepper
      value={disabled ? null : value}
      label={label.toLowerCase()}
      disabled={disabled}
      {...(step === undefined ? {} : { step })}
      {...(bigStep === undefined ? {} : { bigStep })}
      {...(bounds === undefined ? {} : { bounds })}
      onStep={onCommit}
    >
      <NumberField {...props} />
    </Stepper>
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
