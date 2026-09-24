import { randomIds } from "@typewright/font-model";
import {
  addComponent,
  attachComponent,
  attachmentFor,
  flipComponent,
  moveComponentTo,
  removeComponent,
  currentGlyph,
} from "@typewright/tools";
import { useState } from "react";

import { useEditorStore, useStoreValue } from "../../useStore.js";
import styles from "../Inspector.module.css";
import { NumberField } from "../NumberField.js";
import { ComponentIcon, FlipHorizontalIcon, FlipVerticalIcon, TrashIcon } from "../icons.js";
import { Section } from "./Section.js";
import { shown } from "./fields.js";

/**
 * The glyphs placed inside this one, and where each of them sits.
 *
 * Components are references, so the panel lists them and lets them be placed,
 * turned over or removed. Editing what one *looks* like means opening the glyph
 * it refers to, which is the entire point of using one.
 *
 * The two flips are here rather than the whole affine the model carries. They
 * are the transform families actually use — a `b` from a `d`, an opening quote
 * from a closing one — and each is one press with nothing to type, whereas a
 * scale field asks for a number that a designer drawing by eye does not have.
 */
export function ComponentsSection(): React.JSX.Element {
  const store = useEditorStore();
  const components = useStoreValue(
    (s) => currentGlyph(s.session.editor)?.components ?? EMPTY_COMPONENTS,
  );
  const selectedComponent = useStoreValue((s) => s.session.editor.selectedComponent);
  const [adding, setAdding] = useState("");

  /** Place one component at an exact offset. */
  const commitComponent = (id: string, axis: "x" | "y", value: number): void => {
    if (!Number.isFinite(value)) return;
    const glyph = currentGlyph(store.editor);
    const found = glyph?.components.find((c) => c.id === id);
    if (found === undefined) return;

    store.applyTool(
      moveComponentTo(store.editor, id, {
        x: axis === "x" ? value : found.transform.xOffset,
        y: axis === "y" ? value : found.transform.yOffset,
      }),
    );
  };

  return (
    <Section
      name="components"
      icon={ComponentIcon}
      title="Components"
      note={components.length === 0 ? undefined : String(components.length)}
      relevant={components.length > 0}
      empty={components.length === 0}
      emptyNote="none"
    >
      <div className={styles.components}>
        {components.map((c) => (
          <div
            key={c.id}
            className={`${styles.anchorRow} ${styles.componentEntry}`}
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
            <NumberField
              className={styles.input}
              label={`X offset of ${c.base}`}
              title="How far right the placed glyph sits"
              value={shown(c.transform.xOffset)}
              onCommit={(next) => commitComponent(c.id, "x", next)}
            />
            <NumberField
              className={styles.input}
              label={`Y offset of ${c.base}`}
              title="How far up the placed glyph sits"
              value={shown(c.transform.yOffset)}
              onCommit={(next) => commitComponent(c.id, "y", next)}
            />
            <button
              type="button"
              className={styles.rowAction}
              title={`Turn ${c.base} over left to right, where it stands`}
              aria-label={`Flip ${c.base} horizontally`}
              onClick={() => store.applyTool(flipComponent(store.editor, c.id, "horizontal"))}
            >
              <FlipHorizontalIcon />
            </button>
            <button
              type="button"
              className={styles.rowAction}
              title={`Turn ${c.base} over top to bottom, where it stands`}
              aria-label={`Flip ${c.base} vertically`}
              onClick={() => store.applyTool(flipComponent(store.editor, c.id, "vertical"))}
            >
              <FlipVerticalIcon />
            </button>
            <button
              type="button"
              className={styles.componentRemove}
              title={`Remove ${c.base}`}
              aria-label={`Remove ${c.base}`}
              onClick={() => store.applyTool(removeComponent(store.editor, c.id))}
            >
              <TrashIcon />
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
            list="typewright-glyph-names"
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
        </div>
      </div>
    </Section>
  );
}

/** New components need ids; the panel owns a factory, as the menu does. */
const componentIds = randomIds();
const EMPTY_COMPONENTS: readonly never[] = [];
