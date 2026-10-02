import { type Glyph, drawableGlyph } from "@typewright/font-model";
import { drawGlyphAtSize, pixelBox } from "@typewright/render";
import { currentGlyph } from "@typewright/tools";
import { useEffect, useRef, useState } from "react";

import { palette } from "../../scene.js";
import { useStoreValue } from "../../useStore.js";
import styles from "../Inspector.module.css";
import { EyeIcon } from "../icons.js";
import { Section } from "./Section.js";

/** The sizes a glyph is shown at, in pixels to the em: what an icon is used at. */
const SIZES = [16, 24, 32] as const;

/** How wide the magnified picture may be, in CSS pixels: the inspector's column, less its edges. */
const MAGNIFIED_WIDTH = 190;

/**
 * The glyph at the sizes it is used at, and one of them close up.
 *
 * An icon is drawn at a size where a unit is a hair, and used at a size where
 * a pixel is a twenty-fourth of it. Whether its edges fall on pixels or between
 * them — whether a stem is one dark pixel or two grey ones — is the difference
 * between a crisp icon and a blurred one, and nothing on the drawing canvas
 * shows it. So here it is at 16, 24 and 32 pixels, exactly as big as it will
 * be, and whichever is pressed is shown again with every pixel large enough to
 * see.
 *
 * Drawn by the canvas, smoothed and unhinted, which is how a browser draws an
 * icon font. Folded until it is asked for: it is an instrument, and a text
 * face's designer may never open it.
 */
export function PixelsSection(): React.JSX.Element | null {
  const document = useStoreValue((s) => s.session.editor.document);
  const glyph = useStoreValue((s) => currentGlyph(s.session.editor));
  // Read so that a change of theme draws again: the ink is the theme's.
  const theme = useStoreValue((s) => s.theme);
  const [close, setClose] = useState<number>(24);

  if (glyph === null) return null;
  const shown = drawableGlyph(document, glyph);
  const metrics = {
    unitsPerEm: document.info.unitsPerEm,
    ascender: document.info.ascender,
    descender: document.info.descender,
  };
  const closeBox = pixelBox(shown, close, metrics);
  // Whole multiples, so every pixel of the glyph is the same number of the screen's.
  const times = Math.max(2, Math.min(8, Math.floor(MAGNIFIED_WIDTH / closeBox.width)));

  return (
    <Section name="pixels" title="Pixels" icon={EyeIcon} relevant={false}>
      <div className={styles.pixelSizes} role="group" aria-label="Size shown close up">
        {SIZES.map((size) => (
          <button
            key={size}
            type="button"
            className={styles.pixelSize}
            aria-pressed={close === size}
            aria-label={`${String(size)} pixels`}
            title={`The glyph at ${String(size)} pixels to the em. Press to see it close up.`}
            onClick={() => setClose(size)}
          >
            <PixelCanvas glyph={shown} size={size} metrics={metrics} theme={theme} />
            <span>{size}</span>
          </button>
        ))}
      </div>
      <div className={styles.pixelClose}>
        <PixelCanvas
          glyph={shown}
          size={close}
          metrics={metrics}
          theme={theme}
          times={times}
          label={`The glyph at ${String(close)} pixels, magnified ${String(times)} times`}
        />
      </div>
    </Section>
  );
}

/**
 * The glyph drawn at a size, on a canvas exactly that big.
 *
 * Without `times` it is drawn as it will be seen: one pixel of the glyph to
 * one of the page's, at the screen's own density. With it, the canvas holds one
 * pixel for each of the glyph's and is shown `times` as large with no
 * smoothing, so the pixels are the squares they are.
 */
function PixelCanvas({
  glyph,
  size,
  metrics,
  theme,
  times,
  label,
}: {
  readonly glyph: Glyph;
  readonly size: number;
  readonly metrics: { unitsPerEm: number; ascender: number; descender: number };
  readonly theme: string;
  readonly times?: number;
  readonly label?: string;
}): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const box = pixelBox(glyph, size, metrics);
  const { unitsPerEm, ascender, descender } = metrics;

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;

    // Close up, one pixel of the canvas is one of the glyph's whatever the
    // screen: the point is to see the pixels a plain screen would show.
    const density = times === undefined ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.round(box.width * density);
    canvas.height = Math.round(box.height * density);
    ctx.setTransform(density, 0, 0, density, 0, 0);
    ctx.clearRect(0, 0, box.width, box.height);
    drawGlyphAtSize(
      ctx as unknown as Parameters<typeof drawGlyphAtSize>[0],
      glyph,
      size,
      { unitsPerEm, ascender, descender },
      palette().outline,
    );
  }, [glyph, size, unitsPerEm, ascender, descender, theme, times, box.width, box.height]);

  const scale = times ?? 1;
  return (
    <canvas
      ref={ref}
      className={times === undefined ? styles.pixelCanvas : styles.pixelCanvasClose}
      style={{ width: box.width * scale, height: box.height * scale }}
      {...(label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
    />
  );
}
