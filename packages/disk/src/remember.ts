import { HANDLES, databaseExists, inDatabase, inStore } from "./database.js";
import type { WrittenFile } from "./folder.js";
import type { DiskFolder } from "./handles.js";

/**
 * Remembering which folder the font came from.
 *
 * A handle survives a reload, which is the surprising and useful part: it is
 * not a path string but a live capability, and IndexedDB is the only place that
 * will keep one (`localStorage` holds strings, and a handle is not one). What
 * does *not* survive is permission — see `access.ts` — so this remembers where
 * the font is, and the user still has to say yes once per session.
 *
 * One handle, for the font last worked in. Where several fonts are concerned
 * this is the shortcut rather than the record: `projects.ts` keeps one of these
 * per font, with the working copy and the lock that go with it. This stays
 * because the question "which font was I in?" has a cheaper answer than reading
 * the whole list, and because it is what the editor before projects wrote.
 */

/** The database this used before the editor was named. */
const OLD_DATABASE = "fonteditor-disk";

const KEY = "ufo-folder";

/** What was remembered, alongside how to say it to the user. */
export type RememberedFolder = {
  readonly folder: DiskFolder;
  /** The folder's name when it was chosen, for showing before permission. */
  readonly name: string;
  readonly at: number;
  /**
   * What the last save left in it, so the next session's first save is not a
   * rewrite of the whole font.
   *
   * Empty for a folder remembered before this was kept, and for one that has
   * been opened but not yet written to — in both cases the next save writes
   * everything, which is the right answer when nothing is known.
   *
   * A plain array of pairs rather than a `Map`: what goes into IndexedDB is
   * structured-cloned, and while a `Map` survives that, an array is the shape
   * that will still read the same if this is ever written by anything else.
   */
  readonly wrote: readonly (readonly [string, WrittenFile])[];
};

export async function rememberFolder(
  folder: DiskFolder,
  wrote: ReadonlyMap<string, WrittenFile> = new Map(),
): Promise<void> {
  const remembered: RememberedFolder = {
    folder,
    name: folder.name,
    at: Date.now(),
    wrote: [...wrote],
  };
  await inStore(HANDLES, "readwrite", (store) => store.put(remembered, KEY));
}

export async function recallFolder(): Promise<RememberedFolder | null> {
  const here = await inStore(HANDLES, "readonly", (store) => store.get(KEY));
  const found = here ?? (await fromOldDatabase());
  if (found === null || typeof found !== "object") return null;

  // Written by an older version of this editor, or by something else entirely.
  const candidate = found as Partial<RememberedFolder>;
  if (candidate.folder === undefined || typeof candidate.name !== "string") return null;

  const remembered: RememberedFolder = {
    folder: candidate.folder,
    name: candidate.name,
    at: candidate.at ?? 0,
    wrote: Array.isArray(candidate.wrote) ? candidate.wrote.filter(isWritten) : [],
  };

  // Found under the old name: move it, so this is asked once and never again.
  // If the write fails the folder is still returned — being remembered this
  // session matters more than being remembered next session.
  if (here === null) await inStore(HANDLES, "readwrite", (store) => store.put(remembered, KEY));

  return remembered;
}

/**
 * What the editor remembered under its old name, if it ever ran under it.
 *
 * Asks the browser which databases exist before opening one, because opening a
 * database creates it: without the question, every fresh installation would
 * leave behind an empty database named after a program that never ran here.
 */
async function fromOldDatabase(): Promise<unknown> {
  if (!(await databaseExists(OLD_DATABASE))) return null;

  return await inDatabase({
    database: OLD_DATABASE,
    version: 1,
    store: HANDLES,
    mode: "readonly",
    run: (store) => store.get(KEY),
  });
}

/** Believe nothing about what is in the database: it may be older than this. */
function isWritten(entry: unknown): entry is readonly [string, WrittenFile] {
  if (!Array.isArray(entry) || entry.length !== 2) return false;
  const [path, file] = entry as [unknown, unknown];
  if (typeof path !== "string" || typeof file !== "object" || file === null) return false;

  const written = file as Partial<WrittenFile>;
  return typeof written.crc === "number" && typeof written.at === "number";
}

export async function forgetFolder(): Promise<void> {
  await inStore(HANDLES, "readwrite", (store) => store.delete(KEY));
}
