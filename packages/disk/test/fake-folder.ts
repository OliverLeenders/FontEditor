import type { DiskFile, DiskFolder, DiskWritable } from "../src/handles.js";

/**
 * A folder made of maps, standing in for one on a disk.
 *
 * Enough of the File System Access API to run the reader and the writer in
 * Node, and — the point of writing it rather than mocking — inspectable
 * afterwards, so a test can ask what is in the folder instead of what was
 * called.
 */
export class FakeFolder implements DiskFolder {
  readonly kind = "directory" as const;
  readonly files = new Map<string, string>();
  readonly folders = new Map<string, FakeFolder>();

  constructor(readonly name: string) {}

  /** Put a file in, making the folders on the way, as a fixture would. */
  put(path: string, text: string): this {
    const parts = path.split("/");
    const file = parts.pop();
    if (file === undefined) throw new Error("no file name");

    this.reach(parts).files.set(file, text);
    return this;
  }

  /** The folder at this path below here, made if it is not there yet. */
  private reach(parts: readonly string[]): FakeFolder {
    const head = parts[0];
    if (head === undefined) return this;

    let next = this.folders.get(head);
    if (next === undefined) {
      next = new FakeFolder(head);
      this.folders.set(head, next);
    }
    return next.reach(parts.slice(1));
  }

  /** Every file under here, by path, for asserting on the result of a write. */
  all(prefix = ""): Map<string, string> {
    const out = new Map<string, string>();
    for (const [name, text] of this.files) out.set(`${prefix}${name}`, text);
    for (const [name, folder] of this.folders) {
      for (const [path, text] of folder.all(`${prefix}${name}/`)) out.set(path, text);
    }
    return out;
  }

  async *entries(): AsyncIterableIterator<[string, DiskFile | DiskFolder]> {
    for (const [name] of this.files) yield [name, this.file(name)];
    for (const [name, folder] of this.folders) yield [name, folder];
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<DiskFile> {
    if (!this.files.has(name)) {
      if (options?.create !== true) throw new Error(`no such file: ${name}`);
      this.files.set(name, "");
    }
    return await Promise.resolve(this.file(name));
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DiskFolder> {
    let folder = this.folders.get(name);
    if (folder === undefined) {
      if (options?.create !== true) throw new Error(`no such folder: ${name}`);
      folder = new FakeFolder(name);
      this.folders.set(name, folder);
    }
    return await Promise.resolve(folder);
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name) && !this.folders.delete(name)) {
      throw new Error(`no such entry: ${name}`);
    }
    await Promise.resolve();
  }

  private file(name: string): DiskFile {
    return {
      kind: "file",
      name,
      getFile: () =>
        Promise.resolve({
          arrayBuffer: () => {
            const bytes = new TextEncoder().encode(this.files.get(name) ?? "");
            return Promise.resolve(bytes.buffer);
          },
        }),
      createWritable: (): Promise<DiskWritable> => {
        let written = "";
        return Promise.resolve({
          write: (data: string | Uint8Array | ArrayBuffer) => {
            written += typeof data === "string" ? data : new TextDecoder().decode(data);
            return Promise.resolve();
          },
          close: () => {
            this.files.set(name, written);
            return Promise.resolve();
          },
        });
      },
    };
  }
}
