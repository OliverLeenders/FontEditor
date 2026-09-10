import {
  DEFAULT_LAYER_DIRECTORY,
  type ZipEntry,
  type ZipFile,
  crc32,
  defaultLayer,
  entryBytes,
} from "@fonteditor/font-io";

import type { DiskFile, DiskFolder } from "./handles.js";

/**
 * A UFO as a folder rather than an archive.
 *
 * Everything else in this editor treats a UFO as a zip, because until now a
 * browser could only be handed a file. A folder the user picked is the format
 * in its own shape: reading is walking it, writing is putting the same files
 * `exportUfo` would have zipped into it, one by one.
 *
 * The reading half hands back exactly what `unzip` would have — a flat list of
 * paths and bytes — so `readUfo` cannot tell the two apart and there is one
 * reader for the format rather than two.
 */

/**
 * How far down a folder is followed.
 *
 * A UFO is two levels deep and a picked folder is not supposed to be a whole
 * disk. The limit is not a security measure — the user chose the folder — but
 * it turns "you pointed at your home directory" into an error instead of a
 * hang.
 */
export const MAX_DEPTH = 6;

/** Read every file under a folder, as `unzip` would have returned them. */
export async function readFolder(folder: DiskFolder): Promise<ZipFile[]> {
  const out: ZipFile[] = [];
  await walk(folder, "", 0, out);
  return out;
}

async function walk(
  folder: DiskFolder,
  prefix: string,
  depth: number,
  out: ZipFile[],
): Promise<void> {
  if (depth > MAX_DEPTH) throw new Error(`this folder is more than ${String(MAX_DEPTH)} deep`);

  for await (const [name, entry] of folder.entries()) {
    const path = `${prefix}${name}`;
    if (entry.kind === "directory") {
      await walk(entry, `${path}/`, depth + 1, out);
      continue;
    }
    const file = await entry.getFile();
    out.push({ path, bytes: new Uint8Array(await file.arrayBuffer()) });
  }
}

/** What writing a font to a folder did, and what it deliberately left alone. */
export type WriteReport = {
  readonly written: number;
  /** Files that are already what they would have been written as. */
  readonly skipped: number;
  /** Glyph files that were there before and are not part of the font now. */
  readonly removed: readonly string[];
  /** Things the user should know were left as they were. */
  readonly notes: readonly string[];
  /**
   * What every file now holds, as a checksum, for the next save to compare.
   *
   * The caller keeps it and hands it back. Kept by the caller rather than read
   * off the disk because reading a file to find out whether it needs writing
   * costs as much as writing it — and because this is a record of what *we*
   * put there, which is the thing worth comparing against.
   */
  readonly wrote: ReadonlyMap<string, number>;
};

export type WriteOptions = {
  /**
   * What the last save left in this folder, from its report.
   *
   * A file whose contents would be identical is not written again. That is
   * nearly all of them: a UFO is one file per glyph, and moving one point
   * changes one of the three hundred. Without this, saving after any edit
   * rewrites the whole font a file at a time — which is slow enough on a real
   * font to look like the editor has stopped.
   *
   * Absent for the first save after a folder is opened, which writes
   * everything: what is on disk is somebody else's, and only what we wrote
   * ourselves can be assumed to be what we think it is.
   */
  readonly known?: ReadonlyMap<string, number> | undefined;
  /**
   * Called as each file lands, with how many are done and how many there are.
   *
   * A count rather than a fraction: the writer knows exactly how many files it
   * will write, and a number that moves is proof that something is happening
   * where a bar of unknown length is not.
   */
  readonly onProgress?: ((done: number, total: number) => void) | undefined;
};

/**
 * Write a font's files into a folder, and tidy up the glyphs it no longer has.
 *
 * Deleting is the part that needs a rule, because the folder is the user's and
 * may hold things this editor knows nothing about — a `data` directory, a
 * second layer, a designspace beside it. The rule is: only `.glif` files, only
 * in the default layer, and only ones the *previous* save listed in
 * `contents.plist`. A glyph that was deleted in the editor therefore stops
 * existing on disk, and a file we never claimed to own is never touched.
 *
 * Anything else that looks stale is reported rather than removed. A note the
 * user can act on is worth more than a deletion they did not ask for.
 */
