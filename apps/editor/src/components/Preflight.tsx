import {
  type Finding,
  type Severity,
  checkNamed,
  countBySeverity,
  preflight,
} from "@fonteditor/preflight";
import { useEffect, useMemo, useRef, useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./Preflight.module.css";
import open from "./OpenFont.module.css";

/**
 * Everything wrong with the font, and the way to each of them.
 *
 * The things worth finding in a font are the ones that are invisible while you
 * are drawing: a contour left open looks closed on a canvas that fills it, a
 * duplicate code point looks like two good glyphs, a kerning pair naming a
 * glyph renamed last week looks like nothing at all. None of them announces
 * itself, which is why they are still there at export.
 *
 * Nothing here fixes anything, deliberately. Every one of these has a fix that
 * is a decision — whether the contour was meant to close, which of two glyphs
 * keeps the character — so the button is "show me", and the answer is yours.
 */
export function Preflight(): React.JSX.Element {
  const store = useEditorStore();
  const document = useStoreValue((s) => s.session.editor.document);
  const [open_, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Only while the panel is up. A font of a few thousand glyphs is a walk over
  // every point in it, and nothing is looking at the answer until then.
  const findings = useMemo(() => (open_ ? preflight(document) : []), [open_, document]);
  const counted = useMemo(() => countBySeverity(findings), [findings]);

  useEffect(() => {
    if (!open_) return;

    const onDown = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open_]);

  /**
   * Go to what the finding is about.
   *
   * The glyph first and the selection second: opening a glyph clears the
   * selection and frames the drawing, so selecting before would be undone by
   * the very next line.
   */
  const goTo = (f: Finding): void => {
    if (f.glyph === null) return;
    store.setCurrentGlyph(f.glyph);

    const where = f.where;
    if (where === null || where.nodeId === null) return;
    store.setEditor({
      ...store.editor,
      selection: [{ contourId: where.contourId, nodeId: where.nodeId, part: "point" }],
    });
  };

  return (
    <div className={styles.holder} ref={ref}>
      <button
        type="button"
        className={open.button}
        aria-expanded={open_}
        title="Everything findable about this font before it is exported"
        onClick={() => setOpen(!open_)}
      >
        Check font
      </button>

      {open_ ? (
        <div className={styles.panel} role="group" aria-label="Preflight">
          <div className={styles.head}>
            <span>{summary(counted)}</span>
          </div>

          {findings.length === 0 ? (
            <p className={styles.empty}>
              Nothing found. Which is not the same as nothing wrong — this looks at what can be
              found by reading the font, not at whether the drawing is any good.
            </p>
          ) : (
            <ul className={styles.list}>
              {findings.map((f, i) => (
                <li key={`${f.check}-${String(f.glyph)}-${String(i)}`} className={styles.row}>
                  <span className={`${styles.dot} ${styles[f.severity]}`} aria-hidden />
                  <button
                    type="button"
                    className={styles.what}
                    disabled={f.glyph === null}
                    title={checkNamed(f.check).why}
                    onClick={() => goTo(f)}
                  >
                    <span className={styles.title}>{checkNamed(f.check).title}</span>
                    <span className={styles.message}>
                      {f.glyph === null ? "" : `${f.glyph} · `}
                      {f.message}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** What was found, counted, in the order the counts matter. */
function summary(counted: Record<Severity, number>): string {
  const parts: string[] = [];
  if (counted.error > 0) parts.push(`${String(counted.error)} error${s(counted.error)}`);
  if (counted.warning > 0) parts.push(`${String(counted.warning)} warning${s(counted.warning)}`);
  if (counted.note > 0) parts.push(`${String(counted.note)} note${s(counted.note)}`);
  return parts.length === 0 ? "Nothing found" : parts.join(" · ");
}

const s = (n: number): string => (n === 1 ? "" : "s");
