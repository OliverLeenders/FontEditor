import { codePointsOfSet, glyphSet } from "@fonteditor/catalog";
import { glyphNameForCodePoint } from "@fonteditor/font-model";
import { type NewGlyph as GlyphSpec, createGlyphs } from "@fonteditor/tools";
import { useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./OpenFont.module.css";

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
export function NewGlyph(): JSX.Element {
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
          (code) =>
            !Object.values(document.glyphs).some((g) => g.unicodes.includes(code)),
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
          Add {missing.length} missing
        </button>
      ) : null}
    </>
  );
}
