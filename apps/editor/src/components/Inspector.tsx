import {
  isTranslation,
} from "@fonteditor/geometry";
import {
  randomIds,
  setAdvance,
  setLeftSidebearing,
  setNodeType,
  setRightSidebearing,
  sidebearings,
  updateContour,
} from "@fonteditor/font-model";
import {
  addComponent,
  begin,
  commit,
  editCurrentGlyph,
  removeComponent,
  result,
} from "@fonteditor/tools";
import { useRef, useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./Inspector.module.css";

/**
 * The floating inspector: glyph identity, advance, and the selected points.
 *
 * Draggable and dismissible, with its position remembered, because it sits over
 * the canvas rather than reserving space beside it. That is the trade the layout
 * made — nearly all the screen goes to the work, and in exchange the panel can
 * land on top of what you are editing until you move it.
 */
export function Inspector(): JSX.Element | null {
  const store = useEditorStore();
  const open = useStoreValue((s) => s.inspector.open);
  const x = useStoreValue((s) => s.inspector.x);
  const y = useStoreValue((s) => s.inspector.y);
  const glyphName = useStoreValue((s) => s.session.editor.currentGlyph);
  const advance = useStoreValue((s) => s.session.editor.document.glyphs[s.session.editor.currentGlyph]?.advance ?? 0);
  const unicodes = useStoreValue(
    (s) => s.session.editor.document.glyphs[s.session.editor.currentGlyph]?.unicodes ?? EMPTY_CODES,
  );
  // Points only. A handle in the selection is not something these buttons can
  // act on, so counting it would enable them to do nothing.
  const pointCount = useStoreValue(
    (s) => s.session.editor.selection.filter((item) => item.part === "point").length,
  );
  const pointType = useStoreValue(selectedPointType);
  // Two selectors rather than one returning an object: a fresh object every time
  // would compare unequal and re-render the panel on every store notification.
  const leftBearing = useStoreValue(
    (s) => sidebearings(s.session.editor.document.glyphs[s.session.editor.currentGlyph] ?? EMPTY_GLYPH)?.left ?? null,
  );
  const rightBearing = useStoreValue(
    (s) => sidebearings(s.session.editor.document.glyphs[s.session.editor.currentGlyph] ?? EMPTY_GLYPH)?.right ?? null,
  );

  const components = useStoreValue(
    (s) => s.session.editor.document.glyphs[s.session.editor.currentGlyph]?.components ?? EMPTY_COMPONENTS,
  );
  const glyphNames = useStoreValue((s) => s.session.editor.document.glyphOrder);
  const [adding, setAdding] = useState("");

  const drag = useRef<{ dx: number; dy: number } | null>(null);
  if (!open) return null;

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

  const applyPointType = (type: "corner" | "smooth"): void => {
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
        <span className={styles.title}>{glyphName || "no glyph"}</span>
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
          <input
            className={styles.input}
            type="number"
            value={Math.round(advance)}
            onChange={(event) => commitAdvance(Number(event.target.value))}
          />
        </Field>

        {/* Disabled rather than hidden for a glyph with no outline: a space has
            an advance and no sidebearings, and a field that vanishes reads as a
            bug where a greyed one reads as the fact it is. */}
        <Field label="Sidebearings">
          <div className={styles.pair}>
            <input
              className={styles.input}
              type="number"
              aria-label="Left sidebearing"
              title="Left sidebearing"
              disabled={leftBearing === null}
              value={leftBearing === null ? "" : Math.round(leftBearing)}
              onChange={(event) => commitBearing("left", Number(event.target.value))}
            />
            <input
              className={styles.input}
              type="number"
              aria-label="Right sidebearing"
              title="Right sidebearing"
              disabled={rightBearing === null}
              value={rightBearing === null ? "" : Math.round(rightBearing)}
              onChange={(event) => commitBearing("right", Number(event.target.value))}
            />
          </div>
        </Field>

        <div className={styles.rule} />

        {/* Components are references, so the panel lists them and lets them be
            placed or removed. Editing what one *looks* like means opening the
            glyph it refers to, which is the entire point of using one. */}
        <Field label={components.length === 0 ? "Components" : `Components · ${components.length}`}>
          <div className={styles.components}>
            {components.map((c) => (
              <div key={c.id} className={styles.componentRow}>
                <span className={styles.componentName}>{c.base}</span>
                <span className={styles.componentAt}>
                  {isTranslation(c.transform)
                    ? `${String(Math.round(c.transform.xOffset))}, ${String(Math.round(c.transform.yOffset))}`
                    : "transformed"}
                </span>
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
          </div>
        </Field>
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
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
const EMPTY_GLYPH = { name: "", unicodes: [], advance: 0, contours: [], components: [] };
const EMPTY_CODES: readonly number[] = [];

/**
 * The type shared by every selected on-curve point, or `null` when they differ —
 * so a mixed selection shows neither button pressed rather than lying about one.
 */
function selectedPointType(s: {
  session: { editor: { currentGlyph: string; selection: readonly { contourId: string; nodeId: string; part: string }[]; document: { glyphs: Record<string, { contours: readonly { id: string; nodes: readonly { id: string; type: string }[] }[] }> } } };
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
