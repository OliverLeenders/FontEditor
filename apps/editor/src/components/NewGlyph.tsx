import { codePointsOfSet, glyphSet } from "@typewright/catalog";
import { compositePlan, glyphNameForCodePoint, randomIds } from "@typewright/font-model";
import { type NewGlyph as GlyphSpec, buildComposites, createGlyphs } from "@typewright/tools";
import { useMemo, useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./OpenFont.module.css";
import { CopyPlusIcon, SquarePlusIcon } from "./icons.js";

/**
 * What someone typed, read as either a name or a character.
 *
 * The same three forms the browser's search box already accepts, because having
 * learned them once is enough: a name, an explicit code point, or the character
 * itself. Anything else is taken as a name, since a glyph may be called
 * anything at all and refusing an unusual one would be worse than making it.
 */
export function parseGlyphRequest(raw: string): GlyphSpec | null {
  const text = raw.trim();
  if (text === "") return null;

  const explicit = /^(?:u\+|0x)([0-9a-f]{1,6})$/i.exec(text);
  if (explicit !== null) {
    const codePoint = Number.parseInt(explicit[1]!, 16);
    if (Number.isFinite(codePoint) && codePoint <= 0x10ffff) {
      return { name: glyphNameForCodePoint(codePoint), unicodes: [codePoint] };
    }
  }

  const characters = [...text];
  if (characters.length === 1) {
    const codePoint = characters[0]!.codePointAt(0);
    // A single letter is ambiguous — "a" is both a name and a character — and
    // they agree, because that is exactly what the naming convention says.
    if (codePoint !== undefined && codePoint >= 0x20) {
      return { name: glyphNameForCodePoint(codePoint), unicodes: [codePoint] };
    }
  }

  return { name: text };
}

/**
 * Making glyphs: one by name, or a whole set at once.
 *
 * The set half exists because the first thing anyone does with an empty font is
 * ask for ASCII, and typing ninety-five names is not a reasonable way to spend
 * an afternoon. It works off the set already selected in the sidebar, whose
 * count is right there, so "add the missing ones" needs no second choice.
 */
export function NewGlyph(): React.JSX.Element {
  const store = useEditorStore();
  const reading = useStoreValue((s) => s.ownership === "reading");
  const query = useStoreValue((s) => s.catalogQuery);
  const document = useStoreValue((s) => s.session.editor.document);
  const [text, setText] = useState("");

  const advance = Math.round(document.info.unitsPerEm / 2);

  const create = (): void => {
    const wanted = parseGlyphRequest(text);
    if (wanted === null) return;
    store.applyTool(createGlyphs(store.editor, [wanted], advance));
    setText("");
  };

  // Which code points the selected set covers but the font has not got.
  const covered = codePointsOfSet(query.set);
  const missing =
    covered === null
      ? []
      : covered.filter(
          (code) => !Object.values(document.glyphs).some((g) => g.unicodes.includes(code)),
        );

  const addMissing = (): void => {
    store.applyTool(
      createGlyphs(
        store.editor,
        missing.map((code) => ({ name: glyphNameForCodePoint(code), unicodes: [code] })),
        advance,
      ),
    );
  };

  // The accented characters of the set the font could build from what it has.
  // Remembered against the document, since answering walks the whole set.
  const plan = useMemo(() => {
    const wanted = codePointsOfSet(query.set);
    return wanted === null ? null : compositePlan(document, wanted);
  }, [query.set, document]);

  const setLabel = glyphSet(query.set)?.label ?? query.set;

  return (
    <>
      <input
        type="text"
        className={styles.glyphName}
        placeholder="New glyph"
        aria-label="New glyph name or character"
        spellCheck={false}
        disabled={reading}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") create();
        }}
      />
      {missing.length > 0 && !reading ? (
        <button
          type="button"
          className={styles.button}
          title={`Create the ${String(missing.length)} glyphs of ${setLabel} this font has not got`}
          onClick={addMissing}
        >
          <SquarePlusIcon />
          Add {missing.length} missing
        </button>
      ) : null}
      {/* Shown, disabled, when every accent is stuck for want of an anchor:
          letters and marks drawn and nothing appearing would look like the
          feature was not there, when it is one anchor away. */}
      {plan !== null && (plan.buildable.length > 0 || plan.problems.length > 0) && !reading ? (
        <button
          type="button"
          className={styles.button}
          title={buildTitle(plan, setLabel)}
          disabled={plan.buildable.length === 0}
          onClick={() =>
            store.applyTool(
              buildComposites(
                store.editor,
                plan.buildable.map((build) => build.codePoint),
                randomIds(),
              ),
            )
          }
        >
          <CopyPlusIcon />
          Build {plan.buildable.length} accented
        </button>
      ) : null}
    </>
  );
}

/** What building the accents would do, and what is keeping the rest back. */
function buildTitle(plan: ReturnType<typeof compositePlan>, setLabel: string): string {
  const stuck =
    plan.problems.length === 0
      ? ""
      : ` ${String(plan.problems.length)} more have an accent with nothing to land on: give the letter a top or bottom anchor, and the accent a _top or _bottom one.`;
  if (plan.buildable.length === 0) return stuck.trim();
  return `Build the ${String(plan.buildable.length)} accented glyphs of ${setLabel} from their letters and marks.${stuck}`;
}
