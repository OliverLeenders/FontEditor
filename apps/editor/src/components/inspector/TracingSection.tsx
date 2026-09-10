import { fitImageToGlyph, moveImageTo, scaleImageTo } from "@typewright/tools";

import { useEditorStore, useStoreValue } from "../../useStore.js";
import styles from "../Inspector.module.css";
import { ImageIcon } from "../icons.js";
import { Section } from "./Section.js";
import { Field, shown } from "./fields.js";

/**
 * Where the picture behind this letter sits.
 *
 * Nothing at all when there is no picture rather than a folded section naming
 * one: a glyph with nothing to trace has no business claiming a row. The
 * picture itself is chosen in the Tracing panel, or picked off a sheet in the
 * Sheet view; what this is for is the nudge afterwards.
 */
export function TracingSection(): React.JSX.Element | null {
  const store = useEditorStore();
  const image = useStoreValue(
    (s) => s.session.editor.document.glyphs[s.session.editor.currentGlyph]?.image ?? null,
  );

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

  if (image === null) return null;

  return (
    <Section name="tracing" title="Tracing" icon={ImageIcon}>
      <Field label="Image">
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
    </Section>
  );
}
