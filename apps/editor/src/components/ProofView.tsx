import { CanvasSurface, type ProofScene, drawProof } from "@typewright/render";
import { drawableGlyph } from "@typewright/font-model";
import { layoutParagraph, wheelIntent } from "@typewright/view";
import { useEffect, useMemo, useRef, useState } from "react";

import { palette } from "../scene.js";
import { PROOF_SPECIMENS, specimenNamed } from "../specimens.js";
import { hasSomethingToShape, positionerFrom, shaperFrom, useShapingModule } from "../shaping.js";
import {
  type ProofBlock,
  blockCaption,
  drawnSize,
  heldSize,
  ladderBlocks,
} from "../proof-blocks.js";
import { MAX_PROOF_SIZE, MIN_PROOF_SIZE } from "../store/index.js";
import { watchScheme } from "../scheme.js";
import { instanceDocument } from "../instance.js";
import { useEditorStore, useStoreValue } from "../useStore.js";
import { LocationBar } from "./LocationBar.js";
import { ProofBlocks } from "./ProofBlocks.js";
import { TextSettingsControls } from "./TextSettingsControls.js";
import styles from "./ProofView.module.css";

/** Space around the text block, in screen pixels. */
const MARGIN = 56;

/**
 * Space between one block of a waterfall and the next, in screen pixels.
 *
 * Fixed rather than a multiple of either block's size: it is a gap on a page,
 * and a gap that grew with the type would put half an inch between two
 * eight-point blocks and three inches between two at seventy-two, which reads as
 * a page that has come apart rather than a ladder.
 */
const BLOCK_GAP = 34;

/** How far above a block its rule sits. */
const CAPTION_LIFT = 14;

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
 *
 * The page is one block of text at one size, or several — a waterfall, each block
 * with its own size and its own features. One block and several are the same code
 * path with a list of one in it, because the alternative is two layouts, two
 * scenes and two ways for the page to be wrong.
 */
