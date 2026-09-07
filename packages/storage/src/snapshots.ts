import type { FontDocument } from "@fonteditor/font-model";
import {
  fontDocument,
  orderedGlyphs,
  setFeatures,
  setGlyphOrder,
  setKerning,
} from "@fonteditor/font-model";

import type { FileStore } from "./file-store.js";
import {
  type StoredFontInfo,
  type StoredGlyph,
  type StoredKerning,
  SCHEMA_VERSION,
  decodeFontInfo,
  decodeGlyph,
  decodeKerning,
  encodeFontInfo,
  encodeGlyph,
  encodeKerning,
} from "./schema.js";

/**
 * Copies of the whole font, kept beside the project it came from.
 *
 * The working store answers "is my work still here when I come back". This
 * answers the other question, which is the one people ask in a hurry: "can I
 * have it back as it was an hour ago". Undo cannot, because undo is a session's
 * memory and dies with the tab; and the autosave cannot, because its whole job
 * is to keep up with what just happened.
 *
 * A snapshot is one file holding the entire document, unlike the project's file
 * per glyph. That is deliberate: it is written rarely and read whole, and a
 * directory of ten thousand small files per snapshot would cost more to prune
 * than to write.
 */

export const SNAPSHOTS_PREFIX = "snapshots/";

/** How many are kept before the oldest is dropped. */
export const KEEP = 20;

export type StoredSnapshot = {
  readonly schema: number;
  readonly at: number;
  readonly info: StoredFontInfo;
  readonly kerning: StoredKerning;
  readonly glyphs: readonly StoredGlyph[];
  readonly features?: string;
};

/**
 * What a list of snapshots says without opening any of them.
 *
 * The time and the size are in the filename, so listing is one directory read
 * however large the font is — which matters because the list is what someone
 * stares at while deciding whether they have lost anything.
 */
export type SnapshotEntry = {
  readonly at: number;
  readonly glyphs: number;
};

const pathOf = (entry: SnapshotEntry): string =>
  `${SNAPSHOTS_PREFIX}${String(entry.at)}-${String(entry.glyphs)}.json`;

function entryOf(path: string): SnapshotEntry | null {
  const name = path.slice(SNAPSHOTS_PREFIX.length).replace(/\.json$/, "");
  const [at, glyphs] = name.split("-");
  if (at === undefined || glyphs === undefined) return null;

  const when = Number(at);
  const many = Number(glyphs);
  return Number.isFinite(when) && Number.isFinite(many) ? { at: when, glyphs: many } : null;
}

/** Encode a document as a snapshot payload, ready to cross to the worker. */
export function snapshotOf(document: FontDocument, at: number): StoredSnapshot {
  const glyphs = orderedGlyphs(document).map(encodeGlyph);
  return {
    schema: SCHEMA_VERSION,
    at,
    info: encodeFontInfo(document),
    kerning: encodeKerning(document.kerning),
    glyphs,
    ...(document.features === "" ? {} : { features: document.features }),
  };
}

export async function writeSnapshot(
  store: FileStore,
  snapshot: StoredSnapshot,
): Promise<SnapshotEntry> {
  const entry = { at: snapshot.at, glyphs: snapshot.glyphs.length };
  await store.write(pathOf(entry), JSON.stringify(snapshot));
  return entry;
}

/** Every snapshot, newest first. */
export async function listSnapshots(store: FileStore): Promise<SnapshotEntry[]> {
  const paths = await store.list(SNAPSHOTS_PREFIX);
  const entries: SnapshotEntry[] = [];
  for (const path of paths) {
    const entry = entryOf(path);
    if (entry !== null) entries.push(entry);
  }
  return entries.sort((l, r) => r.at - l.at);
}

/**
 * Drop the oldest until `keep` remain.
 *
 * Returns what it removed, so a caller can say so rather than guess.
 */
export async function pruneSnapshots(store: FileStore, keep = KEEP): Promise<SnapshotEntry[]> {
  const entries = await listSnapshots(store);
  const dropped = entries.slice(Math.max(keep, 0));
  for (const entry of dropped) await store.remove(pathOf(entry));
  return dropped;
}

/**
 * Read one back, or `null` where it has gone.
 *
 * A snapshot that will not parse is treated as gone rather than thrown: it is a
 * copy, and the answer to a corrupt copy is the next one down the list.
 */
export async function readSnapshot(store: FileStore, at: number): Promise<StoredSnapshot | null> {
  const entries = await listSnapshots(store);
  const wanted = entries.find((entry) => entry.at === at);
  if (wanted === undefined) return null;

  const text = await store.read(pathOf(wanted));
  if (text === null) return null;

  try {
    const parsed: unknown = JSON.parse(text);
    return isSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isSnapshot(value: unknown): value is StoredSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record["glyphs"]) && typeof record["at"] === "number";
}

/**
 * A snapshot as a document again.
 *
 * Glyphs that will not decode are left out and named, exactly as loading the
 * project does: getting most of a font back is the whole point of the thing.
 */
export function documentOf(snapshot: StoredSnapshot): {
  readonly document: FontDocument;
  readonly problems: readonly string[];
} {
  const problems: string[] = [];
  const glyphs = [];
  for (const stored of snapshot.glyphs) {
    const decoded = decodeGlyph(stored);
    if (decoded.ok) glyphs.push(decoded.value);
    else problems.push(`${stored.name}: ${decoded.reason}`);
  }

  const read = decodeFontInfo(snapshot.info);
  let document = fontDocument(glyphs, read.info);
  if (read.glyphOrder.length > 0) document = setGlyphOrder(document, read.glyphOrder);
  document = setKerning(document, decodeKerning(snapshot.kerning));

  // The features live in the font info file, and in the snapshot beside it for
  // the same reason the glyphs are there: one file, read whole.
  const features = snapshot.features ?? read.features;
  if (features !== "") document = setFeatures(document, features);

  return { document, problems };
}
