import { exportFileName, exportFont, exportUfo } from "@fonteditor/font-io";
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

  /**
   * Hand a file to the browser.
   *
   * The object URL is revoked on the next turn of the event loop rather than
   * immediately: the click has to be dispatched before the URL stops meaning
   * anything.
   */
  const download = (data: BlobPart, file: string, type: string): void => {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const link = window.document.createElement("a");
    link.href = url;
    link.download = file;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const attempt = (run: () => { file: string; warnings: readonly string[] }): void => {
    try {
      setStatus({ kind: "done", ...run() });
    } catch (error) {
      setStatus({
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const otf = (): void =>
    attempt(() => {
      const document = store.editor.document;
      const { bytes, warnings } = exportFont(document);
      const file = exportFileName(document);
      download(bytes, file, "font/otf");
      return { file, warnings };
    });

  const ufo = (): void =>
    attempt(() => {
      const document = store.editor.document;
      const { bytes, fileName } = exportUfo(document);
      // Sliced to a plain ArrayBuffer: a Uint8Array view is not a BlobPart, and
      // a view over a larger buffer would carry more than the archive.
      download(bytes.slice().buffer, fileName, "application/zip");
      return { file: fileName, warnings: [] };
    });

  return (
    <>
      {/* Two exports, because they are for different things: an OTF is a font
          to install and use, a UFO is the source to hand to another tool. The
          OTF loses whatever this editor does not model; the UFO does not. */}
      <button
        type="button"
        className={styles.button}
        disabled={glyphCount === 0}
        title="Build an OTF you can install — outlines and metrics only"
        onClick={otf}
      >
        Export OTF
      </button>
      <button
        type="button"
        className={styles.button}
        disabled={glyphCount === 0}
        title="Write a UFO source folder, zipped — nothing this editor models is lost"
        onClick={ufo}
      >
        Export UFO
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