export function ProofView(): React.JSX.Element {
  const store = useEditorStore();
  // The font at the place being previewed, when one is, and the master being
  // edited otherwise. A paragraph is where a weight nobody drew shows what it
  // is worth: a stem that thickens faster than its neighbours is plain in a
  // line of them and invisible in one letter.
  const document = useStoreValue((s) => instanceDocument(s) ?? s.session.editor.document);
  const text = useStoreValue((s) => s.proofText);
  const size = useStoreValue((s) => s.proofSize);
  const leading = useStoreValue((s) => s.proofLeading);
  const blocks = useStoreValue((s) => s.proofBlocks);
  const zoom = useStoreValue((s) => s.proofZoom);
  /** Whether the page is set as blocks, which is what the rules are drawn for. */
  const waterfall = blocks.length > 0;

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

  const { unitsPerEm } = document.info;
  const applyFeatures = useStoreValue((s) => s.applyFeatures);
  const settings = useStoreValue((s) => s.proofTextSettings);
  const hasFeatures = useMemo(() => hasSomethingToShape(document), [document]);
  // HarfBuzz once it has loaded, which then sets the page on its own. The module
  // rather than an engine, because a block sets with its own features and there
  // is no telling how many blocks there are — see `useShapingModule`.
  const shaping = useShapingModule(applyFeatures);

  /**
   * The blocks the page is set as: what is stored, or the slider's one size.
   *
   * A proof at one size is a list of one block. Every measurement, every layout
   * and the scene itself then have one case to handle, and the size slider goes
   * on meaning what it always meant.
   */
  //
  // A waterfall is drawn at its sizes times the zoom, which Ctrl and the wheel
  // set; the sizes themselves are left as they are.
  const pageBlocks: readonly ProofBlock[] = useMemo(
    () =>
      waterfall
        ? blocks.map((b) => ({ ...b, size: drawnSize(b.size, zoom) }))
        : [{ id: "block-1", size, settings }],
    [waterfall, blocks, size, settings, zoom],
  );

  /**
   * How each block is set, ready to hand to the layout.
   *
   * The shaper and the positioner are compiled per block, because a block's
   * feature switches are the whole point of having blocks: two of them at one
   * size with `ss01` on in the second is the comparison the Proof exists for.
   */
  const prepared = useMemo(
    () =>
      pageBlocks.map((block) => ({
        block,
        shape: shaperFrom(document.features, applyFeatures, block.settings),
        position: positionerFrom(document.features, applyFeatures, block.settings),
        engine:
          applyFeatures && shaping !== null
            ? shaping.harfBuzzEngine(document, block.settings)
            : undefined,
      })),
    [pageBlocks, document, applyFeatures, shaping],
  );

  /**
   * The page: each block set, measured, and stacked under the one before it.
   *
   * The measure is taken per block from the canvas, so every block rewraps as the
   * window changes and a block at 72 pt gets the same column as one at 9 — which
   * is what makes a waterfall a page of text rather than a picture of one.
   *
   * Everything here is in screen pixels except the lines themselves, which stay
   * in design units with their own scale beside them. A block's height is the
   * room its ascenders need, its baselines, and room under the last one for
   * descenders.
   */
  const page = useMemo(() => {
    const laid: {
      readonly block: ProofBlock;
      readonly lines: ReturnType<typeof layoutParagraph>;
      readonly measure: number;
      readonly scale: number;
      readonly top: number;
      readonly height: number;
    }[] = [];

    let top = MARGIN;
    for (const item of prepared) {
      const scale = item.block.size / unitsPerEm;
      const measure = Math.max((width - MARGIN * 2) / Math.max(scale, 0.0001), unitsPerEm);
      const lines = layoutParagraph(
        document,
        text,
        measure,
        leading * unitsPerEm,
        item.shape,
        item.position,
        item.engine,
      );
      const lastBaseline = (lines[lines.length - 1]?.y ?? 0) * scale;
      const height = item.block.size + lastBaseline + item.block.size * 0.4;
      laid.push({ block: item.block, lines, measure, scale, top, height });
      top += height + BLOCK_GAP;
    }
    return laid;
  }, [prepared, document, text, leading, unitsPerEm, width]);

  // A page that runs right to left is set from the right margin, so its ragged
  // edge is on the left — where, in that reading, a line ends.
  const rtl = settings.direction === "rtl";
  const lineCount = useMemo(() => page.reduce((n, b) => n + b.lines.length, 0), [page]);

  /**
   * How tall the set text is, so the page can be scrolled through.
   *
   * A proof at a reading size is a page or two long, and one at ninety-six
   * points is longer still. Fitting it to the window would mean either shrinking
   * the type — which is the one thing a proof must not do, since the size is
   * what is being judged — or cutting it off.
   */
  const contentHeight = useMemo(() => {
    const last = page[page.length - 1];
    return last === undefined ? MARGIN * 2 : last.top + last.height + MARGIN;
  }, [page]);

  // Where the reader should end up once the proof has been re-set at a new
  // size. Null when nothing is waiting.
  const wantedScroll = useRef<number | null>(null);

  // The document too, for the components each glyph is drawn with.
  // The blocks as they are, for the rules: a rule says the size a block is,
  // not the size the zoom draws it at.
  const frame = useRef({ page, document, rtl, waterfall, settings, blocks });
  frame.current = { page, document, rtl, waterfall, settings, blocks };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const surface = new CanvasSurface(canvas, (ctx, viewport) => {
      const state = frame.current;
      // Read here rather than held in state: scrolling a long proof should cost
      // a canvas frame, not a React render of the whole workspace.
      const scrollTop = scrollRef.current?.scrollTop ?? 0;

      const scene: ProofScene = {
        blocks: state.page.map((laid) => ({
          lines: laid.lines.map((line) => {
            const shift = state.rtl ? laid.measure - line.run.width : 0;
            return {
              glyphs: line.run.glyphs.map((p) => ({
                // Components drawn in, or a composite is a gap in the proof.
                glyph: drawableGlyph(state.document, p.glyph),
                x: p.x + shift,
                advance: p.advance,
                dx: p.dx,
                dy: p.dy,
              })),
              y: line.y,
            };
          }),
          // The block's first baseline sits a line below its top, so the
          // ascenders of its first line have somewhere to be.
          view: { scale: laid.scale, tx: MARGIN, ty: laid.top + laid.block.size - scrollTop },
          // A rule only where there is something for it to tell apart. At one
          // size it would say what the slider says.
          caption: state.waterfall
            ? {
                text: blockCaption(
                  state.blocks.find((b) => b.id === laid.block.id) ?? laid.block,
                  state.settings,
                ),
                y: laid.top - CAPTION_LIFT - scrollTop,
                left: MARGIN,
                right: Math.max(MARGIN, viewport.width - MARGIN),
              }
            : null,
        })),
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
  }, [page, contentHeight, rtl, waterfall, settings]);

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
   * A waterfall is zoomed as a whole, every block by the same factor, because
   * the ladder is a set of proportions and zooming one rung of it would be
   * editing the ladder rather than looking at it. And it is zoomed as a view:
   * the sizes are drawn larger and kept as they are. Scaling the sizes
   * themselves rounded each one and pinned the ends at the proof's limits, a
   * notch at a time, until zooming back out no longer gave the ladder back.
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

      if (store.getState().proofBlocks.length > 0) {
        const before = store.getState().proofZoom;
        store.setProofZoom(before * intent.factor);
        const after = store.getState().proofZoom;
        if (after === before) return;
        wantedScroll.current = scroller.scrollTop * (after / before);
        return;
      }

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
      <div className={styles.bar} data-above-blocks={waterfall ? "true" : undefined}>
        <LocationBar />
        <span className={styles.separator} aria-hidden="true" />

        {/* What the page is: one size, or a ladder of them. Choosing the ladder
            fills it in, because a waterfall with no rungs is an empty page and
            a mode that showed nothing until you pressed something else would be
            asking the same question twice. */}
        <select
          className={styles.mode}
          aria-label="How the proof is set"
          value={waterfall ? "waterfall" : "one"}
          onChange={(event) => {
            store.setProofBlocks(event.target.value === "waterfall" ? ladderBlocks(settings) : []);
          }}
        >
          <option value="one">One size</option>
          <option value="waterfall">Waterfall</option>
        </select>

        {!waterfall && (
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
        )}

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
        <span className={styles.separator} aria-hidden="true" />

        {/* Beside the way the line is set rather than by the text, which is at
            the other end of the view: this chooses what is set, and everything
            in this bar is about how it is set. */}
        <select
          className={styles.specimens}
          aria-label="Specimen"
          value={specimenNamed(PROOF_SPECIMENS, text) ?? ""}
          onChange={(event) => {
            const chosen = PROOF_SPECIMENS.find((s) => s.name === event.target.value);
            if (chosen !== undefined) store.setProofText(chosen.text);
          }}
        >
          {specimenNamed(PROOF_SPECIMENS, text) === null && <option value="">Custom</option>}
          {PROOF_SPECIMENS.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <span className={styles.separator} aria-hidden="true" />

        <TextSettingsControls
          value={settings}
          document={document}
          applyFeatures={applyFeatures}
          canShape={hasFeatures}
          onChange={(next) => store.setProofTextSettings(next)}
          onApplyFeaturesChange={() => store.toggleApplyFeatures()}
        />

        <span className={styles.count}>
          {lineCount === 1 ? "1 line" : `${String(lineCount)} lines`}
        </span>
      </div>

      {waterfall && (
        <ProofBlocks
          blocks={blocks}
          settings={settings}
          size={heldSize(size)}
          zoom={zoom}
          onZoomReset={() => store.setProofZoom(1)}
          document={document}
          applyFeatures={applyFeatures}
          canShape={hasFeatures}
          onChange={(next) => store.setProofBlocks(next)}
          onApplyFeaturesChange={() => store.toggleApplyFeatures()}
        />
      )}

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
        data-own-undo=""
        title="Text to set, with any glyph by name after a slash: /a.001, /uni0301"
        spellCheck={false}
        rows={3}
        onChange={(event) => store.setProofText(event.target.value)}
      />
    </div>
  );
}
