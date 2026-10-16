import {
  DEFAULT_LAYER_DIRECTORY,
  type ZipEntry,
  type ZipFile,
  crc32,
  defaultLayer,
  entryBytes,
} from "@typewright/font-io";

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

/** How many files of a folder are read at once. */
const READS_AT_ONCE = 32;

/**
 * How many glyph files are written at once.
 *
 * Writing a file on a disk of somebody's own is slow in a way that has nothing
 * to do with its size: the browser writes it beside the real one, checks it,
 * and moves it into place, and the operating system's scanner looks at it as
 * it lands. About a tenth of a second a file, on a Windows machine in Chrome —
 * and one after another, a font of four thousand glyphs was seven minutes of
 * that. Most of the tenth of a second is waiting, and waits overlap.
 */
const WRITES_AT_ONCE = 16;

/**
 * Read every file under a folder, as `unzip` would have returned them.
 *
 * Listed first and read afterwards, several at a time: a font of four thousand
 * glyphs is four thousand files, and read one after another each waits on the
 * one before for nothing. The files come back in the order the folder lists
 * them, whichever read finished first. `progress` is told how many have been
 * read so far, of how many.
 */
export async function readFolder(
  folder: DiskFolder,
  progress?: (done: number, total: number) => void,
): Promise<ZipFile[]> {
  const found: { path: string; file: DiskFile }[] = [];
  await walk(folder, "", 0, found);

  const out = new Array<ZipFile>(found.length);
  let next = 0;
  let done = 0;
  const reader = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      const entry = found[i];
      if (entry === undefined) return;
      const file = await entry.file.getFile();
      out[i] = { path: entry.path, bytes: new Uint8Array(await file.arrayBuffer()) };
      done += 1;
      if (done % READS_AT_ONCE === 0) progress?.(done, found.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(READS_AT_ONCE, found.length) }, reader));
  progress?.(found.length, found.length);
  return out;
}

