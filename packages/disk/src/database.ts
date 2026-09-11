/**
 * The one IndexedDB this package keeps, and the ceremony of opening it.
 *
 * IndexedDB predates promises and pretends the database might need upgrading on
 * every open, so the ceremony is unavoidable; keeping all of it here means the
 * things built on top read like what they mean. It is also the only place that
 * knows the database's name and version, which matters now that two stores live
 * in it and either may be the first one asked for.
 *
 * Deliberately forgiving throughout. A browser with IndexedDB switched off, or
 * a private window, should mean "the editor forgets things between sessions",
 * never "the editor will not start" — so every way this can fail resolves to
 * `null` and the caller carries on without whatever it was asking for.
 */

const DATABASE = "typewright-disk";

/**
 * Version 2 added `PROJECTS`. The upgrade creates every store this package
 * knows about rather than only the one being asked for: a database opened for
 * one store and upgraded is not upgraded again when the other is asked for at
 * the same version, and would be missing it for good.
 */
const VERSION = 2;

/** Where a folder handle lives. One record, the project last worked in. */
export const HANDLES = "handles";

/** Where the projects live. One record each, keyed by the project's id. */
export const PROJECTS = "projects";

const STORES = [HANDLES, PROJECTS];

export type Run = (store: IDBObjectStore) => IDBRequest;

/** Run one request against a store of the current database. */
export async function inStore(store: string, mode: IDBTransactionMode, run: Run): Promise<unknown> {
  return await inDatabase({ database: DATABASE, version: VERSION, store, mode, run });
}

/**
 * The same, against a database named outright.
 *
 * Only the migration from the editor's former name needs this, and it needs it
 * at that database's own version — opening an existing database at a higher
 * version would upgrade it, which is a strange thing to do to one being read
 * from for the last time.
 */
export async function inDatabase(options: {
  readonly database: string;
  readonly version: number;
  readonly store: string;
  readonly mode: IDBTransactionMode;
  readonly run: Run;
}): Promise<unknown> {
  const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (factory === undefined) return null;

  return await new Promise<unknown>((resolve) => {
    let open: IDBOpenDBRequest;
    try {
      open = factory.open(options.database, options.version);
    } catch {
      resolve(null);
      return;
    }

    open.onupgradeneeded = () => {
      for (const name of STORES) {
        if (!open.result.objectStoreNames.contains(name)) open.result.createObjectStore(name);
      }
    };
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const opened = open.result;
      try {
        const request = options.run(
          opened.transaction(options.store, options.mode).objectStore(options.store),
        );
        request.onerror = () => {
          opened.close();
          resolve(null);
        };
        request.onsuccess = () => {
          const value: unknown = request.result;
          opened.close();
          resolve(value ?? null);
        };
      } catch {
        // A store this database has never had. Reading from one is "nothing is
        // there", which is true and is what every caller wants to hear.
        opened.close();
        resolve(null);
      }
    };
  });
}

/**
 * Whether a database exists, without making one by asking.
 *
 * Opening a database creates it, so a question asked carelessly leaves litter
 * named after something that never ran here. Not every browser will answer;
 * one that will not is better asked the database directly than told no.
 */
export async function databaseExists(name: string): Promise<boolean> {
  const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (factory === undefined) return false;
  if (typeof factory.databases !== "function") return true;

  try {
    return (await factory.databases()).some((it) => it.name === name);
  } catch {
    return true;
  }
}
