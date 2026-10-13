import { fontFileStem, zip } from "@typewright/font-io";

import { runExport } from "./export-jobs.js";
import { compile } from "./exporting.js";
import type { EditorStore } from "./store/index.js";

/**
 * Glyphs on their way out as pictures, a few at a time: the one that is wanted
 * in a drawing program or on a page, rather than the whole font zipped.
 *
 * As compiled, like the zip of every one: components resolved, strokes turned
 * to ink, overlaps joined, in the box a line of text gives the glyph.
 */

/**
 * Hand a file to the browser.
 *
 * The object URL is revoked on the next turn of the event loop rather than
 * immediately: the click has to be dispatched before the URL stops meaning
 * anything.
 */
export function download(data: BlobPart, file: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = file;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** What is said where none of the glyphs asked for has anything to draw. */
const nothingDrawn = (names: readonly string[]): Error =>
  new Error(
    names.length === 1
      ? `${names[0] ?? "The glyph"} draws nothing.`
      : "None of these glyphs draws anything.",
  );

/**
 * These glyphs as SVG files: the file itself where it is one, and an archive
 * where it is several. Told on the status line, as every export is.
 */
export async function exportGlyphSvgs(store: EditorStore, names: readonly string[]): Promise<void> {
  if (names.length === 0 || !store.beginExport()) return;
  try {
    const document = store.editor.document;
    const files = await compile({ kind: "svgs", document, names });
    const [only] = files;
    if (only === undefined) throw nothingDrawn(names);

    if (files.length === 1 && "text" in only) {
      download(only.text, only.path, "image/svg+xml");
      store.endExport({ file: only.path, warnings: [] });
      return;
    }
    const file = `${fontFileStem(document)}-svg.zip`;
    download(zip(files).slice().buffer, file, "application/zip");
    store.endExport({ file: `${file} · ${String(files.length)} files`, warnings: [] });
  } catch (error) {
    store.endExport({ failed: error });
  }
}

/**
 * One glyph as SVG text on the clipboard, which is how a drawing program takes
 * a picture without a file being made of it first.
 *
 * Made on the page's own thread: it is one glyph, and a clipboard is only
 * written to while the click that asked is still fresh.
 */
export async function copyGlyphSvg(store: EditorStore, name: string): Promise<void> {
  try {
    const [file] = await runExport({
      kind: "svgs",
      document: store.editor.document,
      names: [name],
    });
    if (file === undefined || !("text" in file)) throw nothingDrawn([name]);
    await navigator.clipboard.writeText(file.text);
    store.showNotice({ summary: `Copied ${name} as SVG`, details: [] });
  } catch (error) {
    store.reportFailure(error);
  }
}
