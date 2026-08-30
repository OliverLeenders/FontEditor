import type { FileStore } from "./file-store.js";

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
    const storage = navigator.storage;
    if (storage?.getDirectory === undefined) {
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

  async list(prefix: string): Promise<string[]> {
    const found: string[] = [];
    await this.walk(this.root, "", found);
    return found.filter((path) => path.startsWith(prefix));
  }

  /**
   * `FileSystemDirectoryHandle` is async-iterable in every browser that ships
   * OPFS, but TypeScript's DOM library does not yet say so.
   */
  private async walk(
    directory: FileSystemDirectoryHandle,
    base: string,
    into: string[],
  ): Promise<void> {
    const entries = directory as unknown as AsyncIterable<[string, FileSystemHandle]>;
    for await (const [name, handle] of entries) {
      const path = base === "" ? name : `${base}/${name}`;
      if (handle.kind === "directory") {
        await this.walk(handle as FileSystemDirectoryHandle, path, into);
      } else {
        into.push(path);
      }
    }
  }

  private split(path: string): { directory: string[]; file: string } {
    const parts = path.split("/").filter((part) => part !== "");
    const file = parts.pop() ?? "";
    return { directory: parts, file };
  }

  private async directoryHandle(
    parts: readonly string[],
    create: boolean,
  ): Promise<FileSystemDirectoryHandle | null> {
    let handle = this.root;
    for (const part of parts) {
      try {
        handle = await handle.getDirectoryHandle(part, { create });
      } catch {
        return null;
      }
    }
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
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
