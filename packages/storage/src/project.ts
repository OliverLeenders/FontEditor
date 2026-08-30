import type { FontDocument, Glyph } from "@fonteditor/font-model";
import { fontDocument } from "@fonteditor/font-model";

import type { FileStore } from "./file-store.js";
import { glyphFileName } from "./names.js";
import {
  type StoredGlyph,
  SCHEMA_VERSION,
  decodeGlyph,
  encodeFontInfo,
  encodeGlyph,
} from "./schema.js";

/**
 * The layout on disk, shaped like a UFO.
 *
 *     fontinfo.json
 *     glyphs/o.json
 *     journal.ndjson
 *
 * One file per glyph is the load-bearing choice. A font has thousands of them;
 * if a save rewrote a single large file, every pause in typing would cost
 * megabytes. Per-glyph files mean a save writes the couple of kilobytes that
 * actually changed. That the layout also mirrors UFO makes the eventual
 * import/export closer to a rename than a converter.
 */
export const FONT_INFO_PATH = "fontinfo.json";
export const GLYPHS_PREFIX = "glyphs/";
export const JOURNAL_PATH = "journal.ndjson";

export function glyphPath(name: string): string {
  return GLYPHS_PREFIX + glyphFileName(name);
}

// ---------------------------------------------------------------------------
// what changed
// ---------------------------------------------------------------------------

/**
 * The glyphs that differ between two documents.
 *
 * Reference comparison, which is exact here rather than approximate: the model
 * is persistent, so an untouched glyph after an edit is the very same object it
 * was before. This is the same property the history layer relies on, and it is
 * what lets an autosave write only what moved without any dirty-flag
 * bookkeeping to get out of step.
 */
export function dirtyGlyphs(previous: FontDocument | null, next: FontDocument): Glyph[] {
  if (previous === null) return [next.glyph];
  return previous.glyph === next.glyph ? [] : [next.glyph];
}

// ---------------------------------------------------------------------------
// saving
// ---------------------------------------------------------------------------

export type SaveReport = {
  readonly written: readonly string[];
};

export async function saveGlyphs(store: FileStore, glyphs: readonly Glyph[]): Promise<SaveReport> {
  const written: string[] = [];
  for (const g of glyphs) {
    const path = glyphPath(g.name);
    await store.write(path, JSON.stringify(encodeGlyph(g)));
    written.push(path);
  }
  return { written };
}

export async function saveDocument(
  store: FileStore,
  document: FontDocument,
  previous: FontDocument | null = null,
): Promise<SaveReport> {
  const changed = dirtyGlyphs(previous, document);
  const report = await saveGlyphs(store, changed);

  // The index is small and cheap; rewriting it on any change keeps it honest
  // about which glyphs exist.
  if (changed.length > 0 || previous === null) {
    await store.write(FONT_INFO_PATH, JSON.stringify(encodeFontInfo(document)));
  }
  return report;
}

// ---------------------------------------------------------------------------
// the journal
// ---------------------------------------------------------------------------

/**
 * A committed edit that autosave has not flushed yet.
 *
 * Worth being precise about what this protects, because the obvious framing is
 * wrong: it is *not* for recovering a drag in progress. A half-finished drag is
 * not worth restoring, and writing on every pointer move would be absurd. The
 * real exposure is the debounce window — an edit is committed, autosave waits a
 * second to batch, and the tab dies in between. The journal closes that gap with
 * one small append at commit time.
 */
export type JournalRecord = {
  readonly at: number;
  readonly glyph: StoredGlyph;
};

export async function appendJournal(
  store: FileStore,
  glyph: Glyph,
  at: number,
): Promise<void> {
  const record: JournalRecord = { at, glyph: encodeGlyph(glyph) };
  await store.append(JOURNAL_PATH, `${JSON.stringify(record)}\n`);
}

export async function clearJournal(store: FileStore): Promise<void> {
  await store.remove(JOURNAL_PATH);
}

/**
 * Journal records, newest last, skipping any line that will not parse.
 *
 * A truncated final line is the expected failure — the tab died mid-append —
 * and losing that one record is exactly right. Refusing to read the whole
 * journal because its last line is half-written would throw away everything the
 * journal existed to protect.
 */
export async function readJournal(store: FileStore): Promise<JournalRecord[]> {
  const raw = await store.read(JOURNAL_PATH);
  if (raw === null) return [];

  const records: JournalRecord[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === "object" && parsed !== null && "glyph" in parsed) {
        records.push(parsed as JournalRecord);
      }
    } catch {
      // Half-written line; everything before it still stands.
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// loading
// ---------------------------------------------------------------------------

export type LoadResult =
  | { readonly kind: "empty" }
  | {
      readonly kind: "loaded";
      readonly document: FontDocument;
      /** True when the journal held edits newer than the saved files. */
      readonly recovered: boolean;
      /** Files that could not be read, with the reason. Never fatal. */
      readonly problems: readonly string[];
    };

/**
 * Read the project back, applying any journal on top.
 *
 * Journal records are newer than the files by construction — they are written at
 * commit and cleared only once a save lands — so they win.
 *
 * A glyph that fails to decode is reported and skipped rather than aborting the
 * load. Losing one glyph to a corrupt file is bad; losing the project because
 * one glyph is corrupt is worse.
 */
export async function loadDocument(store: FileStore): Promise<LoadResult> {
  const problems: string[] = [];
  const glyphs = new Map<string, Glyph>();

  for (const path of await store.list(GLYPHS_PREFIX)) {
    const raw = await store.read(path);
    if (raw === null) continue;
    const decoded = decodeFile(raw);
    if (decoded.ok) glyphs.set(decoded.value.name, decoded.value);
    else problems.push(`${path}: ${decoded.reason}`);
  }

  let recovered = false;
  for (const record of await readJournal(store)) {
    const decoded = decodeGlyph(record.glyph);
    if (decoded.ok) {
      glyphs.set(decoded.value.name, decoded.value);
      recovered = true;
    } else {
      problems.push(`${JOURNAL_PATH}: ${decoded.reason}`);
    }
  }

  const first = [...glyphs.values()][0];
  if (first === undefined) return { kind: "empty" };

  return { kind: "loaded", document: fontDocument(first), recovered, problems };
}

function decodeFile(raw: string): ReturnType<typeof decodeGlyph> {
  try {
    return decodeGlyph(JSON.parse(raw) as unknown);
  } catch {
    return { ok: false, reason: "file is not valid JSON" };
  }
}

/** Remove everything. Used by "start over", and by tests. */
export async function wipe(store: FileStore): Promise<void> {
  for (const path of await store.list("")) await store.remove(path);
}

export { SCHEMA_VERSION };
