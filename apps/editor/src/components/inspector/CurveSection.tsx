import { type HandleScales, pannedLambdas, panOf } from "@typewright/geometry";
import {
  begin,
  commit,
  focusedSegmentScales,
  focusedSegmentStatus,
  harmoniseSelection,
  holdSegmentTension,
  result,
  selectedCurvature,
  setSegmentTension,
} from "@typewright/tools";
import type { SegmentRef } from "@typewright/view";
import { useEffect, useRef } from "react";

import { useEditorStore, useStoreValue } from "../../useStore.js";
import styles from "../Inspector.module.css";
import { Stepper } from "../Stepper.js";
import { SplineIcon } from "../icons.js";
import { Section } from "./Section.js";
import { Field, shown } from "./fields.js";

/**
 * The segment the selection is on: its tension, its curvature, and the pan.
 *
 * The Tunni controls as numbers, in the two dimensions the geometry actually
 * has: how much handle there is, and how it is split between the two ends.
 *
 * Tension is both handles' reach towards the handle intersection, as a
 * percentage — the proportion a designer already talks in, and the one thing
 * about a curve that carries from one segment to the next where a length in
 * units does not. Pan is the split. Between them they say everything a pair of
 * λs says, and each one on its own is a thing somebody means to change: a
 * number for each handle made every change of tension a change of balance as
 * well, and left the slider saying the same thing twice.
 */
