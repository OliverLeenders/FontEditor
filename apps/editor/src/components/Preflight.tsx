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
import { CircleAlertIcon, InfoIcon, ShieldCheckIcon, TriangleAlertIcon } from "./icons.js";

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
  // The pictures the font really holds, so a glyph naming one that has gone is
  // found. Not in the document, so the check cannot ask for itself.
  const images = useStoreValue((s) => s.images);
  const [open_, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Only while the panel is up. A font of a few thousand glyphs is a walk over
  // every point in it, and nothing is looking at the answer until then.
  const findings = useMemo(
    () =>
      open_ ? preflight(document, { images: new Set(images.map((entry) => entry.name)) }) : [],
    [open_, document, images],
  );
  const counted = useMemo(() => countBySeverity(findings), [findings]);

  // The list of pictures is read on demand, so it has to be asked for before
  // the check that needs it runs.
  useEffect(() => {
    if (!open_) return;
    void store.refreshImages();
  }, [open_, store]);

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
        <ShieldCheckIcon />
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
                  {/* Shape as well as colour. A dot told a colourblind reader
                      nothing the heading did not already say, and the three
                      severities are three different drawings now. */}
                  <span
                    className={`${styles.mark} ${styles[f.severity]}`}
                    title={SEVERITIES[f.severity]}
                  >
                    <SeverityIcon severity={f.severity} />
                  </span>
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

/**
 * The three severities, drawn.
 *
 * An error stops the font being what it says it is; a warning is something that
 * compiles and is probably not what anybody meant; a note is worth knowing. The
 * shapes are the ones every interface uses for those three, so nobody has to
 * learn them here.
 */
function SeverityIcon({ severity }: { severity: Severity }): React.JSX.Element {
  if (severity === "error") return <CircleAlertIcon />;
  if (severity === "warning") return <TriangleAlertIcon />;
  return <InfoIcon />;
}

/** What each mark means, for the pointer that stops on one. */
const SEVERITIES: Record<Severity, string> = {
  error: "An error: this will not come out as a font that says what it means",
  warning: "A warning: this compiles, and is probably not what was meant",
  note: "A note: worth knowing before this goes out",
};
