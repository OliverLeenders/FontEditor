import { type LockManagerLike, browserLocks, projectLock } from "./lock.js";

/**
 * The working copies themselves, as directories: which there are, and removing one.
 *
 * Each font has one, a directory at the root of the origin private file system
 * named by the font's id, and nothing else lives at that root. Everything else
 * in this package works *inside* one of them, from the worker; this is the one
 * place that looks at them from outside, from the page, because deciding which
 * to keep is about the list of fonts rather than about any one font's contents.
 *
 * Removing one is the only irreversible thing the storage layer does, so it
 * asks the question the rest of the editor already asks before writing: is
 * anyone using this? The write lock is per font, held by whichever window has
 * that font open, and a copy whose lock cannot be taken is left alone.
 */

/** The part of a directory handle this needs, so a test can supply one. */
export type WorkingRoot = {
  keys(): AsyncIterable<string>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
};

/** What became of a request to remove a working copy. */
export type Removal =
  /** Gone. */
  | "deleted"
  /** Open in another window, which holds its lock; left exactly as it was. */
  | "in-use"
  /** There was nothing by that name to remove. */
  | "missing"
  /** No private file system, or no locks to ask with; nothing was touched. */
  | "unavailable";

async function originRoot(): Promise<WorkingRoot | null> {
  const storage = (globalThis.navigator as { storage?: StorageManager } | undefined)?.storage;
  if (typeof storage?.getDirectory !== "function") return null;
  try {
    return await storage.getDirectory();
  } catch {
    return null;
  }
}

/** The names of every working copy there is. Empty where there is no store. */
export async function workingCopies(root?: WorkingRoot | null): Promise<string[]> {
  const found = root === undefined ? await originRoot() : root;
  if (found === null) return [];

  const names: string[] = [];
  try {
    for await (const name of found.keys()) names.push(name);
  } catch {
    return [];
  }
  return names;
}

/**
 * Remove one working copy, unless a window has that font open.
 *
 * Without a lock manager this does nothing rather than guess: there would be no
 * way to know that another window is not in the middle of writing to it, and a
 * font deleted from under the window editing it is the worst outcome available.
 */
export async function deleteWorkingCopy(
  id: string,
  options: { readonly root?: WorkingRoot | null; readonly locks?: LockManagerLike | null } = {},
): Promise<Removal> {
  const root = options.root === undefined ? await originRoot() : options.root;
  const locks = options.locks === undefined ? browserLocks() : options.locks;
  if (root === null || locks === null) return "unavailable";

  const outcome = await locks.request(
    projectLock(id),
    { mode: "exclusive", ifAvailable: true },
    async (lock): Promise<Removal> => {
      if (lock === null) return "in-use";
      try {
        await root.removeEntry(id, { recursive: true });
        return "deleted";
      } catch {
        return "missing";
      }
    },
  );
  return outcome as Removal;
}

/**
 * The working copies nothing refers to any more.
 *
 * Only names shaped like an id this editor mints are considered at all. The
 * working copy called `project` predates ids and is never one of these, and a
 * directory whose name this editor would never have chosen is not this editor's
 * to delete — whatever put it there.
 */
export function forgottenCopies(names: readonly string[], known: ReadonlySet<string>): string[] {
  return names.filter((name) => MINTED.some((shape) => shape.test(name)) && !known.has(name));
}

/** The shapes of id `newProject` mints: a UUID, or its fallback where there is none. */
const MINTED = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^p[0-9a-z]{10,}$/,
];