export function CurveSection(): React.JSX.Element {
  const store = useEditorStore();
  const tensionIn = useStoreValue((s) => focusedSegmentScales(s.session.editor)?.lambda1 ?? null);
  const tensionOut = useStoreValue((s) => focusedSegmentScales(s.session.editor)?.lambda2 ?? null);
  const curveStatus = useStoreValue((s) => focusedSegmentStatus(s.session.editor));

  // The curvature either side of the selected node, as radii, and how far apart
  // they are. Three scalars rather than the object, for the reason the
  // coordinates in the point section are three: a fresh object every
  // notification re-renders the panel through every drag.
  const radiusIn = useStoreValue((s) => selectedCurvature(s.session.editor)?.before ?? null);
  const radiusOut = useStoreValue((s) => selectedCurvature(s.session.editor)?.after ?? null);
  const curvatureRatio = useStoreValue((s) => selectedCurvature(s.session.editor)?.ratio ?? null);
  const pointCount = useStoreValue(
    (s) => s.session.editor.selection.filter((item) => item.part === "point").length,
  );

  /**
   * The segment being panned and the scales it was panned from.
   *
   * A slider is a drag, so it is one undo step from press to release — and every
   * value along the way is computed from the scales the drag began with rather
   * than from the last frame's, so passing back through the middle puts the
   * curve back exactly where it started instead of drifting.
   */
  const pan = useRef<{ segment: SegmentRef; from: HandleScales } | null>(null);

  // A section that is folded — or a panel dismissed — mid-drag must not leave
  // the step open: nothing would close it, and autosave holds off while a
  // transaction is pending.
  useEffect(
    () => () => {
      if (pan.current !== null) store.applyTool(result(store.editor, [commit]));
    },
    [store],
  );

  /**
   * Set the tension of both handles, keeping the balance between them.
   *
   * Typed as the mean of the two, which is what the pan is a split of: pan
   * holds the sum and moves the split, this holds the split and moves the sum,
   * so neither control moves the other's number.
   */
  const commitTension = (percent: number): void => {
    if (!Number.isFinite(percent)) return;
    const segment = store.editor.focusedSegment;
    const scales = focusedSegmentScales(store.editor);
    if (segment === null || scales === null) return;

    const mean = percent / 100;
    const balanced = pannedLambdas({ lambda1: mean, lambda2: mean }, panOf(scales) ?? 0);
    if (balanced === null) return;
    store.applyTool(setSegmentTension(store.editor, segment, balanced));
  };

  /**
   * Open the pan step, if one is not open already.
   *
   * Lazily rather than on the press, because a slider is also worked with the
   * arrow keys, and those never send one.
   */
  const startPan = (): void => {
    if (pan.current !== null) return;
    const segment = store.editor.focusedSegment;
    const scales = focusedSegmentScales(store.editor);
    if (segment === null || scales === null) return;

    pan.current = { segment, from: scales };
    store.applyTool(result(store.editor, [begin("Pan handles")]));
  };

  const movePan = (to: number): void => {
    startPan();
    const held = pan.current;
    if (held === null) return;

    const scales = pannedLambdas(held.from, to);
    if (scales === null) return;
    store.applyTool(holdSegmentTension(store.editor, held.segment, scales));
  };

  /**
   * Set the pan outright, as the field beside the slider does.
   *
   * One step of its own, unlike the slider's drag: a number typed is a single
   * change however long it took to type. Held inside the slider's own travel,
   * since a pan of one has shortened a handle into its anchor and the kernel
   * refuses it.
   */
  const commitPan = (percent: number): void => {
    if (!Number.isFinite(percent)) return;
    const segment = store.editor.focusedSegment;
    const scales = focusedSegmentScales(store.editor);
    if (segment === null || scales === null) return;

    const to = Math.max(-PAN_REACH, Math.min(PAN_REACH, percent / 100));
    const panned = pannedLambdas(scales, to);
    if (panned === null) return;
    store.applyTool(setSegmentTension(store.editor, segment, panned));
  };

  const endPan = (): void => {
    if (pan.current === null) return;
    pan.current = null;
    store.applyTool(result(store.editor, [commit]));
  };

  // λ is only a proportion where the handles are on the same side of the chord
  // and pointing at each other; anywhere else the number exists and means
  // nothing anyone would want to type into. See `TunniStatus`.
  const curveReady = curveStatus === "ok" && tensionIn !== null && tensionOut !== null;
  // The mean, since that is the number pan leaves alone: with the handles
  // balanced it is each handle's own reach, and panned it is what they average.
  const tension = tensionIn === null || tensionOut === null ? null : (tensionIn + tensionOut) / 2;
  const panValue =
    tensionIn === null || tensionOut === null
      ? 0
      : (panOf({ lambda1: tensionIn, lambda2: tensionOut }) ?? 0);
  const curveHint =
    curveStatus === null
      ? "Click a curve to work on it"
      : curveStatus === "flat"
        ? "A straight segment has no tension"
        : curveStatus === "ok"
          ? "How far the handles reach towards where the two handle lines cross; pan sets the balance between them"
          : "The handles of this segment do not make a proportion that can be typed";

  return (
    <Section
      name="curve"
      title="Curve"
      icon={SplineIcon}
      relevant={curveStatus !== null}
      empty={curveStatus === null}
      emptyNote="no segment"
    >
      <Field label="Tension">
        <Stepper
          value={tension === null ? null : shown(tension * 100)}
          label="tension"
          disabled={!curveReady}
          onStep={(next) => commitTension(next)}
        >
          <input
            className={styles.input}
            type="number"
            aria-label="Tension of the segment"
            title={curveHint}
            disabled={!curveReady}
            value={tension === null ? "" : shown(tension * 100)}
            onChange={(event) => commitTension(Number(event.target.value))}
          />
        </Stepper>
      </Field>

      {/* What the curvature comb shows at this node, as a number: the radius
            of the circle fitting each side, and how far apart the two are. One
            is a join the light crosses without a crease, and harmonising is
            what puts a join there. */}
      <Field label="Curvature" group>
        <div className={styles.curvature}>
          <span className={styles.readonly}>
            {radiusIn === null || radiusOut === null
              ? "—"
              : `r ${String(Math.round(radiusIn))} · ${String(Math.round(radiusOut))}`}
          </span>
          <span
            className={styles.readonly}
            title="The sharper side over the gentler; 1.00 is a join with no curvature break"
          >
            {curvatureRatio === null ? "" : `× ${curvatureRatio.toFixed(2)}`}
          </span>
          <button
            type="button"
            className={styles.align}
            disabled={pointCount === 0}
            title="Move the selected points to where the curvature either side of them agrees"
            onClick={() => store.applyTool(harmoniseSelection(store.editor))}
          >
            Harmonise
          </button>
        </div>
      </Field>

      {/* Pan moves length from one handle to the other without changing how
            much there is of it, so the curve leans without swelling. The middle
            is where the two are equal, which is what balancing a segment does. */}
      <Field label="Pan">
        <div className={styles.panRow}>
          <div className={styles.panTrack}>
            {/* Behind the slider, so the thumb covers it exactly when the pan
                is where the mark says. */}
            <span className={styles.centre} aria-hidden="true" />
            <input
              className={styles.slider}
              type="range"
              min={-PAN_REACH}
              max={PAN_REACH}
              step={0.01}
              aria-label="Pan the curve between its two handles"
              title="Lengthen one handle by as much as the other shortens; the middle is balanced — double-click to go there"
              disabled={!curveReady}
              value={curveReady ? panValue : 0}
              onChange={(event) => movePan(Number(event.target.value))}
              onPointerUp={endPan}
              onKeyUp={endPan}
              onBlur={endPan}
              // Back to balanced, which is where the mark on the track is. The
              // same gesture as double-clicking the Tunni point on the canvas,
              // and for the same reason: the middle is a place aimed for often
              // enough that hitting it by hand is a nuisance.
              onDoubleClick={() => {
                movePan(0);
                endPan();
              }}
            />
          </div>

          {/* The same number, to read and to type. A slider says roughly, and
              a lean worth keeping is one worth being able to write down — and
              to give the segment beside it. */}
          <Stepper
            value={curveReady ? shown(panValue * 100) : null}
            label="pan"
            disabled={!curveReady}
            onStep={(next) => commitPan(next)}
          >
            <input
              className={styles.input}
              type="number"
              min={-PAN_REACH * 100}
              max={PAN_REACH * 100}
              aria-label="Pan as a percentage"
              title="Which way the reach leans, as a percentage of it: 0 is balanced, 100 is all at the start"
              disabled={!curveReady}
              value={curveReady ? shown(panValue * 100) : ""}
              onChange={(event) => commitPan(Number(event.target.value))}
            />
          </Stepper>
        </div>
      </Field>
    </Section>
  );
}

/**
 * How far the slider goes each way.
 *
 * Not quite all the way to one: at exactly 1 the short handle has been shortened
 * into its own anchor, which the kernel refuses — so the end of the travel would
 * be a place the slider could reach and the curve could not.
 */
const PAN_REACH = 0.98;