async function walk(
  folder: DiskFolder,
  prefix: string,
  depth: number,
  out: { path: string; file: DiskFile }[],
): Promise<void> {
  if (depth > MAX_DEPTH) throw new Error(`this folder is more than ${String(MAX_DEPTH)} deep`);

  for await (const [name, entry] of folder.entries()) {
    const path = `${prefix}${name}`;
    if (entry.kind === "directory") await walk(entry, `${path}/`, depth + 1, out);
    else out.push({ path, file: entry });
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
   * What every file now holds, for the next save to compare against.
   *
   * The caller keeps it and hands it back. Kept by the caller rather than read
   * off the disk because reading a file to find out whether it needs writing
   * costs as much as writing it — and because this is a record of what *we*
   * put there, which is the thing worth comparing against.
   */
  readonly wrote: ReadonlyMap<string, WrittenFile>;
};

/** What one file held when this editor last wrote it, and when that was. */
export type WrittenFile = {
  /** A checksum of the contents, which is what says whether to write again. */
  readonly crc: number;
  /**
   * The file's modified time as the filesystem reported it just afterwards.
   *
   * Not for comparing contents — the checksum does that — but for telling
   * whether anything *else* has touched the file since. Within a session
   * nothing has, and asking would cost a read per file for an answer that is
   * always the same; across a restart it is the only way to know.
   */
  readonly at: number;
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
  readonly known?: ReadonlyMap<string, WrittenFile> | undefined;
  /**
   * Check that nothing else has touched a file before skipping it.
   *
   * For a record made in an earlier session. Within one, this editor is the
   * only thing that has written to the folder and the checksum is enough; after
   * a restart the record describes a folder nobody has looked at since, and a
   * source somebody edited in another program would be skipped and silently
   * left disagreeing with what the editor believes it wrote.
   *
   * It costs one question per file about when it changed — far less than
   * writing it, and far less than reading it.
   */
  readonly verify?: boolean | undefined;
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
 * layer it was not told of, a designspace beside it. The rule is: only `.glif`
 * files, only in a layer this save writes the list of, and only ones that
 * layer's `contents.plist` listed before. A glyph that was deleted in the
 * editor therefore stops existing on disk — in the layer it was deleted from,
 * the drawing or a sketch behind it — and a file we never claimed to own is
 * never touched.
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

  // Read before writing: all of these are files we are about to overwrite.
  // Each layer this save writes the list of, with the glyph files that list
  // named before: the drawing, and every other layer the font has.
  const before = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (!entry.path.endsWith("/contents.plist")) continue;
    const directory = entry.path.slice(0, -"/contents.plist".length);
    if (directory.includes("/")) continue;
    before.set(directory, glifsListed(await textAt(folder, entry.path)));
  }
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
  const sums = new Map<string, number>();
  const wanted: ZipEntry[] = [];
  for (const entry of entries) {
    const sum = crc32(entryBytes(entry));
    sums.set(entry.path, sum);

    const before = options.known?.get(entry.path);
    if (before === undefined || before.crc !== sum) {
      wanted.push(entry);
      continue;
    }
    // The contents match what we wrote. Whether the file is still what we wrote
    // is a different question, and one only worth asking across a restart.
    if (options.verify === true && !(await untouched(folder, entry.path, before.at))) {
      wanted.push(entry);
      notes.push(`${entry.path} had changed since the last save, and was written over`);
    }
  }

  const wrote = new Map<string, WrittenFile>();
  for (const [path, crc] of sums) {
    const before = options.known?.get(path);
    if (before !== undefined && before.crc === crc) wrote.set(path, before);
  }

  let done = 0;
  options.onProgress?.(0, wanted.length);
  const folders = new Folders(folder);
  const one = async (entry: ZipEntry): Promise<void> => {
    await writeFile(folders, entry.path, entryBytes(entry));
    done += 1;
    options.onProgress?.(done, wanted.length);
    wrote.set(entry.path, {
      crc: sums.get(entry.path) ?? 0,
      at: await modifiedAt(folders, entry.path),
    });
  };
  // Glyph files several at a time, and everything else on its own, in the
  // order it came: a run of glyphs is written whole before the file after it
  // is begun, so whatever order the files are handed in is the order they are
  // on disk in, as it was when they were written one by one.
  let run: ZipEntry[] = [];
  const flush = async (): Promise<void> => {
    const queue = run;
    run = [];
    let next = 0;
    const worker = async (): Promise<void> => {
      for (let entry = queue[next++]; entry !== undefined; entry = queue[next++]) await one(entry);
    };
    await Promise.all(Array.from({ length: Math.min(WRITES_AT_ONCE, queue.length) }, worker));
  };
  for (const entry of wanted) {
    if (entry.path.endsWith(".glif")) {
      run.push(entry);
      continue;
    }
    await flush();
    await one(entry);
  }
  await flush();

  const now = new Set(entries.map((e) => e.path));

  const removed: string[] = [];
  for (const [directory, listed] of before) {
    const gone = [...listed].filter((file) => !now.has(`${directory}/${file}`));
    if (gone.length === 0) continue;
    const within = await folder.getDirectoryHandle(directory);
    for (const file of gone) {
      try {
        await within.removeEntry(file);
        // Named as it always was for the drawing, and by its layer for another.
        removed.push(directory === "glyphs" ? file : `${directory}/${file}`);
      } catch {
        // Already gone, or the folder said no. Neither is worth failing a save
        // that has otherwise written every glyph.
        notes.push(`could not remove ${directory}/${file}`);
      }
    }
  }

  return { written: wanted.length, skipped: entries.length - wanted.length, removed, notes, wrote };
}

/**
 * When a file last changed, or now if the filesystem will not say.
 *
 * "Now" is the forgiving answer: it means the next save trusts the checksum,
 * which is what a filesystem with no timestamps leaves us with anyway.
 */
async function modifiedAt(folders: Folders, path: string): Promise<number> {
  const file = await folders.file(path);
  return file?.lastModified ?? Date.now();
}

/**
 * The folders under the one being written, each looked up once.
 *
 * Every glyph file is in `glyphs/`, and looking it up again for each of four
 * thousand of them — twice, once to write and once to ask when it was written
 * — was eight thousand round trips to the browser for one folder.
 */
class Folders {
  private readonly found = new Map<string, Promise<DiskFolder>>();

  constructor(private readonly root: DiskFolder) {}

