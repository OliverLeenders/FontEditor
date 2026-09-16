import type { FontDocument } from "@typewright/font-model";
import type { TextDirection, TextSettings } from "@typewright/view";
import { useMemo } from "react";

import { languagesOf, scriptsOf } from "../text-settings.js";
import styles from "./TextSettingsControls.module.css";

/**
 * How a line is set: which way it runs, and whose rules it chooses.
 *
 * The same three choices in the Spacing bar and in the Proof bar, because they
 * are the same question asked of the same font — and because a line spaced one
 * way and proofed another would be two different fonts on one screen.
 *
 * Every one of them starts at Auto, which is what a shaper does with text it is
 * told nothing about: the direction read from the characters, and the script and
 * language along with it. Choosing is for the font that is drawn for one of them
 * in particular — an Arabic face whose Latin text should still be proofed as
 * Arabic, or a Turkish `locl` rule that only applies when the language says so.
 *
 * What the pickers offer is about this font: the scripts are the ones its
 * characters belong to, and the languages are the ones its feature file names.
 */
export function TextSettingsControls({
  value,
  document,
  onChange,
}: {
  readonly value: TextSettings;
  readonly document: FontDocument;
  readonly onChange: (next: TextSettings) => void;
}): React.JSX.Element {
  const scripts = useMemo(() => scriptsOf(document), [document]);
  const languages = useMemo(() => languagesOf(document), [document]);

  return (
    <span className={styles.controls}>
      <select
        className={styles.select}
        aria-label="Direction"
        title="Which way the text runs. Auto reads it from the characters."
        value={value.direction}
        onChange={(event) => onChange({ ...value, direction: event.target.value as TextDirection })}
      >
        <option value="auto">Auto</option>
        <option value="ltr">Left to right</option>
        <option value="rtl">Right to left</option>
      </select>

      <select
        className={styles.select}
        aria-label="Script"
        title="Whose rules the font should choose. The scripts this font has letters for."
        value={value.script ?? ""}
        onChange={(event) =>
          onChange({ ...value, script: event.target.value === "" ? null : event.target.value })
        }
      >
        <option value="">Script: auto</option>
        {scripts.map((script) => (
          <option key={script.tag} value={script.tag}>
            {script.label}
          </option>
        ))}
      </select>

      {/* Disabled rather than hidden where the feature file names no language:
          the choice exists, and seeing it greyed says where it comes from. */}
      <select
        className={styles.select}
        aria-label="Language"
        title={
          languages.length === 0
            ? "The feature file names no languages yet — add a languagesystem line"
            : "The languages this font's feature file has rules for"
        }
        disabled={languages.length === 0}
        value={value.language ?? ""}
        onChange={(event) =>
          onChange({ ...value, language: event.target.value === "" ? null : event.target.value })
        }
      >
        <option value="">Language: auto</option>
        {languages.map((language) => (
          <option key={language.tag} value={language.tag}>
            {language.label}
          </option>
        ))}
      </select>
    </span>
  );
}
