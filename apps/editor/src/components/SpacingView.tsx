import { breakOutKern, kerningFor, nudgeKern, nudgeSidebearing } from "@fonteditor/tools";
import { CanvasSurface, type RunScene, drawRun } from "@fonteditor/render";
import { sidebearings } from "@fonteditor/font-model";
import {
  type ViewTransform,
  glyphAtX,
  layoutRun,
  occurrencesOf,
  wheelIntent,
} from "@fonteditor/view";
import { useEffect, useMemo, useRef, useState } from "react";

import { KernGroups } from "./KernGroups.js";
import { palette } from "../scene.js";
import { shaperFrom } from "../shaping.js";
import { MAX_SPACING_SIZE, MIN_SPACING_SIZE } from "../store.js";
import { watchScheme } from "../scheme.js";
import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./SpacingView.module.css";

/** Design units per arrow press, and with shift held. */
const STEP = 1;
const BIG_STEP = 10;

/** Left margin when the line is too wide to centre. */
const RUN_INSET = 40;

/**
 * Where the line sits on the canvas.
 *
 * One definition, used by the frame callback and by the click test alike. They
 * have to agree exactly — a click resolved through a different transform than
 * the one that drew selects the wrong letter, and it would do so only at certain
 * widths, which is a miserable bug to find.
 */
export function runView(
  runWidth: number,
  size: number,
  unitsPerEm: number,
  viewport: { width: number; height: number },
  panX = 0,
): ViewTransform {
  const scale = size / unitsPerEm;
  const drawn = runWidth * scale;
  return {
    scale,
    // Centred when it fits, inset when it does not, so a long line runs off the
    // right rather than off both sides at once. The pan is added on top of that
    // resting place, so a line that has not been dragged is still centred.
    tx: (drawn < viewport.width - RUN_INSET * 2 ? (viewport.width - drawn) / 2 : RUN_INSET) + panX,
    ty: viewport.height * 0.72,
  };
}

/**
 * The spacing workspace: a line of text, adjusted a unit at a time.
 *
 * Spacing is not judged on one glyph. It is judged by looking at a word and
 * deciding which gap is wrong, which is why this view exists at all rather than
 * the sidebearing fields in the inspector being the whole feature.
 *
 * The work is almost entirely keyboard: select a letter, then nudge. Arrow keys
 * move the left bearing, alt the right, shift makes the step ten. Every press is
 * a real edit on the glyph, so it shows on every occurrence in the line at once
 * — which is the honest thing, and the reason all occurrences are banded rather
 * than only the one clicked.
 */
