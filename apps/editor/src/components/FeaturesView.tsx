import { compileFeatures } from "@fonteditor/font-io";
import { useMemo } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./FeaturesView.module.css";
import { CheckIcon, CircleAlertIcon } from "./icons.js";

/**
 * The features workspace: OpenType feature source, and what it compiles to.
 *
 * The source is kept as text rather than as a structure of rules, because text
 * is what a designer writes, what UFO stores and what every other tool
 * exchanges. Modelling it would mean choosing which of the language's constructs
 * the model can hold and quietly discarding the rest of somebody's file.
 *
 * Only a part of the language is compiled — classes, and the substitutions that
 * `liga` and `smcp` are made of. Everything else is reported by name and line
 * rather than skipped, and the panel says so plainly. A workspace that accepted
 * a file and shipped a font doing less than the file says would be worse than
 * one that admits its limits.
 */
export function FeaturesView(): React.JSX.Element {
  const store = useEditorStore();
  const source = useStoreValue((s) => s.session.editor.document.features);
  const glyphOrder = useStoreValue((s) => s.session.editor.document.glyphOrder);

  // Compiled as you type, which is the whole value of the panel: a rule about a
  // glyph you have not drawn yet should say so now rather than at export.
  const compiled = useMemo(() => {
    // Ids are positions in the glyph order, which is what the export uses too —
    // so a rule that compiles here compiles there.
    const ids = new Map(glyphOrder.map((name, index) => [name, index]));
    return compileFeatures(source, (name) => ids.get(name));
  }, [source, glyphOrder]);

  const lines = source === "" ? 0 : source.split("\n").length;

  return (
    <div className={styles.features}>
      <div className={styles.bar}>
        <span className={styles.summary}>
          {compiled.tags.length === 0 ? (
            "nothing compiled yet"
          ) : (
            <>
              <b>{compiled.tags.join(" ")}</b>
              {" · "}
              {compiled.rules === 1 ? "1 rule" : `${String(compiled.rules)} rules`}
            </>
          )}
        </span>
        <span className={compiled.problems.length === 0 ? styles.clean : styles.problemCount}>
          {compiled.problems.length === 0
            ? "no problems"
            : compiled.problems.length === 1
              ? "1 problem"
              : `${String(compiled.problems.length)} problems`}
        </span>
        <span className={styles.lines}>{lines === 1 ? "1 line" : `${String(lines)} lines`}</span>
      </div>

      <div className={styles.body}>
        <textarea
          className={styles.source}
          value={source}
          aria-label="Feature source"
          spellCheck={false}
          placeholder={PLACEHOLDER}
          onChange={(event) => store.setFeatures(event.target.value)}
        />

        <aside className={styles.side} aria-label="What the features compile to">
          {compiled.problems.length > 0 ? (
            <>
              <h2 className={styles.heading}>Problems</h2>
              <ul className={styles.problems}>
                {compiled.problems.map((problem, index) => (
                  <li key={`${String(problem.line)}-${String(index)}`}>
                    <CircleAlertIcon />
                    <span className={styles.line}>{problem.line}</span>
                    {problem.message}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <h2 className={styles.heading}>What is compiled</h2>
          {/* Stated rather than implied. Someone pasting a feature file from
              another tool needs to know what will survive the trip, and finding
              out from the exported font is finding out too late. */}
          <ul className={styles.supported}>
            <li>
              <CheckIcon />
              glyph classes — <code>@FIGS = [zero one];</code>
            </li>
            <li>
              <CheckIcon />
              ligatures — <code>sub f i by fi;</code>
            </li>
            <li>
              <CheckIcon />
              single substitution — <code>sub a by a.sc;</code>
            </li>
            <li>
              <CheckIcon />
              class substitution — <code>sub @LOWER by @SMALL;</code>
            </li>
            <li>
              <CheckIcon />
              in context — <code>sub a b&apos; c by b.alt;</code>
            </li>
            <li>
              <CheckIcon />
              exceptions to it — <code>ignore sub f a&apos;;</code>
            </li>
            <li>
              <CheckIcon />
              single adjustment — <code>pos @caps &lt;10 0 20 0&gt;;</code>
            </li>
          </ul>
          <p className={styles.note}>
            A pair adjustment is kerning, which has a workspace of its own and is written from
            there; two ways to write the same rule would be two answers with no way to say which
            won. Alternates, attachment and positioning in a context are kept in the file and
            written to the UFO, but are not compiled into the exported OTF.
          </p>
        </aside>
      </div>
    </div>
  );
}

const PLACEHOLDER = [
  "# OpenType features, in .fea syntax.",
  "",
  "feature liga {",
  "    sub f i by fi;",
  "} liga;",
].join("\n");
