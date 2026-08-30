import { exportFileName, exportFont } from "@fonteditor/font-io";
import { useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./OpenFont.module.css";

type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "done"; readonly file: string; readonly warnings: readonly string[] }
  | { readonly kind: "failed"; readonly message: string };

/**
 * Export the font as a file you can install.
 *
 * Deliberately labelled "Export", never "Save". What comes out is a *new* font
 * built from what the editor models — outlines, advances, the character map,
 * vertical metrics — and not the file you opened with your edits applied. A
 * font imported from elsewhere also carried OpenType features, hinting and
 * composite glyphs, and none of that survives a trip through this model. A
 * button that said "Save" would be promising something it cannot do.
 */
export function ExportFont(): JSX.Element {
  const store = useEditorStore();
  const glyphCount = useStoreValue((s) => s.session.editor.document.glyphOrder.length);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const run = (): void => {
    const document = store.editor.document;
    try {
      const { bytes, warnings } = exportFont(document);
      const file = exportFileName(document);

      // Revoked on the next turn of the event loop rather than immediately: the
      // click has to be dispatched before the URL stops meaning anything.
      const url = URL.createObjectURL(new Blob([bytes], { type: "font/otf" }));
      const link = window.document.createElement("a");
      link.href = url;
      link.download = file;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);

      setStatus({ kind: "done", file, warnings });
    } catch (error) {
      setStatus({
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <>
      <button
        type="button"
        className={styles.button}
        disabled={glyphCount === 0}
        title="Build an OTF from the outlines and metrics in this editor"
        onClick={run}
      >
        Export…
      </button>
      {status.kind === "done" ? (
        <span className={styles.note}>
          {status.file}
          {status.warnings.length > 0 ? (
            <span className={styles.warn} title={status.warnings.slice(0, 20).join("\n")}>
              {" "}
              · {status.warnings.length} warning{status.warnings.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </span>
      ) : null}
      {status.kind === "failed" ? (
        <span className={styles.error} role="alert">
          {status.message}
        </span>
      ) : null}
    </>
  );
}
