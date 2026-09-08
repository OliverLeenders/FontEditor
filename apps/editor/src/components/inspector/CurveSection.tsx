import { type HandleScales, pannedLambdas, panOf } from "@fonteditor/geometry";
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
} from "@fonteditor/tools";
import type { SegmentRef } from "@fonteditor/view";
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
 * The Tunni controls as numbers. Tension is each handle's reach towards the
 * handle intersection, as a percentage — the proportion a designer already
 * talks in, and the one thing about a curve that carries from one segment to
 * the next where a length in units does not.
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

  /** Set one handle's tension, leaving the other where it is. */
  const commitTension = (which: "in" | "out", percent: number): void => {
    if (!Number.isFinite(percent)) return;
    const segment = store.editor.focusedSegment;
    const scales = focusedSegmentScales(store.editor);
    if (segment === null || scales === null) return;

    store.applyTool(
      setSegmentTension(
        store.editor,
        segment,
        which === "in"
          ? { lambda1: percent / 100, lambda2: scales.lambda2 }
          : { lambda1: scales.lambda1, lambda2: percent / 100 },
      ),
    );
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

  const endPan = (): void => {
    if (pan.current === null) return;
    pan.current = null;
    store.applyTool(result(store.editor, [commit]));
  };

  // λ is only a proportion where the handles are on the same side of the chord
  // and pointing at each other; anywhere else the number exists and means
  // nothing anyone would want to type into. See `TunniStatus`.
  const curveReady = curveStatus === "ok" && tensionIn !== null && tensionOut !== null;
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
          ? "How far each handle reaches towards where the two handle lines cross"
          : "The handles of this segment do not make a proportion that can be typed";

  return (
    <Section name="curve" title="Curve" icon={SplineIcon} relevant={curveStatus !== null}>
      <Field label="Tension">
        <div className={styles.pair}>
          <Stepper
            value={tensionIn === null ? null : shown(tensionIn * 100)}
            label="tension at the start"
            disabled={!curveReady}
            onStep={(next) => commitTension("in", next)}
          >
            <input
              className={styles.input}
              type="number"
              aria-label="Tension at the start of the segment"
              title={curveHint}
              disabled={!curveReady}
              value={tensionIn === null ? "" : shown(tensionIn * 100)}
              onChange={(event) => commitTension("in", Number(event.target.value))}
            />
          </Stepper>
          <Stepper
            value={tensionOut === null ? null : shown(tensionOut * 100)}
            label="tension at the end"
            disabled={!curveReady}
            onStep={(next) => commitTension("out", next)}
          >
            <input
              className={styles.input}
              type="number"
              aria-label="Tension at the end of the segment"
              title={curveHint}
              disabled={!curveReady}
              value={tensionOut === null ? "" : shown(tensionOut * 100)}
              onChange={(event) => commitTension("out", Number(event.target.value))}
            />
          </Stepper>
        </div>
      </Field>

      {/* What the curvature comb shows at this node, as a number: the radius
            of the circle fitting each side, and how far apart the two are. One
            is a join the light crosses without a crease, and harmonising is
            what puts a join there. */}
      <Field label="Curvature">
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
