import type { FontDocument } from "@typewright/font-model";
import type { TextSettings } from "@typewright/view";
import { useMemo } from "react";

import { featureChoices } from "../text-settings.js";
import { BarMenu } from "./BarMenu.js";
import styles from "./FeatureSwitches.module.css";
import { CodeIcon } from "./icons.js";

/**
 * Which of the font's features this line is set with.
 *
 * A text renderer turns some features on by itself — ligatures, contextual
 * alternates — and leaves the rest to be asked for. That is right for a proof,
 * which should show what somebody gets by typing, and useless for judging the
 * features nobody gets by typing: a stylistic set drawn and ruled and never once
 * seen substituted until the font was exported and installed. These switches are
 * that asking, and nothing else in the editor can do it.
 *
 * A panel rather than a row of buttons in the bar, because the list is however
 * many features the font defines — three today, twenty by the end — and a bar
 * that grows with the feature file is a bar that stops fitting. A panel is also
 * somewhere to stay: switching one on to look, then another, is the work, and a
 * menu that closed on the first press would be fighting it.
 *
 * The master switch is the first row rather than a button of its own. Off means
 * the letters the substitutions stand in for — the whole font's rules silenced,
 * these switches included, which is why they grey out with it. What it does not
 * mean is "plain text": kerning and mark attachment go with it, because the
 * question it answers is what the font does, not which parts of it are tidy.
 */
export function FeatureSwitches({
  value,
  document,
  applyFeatures,
  canShape,
  onChange,
  onApplyFeaturesChange,
}: {
  readonly value: TextSettings;
  readonly document: FontDocument;
  /** Whether the font's rules are applied at all: the master switch. */
  readonly applyFeatures: boolean;
  /** Whether the font has anything to shape with: features, kerning or anchors. */
  readonly canShape: boolean;
  readonly onChange: (next: TextSettings) => void;
  readonly onApplyFeaturesChange: (next: boolean) => void;
}): React.JSX.Element {
  const choices = useMemo(() => featureChoices(document), [document]);

  const chosen = (tag: string, byDefault: boolean): boolean => value.features[tag] ?? byDefault;

  const switchTo = (tag: string, byDefault: boolean, on: boolean): void => {
    const features = { ...value.features };
    // Back at what a renderer would do is not a choice worth keeping: dropping
    // the tag means a font whose defaults change is followed rather than pinned.
    if (on === byDefault) delete features[tag];
    else features[tag] = on;
    onChange({ ...value, features });
  };

  const switched = Object.keys(value.features).length;

  return (
    <BarMenu
      label="Features"
      icon={CodeIcon}
      title={
        canShape
          ? "Which of the font's features this line is set with"
          : "This font has no features, kerning or anchors to set yet"
      }
      disabled={!canShape}
      panelLabel="Features"
      panelClassName={styles.panel}
      badge={
        switched > 0 && applyFeatures ? (
          <span className={styles.badge} title={`${String(switched)} switched by hand`} />
        ) : undefined
      }
    >
      <div className={styles.rows}>
        <label className={styles.row} title="Set with the font's own rules, or without them">
          <span className={styles.label}>Apply the font&apos;s features</span>
          <input
            type="checkbox"
            className={styles.check}
            checked={applyFeatures}
            onChange={() => onApplyFeaturesChange(!applyFeatures)}
          />
        </label>

        <div className={styles.separator} role="separator" />

        {choices.length === 0 ? (
          <p className={styles.note}>
            This font&apos;s feature file defines no features yet. Write one in the Features
            workspace and its tags appear here.
          </p>
        ) : (
          choices.map((choice) => (
            <label
              key={choice.tag}
              className={styles.row}
              title={
                choice.byDefault
                  ? "A text renderer turns this on by itself"
                  : "Off unless something asks for it — which is what this switch does"
              }
            >
              <span className={styles.label}>
                <code className={styles.tag}>{choice.tag}</code>
                {choice.label === choice.tag ? null : (
                  <span className={styles.name}>{choice.label}</span>
                )}
              </span>
              <input
                type="checkbox"
                className={styles.check}
                aria-label={choice.tag}
                checked={chosen(choice.tag, choice.byDefault)}
                disabled={!applyFeatures}
                onChange={(event) => switchTo(choice.tag, choice.byDefault, event.target.checked)}
              />
            </label>
          ))
        )}

        <div className={styles.footer}>
          <span className={styles.note}>Kept in this browser, not in the font.</span>
          <button
            type="button"
            className={styles.reset}
            disabled={switched === 0}
            onClick={() => onChange({ ...value, features: {} })}
          >
            Reset
          </button>
        </div>
      </div>
    </BarMenu>
  );
}
