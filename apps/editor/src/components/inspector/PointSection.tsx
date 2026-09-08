import { type NodeType, setNodeType, updateContour } from "@fonteditor/font-model";
import {
  type EditorState,
  begin,
  commit,
  editCurrentGlyph,
  moveCoordinateTo,
  result,
  selectedCanBeTangent,
  selectedCoordinate,
  selectedNode,
} from "@fonteditor/tools";

import { useEditorStore, useStoreValue } from "../../useStore.js";
import styles from "../Inspector.module.css";
import { Stepper } from "../Stepper.js";
import { WaypointsIcon } from "../icons.js";
import { Section } from "./Section.js";
import { Field, shown } from "./fields.js";

/**
 * The selected point: what kind it is, where it is, and what its handles do.
 *
 * Every number here is also a drag on the canvas. Typing one goes through the
 * same move the drag would make, so a smooth node still swings its other side
 * and a locked handle still holds its axis.
 */
export function PointSection(): React.JSX.Element {
  const store = useEditorStore();
  // Points only. A handle in the selection is not something these buttons can
  // act on, so counting it would enable them to do nothing.
  const pointCount = useStoreValue(
    (s) => s.session.editor.selection.filter((item) => item.part === "point").length,
  );
  const pointType = useStoreValue(selectedPointType);
  const canTangent = useStoreValue((s) => selectedCanBeTangent(s.session.editor));

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

  return (
    <Section
      name="point"
      icon={WaypointsIcon}
      title="Point"
      note={pointCount === 0 ? undefined : `${pointCount} selected`}
      relevant={pointCount > 0 || coordX !== null}
    >
      <Field label="Type">
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
    </Section>
  );
}

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
