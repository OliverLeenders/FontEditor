import { type FileRead, type FileStore, PROGRESS_EVERY, type ReadProgress } from "./file-store.js";
import { inParallel } from "./parallel.js";

/**
 * How many files are read at once. More than are written at once: a read takes
 * no lock and opens no access handle, and the gain is flat past this.
 */
const READS_AT_ONCE = 64;

/**
 * A `FileStore` backed by the Origin Private File System.
 *
 * Uses `createSyncAccessHandle`, which is only available inside a Worker — so
 * this file only runs there. That constraint turned out to be the reason to put
 * storage in a Worker at all: it is the one OPFS write path that appears to be
 * supported everywhere, and it happens also to be the fast one and the one that
 * cannot stutter a drag.
 *
 * "Origin private" means the browser owns these files. The user cannot open them
 * in a file manager, and they are not a substitute for saving to disk — this is
 * a working store, whose job is that your work is still here when you come back.
 */
export class OpfsFileStore implements FileStore {
  private constructor(private readonly root: FileSystemDirectoryHandle) {}

  static async open(directory = "project"): Promise<OpfsFileStore> {
    // Typed as always present and absent in plenty of places — an old browser,
    // an insecure origin, a test environment. The check is on what is there.
    const storage = navigator.storage as StorageManager | undefined;
    if (typeof storage?.getDirectory !== "function") {
      throw new Error("This browser does not provide an origin private file system.");
    }
    const root = await storage.getDirectory();
    return new OpfsFileStore(await root.getDirectoryHandle(directory, { create: true }));
  }

  async read(path: string): Promise<string | null> {
    const handle = await this.fileHandle(path, false);
    if (handle === null) return null;

    const access = await handle.createSyncAccessHandle();
    try {
      const size = access.getSize();
      if (size === 0) return "";
      const buffer = new Uint8Array(size);
      access.read(buffer, { at: 0 });
      return new TextDecoder().decode(buffer);
    } finally {
      access.close();
    }
  }

  async readBytes(path: string): Promise<Uint8Array | null> {
    const handle = await this.fileHandle(path, false);
    if (handle === null) return null;

    const access = await handle.createSyncAccessHandle();
    try {
      const size = access.getSize();
      const buffer = new Uint8Array(size);
      if (size > 0) access.read(buffer, { at: 0 });
      return buffer;
    } finally {
      access.close();
    }
  }

  async writeBytes(path: string, contents: Uint8Array): Promise<void> {
    const handle = await this.fileHandle(path, true);
    if (handle === null) throw new Error(`Could not open ${path} for writing.`);

    const access = await handle.createSyncAccessHandle();
    try {
      access.truncate(0);
      access.write(contents, { at: 0 });
      access.flush();
    } finally {
      access.close();
    }
  }

  async write(path: string, contents: string): Promise<void> {
    const handle = await this.fileHandle(path, true);
    if (handle === null) throw new Error(`Could not open ${path} for writing.`);

    const access = await handle.createSyncAccessHandle();
    try {
      // Truncate first: writing a shorter document over a longer one would
      // otherwise leave the tail of the old one behind, and the result would
      // still parse as far as the closing brace.
      access.truncate(0);
      access.write(new TextEncoder().encode(contents), { at: 0 });
      access.flush();
    } finally {
      access.close();
    }
  }

  async append(path: string, contents: string): Promise<void> {
    const handle = await this.fileHandle(path, true);
    if (handle === null) throw new Error(`Could not open ${path} for appending.`);

    const access = await handle.createSyncAccessHandle();
    try {
      access.write(new TextEncoder().encode(contents), { at: access.getSize() });
      access.flush();
    } finally {
      access.close();
    }
  }

  async remove(path: string): Promise<void> {
    const { directory, file } = this.split(path);
    const parent = await this.directoryHandle(directory, false);
    if (parent === null) return;
    try {
      await parent.removeEntry(file);
    } catch {
      // Already gone, which is the outcome the caller wanted.
    }
  }

  async removeFolder(path: string): Promise<void> {
    const { directory, file } = this.split(path);
    const parent = await this.directoryHandle(directory, false);
    if (parent === null) return;
    this.folders.clear();
    try {
      await parent.removeEntry(file, { recursive: true });
    } catch {
      // Already gone, which is the outcome the caller wanted.
    }
  }

