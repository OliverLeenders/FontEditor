import type { FontDocument, Glyph } from "@typewright/font-model";
import {
  DEFAULT_FONT_INFO,
  fontDocument,
  glyphFileName,
  setGlyphOrder,
  setFeatures,
  setGuides,
  setKept,
  setKerning,
  setLayers,
} from "@typewright/font-model";

import { type FileStore, type ReadProgress, readAll } from "./file-store.js";
import { isGenerational } from "./generations.js";
import { inParallel } from "./parallel.js";

import {
  type StoredGlyph,
  SCHEMA_VERSION,
  decodeFontInfo,
  decodeGlyph,
  encodeFontInfo,
  encodeGlyph,
  encodeKerning,
  decodeKerning,
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
/**
 * Kerning gets its own file, as it does in a UFO.
 *
 * It is font-level data like the index, but it grows with the square of the
 * alphabet where the index grows with the alphabet — so folding it into
 * fontinfo would mean rewriting every pair each time a glyph is renamed or
 * reordered.
 */
export const KERNING_PATH = "kerning.json";
/**
 * Which master the glyphs here are, by its id.
 *
 * A font drawn more than once keeps one master in these files and the rest
 * parked, and the designspace beside them says which is open. The two are
 * written apart — every glyph, and then the designspace — so stopping between
 * them left the designspace naming one master over another's drawing, which the
 * next switch then parked under the wrong name. This is written with the glyphs
 * it describes, as one of the font's own files, so that it is never out of step
 * with them; a reader believes it over the designspace.
 *
 * Absent for a font with nothing to tell apart, and in every working copy from
 * before it existed.
 */
export const MASTER_PATH = "master.txt";

/** The master a working copy says its glyphs are, or `null` where it does not say. */
export async function readHeldMaster(store: FileStore): Promise<string | null> {
  const raw = await store.read(MASTER_PATH);
  const id = raw === null ? "" : raw.trim();
  return id === "" ? null : id;
}

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
  const changed: Glyph[] = [];
  for (const name of next.glyphOrder) {
    const glyph = next.glyphs[name];
    if (glyph === undefined) continue;
    if (previous === null || previous.glyphs[name] !== glyph) changed.push(glyph);
  }
  return changed;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

/** Glyph files that should no longer exist, because the glyph was removed. */
export function removedGlyphs(previous: FontDocument | null, next: FontDocument): string[] {
  if (previous === null) return [];
  return previous.glyphOrder.filter((name) => !(name in next.glyphs));
}

// ---------------------------------------------------------------------------
// saving
// ---------------------------------------------------------------------------

export type SaveReport = {
  readonly written: readonly string[];
};

export async function saveGlyphs(store: FileStore, glyphs: readonly Glyph[]): Promise<SaveReport> {
  // A few at a time rather than one: importing a font writes every glyph it
  // has, and a thousand awaited round trips end to end is most of the time it
  // takes to open one.
  const written = await inParallel(glyphs, async (g) => {
    const path = glyphPath(g.name);
    await store.write(path, JSON.stringify(encodeGlyph(g)));
    return path;
  });
  return { written };
}

export async function saveDocument(
  store: FileStore,
  document: FontDocument,
  previous: FontDocument | null = null,
): Promise<SaveReport> {
  const changed = dirtyGlyphs(previous, document);
  const report = await saveGlyphs(store, changed);

  await inParallel(removedGlyphs(previous, document), (name) => store.remove(glyphPath(name)));

  // The index is small and cheap; rewriting it whenever anything moved keeps it
  // honest about which glyphs exist and in what order.
  const orderChanged = previous === null || !sameOrder(previous.glyphOrder, document.glyphOrder);
  // The grid and the fixed width are written into the same file as the info.
  const infoChanged =
    previous === null ||
    previous.info !== document.info ||
    previous.grid !== document.grid ||
    previous.fixedWidth !== document.fixedWidth ||
    previous.nameLigatures !== document.nameLigatures;
  if (changed.length > 0 || orderChanged || infoChanged) {
    await store.write(FONT_INFO_PATH, JSON.stringify(encodeFontInfo(document)));
  }

  // Reference equality again: kerning is persistent, so an untouched table is
  // the same object and costs nothing to skip.
  if (previous === null || previous.kerning !== document.kerning) {
    await store.write(KERNING_PATH, JSON.stringify(encodeKerning(document.kerning)));
  }
  return report;
}

/**
 * Write a whole document, replacing whatever the project held.
 *
 * What an import needs, and deliberately not `saveDocument` with a `null`
 * previous: that would write every glyph but leave the *old* font's glyph files
 * sitting in the directory, to be loaded back on the next launch as though they
 * belonged to the new font.
 *
 * New glyphs are written before old ones are removed. The reverse order — clear
 * then fill — leaves a window in which a crash loses the project entirely,
 * whereas this leaves at worst a few stale files that the next import clears
 * anyway. The journal is dropped last, once the document it described is
 * definitively superseded.
 */
export async function replaceDocument(
  store: FileStore,
  document: FontDocument,
  /** The master this document is, where the font has several: see {@link MASTER_PATH}. */
  master: string | null = null,
): Promise<{ readonly written: number; readonly removed: number }> {
  // Kept in generations, the new font is written beside the old one and takes
  // its place in one step: see `generations.ts`. Nothing of the old font is
  // left to remove, and the journal belonged to it.
  if (isGenerational(store)) {
    const before = (await store.list(GLYPHS_PREFIX)).length;
    let written = 0;
    await store.replace(async (next) => {
      written = (await writeWhole(next, document, master)).length;
    });
    return { written, removed: Math.max(0, before - written) };
  }

  const wanted = document.glyphOrder
    .map((name) => document.glyphs[name])
    .filter((g): g is Glyph => g !== undefined);
  const keep = new Set(
    await inParallel(wanted, async (g) => {
      const path = glyphPath(g.name);
      await store.write(path, JSON.stringify(encodeGlyph(g)));
      return path;
    }),
  );

  const stale = (await store.list(GLYPHS_PREFIX)).filter((path) => !keep.has(path));
  await inParallel(stale, (path) => store.remove(path));
  const removed = stale.length;

  await store.write(FONT_INFO_PATH, JSON.stringify(encodeFontInfo(document)));
  await store.write(KERNING_PATH, JSON.stringify(encodeKerning(document.kerning)));
  if (master === null) await store.remove(MASTER_PATH);
  else await store.write(MASTER_PATH, master);
  await clearJournal(store);
  return { written: keep.size, removed };
}

/** Every file of a font into a store that has none of them yet: its glyphs, its info, its kerning. */
async function writeWhole(
  store: FileStore,
  document: FontDocument,
  master: string | null,
): Promise<string[]> {
  const wanted = document.glyphOrder
    .map((name) => document.glyphs[name])
    .filter((g): g is Glyph => g !== undefined);
  const paths = await inParallel(wanted, async (g) => {
    const path = glyphPath(g.name);
    await store.write(path, JSON.stringify(encodeGlyph(g)));
    return path;
  });
  await store.write(FONT_INFO_PATH, JSON.stringify(encodeFontInfo(document)));
  await store.write(KERNING_PATH, JSON.stringify(encodeKerning(document.kerning)));
  if (master !== null) await store.write(MASTER_PATH, master);
  return paths;
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
 *
 * A record is a commit: the glyphs it changed, as it left them, and the names
 * of the ones it took away. The names are what make the journal true of a font
 * rather than of its glyphs one by one — without them a glyph removed, renamed,
 * or added and then undone could only be journalled as the glyph it had been,
 * and reading the journal back brought it back. And a commit is one record, one
 * line, because it is one thing: a rename written as a name gone and then a
 * glyph arrived, and stopped between the two, was a glyph under neither name.
 * A line cut off as it was written is not read, so a commit is in the journal
 * whole or is not in it.
 *
 * The first kind, a single glyph, is what every journal held before this, and
 * is still read.
 */
export type JournalRecord =
  | { readonly at: number; readonly glyph: StoredGlyph }
  | {
      readonly at: number;
      readonly glyphs: readonly StoredGlyph[];
      readonly removed: readonly string[];
      /**
       * The order the glyphs are in after this commit, where it changed them:
       * a glyph added, removed, renamed or moved. The saved order is in the
       * font's information, which the journal does not hold, and read back
       * without this a glyph renamed came back at the end of the font.
       */
      readonly order?: readonly string[];
    };

export async function appendJournal(store: FileStore, glyph: Glyph, at: number): Promise<void> {
  const record: JournalRecord = { at, glyph: encodeGlyph(glyph) };
  await store.append(JOURNAL_PATH, `${JSON.stringify(record)}\n`);
}

/** Note a commit in the journal: the glyphs it changed, and the ones it took away. */
export async function appendJournalCommit(
  store: FileStore,
  glyphs: readonly Glyph[],
  removed: readonly string[],
  at: number,
  /** The order of the glyphs after the commit, where it changed it. */
  order: readonly string[] | null = null,
): Promise<void> {
  const record: JournalRecord = {
    at,
    glyphs: glyphs.map(encodeGlyph),
    removed,
    ...(order === null ? {} : { order }),
  };
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
      if (typeof parsed !== "object" || parsed === null) continue;
      const commit = parsed as { glyphs?: unknown; removed?: unknown };
      if ("glyph" in parsed || (Array.isArray(commit.glyphs) && Array.isArray(commit.removed))) {
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
      /**
       * Glyphs the journal says were removed, whose files may still be there.
       *
       * The document does not have them; the folder does until something
       * takes them out, and a save that only writes what changed never would.
       */
      readonly gone: readonly string[];
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
export async function loadDocument(store: FileStore, progress?: ReadProgress): Promise<LoadResult> {
  const problems: string[] = [];
  const glyphs = new Map<string, Glyph>();

  // Read several at a time, and fold the results in afterwards in the order
  // the paths came in: which glyph wins a name collision and which problem is
  // reported first must not depend on which read finished first.
  const files = await readAll(store, GLYPHS_PREFIX, progress);

  for (const { path, raw } of files) {
    const decoded = decodeFile(raw);
    if (decoded.ok) glyphs.set(decoded.value.name, decoded.value);
    else problems.push(`${path}: ${decoded.reason}`);
  }

  let recovered = false;
  // Glyphs the journal took away, and did not put back afterwards: their files
  // are still there, and are for whoever saves this to take out.
  const gone = new Set<string>();
  // The order of the glyphs as the last commit to change it left it.
  let journalled: readonly string[] | null = null;
  for (const record of await readJournal(store)) {
    if ("glyphs" in record && Array.isArray(record.order)) journalled = record.order;
    // What it took away first, then what it left: a glyph renamed is its old
    // name gone and its new one arrived, in one commit.
    for (const name of "glyphs" in record ? record.removed : []) {
      glyphs.delete(name);
      gone.add(name);
      recovered = true;
    }
    for (const stored of "glyphs" in record ? record.glyphs : [record.glyph]) {
      const decoded = decodeGlyph(stored);
      if (decoded.ok) {
        glyphs.set(decoded.value.name, decoded.value);
        gone.delete(decoded.value.name);
        recovered = true;
      } else {
        problems.push(`${JOURNAL_PATH}: ${decoded.reason}`);
      }
    }
  }

  if (glyphs.size === 0) return { kind: "empty" };

  // The saved order wins where it is known; anything the index does not mention
  // is appended, so a glyph file that appeared without the index being rewritten
  // still shows up rather than vanishing.
  const rawInfo = await store.read(FONT_INFO_PATH);
  const { info, glyphOrder, features, guides, kept, layers, grid, fixedWidth, nameLigatures } =
    decodeFontInfo(parseOrNull(rawInfo));
  const kerning = decodeKerning(parseOrNull(await store.read(KERNING_PATH)));

  const ordered: Glyph[] = [];
  const seen = new Set<string>();
  for (const name of journalled ?? glyphOrder) {
    const g = glyphs.get(name);
    if (g !== undefined && !seen.has(name)) {
      ordered.push(g);
      seen.add(name);
    }
  }
  for (const [name, g] of glyphs) {
    if (!seen.has(name)) ordered.push(g);
  }

  const document = setLayers(
    setKept(
      setGuides(
        setFeatures(
          setKerning(
            setGlyphOrder(
              { ...fontDocument(ordered, info), grid, fixedWidth, nameLigatures },
              ordered.map((g) => g.name),
            ),
            kerning,
          ),
          features,
        ),
        guides,
      ),
      kept,
    ),
    layers,
  );
  return { kind: "loaded", document, recovered, problems, gone: [...gone] };
}

function parseOrNull(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
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
  await inParallel(await store.list(""), (path) => store.remove(path));
  if (isGenerational(store)) store.emptied();
}

export { DEFAULT_FONT_INFO, SCHEMA_VERSION };
