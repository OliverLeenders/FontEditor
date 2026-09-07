import { type CatalogQuery, DEFAULT_QUERY } from "@fonteditor/catalog";
import type { DiskFolder } from "@fonteditor/disk";
import { session as newSession } from "@fonteditor/edit-core";
import { importFont as parseFontFile, importUfo, looksLikeUfo } from "@fonteditor/font-io";
import {
  type FontDocument,
  type GlyphName,
  DEFAULT_FONT_INFO,
  fontDocument,
  glyph,
  randomIds,
} from "@fonteditor/font-model";
import { editorState } from "@fonteditor/tools";

import type { Persistence } from "../persistence.js";
import type { StoreHost } from "./state.js";

/**
 * Putting a whole font in front of the reader: a new one, or one from a file.
 *
 * Free functions over the store rather than methods on it, because this is the
 * one part that reads files, and it is long enough — two readers, a warning
 * format each, and the rule about what replaces what — to be worth reading on
 * its own.
 */

/** What opening a font needs of the store beyond reading and patching state. */
export type FontHost = StoreHost & {
  readonly disk: Persistence;
  /** Keep a copy of the font as it is now, before replacing it. */
  keepSnapshot: () => Promise<void>;
  /** Let go of a decoded picture, because the bytes behind it have changed. */
  forgetImage: (name: string) => void;
  /** The folder on disk this font came from, if it came from one. */
  folder: () => DiskFolder | null;
  setFolder: (folder: DiskFolder | null, name?: string) => void;
  /** The glyph to open once the font is on screen, and the camera to frame it. */
  showGlyph: (name: GlyphName) => void;
  setCatalogQuery: (changes: Partial<CatalogQuery>) => void;
};

/** What a font brought in from a file turned out to be. */
export type ImportReport = {
  family: string;
  glyphs: number;
  warnings: string[];
};

/**
 * Start a new, empty font, discarding whatever is open.
 *
 * Empty means genuinely empty apart from `.notdef`, which every font needs and
 * which no one wants to remember to make. Destructive, so the caller is
 * expected to have asked first; the store's job is to do it cleanly rather
 * than to second-guess it.
 */
export async function newFont(host: FontHost): Promise<void> {
  const document = fontDocument([glyph(".notdef", { advance: 500 })], DEFAULT_FONT_INFO);
  await adoptDocument(host, document);
}

/**
 * Replace the document with a font read from a file.
 *
 * Which reader is used comes from the file's name rather than from sniffing
 * its bytes: a UFO is a zip and a zip could be anything, so the only honest
 * way to know one is that it was offered as one. Being wrong is cheap — the
 * UFO reader says what it could not find.
 *
 * Deliberately *not* an undoable edit. Undo is for the shape you are drawing;
 * a single ctrl-Z that silently swapped the whole font back would be alarming
 * rather than useful, and the history it restored would describe glyphs that
 * are no longer open. The session starts again on the new font.
 */
export async function importFont(
  host: FontHost,
  bytes: ArrayBuffer,
  fileName = "",
): Promise<ImportReport> {
  const read = looksLikeUfo(fileName)
    ? await readUfo(bytes)
    : (() => {
        const parsed = parseFontFile(bytes, randomIds());
        return {
          document: parsed.document,
          images: new Map<string, Uint8Array>(),
          warnings: parsed.warnings.map((w) =>
            w.glyph === null ? w.message : `${w.glyph}: ${w.message}`,
          ),
        };
      })();

  await adoptDocument(host, read.document);
  await adoptImages(host, read.images);

  const { info, glyphOrder } = read.document;
  return {
    family: `${info.familyName} ${info.styleName}`.trim(),
    glyphs: glyphOrder.length,
    warnings: read.warnings,
  };
}

async function readUfo(bytes: ArrayBuffer): Promise<{
  document: FontDocument;
  warnings: string[];
  images: ReadonlyMap<string, Uint8Array>;
}> {
  const out = await importUfo(bytes, randomIds());
  // A UFO that cannot be read is reported rather than half-adopted: there is
  // no partial font to fall back on the way a damaged glyph has one.
  if ("reason" in out) throw new Error(out.reason);

  return {
    document: out.document,
    images: out.images,
    warnings: out.warnings.map((w) => (w.glyph === null ? w.message : `${w.glyph}: ${w.message}`)),
  };
}

/**
 * Put the pictures a font arrived with into the store.
 *
 * After the document, not before: an image belongs to a font, and writing them
 * first would leave a store holding pictures for a font that failed to open.
 */
export async function adoptImages(
  host: FontHost,
  images: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
  for (const [name, bytes] of images) {
    host.forgetImage(name);
    await host.disk.putImage(name, bytes);
  }
  host.patch({ images: await host.disk.images() });
}

/**
 * Make a document the one being edited, on screen and on disk.
 *
 * Shared by opening a font and by starting a new one, because they differ only
 * in where the document came from. The history is replaced rather than
 * appended to, for the reason `importFont` gives.
 */
export async function adoptDocument(host: FontHost, document: FontDocument): Promise<void> {
  // A copy of what is open before it stops being open. Opening a font is the
  // most destructive thing this editor does — it replaces every glyph on disk —
  // and it is exactly the moment someone discovers they meant the other file.
  await host.keepSnapshot();

  showDocument(host, document, false);
  host.setCatalogQuery(DEFAULT_QUERY);
  // Whatever folder on disk was open held the *previous* font. Forgetting it
  // here means Save can never quietly write this font over that one; opening a
  // folder sets the link again straight afterwards.
  host.setFolder(null);
  await host.disk.replaceAll(document);
}

/** Put a document on screen, starting its history over. */
export function showDocument(host: FontHost, document: FontDocument, recovered: boolean): void {
  host.patch({
    session: newSession(editorState({ document, view: host.state().session.editor.view })),
    recovered,
  });
  host.showGlyph(document.glyphOrder[0] ?? "");
}
