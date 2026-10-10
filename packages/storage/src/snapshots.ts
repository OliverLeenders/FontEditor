import type { FontDocument } from "@typewright/font-model";
import {
  fontDocument,
  orderedGlyphs,
  setFeatures,
  setGlyphOrder,
  setGuides,
  setKept,
  setKerning,
  setLayers,
} from "@typewright/font-model";

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
  /**
   * The master it is a copy of, by its id, in a font drawn more than once.
   *
   * A copy is of the document that was open, which is one master. Without this
   * a copy kept while the regular was drawn could be put back while the bold
   * was, and the bold became the regular. Absent in a copy of a font with one
   * master, and in every copy from before this was kept.
   */
  readonly master?: string;
};

/**
 * What a list of snapshots says without opening any of them.
 *
 * The time, the size and the master are in the filename, so listing is one
 * directory read however large the font is — which matters because the list is
 * what someone stares at while deciding whether they have lost anything.
 */
export type SnapshotEntry = {
  readonly at: number;
  readonly glyphs: number;
  /** The master it is a copy of, or `null` where it does not say. */
  readonly master: string | null;
};

/** The master's id goes last, written so that whatever is in it is one safe piece of a name. */
const pathOf = (entry: SnapshotEntry): string =>
  `${SNAPSHOTS_PREFIX}${String(entry.at)}-${String(entry.glyphs)}${
    entry.master === null ? "" : `-${encodeURIComponent(entry.master)}`
  }.json`;

function entryOf(path: string): SnapshotEntry | null {
  const name = path.slice(SNAPSHOTS_PREFIX.length).replace(/\.json$/, "");
  const [at, glyphs, ...rest] = name.split("-");
  if (at === undefined || glyphs === undefined) return null;

  const when = Number(at);
  const many = Number(glyphs);
  if (!Number.isFinite(when) || !Number.isFinite(many)) return null;

  let master: string | null = null;
  if (rest.length > 0) {
    try {
      // An id may hold a hyphen of its own, so it is everything after the size.
      master = decodeURIComponent(rest.join("-"));
    } catch {
      master = rest.join("-");
    }
  }
  return { at: when, glyphs: many, master };
}

/** Encode a document as a snapshot payload, ready to cross to the worker. */
export function snapshotOf(
  document: FontDocument,
  at: number,
  master: string | null = null,
): StoredSnapshot {
  const glyphs = orderedGlyphs(document).map(encodeGlyph);
  return {
    schema: SCHEMA_VERSION,
    at,
    info: encodeFontInfo(document),
    kerning: encodeKerning(document.kerning),
    glyphs,
    ...(document.features === "" ? {} : { features: document.features }),
    ...(master === null ? {} : { master }),
  };
}

export async function writeSnapshot(
  store: FileStore,
  snapshot: StoredSnapshot,
): Promise<SnapshotEntry> {
  const entry = {
    at: snapshot.at,
    glyphs: snapshot.glyphs.length,
    master: snapshot.master ?? null,
  };
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
 * Drop the oldest copies of one master until `keep` remain.
 *
 * Of one master, so that an afternoon spent in the bold does not push the last
 * copy of the regular off the end: each master has its own twenty. `null` is
 * the copies that do not say, which is all of them in a font drawn once.
 *
 * Returns what it removed, so a caller can say so rather than guess.
 */
export async function pruneSnapshots(
  store: FileStore,
  master: string | null = null,
  keep = KEEP,
): Promise<SnapshotEntry[]> {
  const entries = (await listSnapshots(store)).filter((entry) => entry.master === master);
  const dropped = entries.slice(Math.max(keep, 0));
  for (const entry of dropped) await store.remove(pathOf(entry));
  return dropped;
}

/**
 * Read one back, or `null` where it has gone.
 *
 * A snapshot that will not parse is treated as gone rather than thrown: it is a
 * copy, and the answer to a corrupt copy is the next one down the list.
 *
 * By its time and the master it is of. The time alone is not which copy: two
 * masters can each have one kept in the same millisecond, and asked for by
 * time the first found was put back, which was as often the other master's.
 * Without a master said, it is the first at that time, as it always was.
 */
export async function readSnapshot(
  store: FileStore,
  at: number,
  master?: string | null,
): Promise<StoredSnapshot | null> {
  const entries = await listSnapshots(store);
  const wanted = entries.find(
    (entry) => entry.at === at && (master === undefined || entry.master === master),
  );
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
  let document = {
    ...fontDocument(glyphs, read.info),
    grid: read.grid,
    fixedWidth: read.fixedWidth,
    nameLigatures: read.nameLigatures,
    serifs: read.serifs,
  };
  if (read.glyphOrder.length > 0) document = setGlyphOrder(document, read.glyphOrder);
  document = setKerning(document, decodeKerning(snapshot.kerning));

  // The features live in the font info file, and in the snapshot beside it for
  // the same reason the glyphs are there: one file, read whole.
  const features = snapshot.features ?? read.features;
  if (features !== "") document = setFeatures(document, features);

  // Whatever the font carries that this editor cannot model, which rides along
  // in the stored font info. A copy that came back without it would quietly
  // strip somebody's source the next time they saved.
  document = setLayers(setKept(setGuides(document, read.guides), read.kept), read.layers);

  return { document, problems };
}
