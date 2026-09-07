/**
 * The narrow filesystem the rest of this package is written against.
 *
 * Deliberately small — read, write, remove, list — because that is all a
 * project needs, and because a small interface is one an in-memory
 * implementation can satisfy exactly. Everything above this line is therefore
 * testable in Node with no browser at all, and only the OPFS adapter needs one.
 *
 * Paths are `/`-separated and relative to the project root. Directories are
 * implied by paths rather than created explicitly, which is the one real
 * concession to keeping the interface this small.
 */
export interface FileStore {
  read(path: string): Promise<string | null>;
  write(path: string, contents: string): Promise<void>;
  /**
   * The same two, for files that are not text.
   *
   * Everything this editor saves of a font is XML or JSON; the one thing that
   * is not is a picture somebody is tracing from. Base64 through the text
   * methods would have avoided this pair at the price of a third more bytes on
   * disk and a decode on every read — for a file that is already the largest
   * thing in the project.
   */
  readBytes(path: string): Promise<Uint8Array | null>;
  writeBytes(path: string, contents: Uint8Array): Promise<void>;
  append(path: string, contents: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Paths beginning with `prefix`, in no guaranteed order. */
  list(prefix: string): Promise<string[]>;
}

/** An in-memory `FileStore`, for tests and for a session that cannot persist. */
export class MemoryFileStore implements FileStore {
  private readonly files = new Map<string, string>();
  private readonly binary = new Map<string, Uint8Array>();

  /** Counts every call, so a test can assert that a save wrote what it claimed. */
  readonly writes: string[] = [];

  read(path: string): Promise<string | null> {
    return Promise.resolve(this.files.get(path) ?? null);
  }

  write(path: string, contents: string): Promise<void> {
    this.files.set(path, contents);
    this.writes.push(path);
    return Promise.resolve();
  }

  append(path: string, contents: string): Promise<void> {
    this.files.set(path, (this.files.get(path) ?? "") + contents);
    this.writes.push(path);
    return Promise.resolve();
  }

  remove(path: string): Promise<void> {
    // Both maps: a path is one file, whichever of the two holds it, and a
    // remove that missed the binary half would leave a deleted image behind.
    this.files.delete(path);
    this.binary.delete(path);
    return Promise.resolve();
  }

  readBytes(path: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.binary.get(path) ?? null);
  }

  writeBytes(path: string, contents: Uint8Array): Promise<void> {
    this.binary.set(path, contents);
    this.writes.push(path);
    return Promise.resolve();
  }

  list(prefix: string): Promise<string[]> {
    return Promise.resolve(
      [...this.files.keys(), ...this.binary.keys()].filter((path) => path.startsWith(prefix)),
    );
  }

  // ---- test helpers ----

  has(path: string): boolean {
    return this.files.has(path) || this.binary.has(path);
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.files);
  }

  clearWrites(): void {
    this.writes.length = 0;
  }
}
