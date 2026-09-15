import { type MarksSource, compileFeatures, readMarks, writeMarks } from "@typewright/font-io";
import { type Glyph, type GlyphName, currentMaster } from "@typewright/font-model";
import { useMemo, useRef, useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import { FeatureSource, type FeatureSourceHandle } from "./FeatureSource.js";
import styles from "./FeaturesView.module.css";
import { CheckIcon, CircleAlertIcon } from "./icons.js";

type FileId = "features" | "marks";

const FILES: readonly { readonly id: FileId; readonly label: string }[] = [
  { id: "features", label: "Features" },
  { id: "marks", label: "Marks" },
];

/** What was typed into the Marks file, and the file the anchors gave once it was put in. */
type Draft = { readonly text: string; readonly written: string };

/**
 * The features workspace: OpenType feature source, and what it compiles to.
 *
 * The source is kept as text rather than as a structure of rules, because text
 * is what a designer writes, what UFO stores and what every other tool
 * exchanges. Modelling it would mean choosing which of the language's constructs
 * the model can hold and quietly discarding the rest of somebody's file.
 *
 * Most of the language is compiled — substitutions of every kind but the
 * reverse one, named lookups and their flags, scripts and languages, and
 * positioning plain and in a context. What is not is reported by name and line
 * rather than skipped, and the panel says so plainly. A workspace that accepted
 * a file and shipped a font doing less than the file says would be worse than
 * one that admits its limits.
 *
 * Beside it is the Marks file: the anchors of the master being edited, written
 * as mark attachment. It is not stored. A change that reads cleanly goes into
 * the anchors at once, and what was typed stays on screen for as long as the
 * anchors are what it made them — leaving the file, or changing an anchor
 * anywhere else, writes it again from the anchors.
 */
export function FeaturesView(): React.JSX.Element {
  const store = useEditorStore();
  const source = useStoreValue((s) => s.session.editor.document.features);
  const glyphOrder = useStoreValue((s) => s.session.editor.document.glyphOrder);
  const glyphs = useStoreValue((s) => s.session.editor.document.glyphs);
  const master = useStoreValue((s) => currentMaster(s.project).name);
  const editor = useRef<FeatureSourceHandle>(null);
  const size = useStoreValue((s) => s.featureSize);
  const [file, setFile] = useState<FileId>("features");
  const [draft, setDraft] = useState<Draft | null>(null);

  // Compiled as you type, which is the whole value of the panel: a rule about a
  // glyph you have not drawn yet should say so now rather than at export.
  const compiled = useMemo(() => {
    // Ids are positions in the glyph order, which is what the export uses too —
    // so a rule that compiles here compiles there.
    const ids = new Map(glyphOrder.map((name, index) => [name, index]));
    return compileFeatures(source, (name) => ids.get(name));
  }, [source, glyphOrder]);

  // Only while the Marks file is open: writing it walks every glyph.
  const written = useMemo(
    () => (file === "marks" ? writeMarks(inOrder(glyphOrder, glyphs), master) : ""),
    [file, glyphOrder, glyphs, master],
  );
  const marksText = draft !== null && draft.written === written ? draft.text : written;
  const marks = useMemo(
    () => (file === "marks" ? readMarks(marksText, (name) => name in glyphs) : null),
    [file, marksText, glyphs],
  );

  const problems = marks === null ? compiled.problems : marks.problems;
  const problemLines = useMemo(() => new Set(problems.map((problem) => problem.line)), [problems]);

  const text = file === "marks" ? marksText : source;
  const lines = text === "" ? 0 : text.split("\n").length;

  const choose = (next: FileId): void => {
    setFile(next);
    // Leaving the Marks file lets go of what was typed there.
    setDraft(null);
  };

  const editMarks = (typed: string): void => {
    store.setMarks(typed);
    const document = store.editor.document;
    setDraft({
      text: typed,
      written: writeMarks(inOrder(document.glyphOrder, document.glyphs), master),
    });
  };

  return (
    <div className={styles.features}>
      <div className={styles.bar}>
        <div className={styles.files} role="tablist" aria-label="Files">
          {FILES.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              className={styles.file}
              aria-selected={f.id === file}
              onClick={() => choose(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className={styles.summary}>
          {marks === null ? (
            compiled.tags.length === 0 ? (
              "nothing compiled yet"
            ) : (
              <>
                <b>{compiled.tags.join(" ")}</b>
                {" · "}
                {counted(compiled.rules, "rule")}
              </>
            )
          ) : (
            <MarksSummary marks={marks} />
          )}
        </span>
        <span className={problems.length === 0 ? styles.clean : styles.problemCount}>
          {problems.length === 0 ? "no problems" : counted(problems.length, "problem")}
          {marks !== null && problems.length > 0 ? " · anchors unchanged" : null}
        </span>
        <span className={styles.lines}>{counted(lines, "line")}</span>
      </div>

      <div className={styles.body}>
        <FeatureSource
          key={file}
          ref={editor}
          value={text}
          onChange={file === "marks" ? editMarks : (typed) => store.setFeatures(typed)}
          problemLines={problemLines}
          placeholder={file === "marks" ? "" : PLACEHOLDER}
          size={size}
          onZoom={(factor) => store.setFeatureSize(store.getState().featureSize * factor)}
          label={file === "marks" ? "Marks source" : "Feature source"}
        />

        <aside
          className={styles.side}
          aria-label={file === "marks" ? "What the marks say" : "What the features compile to"}
        >
          {problems.length > 0 ? (
            <>
              <h2 className={styles.heading}>Problems</h2>
              <ul className={styles.problems}>
                {problems.map((problem, index) => (
                  <li key={`${String(problem.line)}-${String(index)}`}>
                    {/* A problem is somewhere, so pressing it goes there. */}
                    <button
                      type="button"
                      className={styles.problem}
                      onClick={() => editor.current?.goToLine(problem.line)}
                    >
                      <CircleAlertIcon />
                      <span className={styles.line}>{problem.line}</span>
                      <span>{problem.message}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {marks === null ? <WhatIsCompiled /> : <WhatTheMarksAre marks={marks} master={master} />}
        </aside>
      </div>
    </div>
  );
}

function inOrder(order: readonly GlyphName[], glyphs: Readonly<Record<GlyphName, Glyph>>): Glyph[] {
  return order.flatMap((name) => glyphs[name] ?? []);
}

const counted = (n: number, what: string): string =>
  n === 1 ? `1 ${what}` : `${String(n)} ${what}s`;

/** The glyphs the Marks file names, by the part each plays. */
function roles(marks: MarksSource): { marks: number; bases: number; stacked: number } {
  const attaching = new Set(
    marks.places.filter((p) => p.anchor.startsWith("_")).map((p) => p.glyph),
  );
  const bases = new Set<GlyphName>();
  const stacked = new Set<GlyphName>();
  for (const place of marks.places) {
    if (place.anchor.startsWith("_")) continue;
    (attaching.has(place.glyph) ? stacked : bases).add(place.glyph);
  }
  return { marks: attaching.size, bases: bases.size, stacked: stacked.size };
}

function MarksSummary({ marks }: { marks: MarksSource }): React.JSX.Element {
  const { bases, stacked } = roles(marks);
  const tags = [bases > 0 ? "mark" : null, stacked > 0 ? "mkmk" : null].filter((t) => t !== null);
  const named = new Set(marks.places.map((p) => p.glyph)).size;
  return tags.length === 0 ? (
    <>no marks yet</>
  ) : (
    <>
      <b>{tags.join(" ")}</b>
      {" · "}
      {counted(named, "glyph")}
    </>
  );
}

function WhatTheMarksAre({
  marks,
  master,
}: {
  marks: MarksSource;
  master: string;
}): React.JSX.Element {
  const { marks: attaching, bases, stacked } = roles(marks);
  return (
    <>
      <h2 className={styles.heading}>From the anchors</h2>
      <p className={styles.note}>
        Of the master <b>{master}</b>.
      </p>
      <ul className={styles.counts}>
        <li>
          <span className={styles.count}>{marks.classes.length}</span>
          {marks.classes.length === 1 ? "mark class" : "mark classes"}
        </li>
        <li>
          <span className={styles.count}>{attaching}</span>
          {attaching === 1 ? "mark" : "marks"}
        </li>
        <li>
          <span className={styles.count}>{bases}</span>
          {bases === 1 ? "glyph marks attach to" : "glyphs marks attach to"}
        </li>
        <li>
          <span className={styles.count}>{stacked}</span>
          {stacked === 1 ? "mark others stack on" : "marks others stack on"}
        </li>
      </ul>
      {/* The file looks like any feature file, and behaves like none: said
          here, because finding out by losing a comment is finding out late. */}
      <p className={styles.note}>
        Mark attachment is compiled from the anchors, and this file is them written out. A change
        that reads cleanly moves, adds or removes anchors at once, and undo takes it back; while the
        file has a problem, no anchor changes. Leaving the file or moving an anchor elsewhere writes
        it again, so comments are not kept. A ligature&apos;s parts, mark filtering sets and rules
        outside <code>mark</code> and <code>mkmk</code> belong in the feature file.
      </p>
    </>
  );
}

function WhatIsCompiled(): React.JSX.Element {
  return (
    <>
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
          one into several — <code>sub ffi by f f i;</code>
        </li>
        <li>
          <CheckIcon />
          alternates — <code>sub a from [a.ss01 a.ss02];</code>
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
          named lookups — <code>sub c a&apos; lookup SMALL;</code>
        </li>
        <li>
          <CheckIcon />
          lookup flags — <code>lookupflag IgnoreMarks;</code>
        </li>
        <li>
          <CheckIcon />
          scripts and languages — <code>language TRK;</code>
        </li>
        <li>
          <CheckIcon />
          single adjustment — <code>pos @caps &lt;10 0 20 0&gt;;</code>
        </li>
        <li>
          <CheckIcon />
          adjustment in context — <code>pos T o&apos; &lt;0 0 -40 0&gt;;</code>
        </li>
      </ul>
      <p className={styles.note}>
        A pair adjustment is kerning, which is written in the Spacing workspace, and mark attachment
        is where the glyphs&apos; anchors say, which the Marks file writes out; two ways to write
        the same rule would be two answers with no way to say which won. Reverse substitution, mark
        filtering sets and <code>table</code> blocks are kept in the file and written to the UFO,
        but are not compiled into the exported OTF.
      </p>
    </>
  );
}

const PLACEHOLDER = [
  "# OpenType features, in .fea syntax.",
  "",
  "feature liga {",
  "    sub f i by fi;",
  "} liga;",
].join("\n");
