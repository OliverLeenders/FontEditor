import type { FileStore } from "./file-store.js";

/**
 * The layers of the source that are not the one being drawn.
 *
 * A UFO may hold several sets of glyphs — a sketch traced over, a previous
 * version, shapes being fitted — and this editor edits exactly one of them. The
 * rest are read and never looked at, and written back where they were found,
 * which is the rule the unmodelled `fontinfo` keys and the whole of a `lib`
 * already follow.
 *
 * Kept here rather than on the document, for the reason the pictures are: a
 * second set of glyphs is the size of the first, and the document is a value
 * history copies on every edit and autosave rewrites on every quiet second.
 * They are also not undoable, and should not be — nothing in the editor can
 * change them, so there is nothing to undo.
 *
 * One file rather than a directory of them. Nothing here ever reads a part of a
 * layer: they arrive together when a font is opened and leave together when one
 * is saved, so a shape that can be written and read in a single call is the
 * shape that fits. It is the largest thing in the project after the pictures,
 * and like them it is written once and then left alone.
 */

/**
 * A layer as it is kept here.
 *
 * The same shape `font-io` reads and writes, declared again rather than
 * imported: this package knows how to keep a file and nothing about what a UFO
 * is, and it is the reader's business what these strings mean. TypeScript is
 * structural, so the two are the same type wherever they meet.
 */
export type StoredLayer = {
  readonly name: string;
  readonly directory: string;
  readonly files: readonly { readonly path: string; readonly text: string }[];
  /**
   * The master whose UFO the layer is in, for a family. Absent for a font of
   * one master, and in every project written before families kept layers.
   */
  readonly master?: string;
};

export const LAYERS_PATH = "layers.json";
export const LAYERS_SCHEMA = 1;

type StoredLayers = {
  readonly schema: number;
  readonly layers: readonly StoredLayer[];
};

export async function writeLayers(store: FileStore, layers: readonly StoredLayer[]): Promise<void> {
  // A font with no extra layers is the ordinary case, and it deserves no file:
  // an empty one would be read back on every open for nothing, and left behind
  // when a font that had layers is replaced by one that has none.
  if (layers.length === 0) {
    await store.remove(LAYERS_PATH);
    return;
  }
  const stored: StoredLayers = { schema: LAYERS_SCHEMA, layers };
  await store.write(LAYERS_PATH, JSON.stringify(stored));
}

/**
 * What was kept, or nothing.
 *
 * Nothing is the ordinary answer rather than a failure: most fonts have one
 * layer, and every project written before this existed has no such file. A file
 * that cannot be parsed is nothing too — it is data this editor never
 * understood, so there is no repair to attempt, and refusing to open the font
 * over it would be losing the drawing to save the sketch.
 */
export async function readLayers(store: FileStore): Promise<readonly StoredLayer[]> {
  const raw = await store.read(LAYERS_PATH);
  if (raw === null) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return [];
    const layers = (parsed as { layers?: unknown }).layers;
    return Array.isArray(layers) ? layers.filter(isLayer) : [];
  } catch {
    return [];
  }
}

/** Believe nothing about what is on disk: it may be older than this code. */
function isLayer(value: unknown): value is StoredLayer {
  if (typeof value !== "object" || value === null) return false;
  const layer = value as Partial<StoredLayer>;
  if (typeof layer.name !== "string" || typeof layer.directory !== "string") return false;
  if (layer.master !== undefined && typeof layer.master !== "string") return false;
  if (!Array.isArray(layer.files)) return false;

  return layer.files.every(
    (file: unknown) =>
      typeof file === "object" &&
      file !== null &&
      typeof (file as { path?: unknown }).path === "string" &&
      typeof (file as { text?: unknown }).text === "string",
  );
}
