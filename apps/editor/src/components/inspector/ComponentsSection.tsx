import { randomIds } from "@fonteditor/font-model";
import {
  addComponent,
  attachComponent,
  attachmentFor,
  moveComponentTo,
  removeComponent,
} from "@fonteditor/tools";
import { useState } from "react";

import { useEditorStore, useStoreValue } from "../../useStore.js";
import styles from "../Inspector.module.css";
import { Section } from "./Section.js";
import { shown } from "./fields.js";

/**
 * The glyphs placed inside this one, and where each of them sits.
 *
 * Components are references, so the panel lists them and lets them be placed or
 * removed. Editing what one *looks* like means opening the glyph it refers to,
 * which is the entire point of using one.
 */
export function ComponentsSection(): React.JSX.Element {
  const store = useEditorStore();
  const components = useStoreValue(
    (s) =>
      s.session.editor.document.glyphs[s.session.editor.currentGlyph]?.components ??
      EMPTY_COMPONENTS,
  );
  const selectedComponent = useStoreValue((s) => s.session.editor.selectedComponent);
  const glyphNames = useStoreValue((s) => s.session.editor.document.glyphOrder);
  const [adding, setAdding] = useState("");

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

  return (
    <Section
      name="components"
      title="Components"
      note={components.length === 0 ? undefined : String(components.length)}
      relevant={components.length > 0}
    >
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
    </Section>
  );
}

/** New components need ids; the panel owns a factory, as the menu does. */
const componentIds = randomIds();
const EMPTY_COMPONENTS: readonly never[] = [];
