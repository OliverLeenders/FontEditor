import {
  exportFamily,
  exportFileName,
  exportFont,
  exportTrueType,
  exportUfo,
  exportVariableFont,
} from "@fonteditor/font-io";
import { type Location, defaultLocation } from "@fonteditor/font-model";
import { useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./OpenFont.module.css";
import { DownloadIcon } from "./icons.js";

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
export function ExportFont(): React.JSX.Element {
  const store = useEditorStore();
  const glyphCount = useStoreValue((s) => s.session.editor.document.glyphOrder.length);
  const masters = useStoreValue((s) => s.project.masters.length);
  const axes = useStoreValue((s) => s.project.axes.length);
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

  const attemptAsync = async (
    run: () => Promise<{ file: string; warnings: readonly string[] }>,
  ): Promise<void> => {
    try {
      setStatus({ kind: "done", ...(await run()) });
    } catch (error) {
      setStatus({
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
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

  /**
   * The whole family: a UFO per master and the designspace beside them.
   *
   * What fontmake is given, and what makes a design drawn here buildable by
   * something else. Asynchronous because the masters that are not open live on
   * disk and have to be read in.
   */
  const family = (): void =>
    void attemptAsync(async () => {
      const masters = await store.allMasters();
      const { bytes, fileName, files } = exportFamily(store.getState().project.axes, masters);
      download(bytes.slice().buffer, fileName, "application/zip");
      return { file: `${fileName} · ${String(files)} files`, warnings: [] };
    });

  /**
   * One font that is every master and everything between them.
   *
   * The masters have to be in the order the designspace puts them and the
   * default first: everything in the file is a delta from the first master, and
   * a font whose default is its Black is a font that is Black until something
   * asks otherwise.
   */
  const variable = (): void =>
    void attemptAsync(async () => {
      const project = store.getState().project;
      const all = await store.allMasters();
      const home = defaultLocation(project.axes);
      const ordered = [
        ...all.filter((m) => atHome(m.location, home, project.axes)),
        ...all.filter((m) => !atHome(m.location, home, project.axes)),
      ];

      const out = exportVariableFont(project.axes, ordered);
      const file = exportFileName(store.editor.document).replace(/\.otf$/, "-VF.otf");
      download(out.bytes, file, "font/otf");
      return { file, warnings: out.warnings };
    });

  /**
   * The same font, with quadratic outlines.
   *
   * A conversion rather than another way of writing the same numbers: a cubic
   * cannot be said exactly as quadratics, so this is the drawing to within a
   * fraction of a unit rather than the drawing itself. The OTF beside it is
   * exact, and is the one to hand to somebody who will edit it again.
   */
  const truetype = (): void =>
    attempt(() => {
      const document = store.editor.document;
      const { bytes, warnings } = exportTrueType(document);
      const file = exportFileName(document).replace(/\.otf$/, ".ttf");
      download(bytes, file, "font/ttf");
      return { file, warnings };
    });

  const ufo = (): void =>
    void attemptAsync(async () => {
      const document = store.editor.document;
      // The pictures too, which is why this one is the async of the pair: they
      // are read from the working store rather than held in the document.
      const { bytes, fileName } = exportUfo(document, await store.allImages());
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
        <DownloadIcon />
        Export OTF
      </button>
      <button
        type="button"
        className={styles.button}
        disabled={glyphCount === 0}
        title="The same font with quadratic outlines — what hinting and most web pipelines want"
        onClick={truetype}
      >
        <DownloadIcon />
        Export TTF
      </button>
      <button
        type="button"
        className={styles.button}
        disabled={glyphCount === 0}
        title="Write a UFO source folder, zipped — nothing this editor models is lost"
        onClick={ufo}
      >
        <DownloadIcon />
        Export UFO
      </button>
      {/* Only where there is a family to write. A designspace with one source
          is a legal file and a pointless one, and a button that made one would
          be a button that does nothing anybody wanted. */}
      {masters > 1 ? (
        <>
          <button
            type="button"
            className={styles.button}
            disabled={glyphCount === 0}
            title="Write every master as its own UFO, with the designspace that ties them together"
            onClick={family}
          >
            <DownloadIcon />
            Export family
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={glyphCount === 0 || axes === 0}
            title={
              axes === 0
                ? "A variable font needs an axis to vary along"
                : "One font that is every master and everything between them"
            }
            onClick={variable}
          >
            <DownloadIcon />
            Export variable
          </button>
        </>
      ) : null}
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

/** Whether a master sits where every axis has its default: the font's home. */
function atHome(
  at: Location,
  home: Location,
  axes: readonly { readonly tag: string; readonly default: number }[],
): boolean {
  return axes.every((a) => (at[a.tag] ?? a.default) === (home[a.tag] ?? a.default));
}