export function SpacingView({
  onOpenGlyph,
}: {
  onOpenGlyph: (name: string) => void;
}): React.JSX.Element {
  const store = useEditorStore();
  const document = useStoreValue((s) => s.session.editor.document);
  const text = useStoreValue((s) => s.spacingText);
  const size = useStoreValue((s) => s.spacingSize);
  const mode = useStoreValue((s) => s.spacingMode);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  // How far the line has been pushed along, in screen pixels. Zero is where the
  // line puts itself, so the view has a resting place to return to.
  const [panX, setPanX] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<CanvasSurface | null>(null);

  // The features the font itself defines are applied here, so the line is set
  // the way the font would set it — a ligature in the source shows as one letter
  // rather than as the two it replaces.
  const applyFeatures = useStoreValue((s) => s.applyFeatures);
  const shape = useMemo(
    () => shaperFrom(document.features, applyFeatures),
    [document.features, applyFeatures],
  );
  const hasFeatures = document.features.trim() !== "";
  const run = useMemo(() => layoutRun(document, text, shape), [document, text, shape]);

  const selectedName = selected === null ? null : (run.glyphs[selected]?.name ?? null);
  const bands = useMemo(
    () => (selectedName === null ? [] : occurrencesOf(run, selectedName)),
    [run, selectedName],
  );

  const frame = useRef({ run, document, bands, size, panX });
  frame.current = { run, document, bands, size, panX };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const surface = new CanvasSurface(canvas, (ctx, viewport) => {
      const state = frame.current;
      const { info } = state.document;

      const scene: RunScene = {
        glyphs: state.run.glyphs.map((p) => ({ glyph: p.glyph, x: p.x })),
        view: runView(state.run.width, state.size, info.unitsPerEm, viewport, state.panX),
        viewport,
        palette: palette(),
        metrics: {
          unitsPerEm: info.unitsPerEm,
          ascender: info.ascender,
          descender: info.descender,
        },
        selected: state.bands,
        allMargins: false,
      };
      drawRun(ctx, scene);
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
  }, [run, bands, size, document, panX]);

  // A new line starts where a line starts. Carrying the old offset over would
  // open a different word off the side of the canvas.
  useEffect(() => {
    setPanX(0);
  }, [text]);

  /**
   * The wheel: along the line, or into it with ctrl held.
   *
   * Non-passive, like the glyph canvas, because a ctrl-wheel that is not claimed
   * here is a ctrl-wheel the browser uses to zoom the whole editor.
   */
  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;

    const onWheel = (event: WheelEvent): void => {
      const surface = surfaceRef.current;
      const canvas = canvasRef.current;
      if (surface === null || canvas === null) return;
      event.preventDefault();

      const intent = wheelIntent(event);
      if (intent.kind === "pan") {
        // One line of text: there is nothing above or below it to reach, so a
        // vertical wheel moves along the line as a horizontal one does.
        setPanX((at) => at + (intent.dx !== 0 ? intent.dx : intent.dy));
        return;
      }

      // Zooming is a change of type size here, not of a separate view scale —
      // the size is the thing being judged, and there is only one of it. What
      // has to be preserved is the letter under the cursor, which the resting
      // place would otherwise slide out from under as the line grows.
      const state = frame.current;
      const box = canvas.getBoundingClientRect();
      const viewport = { width: box.width, height: box.height };
      const before = runView(
        state.run.width,
        state.size,
        state.document.info.unitsPerEm,
        viewport,
        state.panX,
      );
      const cursor = surface.toCanvasPoint(event).x;
      const held = (cursor - before.tx) / before.scale;

      const wanted = state.size * intent.factor;
      store.setSpacingSize(wanted);
      const settled = store.getState().spacingSize;
      const resting = runView(
        state.run.width,
        settled,
        state.document.info.unitsPerEm,
        viewport,
        0,
      );
      setPanX(cursor - held * resting.scale - resting.tx);
    };

    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [store]);

  // A shorter line must not leave the selection pointing past its end.
  useEffect(() => {
    setSelected((current) => (current === null || current < run.glyphs.length ? current : null));
  }, [run.glyphs.length]);

  /** Screen point to a run index, through the same transform the canvas drew with. */
  const indexAt = (event: { clientX: number; clientY: number }): number | null => {
    const canvas = canvasRef.current;
    const surface = surfaceRef.current;
    if (canvas === null || surface === null) return null;

    const point = surface.toCanvasPoint(event);
    const box = canvas.getBoundingClientRect();
    const view = runView(
      run.width,
      size,
      document.info.unitsPerEm,
      { width: box.width, height: box.height },
      panX,
    );

    return glyphAtX(run, (point.x - view.tx) / view.scale)?.index ?? null;
  };

  const nudge = (side: "left" | "right", delta: number): void => {
    if (selectedName === null) return;
    store.applyTool(nudgeSidebearing(store.editor, selectedName, side, delta));
  };

  // In kern mode the selection means the gap *before* the selected letter, so
  // the pair is it and the one preceding it.
  const previousName =
    selected === null || selected === 0 ? null : (run.glyphs[selected - 1]?.name ?? null);
  const pair =
    previousName === null || selectedName === null
      ? null
      : kerningFor(store.editor, previousName, selectedName);

  const kern = (delta: number): void => {
    if (previousName === null || selectedName === null) return;
    store.applyTool(nudgeKern(store.editor, previousName, selectedName, delta));
  };

  const selectedGlyph = selectedName === null ? undefined : document.glyphs[selectedName];
  const bearings = selectedGlyph === undefined ? null : sidebearings(selectedGlyph);

  return (
    <div className={styles.spacing}>
      <div className={styles.bar}>
        <input
          type="text"
          className={styles.text}
          value={text}
          aria-label="Text to space"
          spellCheck={false}
          onChange={(event) => store.setSpacingText(event.target.value)}
        />
        {/* Two exclusive modes rather than a modifier key: adjusting a letter's
            own space and adjusting the gap before it are different jobs, and
            which one the arrows are doing should be visible, not remembered. */}
        <div className={styles.modes} role="group" aria-label="What the arrows adjust">
          <button
            type="button"
            aria-pressed={mode === "space"}
            onClick={() => store.setSpacingMode("space")}
          >
            Space
          </button>
          <button
            type="button"
            aria-pressed={mode === "kern"}
            onClick={() => store.setSpacingMode("kern")}
          >
            Kern
          </button>
        </div>
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
        {/* Groups belong beside the line rather than in a workspace of their
            own: which class a letter is in is a question that arrives while
            looking at a gap, not before. */}
        <KernGroups
          open={groupsOpen}
          onOpenChange={setGroupsOpen}
          first={previousName}
          second={selectedName}
        />
        <label className={styles.sizeLabel}>
          Size
          <input
            type="range"
            className={styles.size}
            min={MIN_SPACING_SIZE}
            max={MAX_SPACING_SIZE}
            step={4}
            value={size}
            aria-label="Type size"
            onChange={(event) => store.setSpacingSize(Number(event.target.value))}
          />
          {/* The wheel sets a fractional size, because a zoom that snapped to
              whole pixels would stall on a trackpad's small deltas. The reader
              is shown the number they would type. */}
          <span className={styles.sizeValue}>{Math.round(size)}</span>
        </label>
      </div>

      <div
        ref={stageRef}
        className={styles.stage}
        tabIndex={0}
        role="application"
        aria-label="Spacing line"
        onKeyDown={(event) => {
          if (event.ctrlKey || event.metaKey) return;
          const step = event.shiftKey ? BIG_STEP : STEP;
          const side = event.altKey ? "right" : "left";

          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            if (selectedName === null) return;
            const amount = event.key === "ArrowRight" ? step : -step;
            if (mode === "kern") kern(amount);
            else nudge(side, amount);
            return;
          }
          // Tab would leave the stage, so stepping through letters gets its own
          // keys rather than fighting the browser for focus order.
          if (event.key === "]" || event.key === "[") {
            event.preventDefault();
            const next = (selected ?? -1) + (event.key === "]" ? 1 : -1);
            if (next >= 0 && next < run.glyphs.length) setSelected(next);
            return;
          }
          if (event.key === "Escape") setSelected(null);
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.focus();
          setSelected(indexAt(event));
        }}
        onDoubleClick={(event) => {
          const index = indexAt(event);
          const name = index === null ? null : run.glyphs[index]?.name;
          if (name !== null && name !== undefined) onOpenGlyph(name);
        }}
      >
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      </div>

      <div className={styles.readout}>
        {selectedName === null ? (
          <span className={styles.hint}>
            Click a letter &middot; arrows adjust, shift by ten &middot; alt for the right side
            &middot; double-click to draw it
          </span>
        ) : mode === "kern" ? (
          <>
            {previousName === null ? (
              <span className={styles.hint}>
                Nothing precedes this letter, so there is no pair to kern.
              </span>
            ) : (
              <>
                <span className={styles.name}>
                  {previousName} {selectedName}
                </span>
                <Value label="Kern" value={pair?.value ?? 0} />
                {/* Which rule applied, because adjusting a class moves far more
                    than the two letters in front of you. */}
                {pair === null ? (
                  <span className={styles.hint}>no pair yet</span>
                ) : pair.grouped ? (
                  <>
                    <span className={styles.hint}>
                      from {pair.first} {pair.second}
                    </span>
                    <button
                      type="button"
                      className={styles.breakOut}
                      title="Kern these two on their own, leaving the group alone"
                      onClick={() =>
                        store.applyTool(breakOutKern(store.editor, previousName, selectedName))
                      }
                    >
                      Kern separately
                    </button>
                  </>
                ) : (
                  <span className={styles.hint}>this pair only</span>
                )}
                {/* Opens the panel already showing the classes these two are
                    in, because the moment you want a class is the moment a
                    pair turns out to be one of a family. */}
                <button
                  type="button"
                  className={styles.breakOut}
                  title="The classes these two letters kern by"
                  onClick={() => setGroupsOpen(true)}
                >
                  Group…
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <span className={styles.name}>{selectedName}</span>
            {bearings === null ? (
              <span className={styles.hint}>no outline, so no sidebearings</span>
            ) : (
              <>
                <Value label="Left" value={bearings.left} />
                <Value label="Right" value={bearings.right} />
                <Value label="Advance" value={document.glyphs[selectedName]?.advance ?? 0} />
              </>
            )}
            {bands.length > 1 ? (
              <span className={styles.hint}>{bands.length} occurrences, all moving together</span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function Value({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <span className={styles.value}>
      <span className={styles.valueLabel}>{label}</span>
      {Math.round(value)}
    </span>
  );
}
