import {
  BACKGROUND,
  hasLayer,
  layerLabel,
  layerProblem,
  layerProblemSays,
} from "@typewright/font-model";
import { useState } from "react";

import { useEditorStore, useStoreValue } from "../../useStore.js";
import styles from "../Inspector.module.css";
import {
  ArrowLeftRightIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  LayersIcon,
  PenToolIcon,
  TrashIcon,
} from "../icons.js";
import { Section } from "./Section.js";

/**
 * The glyph's drawings: the letter itself, and its layers.
 *
 * One of them is being drawn in, and every tool acts on that one. The rest can
 * be shown behind it, faint — the letter is always shown behind a layer being
 * drawn in, since that is what a background is drawn against. Beside each
 * layer, the three things done between a letter and its background: copy the
 * letter in before reworking it, trade the two, and clear the layer.
 *
 * The layers are the font's, so adding or removing one is about every glyph;
 * copying, trading and clearing here are about the glyph on the canvas, and
 * the glyph grid's menu does them for every glyph picked.
 */
export function LayersSection(): React.JSX.Element {
  const store = useEditorStore();
  const layers = useStoreValue((s) => s.session.editor.document.layers);
  const drawingIn = useStoreValue((s) => s.session.editor.layer);
  const glyphName = useStoreValue((s) => s.session.editor.currentGlyph);
  const glyphLayers = useStoreValue(
    (s) => s.session.editor.document.glyphs[s.session.editor.currentGlyph]?.layers ?? NO_LAYERS,
  );
  const shown = useStoreValue((s) => s.shownLayers);
  const reading = useStoreValue((s) => s.ownership === "reading");
  const [draft, setDraft] = useState("");

  const problem = draft.trim() === "" ? null : layerProblem(store.editor.document, draft);
  const add = (): void => {
    if (draft.trim() === "" || problem !== null) return;
    store.addLayer(draft);
    setDraft("");
  };

  return (
    <Section
      name="layers"
      icon={LayersIcon}
      title="Layers"
      note={drawingIn === null ? undefined : `drawing in ${layerLabel(drawingIn)}`}
      relevant={layers.length > 0 || drawingIn !== null}
      empty={layers.length === 0 && drawingIn === null}
      emptyNote="none"
    >
      <div className={styles.components}>
        <div className={styles.layerRow} data-here={drawingIn === null ? "true" : undefined}>
          <button
            type="button"
            className={styles.rowAction}
            aria-pressed={drawingIn === null}
            aria-label="Draw in the letter itself"
            title="Draw in the letter itself"
            disabled={reading}
            onClick={() => store.drawInLayer(null)}
          >
            <PenToolIcon />
          </button>
          <span className={styles.layerName}>Drawing</span>
        </div>

        {layers.map((layer) => {
          const label = layerLabel(layer.name);
          const here = drawingIn === layer.name;
          const visible = shown.includes(layer.name);
          const drawn = glyphLayers[layer.name] !== undefined;
          return (
            <div key={layer.name} className={styles.layerRow} data-here={here ? "true" : undefined}>
              <button
                type="button"
                className={styles.rowAction}
                aria-pressed={here}
                aria-label={`Draw in ${label}`}
                title={`Draw in ${label}`}
                disabled={reading}
                onClick={() => store.drawInLayer(layer.name)}
              >
                <PenToolIcon />
              </button>
              <span className={styles.layerName} title={layer.name}>
                {label}
                {drawn ? null : <span className={styles.readonly}> · empty</span>}
              </span>
              <button
                type="button"
                className={styles.rowAction}
                aria-pressed={visible}
                aria-label={
                  visible ? `Hide ${label} behind the drawing` : `Show ${label} behind the drawing`
                }
                title={visible ? "Shown behind the drawing" : "Not shown"}
                onClick={() => store.toggleLayerShown(layer.name)}
              >
                {visible ? <EyeIcon /> : <EyeOffIcon />}
              </button>
              <button
                type="button"
                className={styles.rowAction}
                aria-label={`Copy ${glyphName} into ${label}`}
                title={`Copy the drawing of ${glyphName} into ${label}, over what is there`}
                disabled={reading}
                onClick={() => store.copyToLayer([glyphName], layer.name)}
              >
                <CopyIcon />
              </button>
              <button
                type="button"
                className={styles.rowAction}
                aria-label={`Swap ${glyphName} with ${label}`}
                title={`Trade the drawing of ${glyphName} and its drawing in ${label}`}
                disabled={reading}
                onClick={() => store.swapWithLayer([glyphName], layer.name)}
              >
                <ArrowLeftRightIcon />
              </button>
              <button
                type="button"
                className={styles.componentRemove}
                aria-label={`Clear ${label} in ${glyphName}`}
                title={`Take the drawing of ${glyphName} out of ${label}`}
                disabled={reading || !drawn}
                onClick={() => store.clearLayer([glyphName], layer.name)}
              >
                <TrashIcon />
              </button>
            </div>
          );
        })}

        <div className={styles.layerAdd}>
          {hasLayer(store.editor.document, BACKGROUND) ? null : (
            <button
              type="button"
              className={styles.layerAddButton}
              disabled={reading}
              title="Add the background layer, which B draws in"
              onClick={() => store.addLayer(BACKGROUND)}
            >
              Add background
            </button>
          )}
          <input
            className={styles.input}
            value={draft}
            placeholder="New layer"
            aria-label="Name of a new layer"
            spellCheck={false}
            disabled={reading}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") add();
            }}
          />
          <button
            type="button"
            className={styles.layerAddButton}
            disabled={reading || draft.trim() === "" || problem !== null}
            onClick={add}
          >
            Add
          </button>
        </div>
        {problem === null ? null : (
          <span className={styles.readonly} role="status">
            {layerProblemSays(problem)}
          </span>
        )}

        {layers.length > 0 ? (
          <details className={styles.layerRemove}>
            <summary>Remove a layer from the font</summary>
            {layers.map((layer) => (
              <button
                key={layer.name}
                type="button"
                className={styles.layerAddButton}
                disabled={reading}
                title={`Remove ${layerLabel(layer.name)} and every glyph's drawing in it`}
                onClick={() => store.removeLayer(layer.name)}
              >
                Remove {layerLabel(layer.name)}
              </button>
            ))}
          </details>
        ) : null}
      </div>
    </Section>
  );
}

const NO_LAYERS: Readonly<Record<string, unknown>> = {};
