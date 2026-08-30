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
  append(path: string, contents: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Paths beginning with `prefix`, in no guaranteed order. */
  list(prefix: string): Promise<string[]>;
}

/** An in-memory `FileStore`, for tests and for a session that cannot persist. */
export class MemoryFileStore implements FileStore {
  private readonly files = new Map<string, string>();

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
    this.files.delete(path);
    return Promise.resolve();
  }

  list(prefix: string): Promise<string[]> {
    return Promise.resolve([...this.files.keys()].filter((path) => path.startsWith(prefix)));
  }

  // ---- test helpers ----

  has(path: string): boolean {
    return this.files.has(path);
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.files);
  }

  clearWrites(): void {
    this.writes.length = 0;
  }
}
