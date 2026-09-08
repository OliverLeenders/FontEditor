import { type HandleScales, pannedLambdas, panOf } from "@fonteditor/geometry";
import {
  type NodeType,
  randomIds,
  setAdvance,
  setLeftSidebearing,
  setNodeType,
  setRightSidebearing,
  sidebearings,
  updateContour,
} from "@fonteditor/font-model";
import {
  fitImageToGlyph,
  guideById,
  moveGuideTo,
  moveImageTo,
  moveGuideToScope,
  removeGuideAt,
  renameGuideTo,
  scaleImageTo,
  turnGuideTo,
  type EditorState,
  addComponent,
  begin,
  commit,
  editCurrentGlyph,
  focusedSegmentScales,
  focusedSegmentStatus,
  holdSegmentTension,
  moveCoordinateTo,
  attachComponent,
  attachmentFor,
  moveAnchorToPoint,
  moveComponentTo,
  removeAnchorAt,
  removeComponent,
  renameAnchorTo,
  renameCurrentGlyph,
  renameRefusal,
  result,
  harmoniseSelection,
  selectedCanBeTangent,
  selectedCoordinate,
  selectedCurvature,
  selectedNode,
  setSegmentTension,
} from "@fonteditor/tools";
import type { SegmentRef } from "@fonteditor/view";
import { useEffect, useMemo, useRef, useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import { Stepper } from "./Stepper.js";
import { TransformPanel } from "./TransformPanel.js";
import styles from "./Inspector.module.css";

/**
 * The floating inspector: glyph identity, advance, and the selected points.
 *
 * Draggable and dismissible, with its position remembered, because it sits over
 * the canvas rather than reserving space beside it. That is the trade the layout
 * made — nearly all the screen goes to the work, and in exchange the panel can
 * land on top of what you are editing until you move it.
 */
export function Inspector(): React.JSX.Element | null {
  const store = useEditorStore();
  const open = useStoreValue((s) => s.inspector.open);
  const x = useStoreValue((s) => s.inspector.x);
  const y = useStoreValue((s) => s.inspector.y);
  const glyphName = useStoreValue((s) => s.session.editor.currentGlyph);
  const advance = useStoreValue(
    (s) => s.session.editor.document.glyphs[s.session.editor.currentGlyph]?.advance ?? 0,
  );
  const unicodes = useStoreValue(
    (s) => s.session.editor.document.glyphs[s.session.editor.currentGlyph]?.unicodes ?? EMPTY_CODES,
  );
  // Points only. A handle in the selection is not something these buttons can
  // act on, so counting it would enable them to do nothing.
  const pointCount = useStoreValue(
    (s) => s.session.editor.selection.filter((item) => item.part === "point").length,
  );
  const pointType = useStoreValue(selectedPointType);
  const canTangent = useStoreValue((s) => selectedCanBeTangent(s.session.editor));
  // Two selectors rather than one returning an object: a fresh object every time
  // would compare unequal and re-render the panel on every store notification.
  const leftBearing = useStoreValue(
    (s) =>
      sidebearings(s.session.editor.document.glyphs[s.session.editor.currentGlyph] ?? EMPTY_GLYPH)
        ?.left ?? null,
  );
  const rightBearing = useStoreValue(
    (s) =>
      sidebearings(s.session.editor.document.glyphs[s.session.editor.currentGlyph] ?? EMPTY_GLYPH)
        ?.right ?? null,
  );

  // Three scalar selectors rather than one returning the position: an object
  // built in a selector is a new object every time and would re-render the panel
  // on every store notification, drags included.
  const coordX = useStoreValue((s) => selectedCoordinate(s.session.editor)?.point.x ?? null);
  const coordY = useStoreValue((s) => selectedCoordinate(s.session.editor)?.point.y ?? null);
  const coordPart = useStoreValue((s) => selectedCoordinate(s.session.editor)?.item.part ?? null);

  // The handles of whichever single node the selection names, as a length and a
  // direction rather than as a position. Four scalars for the same reason the
  // coordinate above is three: a selector that built a point would build a new
  // one every notification and re-render the panel through every drag.
  const inLength = useStoreValue((s) => handlePolar(s.session.editor, "in")?.length ?? null);
  const inAngle = useStoreValue((s) => handlePolar(s.session.editor, "in")?.angle ?? null);
  const outLength = useStoreValue((s) => handlePolar(s.session.editor, "out")?.length ?? null);
  const outAngle = useStoreValue((s) => handlePolar(s.session.editor, "out")?.angle ?? null);

  // The curvature either side of the selected node, as radii, and how far apart
  // they are. Three scalars rather than the object, for the reason the
  // coordinate above is three: a fresh object every notification re-renders the
  // panel through every drag.
  const radiusIn = useStoreValue((s) => selectedCurvature(s.session.editor)?.before ?? null);
  const radiusOut = useStoreValue((s) => selectedCurvature(s.session.editor)?.after ?? null);
  const curvatureRatio = useStoreValue((s) => selectedCurvature(s.session.editor)?.ratio ?? null);

  const tensionIn = useStoreValue((s) => focusedSegmentScales(s.session.editor)?.lambda1 ?? null);
  const tensionOut = useStoreValue((s) => focusedSegmentScales(s.session.editor)?.lambda2 ?? null);
  const curveStatus = useStoreValue((s) => focusedSegmentStatus(s.session.editor));

  const anchors = useStoreValue(
    (s) =>
      s.session.editor.document.glyphs[s.session.editor.currentGlyph]?.anchors ?? EMPTY_ANCHORS,
  );
  const selectedAnchor = useStoreValue((s) => s.session.editor.selectedAnchor);
  const selectedGuide = useStoreValue((s) => s.session.editor.selectedGuide);
  const image = useStoreValue(
    (s) => s.session.editor.document.glyphs[s.session.editor.currentGlyph]?.image ?? null,
  );
  // The two lists separately, because each is a reference that lives in the
  // state. Selecting them together would build a fresh array on every call,
  // and `useSyncExternalStore` compares snapshots with `Object.is` — so the
  // component would re-render for ever. See `useStoreValue`.
  const fontGuides = useStoreValue((s) => s.session.editor.document.guides);
  const glyphGuides = useStoreValue(
    (s) => s.session.editor.document.glyphs[s.session.editor.currentGlyph]?.guides ?? EMPTY_GUIDES,
  );
  // Joined here, where a new array costs one render rather than all of them.
  const guides = useMemo(
    () => [
      ...fontGuides.map((guide) => ({ guide, scope: "font" as const })),
      ...glyphGuides.map((guide) => ({ guide, scope: "glyph" as const })),
    ],
    [fontGuides, glyphGuides],
  );
  const selectedComponent = useStoreValue((s) => s.session.editor.selectedComponent);

  const components = useStoreValue(
    (s) =>
      s.session.editor.document.glyphs[s.session.editor.currentGlyph]?.components ??
      EMPTY_COMPONENTS,
  );
  const glyphNames = useStoreValue((s) => s.session.editor.document.glyphOrder);
  const [adding, setAdding] = useState("");

  // The field is only a draft until it is committed, so it holds its own text.
  // Reset when the open glyph changes, or it would show the last glyph's name.
  const [draftName, setDraftName] = useState(glyphName);
  useEffect(() => setDraftName(glyphName), [glyphName]);

  const refusal = renameRefusal(store.editor, draftName);
  const renameable = draftName.trim() !== glyphName && refusal === null;
  // A name is only wrong once it has been changed into something wrong. A glyph
  // sitting under its own name is never in error, and `.notdef` would otherwise
  // be marked invalid the moment it was opened.
  const wrong = draftName !== glyphName && refusal !== null && refusal !== "missing";

  const drag = useRef<{ dx: number; dy: number } | null>(null);

  /**
   * The segment being panned and the scales it was panned from.
   *
   * A slider is a drag, so it is one undo step from press to release — and every
   * value along the way is computed from the scales the drag began with rather
   * than from the last frame's, so passing back through the middle puts the
   * curve back exactly where it started instead of drifting.
   */
  const pan = useRef<{ segment: SegmentRef; from: HandleScales } | null>(null);

  // A panel that is dismissed mid-drag must not leave the step open: nothing
  // would close it, and autosave holds off while a transaction is pending.
  useEffect(
    () => () => {
      if (pan.current !== null) store.applyTool(result(store.editor, [commit]));
    },
    [store],
  );

  if (!open) return null;

  /**
   * Commit the name, or put the field back.
   *
   * On blur as well as on Enter, because a field that quietly discarded what was
   * typed the moment you clicked elsewhere would be worse than one that asked.
   * Escape is the way to change your mind.
   */
  const commitName = (): void => {
    if (!renameable) {
      setDraftName(glyphName);
      return;
    }
    store.applyTool(renameCurrentGlyph(store.editor, draftName));
  };

  const commitAdvance = (value: number): void => {
    if (!Number.isFinite(value)) return;
    const document = editCurrentGlyph(store.editor, (g) => setAdvance(g, value));
    if (document === null) return;
    store.applyTool(result({ ...store.editor, document }, [begin("Set advance"), commit]));
  };

  /**
   * Both sidebearings commit the same way, and each is one undo step.
   *
   * Sidebearings are derived, so these write through to the advance and the
   * outline; see `setLeftSidebearing` for why the left one moves the advance
   * with it.
   */
  const commitBearing = (side: "left" | "right", value: number): void => {
    if (!Number.isFinite(value)) return;
    const document = editCurrentGlyph(store.editor, (g) =>
      side === "left" ? setLeftSidebearing(g, value) : setRightSidebearing(g, value),
    );
    if (document === null) return;
    store.applyTool(
      result({ ...store.editor, document }, [
        begin(side === "left" ? "Set left sidebearing" : "Set right sidebearing"),
        commit,
      ]),
    );
  };

  /**
   * Move the one selected point or handle to an exact coordinate.
   *
   * The other axis is read at the moment of the commit rather than from the
   * field beside it: typing in one box should not write back whatever the other
   * happened to be showing.
   */
  const commitCoordinate = (axis: "x" | "y", value: number): void => {
    if (!Number.isFinite(value)) return;
    const current = selectedCoordinate(store.editor);
    if (current === null) return;

    store.applyTool(
      moveCoordinateTo(store.editor, current.item, {
        x: axis === "x" ? value : current.point.x,
        y: axis === "y" ? value : current.point.y,
      }),
    );
  };

  /**
   * Move one handle of the selected node by its length or its direction.
   *
   * Both go through the same move a drag would make, so a smooth node still
   * swings its other side and a locked handle still holds its axis: what is
   * typed here and what is dragged there are the same edit, expressed twice.
   *
   * The axis not being typed is read from the geometry at the moment of the
   * commit rather than from the field beside it, as the coordinates above are.
   */
  const commitHandle = (which: "in" | "out", axis: "length" | "angle", value: number): void => {
    if (!Number.isFinite(value)) return;
    const found = selectedNode(store.editor);
    const polar = handlePolar(store.editor, which);
    if (found === null || polar === null) return;

    const length = Math.max(0, axis === "length" ? value : polar.length);
    const angle = ((axis === "angle" ? value : polar.angle) * Math.PI) / 180;

    store.applyTool(
      moveCoordinateTo(
        store.editor,
        { contourId: found.contourId, nodeId: found.nodeId, part: which },
        {
          x: found.node.pt.x + Math.cos(angle) * length,
          y: found.node.pt.y + Math.sin(angle) * length,
        },
      ),
    );
  };

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

  /** Place one component at an exact offset. */
  const commitComponent = (id: string, axis: "x" | "y", value: number): void => {
    if (!Number.isFinite(value)) return;
    const glyph = store.editor.document.glyphs[store.editor.currentGlyph];
    const found = glyph?.components.find((c) => c.id === id);
    if (found === undefined) return;

    store.applyTool(
      moveComponentTo(store.editor, id, {
        x: axis === "x" ? value : found.transform.xOffset,
        y: axis === "y" ? value : found.transform.yOffset,
      }),
    );
  };

  /**
   * Move one anchor to an exact coordinate.
   *
   * The other axis is read from the glyph at the moment of the commit rather
   * than from the field beside it, as the point coordinates above are.
   */
  const commitImage = (axis: "x" | "y", value: number): void => {
    if (!Number.isFinite(value) || image === null) return;
    const t = image.transform;
    store.applyTool(
      moveImageTo(store.editor, {
        x: axis === "x" ? value : t.xOffset,
        y: axis === "y" ? value : t.yOffset,
      }),
    );
  };

  const commitGuide = (id: string, axis: "x" | "y", value: number): void => {
    if (!Number.isFinite(value)) return;
    const found = guideById(store.editor, id);
    if (found === null) return;

    const pt = found.guide.pt;
    store.applyTool(
      moveGuideTo(store.editor, id, axis === "x" ? { x: value, y: pt.y } : { x: pt.x, y: value }),
    );
  };

  const commitAnchor = (id: string, axis: "x" | "y", value: number): void => {
    if (!Number.isFinite(value)) return;
    const glyph = store.editor.document.glyphs[store.editor.currentGlyph];
    const found = glyph?.anchors.find((a) => a.id === id);
    if (found === undefined) return;

    store.applyTool(
      moveAnchorToPoint(store.editor, id, {
        x: axis === "x" ? value : found.pt.x,
        y: axis === "y" ? value : found.pt.y,
      }),
    );
  };

  const applyPointType = (type: NodeType): void => {
    let editor = store.editor;
    // Every selected on-curve point, one contour operation at a time.
    for (const item of editor.selection) {
      if (item.part !== "point") continue;
      const document = editCurrentGlyph(editor, (g) =>
        updateContour(g, item.contourId, (c) => setNodeType(c, item.nodeId, type)),
      );
      if (document !== null) editor = { ...editor, document };
    }
    if (editor !== store.editor) {
      store.applyTool(result(editor, [begin("Set point type", false), commit]));
    }
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
    <aside
      className={styles.panel}
      style={{ left: `${x}px`, top: `${y}px` }}
      aria-label="Glyph inspector"
    >
      <header
        className={styles.grip}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { dx: event.clientX - x, dy: event.clientY - y };
        }}
        onPointerMove={(event) => {
          const from = drag.current;
          if (from === null) return;
          store.moveInspector(
            Math.max(0, event.clientX - from.dx),
            Math.max(0, event.clientY - from.dy),
          );
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          drag.current = null;
        }}
      >
        {/* The name is a reference — components place a glyph by it and kerning
            names it on both sides of a pair — so renaming is an edit rather
            than relabelling, and it belongs with the other fields that edit
            this glyph. It stays in the header because that is where the name
            already was, and where anyone would look for it. */}
        <input
          className={styles.name}
          value={draftName}
          aria-label="Glyph name"
          spellCheck={false}
          disabled={glyphName === ""}
          title={
            refusal === "reserved"
              ? "A font finds .notdef by name, so this one keeps it"
              : wrong && refusal === "taken"
                ? "Another glyph already has that name"
                : wrong && refusal === "empty"
                  ? "A glyph needs a name"
                  : "Rename this glyph, and everything that refers to it"
          }
          data-invalid={wrong ? "true" : undefined}
          readOnly={refusal === "reserved"}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setDraftName(glyphName);
              event.currentTarget.blur();
            }
            event.stopPropagation();
          }}
        />
        <button
          type="button"
          className={styles.dismiss}
          title="Hide the inspector  (I)"
          aria-label="Hide the inspector"
          onClick={() => store.toggleInspector()}
        >
          ×
        </button>
      </header>

      <div className={styles.body}>
        <Field label="Unicode">
          <span className={styles.readonly}>
            {unicodes.length === 0
              ? "—"
              : unicodes.map((u) => `U+${u.toString(16).toUpperCase().padStart(4, "0")}`).join(" ")}
          </span>
        </Field>

        <Field label="Advance">
          <Stepper
            value={Math.round(advance)}
            label="Advance"
            onStep={(next) => commitAdvance(next)}
          >
            <input
              className={styles.input}
              type="number"
              value={Math.round(advance)}
              onChange={(event) => commitAdvance(Number(event.target.value))}
            />
          </Stepper>
        </Field>

        {/* Disabled rather than hidden for a glyph with no outline: a space has
            an advance and no sidebearings, and a field that vanishes reads as a
            bug where a greyed one reads as the fact it is. */}
        <Field label="Sidebearings">
          <div className={styles.pair}>
            <Stepper
              value={leftBearing === null ? null : Math.round(leftBearing)}
              label="left sidebearing"
              disabled={leftBearing === null}
              onStep={(next) => commitBearing("left", next)}
            >
              <input
                className={styles.input}
                type="number"
                aria-label="Left sidebearing"
                title="Left sidebearing"
                disabled={leftBearing === null}
                value={leftBearing === null ? "" : Math.round(leftBearing)}
                onChange={(event) => commitBearing("left", Number(event.target.value))}
              />
            </Stepper>
            <Stepper
              value={rightBearing === null ? null : Math.round(rightBearing)}
              label="right sidebearing"
              disabled={rightBearing === null}
              onStep={(next) => commitBearing("right", next)}
            >
              <input
                className={styles.input}
                type="number"
                aria-label="Right sidebearing"
                title="Right sidebearing"
                disabled={rightBearing === null}
                value={rightBearing === null ? "" : Math.round(rightBearing)}
                onChange={(event) => commitBearing("right", Number(event.target.value))}
              />
            </Stepper>
          </div>
        </Field>

        <div className={styles.rule} />

        {/* Components are references, so the panel lists them and lets them be
            placed or removed. Editing what one *looks* like means opening the
            glyph it refers to, which is the entire point of using one. */}
        <Field label={components.length === 0 ? "Components" : `Components · ${components.length}`}>
          <div className={styles.components}>
            {components.map((c) => (
              <div
                key={c.id}
                className={styles.anchorRow}
                data-selected={c.id === selectedComponent ? "true" : undefined}
              >
                {/* The name is a reference and not a label, so it is shown
                    rather than typed into: pointing a component at a different
                    glyph is a different edit, and one that has to be checked
                    for recursion first. */}
                <button
                  type="button"
                  className={styles.componentOpen}
                  title={`Open ${c.base}`}
                  onClick={() => store.setCurrentGlyph(c.base)}
                >
                  {c.base}
                </button>
                <input
                  className={styles.input}
                  type="number"
                  aria-label={`X offset of ${c.base}`}
                  title="How far right the placed glyph sits"
                  value={shown(c.transform.xOffset)}
                  onChange={(event) => commitComponent(c.id, "x", Number(event.target.value))}
                />
                <input
                  className={styles.input}
                  type="number"
                  aria-label={`Y offset of ${c.base}`}
                  title="How far up the placed glyph sits"
                  value={shown(c.transform.yOffset)}
                  onChange={(event) => commitComponent(c.id, "y", Number(event.target.value))}
                />
                <button
                  type="button"
                  className={styles.componentRemove}
                  title={`Remove ${c.base}`}
                  aria-label={`Remove ${c.base}`}
                  onClick={() => store.applyTool(removeComponent(store.editor, c.id))}
                >
                  ×
                </button>
              </div>
            ))}
            {/* One button for the whole list: every component that has a pair
                to line up by goes back to where its anchors say it belongs. */}
            {components.length > 0 && (
              <button
                type="button"
                className={styles.align}
                disabled={!components.some((c) => attachmentFor(store.editor, c.id) !== null)}
                title="Put each component back where the anchors say it belongs"
                onClick={() => {
                  for (const c of components) {
                    store.applyTool(attachComponent(store.editor, c.id));
                  }
                }}
              >
                Align to anchors
              </button>
            )}
            <div className={styles.componentRow}>
              <input
                className={styles.input}
                list="fonteditor-glyph-names"
                placeholder="glyph name"
                aria-label="Add a component"
                value={adding}
                onChange={(event) => setAdding(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  store.applyTool(addComponent(store.editor, adding, componentIds));
                  setAdding("");
                }}
              />
              <datalist id="fonteditor-glyph-names">
                {glyphNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
          </div>
        </Field>

        <div className={styles.rule} />

        {/* Where accents attach. Added from the canvas — right-click where you
            want one — because a place is chosen by pointing at it; what a panel
            is for is the name and the exact numbers. */}
        <Field label={anchors.length === 0 ? "Anchors" : `Anchors · ${anchors.length}`}>
          <div className={styles.components}>
            {anchors.length === 0 && (
              <span className={styles.readonly}>Right-click the canvas to add one</span>
            )}
            {anchors.map((a) => (
              <div
                key={a.id}
                className={styles.anchorRow}
                data-selected={a.id === selectedAnchor ? "true" : undefined}
              >
                <input
                  className={styles.input}
                  value={a.name}
                  aria-label={`Name of the anchor at ${String(Math.round(a.pt.x))}, ${String(Math.round(a.pt.y))}`}
                  spellCheck={false}
                  title="What this place is called; an accent's own anchor starts with an underscore"
                  onChange={(event) =>
                    store.applyTool(renameAnchorTo(store.editor, a.id, event.target.value))
                  }
                />
                <input
                  className={styles.input}
                  type="number"
                  aria-label={`X of the anchor ${a.name}`}
                  value={shown(a.pt.x)}
                  onChange={(event) => commitAnchor(a.id, "x", Number(event.target.value))}
                />
                <input
                  className={styles.input}
                  type="number"
                  aria-label={`Y of the anchor ${a.name}`}
                  value={shown(a.pt.y)}
                  onChange={(event) => commitAnchor(a.id, "y", Number(event.target.value))}
                />
                <button
                  type="button"
                  className={styles.componentRemove}
                  title={`Remove ${a.name === "" ? "this anchor" : a.name}`}
                  aria-label={`Remove the anchor ${a.name}`}
                  onClick={() => store.applyTool(removeAnchorAt(store.editor, a.id))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </Field>

        <div className={styles.rule} />

        {/* Where the picture behind this letter sits. Added and chosen in the
            Tracing panel, and picked off a sheet in the Sheet view; what these
            are for is the nudge afterwards. */}
        {image === null ? null : (
          <>
            <Field label="Tracing">
              <div className={styles.imageRow}>
                <span className={styles.imageName} title={image.name}>
                  {image.name}
                </span>
                <input
                  className={styles.input}
                  type="number"
                  aria-label="X of the picture"
                  title="Where its lower-left corner sits"
                  value={shown(image.transform.xOffset)}
                  onChange={(event) => commitImage("x", Number(event.target.value))}
                />
                <input
                  className={styles.input}
                  type="number"
                  aria-label="Y of the picture"
                  value={shown(image.transform.yOffset)}
                  onChange={(event) => commitImage("y", Number(event.target.value))}
                />
                <input
                  className={styles.input}
                  type="number"
                  step={0.01}
                  aria-label="Scale of the picture"
                  title="How many design units to a pixel"
                  value={shown(image.transform.xScale)}
                  onChange={(event) =>
                    store.applyTool(scaleImageTo(store.editor, Number(event.target.value)))
                  }
                />
                <button
                  type="button"
                  className={styles.imageFit}
                  title="Lay it across the glyph, descender to ascender, keeping its proportions"
                  onClick={() => {
                    const decoded = store.picture(image.name);
                    if (decoded !== null) store.applyTool(fitImageToGlyph(store.editor, decoded));
                  }}
                >
                  Fit
                </button>
              </div>
            </Field>

            <div className={styles.rule} />
          </>
        )}

        {/* The lines this letter is drawn against, and the font's shown with
            them. Added from the canvas — right-click where you want one — for
            the reason anchors are: a place is chosen by pointing at it, and what
            a panel is for is the name and the exact numbers. */}
        <Field label={guides.length === 0 ? "Guides" : `Guides · ${guides.length}`}>
          <div className={styles.components}>
            {guides.length === 0 && (
              <span className={styles.readonly}>Right-click the canvas to add one</span>
            )}
            {guides.map(({ guide: g, scope }) => (
              <div
                key={g.id}
                className={styles.guideRow}
                data-selected={g.id === selectedGuide ? "true" : undefined}
              >
                <input
                  className={styles.input}
                  value={g.name}
                  aria-label={`Name of the guide at ${String(Math.round(g.pt.x))}, ${String(Math.round(g.pt.y))}`}
                  spellCheck={false}
                  placeholder={scope === "font" ? "font guide" : "guide"}
                  title="What this line is for — a stem width, an overshoot, the italic angle"
                  onChange={(event) =>
                    store.applyTool(renameGuideTo(store.editor, g.id, event.target.value))
                  }
                />
                <input
                  className={styles.input}
                  type="number"
                  aria-label={`X of the guide ${g.name}`}
                  value={shown(g.pt.x)}
                  onChange={(event) => commitGuide(g.id, "x", Number(event.target.value))}
                />
                <input
                  className={styles.input}
                  type="number"
                  aria-label={`Y of the guide ${g.name}`}
                  value={shown(g.pt.y)}
                  onChange={(event) => commitGuide(g.id, "y", Number(event.target.value))}
                />
                <input
                  className={styles.input}
                  type="number"
                  aria-label={`Angle of the guide ${g.name}`}
                  title="Degrees counter-clockwise: 0 lies flat, 90 stands up"
                  value={shown(g.angle)}
                  onChange={(event) =>
                    store.applyTool(turnGuideTo(store.editor, g.id, Number(event.target.value)))
                  }
                />
                {/* Which scope it is in, and the way to change it. A line drawn
                    while working on one letter often turns out to be about the
                    whole alphabet, and finding that out should not mean typing
                    it again somewhere else. */}
                <button
                  type="button"
                  className={styles.guideScope}
                  aria-pressed={scope === "font"}
                  title={
                    scope === "font"
                      ? "In every glyph. Click to keep it in this one."
                      : "In this glyph only. Click to give it to the whole font."
                  }
                  onClick={() =>
                    store.applyTool(
                      moveGuideToScope(store.editor, g.id, scope === "font" ? "glyph" : "font"),
                    )
                  }
                >
                  {scope === "font" ? "font" : "glyph"}
                </button>
                <button
                  type="button"
                  className={styles.componentRemove}
                  title={`Remove ${g.name === "" ? "this guide" : g.name}`}
                  aria-label={`Remove the guide ${g.name}`}
                  onClick={() => store.applyTool(removeGuideAt(store.editor, g.id))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </Field>

        <div className={styles.rule} />

        <Field label={pointCount === 0 ? "Point" : `Point · ${pointCount} selected`}>
          <div className={styles.segmented}>
            <button
              type="button"
              aria-pressed={pointType === "corner"}
              disabled={pointCount === 0}
              onClick={() => applyPointType("corner")}
            >
              Corner
            </button>
            <button
              type="button"
              aria-pressed={pointType === "smooth"}
              disabled={pointCount === 0}
              onClick={() => applyPointType("smooth")}
            >
              Smooth
            </button>
            {/* Only where it would be true: a tangent node says the curve on one
                side leaves along the straight segment on the other, and a point
                with two curves or two lines has no such arrangement. Disabled
                rather than hidden, so the third choice is visibly a choice. */}
            <button
              type="button"
              aria-pressed={pointType === "tangent"}
              disabled={pointCount === 0 || !canTangent}
              title={
                canTangent
                  ? "The curve leaves along the straight side"
                  : "Needs a straight segment on one side and a curve on the other"
              }
              onClick={() => applyPointType("tangent")}
            >
              Tangent
            </button>
          </div>
        </Field>

        {/* Only for a single selection. A coordinate shown for six selected
            points would be one arbitrary point's, and typing into it would move
            that one alone — neither of which is what a number in a box promises.
            Disabled rather than hidden, for the reason the sidebearings are. */}
        <Field label={coordPart === "in" || coordPart === "out" ? "Handle position" : "Position"}>
          <div className={styles.pair}>
            <Stepper
              value={coordX}
              label="x position"
              disabled={coordX === null}
              onStep={(next) => commitCoordinate("x", next)}
            >
              <input
                className={styles.input}
                type="number"
                aria-label="X position"
                title="X position"
                disabled={coordX === null}
                value={coordX === null ? "" : shown(coordX)}
                onChange={(event) => commitCoordinate("x", Number(event.target.value))}
              />
            </Stepper>
            <Stepper
              value={coordY}
              label="y position"
              disabled={coordY === null}
              onStep={(next) => commitCoordinate("y", next)}
            >
              <input
                className={styles.input}
                type="number"
                aria-label="Y position"
                title="Y position"
                disabled={coordY === null}
                value={coordY === null ? "" : shown(coordY)}
                onChange={(event) => commitCoordinate("y", Number(event.target.value))}
              />
            </Stepper>
          </div>
        </Field>

        {/* The same handles as offsets from the point they hang off, which is
            how a handle is thought about: forty units out and level, not at
            x=346. Kept beside the absolute pair rather than replacing it — one
            says where the handle is, the other says what it does. */}
        <Field label="Handles">
          <div className={styles.handles}>
            <HandleRow
              side="in"
              length={inLength}
              angle={inAngle}
              onLength={(next) => commitHandle("in", "length", next)}
              onAngle={(next) => commitHandle("in", "angle", next)}
            />
            <HandleRow
              side="out"
              length={outLength}
              angle={outAngle}
              onLength={(next) => commitHandle("out", "length", next)}
              onAngle={(next) => commitHandle("out", "angle", next)}
            />
          </div>
        </Field>

        <div className={styles.rule} />

        {/* The Tunni controls as numbers. Tension is each handle's reach towards
            the handle intersection, as a percentage — the proportion a designer
            already talks in, and the one thing about a curve that carries from
            one segment to the next where a length in units does not. */}
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

        <div className={styles.rule} />

        <TransformPanel />
      </div>
    </aside>
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

/** One handle, as the length and direction of its offset from its own node. */
function handlePolar(
  editor: EditorState,
  which: "in" | "out",
): { readonly length: number; readonly angle: number } | null {
  const found = selectedNode(editor);
  if (found === null) return null;

  const handle = which === "in" ? found.node.in : found.node.out;
  if (handle === null) return null;

  const dx = handle.x - found.node.pt.x;
  const dy = handle.y - found.node.pt.y;
  const length = Math.hypot(dx, dy);
  // A handle sitting on its node points nowhere; zero is the one answer that
  // does not pretend otherwise, and typing a length into it sends it out east.
  return { length, angle: length === 0 ? 0 : (Math.atan2(dy, dx) * 180) / Math.PI };
}

/** The two fields for one handle: how far it reaches, and which way. */
function HandleRow({
  side,
  length,
  angle,
  onLength,
  onAngle,
}: {
  readonly side: "in" | "out";
  readonly length: number | null;
  readonly angle: number | null;
  readonly onLength: (next: number) => void;
  readonly onAngle: (next: number) => void;
}): React.JSX.Element {
  const missing = length === null;
  const named = side === "in" ? "incoming" : "outgoing";
  const absent = "This side of the point is a straight line";
  return (
    <div className={styles.handleRow}>
      <span className={styles.side}>{side}</span>
      <Stepper
        value={length === null ? null : shown(length)}
        label={named + " handle length"}
        bounds={{ min: 0 }}
        disabled={missing}
        onStep={onLength}
      >
        <input
          className={styles.input}
          type="number"
          aria-label={"Length of the " + named + " handle"}
          title={missing ? absent : "How far the handle reaches from its point"}
          disabled={missing}
          value={length === null ? "" : shown(length)}
          onChange={(event) => onLength(Number(event.target.value))}
        />
      </Stepper>
      <Stepper
        value={angle === null ? null : shown(angle)}
        label={named + " handle angle"}
        disabled={missing}
        onStep={onAngle}
      >
        <input
          className={styles.input}
          type="number"
          aria-label={"Angle of the " + named + " handle"}
          title={missing ? absent : "Degrees, anticlockwise from east"}
          disabled={missing}
          value={angle === null ? "" : shown(angle)}
          onChange={(event) => onAngle(Number(event.target.value))}
        />
      </Stepper>
    </div>
  );
}

/**
 * A coordinate as a field should show it.
 *
 * Not rounded, unlike the advance and the sidebearings: this field exists to set
 * an exact position, and a display that rounded 106.402 to 106 would write 106
 * back the moment anything else in the panel was touched. Two decimals is enough
 * to see that a number is not whole without showing the floating-point tail.
 */
function shown(v: number): number {
  return Math.round(v * 100) / 100;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      {children}
    </label>
  );
}

/** New components need ids; the panel owns a factory, as the menu does. */
const componentIds = randomIds();
const EMPTY_COMPONENTS: readonly never[] = [];
const EMPTY_ANCHORS: readonly never[] = [];
const EMPTY_GUIDES: readonly never[] = [];
const EMPTY_GLYPH = {
  name: "",
  unicodes: [],
  advance: 0,
  contours: [],
  components: [],
  anchors: [],
  guides: [],
  image: null,
  kept: [],
};
const EMPTY_CODES: readonly number[] = [];

/**
 * The type shared by every selected on-curve point, or `null` when they differ —
 * so a mixed selection shows neither button pressed rather than lying about one.
 */
function selectedPointType(s: {
  session: {
    editor: {
      currentGlyph: string;
      selection: readonly { contourId: string; nodeId: string; part: string }[];
      document: {
        glyphs: Record<
          string,
          { contours: readonly { id: string; nodes: readonly { id: string; type: string }[] }[] }
        >;
      };
    };
  };
}): string | null {
  const editor = s.session.editor;
  const glyph = editor.document.glyphs[editor.currentGlyph];
  if (glyph === undefined) return null;

  let found: string | null = null;
  for (const item of editor.selection) {
    if (item.part !== "point") continue;
    const contour = glyph.contours.find((c) => c.id === item.contourId);
    const node = contour?.nodes.find((n) => n.id === item.nodeId);
    if (node === undefined) continue;
    if (found === null) found = node.type;
    else if (found !== node.type) return null;
  }
  return found;
}
