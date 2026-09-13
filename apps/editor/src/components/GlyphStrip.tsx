import type { Glyph } from "@typewright/font-model";
import { glyphsForString, textTokens } from "@typewright/font-model";
import { drawGlyphThumbnail } from "@typewright/render";
import { useEffect, useRef } from "react";

import { palette } from "../scene.js";
import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./GlyphStrip.module.css";

/**
 * A row of glyphs from a string you type, and the way you move between them.
 *
 * Typing the text rather than picking from a list is how Glyphs and RoboFont
 * work, and the reason is that it doubles as a spacing check: you see the glyph
 * you are editing beside the ones it will actually stand next to.
 *
 * A character the font has nothing for is shown as a gap rather than skipped, so
 * what you typed and what you see stay in step. A glyph with no key to type it
 * by is reached by name after a slash — `/a.001`, `/uni0301` — as it is in the
 * Spacing line and the Proof.
 */
export function GlyphStrip(): React.JSX.Element {
  const store = useEditorStore();
  const text = useStoreValue((s) => s.stripText);
  const document = useStoreValue((s) => s.session.editor.document);
  const current = useStoreValue((s) => s.session.editor.currentGlyph);

  const tokens = textTokens(text);
  const found = glyphsForString(document, tokens);

  return (
    <div className={styles.strip}>
      <input
        className={styles.text}
        value={text}
        spellCheck={false}
        aria-label="Glyphs to show"
        title="Letters, or a glyph by name after a slash: /a.001, /uni0301"
        onChange={(event) => store.setStripText(event.target.value)}
      />
      <div className={styles.cells}>
        {found.map((glyph, index) =>
          glyph === null ? (
            <span
              key={`gap-${String(index)}`}
              className={styles.missing}
              title={`No glyph for “${tokens[index]?.text.trim() ?? "?"}”`}
            />
          ) : (
            <GlyphCell
              key={`${glyph.name}-${String(index)}`}
              glyph={glyph}
              active={glyph.name === current}
              metrics={document.info}
              onSelect={() => store.setCurrentGlyph(glyph.name)}
            />
          ),
        )}
      </div>
    </div>
  );
}

function GlyphCell({
  glyph,
  active,
  metrics,
  onSelect,
}: {
  glyph: Glyph;
  active: boolean;
  metrics: { unitsPerEm: number; ascender: number; descender: number };
  onSelect: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    drawGlyphThumbnail(
      ctx as unknown as Parameters<typeof drawGlyphThumbnail>[0],
      glyph,
      { x: 0, y: 0, width, height },
      palette(),
      metrics,
    );
  }, [glyph, metrics]);

  return (
    <button
      type="button"
      className={styles.cell}
      aria-pressed={active}
      title={glyph.name}
      onClick={onSelect}
    >
      <canvas ref={ref} className={styles.thumb} />
      <span className={styles.name}>{glyph.name}</span>
    </button>
  );
}
