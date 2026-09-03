import { CanvasSurface, type ProofScene, drawProof } from "@fonteditor/render";
import { layoutParagraph } from "@fonteditor/view";
import { useEffect, useMemo, useRef, useState } from "react";

import { palette } from "../scene.js";
import { watchScheme } from "../scheme.js";
import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./ProofView.module.css";

/** Space around the text block, in screen pixels. */
const MARGIN = 56;

/**
 * The proof: the font set as text, and nothing else.
 *
 * Every other workspace draws things to help you work — points, handles,
 * baselines, margins, the advance of each glyph. Each of them is also a mark on
 * the page that is not part of the font, and the question a proof answers is
 * whether the font reads. So this one draws the letters and stops: no controls
 * on the canvas, nothing selectable, nothing to click.
 *
 * It is also the only view where the text is not a specimen string. The spacing
 * view wants "nonno" and the strip wants whatever you are drawing; a proof wants
 * sentences, because the thing being judged is a line of type rather than a
 * letter.
 */
export function ProofView(): React.JSX.Element {
  const store = useEditorStore();
  const document = useStoreValue((s) => s.session.editor.document);
  const text = useStoreValue((s) => s.proofText);
  const size = useStoreValue((s) => s.proofSize);
  const leading = useStoreValue((s) => s.proofLeading);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<CanvasSurface | null>(null);
  const [width, setWidth] = useState(0);

  // Measured here rather than read inside the frame callback. A callback that
  // asked the store to re-lay-out would be a redraw causing a state change
  // causing a redraw — the loop that once had this app repainting sixty times a
  // second while nothing was happening.
  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;

    const measure = (): void => setWidth(stage.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  /**
   * The measure, in design units.
   *
   * Taken from the canvas rather than fixed, so the proof rewraps as the window
   * changes — which is what makes it a page of text rather than a picture of one.
   */
  const { unitsPerEm } = document.info;
  const lines = useMemo(() => {
    const scale = size / unitsPerEm;
    const measure = (width - MARGIN * 2) / Math.max(scale, 0.0001);
    return layoutParagraph(document, text, Math.max(measure, unitsPerEm), leading * unitsPerEm);
  }, [document, text, size, leading, unitsPerEm, width]);

  /**
   * How tall the set text is, so the page can be scrolled through.
   *
   * A proof at a reading size is a page or two long, and one at ninety-six
   * points is longer still. Fitting it to the window would mean either shrinking
   * the type — which is the one thing a proof must not do, since the size is
   * what is being judged — or cutting it off.
   */
  const contentHeight = useMemo(() => {
    const scale = size / unitsPerEm;
    const lastBaseline = (lines[lines.length - 1]?.y ?? 0) * scale;
    // Room under the last baseline for descenders, and the margin again.
    return MARGIN * 2 + size + lastBaseline + size * 0.4;
  }, [lines, size, unitsPerEm]);

  const frame = useRef({ lines, size, unitsPerEm });
  frame.current = { lines, size, unitsPerEm };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const surface = new CanvasSurface(canvas, (ctx, viewport) => {
      const state = frame.current;
      const scale = state.size / state.unitsPerEm;
      // Read here rather than held in state: scrolling a long proof should cost
      // a canvas frame, not a React render of the whole workspace.
      const scrollTop = scrollRef.current?.scrollTop ?? 0;

      const scene: ProofScene = {
        lines: state.lines.map((line) => ({
          glyphs: line.run.glyphs.map((p) => ({ glyph: p.glyph, x: p.x })),
          y: line.y,
        })),
        // The first baseline sits a line below the top margin, so the ascenders
        // of the first line have somewhere to be.
        view: { scale, tx: MARGIN, ty: MARGIN + state.size - scrollTop },
        viewport,
        palette: palette(),
      };
      drawProof(ctx, scene);
    });

    surfaceRef.current = surface;
    surface.start();

    const invalidate = (): void => surface.invalidate();
    const stopWatching = watchScheme(invalidate);

    return () => {
      stopWatching();
      surface.destroy();
      surfaceRef.current = null;
    };
  }, []);

  useEffect(() => {
    surfaceRef.current?.invalidate();
  }, [lines, size, contentHeight]);

  return (
    <div className={styles.proof}>
      <div className={styles.bar}>
        <label className={styles.sizeLabel}>
          Size
          <input
            type="range"
            className={styles.slider}
            min={8}
            max={140}
            step={1}
            value={size}
            aria-label="Type size"
            onChange={(event) => store.setProofSize(Number(event.target.value))}
          />
          <span className={styles.value}>{size}</span>
        </label>

        <label className={styles.sizeLabel}>
          Leading
          <input
            type="range"
            className={styles.slider}
            min={0.8}
            max={2.4}
            step={0.05}
            value={leading}
            aria-label="Line spacing"
            onChange={(event) => store.setProofLeading(Number(event.target.value))}
          />
          <span className={styles.value}>{leading.toFixed(2)}</span>
        </label>

        <span className={styles.count}>
          {lines.length === 1 ? "1 line" : `${String(lines.length)} lines`}
        </span>
      </div>

      <div ref={stageRef} className={styles.stage}>
        {/* The canvas stays the size of the window and repaints as the scroller
            moves beneath it, which is what the glyph browser's grid does and for
            the same reason: a canvas as tall as the content would be enormous. */}
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
        <div
          ref={scrollRef}
          className={styles.scroller}
          onScroll={() => surfaceRef.current?.invalidate()}
        >
          <div style={{ height: `${String(contentHeight)}px` }} />
        </div>
      </div>

      {/* The text is edited beneath the proof rather than in a dialog: changing
          a word and seeing the line rewrap is the whole of using this. */}
      <textarea
        className={styles.text}
        value={text}
        aria-label="Proof text"
        spellCheck={false}
        rows={3}
        onChange={(event) => store.setProofText(event.target.value)}
      />
    </div>
  );
}