  /** The folder a path is in, made where it is not there yet. */
  async of(path: string): Promise<{ readonly folder: DiskFolder; readonly name: string }> {
    const parts = path.split("/");
    const name = parts.pop();
    if (name === undefined || name === "") throw new Error(`not a file path: ${path}`);
    return { folder: await this.made(parts), name };
  }

  /** Look up the folders on the way to a path again, next time they are asked for. */
  forget(path: string): void {
    const parts = path.split("/").slice(0, -1);
    for (let k = parts.length; k > 0; k--) this.found.delete(parts.slice(0, k).join("/"));
  }

  /** A file as it is now, or `null` where it is not there or will not say. */
  async file(path: string): Promise<{ readonly lastModified: number } | null> {
    try {
      const { folder, name } = await this.of(path);
      return await (await folder.getFileHandle(name)).getFile();
    } catch {
      return null;
    }
  }

  private made(parts: readonly string[]): Promise<DiskFolder> {
    if (parts.length === 0) return Promise.resolve(this.root);
    const key = parts.join("/");
    let found = this.found.get(key);
    if (found === undefined) {
      // Kept as the promise, so two files asking at once look it up once.
      found = this.made(parts.slice(0, -1)).then((parent) =>
        parent.getDirectoryHandle(parts[parts.length - 1] ?? "", { create: true }),
      );
      found.catch(() => this.found.delete(key));
      this.found.set(key, found);
    }
    return found;
  }
}

/** Whether a file is still the one we wrote, by when it last changed. */
async function untouched(folder: DiskFolder, path: string, at: number): Promise<boolean> {
  const file = await fileAt(folder, path);
  // Gone is not untouched. A file the record knows and the folder does not is
  // one somebody deleted, and it has to be written again.
  if (file === null) return false;
  return file.lastModified <= at;
}

/** One file's handle, followed through the directories, or `null`. */
async function fileAt(
  folder: DiskFolder,
  path: string,
): Promise<{ readonly lastModified: number } | null> {
  const parts = path.split("/");
  const name = parts.pop();
  if (name === undefined) return null;

  try {
    let at = folder;
    for (const part of parts) at = await at.getDirectoryHandle(part);
    return await (await at.getFileHandle(name)).getFile();
  } catch {
    // Not there, or the folder said no. Either way there is nothing to compare.
    return null;
  }
}

/**
 * Write one file, making the directories on the way to it.
 *
 * Tried again where the disk says no, a moment later and with the folder looked
 * up afresh. A save of four thousand glyphs to a folder on Windows was seen to
 * fail part way with Chrome's "an operation that depends on state cached in an
 * interface object", after sixteen files at a time were written. What refused
 * it is not known yet — something holding a file that has just landed, the
 * virus scanner or an indexer, is the likeliest — and a write that is refused
 * once is worth trying again rather than failing a save of thousands for. Said
 * with the file's name where it is refused every time, so there is something
 * to go on.
 */
async function writeFile(folders: Folders, path: string, data: Uint8Array): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      const { folder: at, name } = await folders.of(path);
      const handle = await at.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
      return;
    } catch (error) {
      // Only a refusal that may pass: a folder that has gone, or that may not
      // be written to at all, says so again however often it is asked.
      if (attempt >= WRITE_ATTEMPTS || !mayPass(error)) {
        const why = error instanceof Error ? error.message : String(error);
        throw new Error(`${path} could not be written: ${why}`, { cause: error });
      }
      folders.forget(path);
      await new Promise((wake) => setTimeout(wake, RETRY_AFTER * attempt));
    }
  }
}

/**
 * Whether a write was refused in a way that may not happen next time: the file
 * held by something else as it was written over, which Chrome says as a state
 * that changed, or as a file that may not be changed just now.
 */
function mayPass(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "InvalidStateError" || name === "NoModificationAllowedError";
}

/** How many times a file is tried before the save is said to have failed. */
const WRITE_ATTEMPTS = 4;
/** How long to wait before trying a file again, in milliseconds, more each time. */
const RETRY_AFTER = 150;

/** The text of a file, or `null` if it is not there. */
export async function textAt(folder: DiskFolder, path: string): Promise<string | null> {
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
