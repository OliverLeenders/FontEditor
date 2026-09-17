import { currentGlyph, moveAnchorToPoint, removeAnchorAt, renameAnchorTo } from "@typewright/tools";

import { useEditorStore, useStoreValue } from "../../useStore.js";
import styles from "../Inspector.module.css";
import { AnchorIcon, TrashIcon } from "../icons.js";
import { Section } from "./Section.js";
import { shown } from "./fields.js";

/**
 * The places accents attach, by name and by number.
 *
 * Added from the canvas — right-click where you want one — because a place is
 * chosen by pointing at it; what a panel is for is the name and the exact
 * numbers.
 */
export function AnchorsSection(): React.JSX.Element {
  const store = useEditorStore();
  const anchors = useStoreValue((s) => currentGlyph(s.session.editor)?.anchors ?? EMPTY_ANCHORS);
  const selectedAnchor = useStoreValue((s) => s.session.editor.selectedAnchor);

  /**
   * Move one anchor to an exact coordinate.
   *
   * The other axis is read from the glyph at the moment of the commit rather
   * than from the field beside it, as the point coordinates are.
   */
  const commitAnchor = (id: string, axis: "x" | "y", value: number): void => {
    if (!Number.isFinite(value)) return;
    const glyph = currentGlyph(store.editor);
    const found = glyph?.anchors.find((a) => a.id === id);
    if (found === undefined) return;

    store.applyTool(
      moveAnchorToPoint(store.editor, id, {
        x: axis === "x" ? value : found.pt.x,
        y: axis === "y" ? value : found.pt.y,
      }),
    );
  };

  return (
    <Section
      name="anchors"
      icon={AnchorIcon}
      title="Anchors"
      note={anchors.length === 0 ? undefined : String(anchors.length)}
      relevant={anchors.length > 0}
      empty={anchors.length === 0}
      emptyNote="none"
    >
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
              <TrashIcon />
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}

const EMPTY_ANCHORS: readonly never[] = [];
