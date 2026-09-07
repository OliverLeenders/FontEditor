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
 * Deliberately small and deliberately forgiving: a browser with IndexedDB
 * disabled, or a private window, should mean "the editor forgets where the font
 * was", never "the editor will not start".
 */

const DATABASE = "fonteditor-disk";
const STORE = "handles";
const KEY = "ufo-folder";

/** What was remembered, alongside how to say it to the user. */
export type RememberedFolder = {
  readonly folder: DiskFolder;
  /** The folder's name when it was chosen, for showing before permission. */
  readonly name: string;
  readonly at: number;
};

export async function rememberFolder(folder: DiskFolder): Promise<void> {
  const remembered: RememberedFolder = { folder, name: folder.name, at: Date.now() };
  await inStore("readwrite", (store) => store.put(remembered, KEY));
}

export async function recallFolder(): Promise<RememberedFolder | null> {
  const found = await inStore("readonly", (store) => store.get(KEY));
  if (found === null || typeof found !== "object") return null;

  // Written by an older version of this editor, or by something else entirely.
  const candidate = found as Partial<RememberedFolder>;
  if (candidate.folder === undefined || typeof candidate.name !== "string") return null;
  return { folder: candidate.folder, name: candidate.name, at: candidate.at ?? 0 };
}

export async function forgetFolder(): Promise<void> {
  await inStore("readwrite", (store) => store.delete(KEY));
}

/**
 * Run one request against the store, and turn every way it can go wrong into
 * `null`.
 *
 * IndexedDB's API is old enough to predate promises and pretends the database
 * might need upgrading on every open, so the ceremony is unavoidable; keeping
 * all of it in one place means the three functions above read like what they
 * mean.
 */
async function inStore(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<unknown> {
  const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (factory === undefined) return null;

  return await new Promise<unknown>((resolve) => {
    let open: IDBOpenDBRequest;
    try {
      open = factory.open(DATABASE, 1);
    } catch {
      resolve(null);
      return;
    }

    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
    };
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const database = open.result;
      try {
        const request = run(database.transaction(STORE, mode).objectStore(STORE));
        request.onerror = () => {
          database.close();
          resolve(null);
        };
        request.onsuccess = () => {
          const value: unknown = request.result;
          database.close();
          resolve(value ?? null);
        };
      } catch {
        database.close();
        resolve(null);
      }
    };
  });
}