export async function writeFolder(
  folder: DiskFolder,
  entries: readonly ZipEntry[],
  options: WriteOptions = {},
): Promise<WriteReport> {
  const notes: string[] = [];

  // Read before writing: both of these are files we are about to overwrite.
  const before = glifsListed(await textAt(folder, "glyphs/contents.plist"));
  const layer = defaultLayer(await textAt(folder, "layercontents.plist"));
  if (layer !== DEFAULT_LAYER_DIRECTORY) {
    notes.push(
      `the font's default layer was ${layer}; the glyphs are in glyphs/ now, and ${layer}/ ` +
        `is still on disk but no longer listed in layercontents.plist`,
    );
  }

  // What each file will hold, worked out before anything is written: the
  // comparison is against what the last save put there, and the answer is also
  // what this save hands back for the next one to compare against.
  const wrote = new Map<string, number>();
  const wanted: ZipEntry[] = [];
  for (const entry of entries) {
    const sum = crc32(entryBytes(entry));
    wrote.set(entry.path, sum);
    if (options.known?.get(entry.path) !== sum) wanted.push(entry);
  }

  let done = 0;
  options.onProgress?.(0, wanted.length);
  for (const entry of wanted) {
    await writeFile(folder, entry.path, entryBytes(entry));
    done += 1;
    options.onProgress?.(done, wanted.length);
  }

  const now = new Set(
    entries
      .filter((e) => e.path.startsWith("glyphs/") && e.path.endsWith(".glif"))
      .map((e) => e.path.slice("glyphs/".length)),
  );

  const removed: string[] = [];
  if (before.size > 0) {
    const glyphs = await folder.getDirectoryHandle("glyphs");
    for (const file of before) {
      if (now.has(file)) continue;
      try {
        await glyphs.removeEntry(file);
        removed.push(file);
      } catch {
        // Already gone, or the folder said no. Neither is worth failing a save
        // that has otherwise written every glyph.
        notes.push(`could not remove glyphs/${file}`);
      }
    }
  }

  return { written: wanted.length, skipped: entries.length - wanted.length, removed, notes, wrote };
}

/** Write one file, making the directories on the way to it. */
async function writeFile(folder: DiskFolder, path: string, data: Uint8Array): Promise<void> {
  const parts = path.split("/");
  const name = parts.pop();
  if (name === undefined || name === "") throw new Error(`not a file path: ${path}`);

  let at = folder;
  for (const part of parts) at = await at.getDirectoryHandle(part, { create: true });

  const handle = await at.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

/** The text of a file, or `null` if it is not there. */
async function textAt(folder: DiskFolder, path: string): Promise<string | null> {
  const parts = path.split("/");
  const name = parts.pop();
  if (name === undefined) return null;

  let at: DiskFolder = folder;
  try {
    for (const part of parts) at = await at.getDirectoryHandle(part);
    const handle: DiskFile = await at.getFileHandle(name);
    const file = await handle.getFile();
    return new TextDecoder().decode(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return null;
  }
}

/**
 * The glyph files a `contents.plist` names.
 *
 * Read with a pattern rather than the plist parser because the question is not
 * what the dictionary means — it is which files on disk the last save claimed.
 * Every value in that dictionary is a filename, so matching the values that end
 * in `.glif` answers it exactly, and a plist too damaged to parse still gives
 * up the names it holds.
 */
function glifsListed(source: string | null): Set<string> {
  const out = new Set<string>();
  if (source === null) return out;
  for (const match of source.matchAll(/<string>([^<]+\.glif)<\/string>/g)) {
    const name = match[1];
    if (name !== undefined && !name.includes("/")) out.add(name);
  }
  return out;
}
