import { placeImageByCrop, shownImageCrop } from "@fonteditor/tools";
import { useEffect, useMemo, useRef, useState } from "react";

import { glyphsTracing } from "../store/images.js";
import { useEditorStore, useStoreValue } from "../useStore.js";
import open from "./OpenFont.module.css";
import styles from "./Sheet.module.css";

/**
 * The picture whole, with a rectangle round each letter that has been found in
 * it.
 *
 * This is the answer to assigning one scan to twenty-six glyphs. Placing each
 * letter by dragging the whole sheet about behind it means finding the same
 * picture twenty-six times; here the picture stays still and you draw a box
 * round each letter in turn.
 *
 * The boxes are not stored. Each one *is* a glyph's placement read backwards —
 * the transform that puts that part of the picture into that letter, inverted —
 * so there is nothing to keep in step, and a letter nudged on the canvas moves
 * its box here.
 */
export function Sheet(): React.JSX.Element | null {
  const store = useEditorStore();
  const editor = useStoreValue((s) => s.session.editor);
  const glyph = useStoreValue((s) => s.session.editor.currentGlyph);
  const image = useStoreValue(
    (s) => s.session.editor.document.glyphs[s.session.editor.currentGlyph]?.image ?? null,
  );

  const [open_, setOpen] = useState(false);
  const [drag, setDrag] = useState<{ from: Point; to: Point } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const decoded = image === null ? null : store.picture(image.name);

  // Every glyph traced from this picture, and the part of it each one shows.
  // Derived from the placements, so it cannot drift from them.
  const marks = useMemo(() => {
    if (image === null) return [];
    return glyphsTracing(editor, image.name).flatMap((name) => {
      const found = editor.document.glyphs[name];
      if (found?.image === null || found?.image === undefined) return [];

      const { ascender, descender } = editor.document.info;
      const onto = {
        from: { x: 0, y: descender },
        to: { x: found.advance, y: ascender },
      };
      const crop = shownImageCrop({ ...editor, currentGlyph: name }, onto);
      return crop === null ? [] : [{ name, crop }];
    });
  }, [editor, image]);

  useEffect(() => {
    if (!open_) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open_]);

  if (image === null) return null;

  /**
   * Where a pointer is in the picture's own pixels.
   *
   * The element is the picture scaled to fit, so this is the scale undone —
   * and it is the only place in this component that knows how big the picture
   * is on screen.
   */
  const atPixel = (event: React.PointerEvent): Point | null => {
    const box = boxRef.current?.getBoundingClientRect();
    if (box === undefined || decoded === null || box.width === 0) return null;

    const scale = decoded.width / box.width;
    return {
      x: (event.clientX - box.left) * scale,
      // Image space has its origin at the bottom left, where the element's is
      // at the top left. Everything below is in image space.
      y: decoded.height - (event.clientY - box.top) * scale,
    };
  };

  /** Take what was drawn and make it this glyph's placement. */
  const settle = (crop: { from: Point; to: Point }): void => {
    if (decoded === null) return;

    const { ascender, descender } = editor.document.info;
    const advance = editor.document.glyphs[glyph]?.advance ?? 0;

    store.applyTool(
      placeImageByCrop(
        editor,
        {
          from: { x: Math.min(crop.from.x, crop.to.x), y: Math.min(crop.from.y, crop.to.y) },
          to: { x: Math.max(crop.from.x, crop.to.x), y: Math.max(crop.from.y, crop.to.y) },
        },
        { from: { x: 0, y: descender }, to: { x: advance, y: ascender } },
      ),
    );
  };

  return (
    <div className={styles.holder}>
      <button
        type="button"
        className={open.button}
        aria-expanded={open_}
        title="See the whole picture, and draw a box round this letter in it"
        onClick={() => setOpen(!open_)}
      >
        Sheet
      </button>

      {open_ ? (
        <div className={styles.panel} role="group" aria-label="The picture whole">
          <div className={styles.head}>
            <span>{image.name}</span>
            <span className={styles.hint}>
              Drag a box round {glyph}
              {decoded === null ? " · reading the picture…" : ""}
            </span>
            <button type="button" className={styles.close} onClick={() => setOpen(false)}>
              Done
            </button>
          </div>

          <div
            ref={boxRef}
            className={styles.sheet}
            onPointerDown={(event) => {
              const at = atPixel(event);
              if (at === null) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              setDrag({ from: at, to: at });
            }}
            onPointerMove={(event) => {
              if (drag === null) return;
              const at = atPixel(event);
              if (at !== null) setDrag({ ...drag, to: at });
            }}
            onPointerUp={() => {
              if (drag === null) return;
              // A click rather than a drag places nothing: a box of no area has
              // no transform, and clearing the glyph's placement on a stray
              // click would be a poor trade.
              if (Math.abs(drag.to.x - drag.from.x) > 2 && Math.abs(drag.to.y - drag.from.y) > 2) {
                settle(drag);
              }
              setDrag(null);
            }}
          >
            {decoded === null ? (
              <p className={styles.waiting}>
                {store.pictureBroken(image.name)
                  ? "This picture cannot be shown. It is still in the font, and still written out."
                  : "Reading the picture…"}
              </p>
            ) : (
              <>
                <img
                  className={styles.picture}
                  src={sourceOf(decoded.bitmap)}
                  alt=""
                  draggable={false}
                />
                {marks.map((mark) => (
                  <span
                    key={mark.name}
                    className={styles.mark}
                    data-here={mark.name === glyph ? "true" : undefined}
                    style={rectOf(mark.crop, decoded)}
                  >
                    <span className={styles.markName}>{mark.name}</span>
                  </span>
                ))}
                {drag === null ? null : (
                  <span className={styles.drawing} style={rectOf(drag, decoded)} />
                )}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type Point = { x: number; y: number };

/**
 * A rectangle in image pixels, as a position on the scaled element.
 *
 * Percentages rather than pixels, so the picture and its boxes scale together
 * however wide the panel ends up.
 */
function rectOf(
  crop: { from: Point; to: Point },
  size: { width: number; height: number },
): React.CSSProperties {
  const left = Math.min(crop.from.x, crop.to.x);
  const right = Math.max(crop.from.x, crop.to.x);
  // Back into the element's space, where y runs down from the top.
  const top = size.height - Math.max(crop.from.y, crop.to.y);
  const bottom = size.height - Math.min(crop.from.y, crop.to.y);

  return {
    left: `${String((left / size.width) * 100)}%`,
    top: `${String((top / size.height) * 100)}%`,
    width: `${String(((right - left) / size.width) * 100)}%`,
    height: `${String(((bottom - top) / size.height) * 100)}%`,
  };
}

/**
 * A decoded picture as something an `<img>` will show.
 *
 * A bitmap cannot be handed to an element directly, and drawing it to a canvas
 * per frame would be a second copy of a scan in memory. One object URL per
 * bitmap, made once and kept, is the cheap way round — and the browser reclaims
 * it when the page goes.
 */
const sources = new WeakMap<ImageBitmap, string>();

function sourceOf(bitmap: ImageBitmap): string {
  const found = sources.get(bitmap);
  if (found !== undefined) return found;

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);

  const url = canvas.toDataURL();
  sources.set(bitmap, url);
  return url;
}
