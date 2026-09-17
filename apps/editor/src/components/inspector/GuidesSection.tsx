import {
  guideById,
  moveGuideTo,
  moveGuideToScope,
  removeGuideAt,
  renameGuideTo,
  turnGuideTo,
  currentGlyph,
} from "@typewright/tools";
import { useMemo } from "react";

import { useEditorStore, useStoreValue } from "../../useStore.js";
import styles from "../Inspector.module.css";
import { FrameIcon, TrashIcon } from "../icons.js";
import { Section } from "./Section.js";
import { shown } from "./fields.js";

/**
 * The lines this letter is drawn against, the font's shown with the glyph's.
 *
 * Added from the canvas — right-click where you want one — for the reason
 * anchors are: a place is chosen by pointing at it, and what a panel is for is
 * the name and the exact numbers.
 */
export function GuidesSection(): React.JSX.Element {
  const store = useEditorStore();
  const selectedGuide = useStoreValue((s) => s.session.editor.selectedGuide);
  // The two lists separately, because each is a reference that lives in the
  // state. Selecting them together would build a fresh array on every call,
  // and `useSyncExternalStore` compares snapshots with `Object.is` — so the
  // component would re-render for ever. See `useStoreValue`.
  const fontGuides = useStoreValue((s) => s.session.editor.document.guides);
  const glyphGuides = useStoreValue((s) => currentGlyph(s.session.editor)?.guides ?? EMPTY_GUIDES);
  // Joined here, where a new array costs one render rather than all of them.
  const guides = useMemo(
    () => [
      ...fontGuides.map((guide) => ({ guide, scope: "font" as const })),
      ...glyphGuides.map((guide) => ({ guide, scope: "glyph" as const })),
    ],
    [fontGuides, glyphGuides],
  );

  const commitGuide = (id: string, axis: "x" | "y", value: number): void => {
    if (!Number.isFinite(value)) return;
    const found = guideById(store.editor, id);
    if (found === null) return;

    const pt = found.guide.pt;
    store.applyTool(
      moveGuideTo(store.editor, id, axis === "x" ? { x: value, y: pt.y } : { x: pt.x, y: value }),
    );
  };

  return (
    <Section
      name="guides"
      icon={FrameIcon}
      title="Guides"
      note={guides.length === 0 ? undefined : String(guides.length)}
      relevant={guides.length > 0}
    >
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
              <TrashIcon />
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}

const EMPTY_GUIDES: readonly never[] = [];
