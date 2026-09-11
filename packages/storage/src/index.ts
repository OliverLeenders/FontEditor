/**
 * @typewright/storage
 *
 * Local-first persistence.
 *
 * The layers are stacked so that almost none of this needs a browser to test.
 * Serialization, the file layout, the project save/load logic, the journal and
 * the autosave scheduler are all written against a four-method `FileStore`
 * interface and exercised in Node against an in-memory implementation. Only
 * `OpfsFileStore` — a hundred lines of adapter — actually touches the browser,
 * and it runs inside a Worker because `createSyncAccessHandle` is available
 * nowhere else.
 *
 * Worth remembering what this is: the Origin Private File System is owned by the
 * browser, not the user. These files cannot be opened in a file manager. It is a
 * working store, whose promise is that your work is still here when you come
 * back — not a replacement for saving a font to disk, which is a later step.
 */

export type {
  Decoded,
  Migration,
  StoredContour,
  StoredFontInfo,
  StoredGlyph,
  StoredNode,
  StoredPoint,
} from "./schema.js";
export {
  MIGRATIONS,
  SCHEMA_VERSION,
  decodeFontInfo,
  decodeGlyph,
  encodeFontInfo,
  encodeGlyph,
  migrate,
} from "./schema.js";

/**
 * Re-exported for convenience; it lives in the model now that the exporter
 * needs the same rule for `.glif` files.
 */
export { glyphFileName } from "@typewright/font-model";

export type { FileStore } from "./file-store.js";
export { MemoryFileStore } from "./file-store.js";

export type { JournalRecord, LoadResult, SaveReport } from "./project.js";
export {
  FONT_INFO_PATH,
  GLYPHS_PREFIX,
  JOURNAL_PATH,
  KERNING_PATH,
  appendJournal,
  clearJournal,
  dirtyGlyphs,
  glyphPath,
  removedGlyphs,
  loadDocument,
  readJournal,
  replaceDocument,
  saveDocument,
  saveGlyphs,
  wipe,
} from "./project.js";

export type { LockGrant, LockManagerLike } from "./lock.js";
export { PROJECT_LOCK, projectLock, ProjectLock, browserLocks } from "./lock.js";

export type { AutosaveHooks, AutosaveOptions, AutosaveStatus } from "./autosave.js";
export { Autosave, DEFAULT_DEBOUNCE_MS } from "./autosave.js";

export type { LoadedPayload, StorageRequest, StorageResponse } from "./protocol.js";

export type { LoadedProject } from "./client.js";
export { StorageClient } from "./client.js";

export { OpfsFileStore, requestPersistence } from "./opfs.js";

export { AT_ONCE, inParallel } from "./parallel.js";

export type { StoredDesignspace } from "./masters.js";
export {
  DESIGNSPACE_PATH,
  DESIGNSPACE_SCHEMA,
  MASTERS_PREFIX,
  listMasters,
  readDesignspace,
  readMaster,
  removeMaster,
  writeDesignspace,
  writeMaster,
} from "./masters.js";

export type { ImageEntry } from "./images.js";
export type { StoredLayer } from "./layers.js";
export { LAYERS_PATH, LAYERS_SCHEMA, readLayers, writeLayers } from "./layers.js";
export {
  IMAGES_PREFIX,
  allImages,
  listImages,
  pruneImages,
  readImage,
  removeImage,
  usableImageName,
  writeImage,
} from "./images.js";

export type { SnapshotEntry, StoredSnapshot } from "./snapshots.js";
export {
  KEEP,
  SNAPSHOTS_PREFIX,
  documentOf,
  listSnapshots,
  pruneSnapshots,
  readSnapshot,
  snapshotOf,
  writeSnapshot,
} from "./snapshots.js";