  /**
   * Walked from the deepest folder the prefix names rather than from the top:
   * listing a font's snapshots should not cost a walk through its four thousand
   * glyph files.
   */
  async list(prefix: string): Promise<string[]> {
    const found: { path: string; handle: FileSystemFileHandle }[] = [];
    const cut = prefix.lastIndexOf("/");
    const base = cut === -1 ? "" : prefix.slice(0, cut);
    const from = await this.directoryHandle(
      base.split("/").filter((part) => part !== ""),
      false,
    );
    if (from === null) return [];
    await this.walk(from, base, found);
    return found.map((file) => file.path).filter((path) => path.startsWith(prefix));
  }

  /**
   * Every file in a folder, read whole.
   *
   * A font is thousands of small files, and read one path at a time each of
   * them is four round trips to the browser's file process: two folders looked
   * up, the file looked up, and an access handle opened on it — the last of
   * which also locks the file. Here the folder is listed once, which hands back
   * a handle to every file in it, and each is read as a `File`, which takes no
   * lock and so can overlap with its neighbours. Four thousand glyphs took
   * 3.2 s the first way and take 0.7 s this way.
   */
  async readFolder(folder: string, progress?: ReadProgress): Promise<FileRead[]> {
    const base = folder.replace(/\/+$/, "");
    const from = await this.directoryHandle(
      base.split("/").filter((part) => part !== ""),
      false,
    );
    if (from === null) return [];

    const files: { path: string; handle: FileSystemFileHandle }[] = [];
    await this.walk(from, base, files);

    let done = 0;
    const read = await inParallel(
      files,
      async ({ path, handle }) => {
        const raw = await (await handle.getFile()).text();
        done += 1;
        if (done % PROGRESS_EVERY === 0) progress?.(done, files.length);
        return { path, raw };
      },
      READS_AT_ONCE,
    );
    progress?.(files.length, files.length);
    return read;
  }

  /**
   * `FileSystemDirectoryHandle` is async-iterable in every browser that ships
   * OPFS, but TypeScript's DOM library does not yet say so.
   */
  private async walk(
    directory: FileSystemDirectoryHandle,
    base: string,
    into: { path: string; handle: FileSystemFileHandle }[],
  ): Promise<void> {
    const entries = directory as unknown as AsyncIterable<[string, FileSystemHandle]>;
    for await (const [name, handle] of entries) {
      const path = base === "" ? name : `${base}/${name}`;
      if (handle.kind === "directory") {
        await this.walk(handle as FileSystemDirectoryHandle, path, into);
      } else {
        into.push({ path, handle: handle as FileSystemFileHandle });
      }
    }
  }

  private split(path: string): { directory: string[]; file: string } {
    const parts = path.split("/").filter((part) => part !== "");
    const file = parts.pop() ?? "";
    return { directory: parts, file };
  }

  /**
   * The folders looked up so far, by path.
   *
   * A font's files are nearly all in one folder, and looking it up again for
   * each of them was half the round trips of a save. Forgotten whenever a
   * folder is removed, since a handle to a folder that has gone is no use.
   */
  private readonly folders = new Map<string, FileSystemDirectoryHandle>();

  private async directoryHandle(
    parts: readonly string[],
    create: boolean,
  ): Promise<FileSystemDirectoryHandle | null> {
    const key = parts.join("/");
    const known = this.folders.get(key);
    if (known !== undefined) return known;

    let handle = this.root;
    for (const part of parts) {
      try {
        handle = await handle.getDirectoryHandle(part, { create });
      } catch {
        return null;
      }
    }
    this.folders.set(key, handle);
    return handle;
  }

  private async fileHandle(path: string, create: boolean): Promise<FileSystemFileHandle | null> {
    const { directory, file } = this.split(path);
    const parent = await this.directoryHandle(directory, create);
    if (parent === null) return null;
    try {
      return await parent.getFileHandle(file, { create });
    } catch {
      return null;
    }
  }
}

/**
 * Ask the browser not to evict this data under storage pressure.
 *
 * Origin private storage is "best effort" by default: a browser short of disk
 * may discard it without asking. Resolves to whether persistence was granted —
 * worth reporting, since a `false` means autosave is not a durable promise.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    // Typed as always present; absent on an insecure origin and in tests.
    const storage = navigator.storage as StorageManager | undefined;
    if (typeof storage?.persist !== "function") return false;
    return await storage.persist();
  } catch {
    return false;
  }
}
