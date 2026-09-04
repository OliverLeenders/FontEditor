import { CanvasSurface, type ProofScene, drawProof } from "@fonteditor/render";
import { layoutParagraph, wheelIntent } from "@fonteditor/view";
import { useEffect, useMemo, useRef, useState } from "react";

import { palette } from "../scene.js";
import { shaperFrom } from "../shaping.js";
import { MAX_PROOF_SIZE, MIN_PROOF_SIZE } from "../store.js";
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
  const applyFeatures = useStoreValue((s) => s.applyFeatures);
  const shape = useMemo(
    () => shaperFrom(document.features, applyFeatures),
    [document.features, applyFeatures],
  );
  const hasFeatures = document.features.trim() !== "";
  const lines = useMemo(() => {
    const scale = size / unitsPerEm;
    const measure = (width - MARGIN * 2) / Math.max(scale, 0.0001);
    return layoutParagraph(
      document,
      text,
      Math.max(measure, unitsPerEm),
      leading * unitsPerEm,
      shape,
    );
  }, [document, text, size, leading, unitsPerEm, width, shape]);

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

  // Where the reader should end up once the proof has been re-set at a new
  // size. Null when nothing is waiting.
  const wantedScroll = useRef<number | null>(null);

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

  // After the page has grown or shrunk, and not before.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller === null || wantedScroll.current === null) return;
    scroller.scrollTop = wantedScroll.current;
    wantedScroll.current = null;
    surfaceRef.current?.invalidate();
  }, [contentHeight]);

  /**
   * Ctrl-wheel sets the type size; the wheel on its own scrolls the page.
   *
   * Zooming a proof is changing the size it is set at, so the text rewraps —
   * which is the point of a proof and the reason there is no separate view
   * scale to zoom instead. What cannot be kept is the exact word under the
   * cursor: the line breaks move. What is kept is the position through the
   * proof, by scaling the scroll with the size, so the reader stays roughly
   * where they were rather than being thrown back to the first paragraph.
   *
   * Non-passive, and only for the ctrl case: a plain wheel is handed straight
   * back to the scroller, which is better at scrolling than this would be.
   */
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller === null) return;

    const onWheel = (event: WheelEvent): void => {
      const intent = wheelIntent(event);
      if (intent.kind !== "zoom") return;
      event.preventDefault();

      const before = store.getState().proofSize;
      store.setProofSize(before * intent.factor);
      const after = store.getState().proofSize;
      if (after === before) return;

      // Left for the effect below rather than set here. The page has to be
      // re-set and re-measured at the new size before it can be scrolled that
      // far, and a value assigned now is clamped to the old, shorter page —
      // which drags the reader towards the top on every notch.
      wantedScroll.current = scroller.scrollTop * (after / before);
    };

    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, [store]);

  return (
    <div className={styles.proof}>
      <div className={styles.bar}>
        <label className={styles.sizeLabel}>
          Size
          <input
            type="range"
            className={styles.slider}
            min={MIN_PROOF_SIZE}
            max={MAX_PROOF_SIZE}
            step={1}
            value={size}
            aria-label="Type size"
            onChange={(event) => store.setProofSize(Number(event.target.value))}
          />
          <span className={styles.value}>{Math.round(size)}</span>
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

        {/* Off is not "plain text": it is the letters the substitutions stand
            in for, which is what you want the moment a ligature looks wrong and
            you need to see what went into it. */}
        <button
          type="button"
          className={styles.features}
          aria-pressed={applyFeatures}
          disabled={!hasFeatures}
          title={
            hasFeatures
              ? applyFeatures
                ? "Set with the font's features — click to see the letters behind them"
                : "Set without the font's features"
              : "This font defines no features yet"
          }
          onClick={() => store.toggleApplyFeatures()}
        >
          Features
        </button>

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
