/**
 * A small IndexedDB, enough for the handful of calls this package makes.
 *
 * Hand-rolled rather than pulled in: what is exercised is `get`, `getAll`,
 * `put` and `delete`, plus the question of which databases exist, and a fake
 * that size is easier to read than the contract of a real one. The asynchrony
 * is real, though — every request settles in a later microtask, because the
 * code under test assigns its handlers after the call returns, and a fake that
 * settled synchronously would never run them.
 *
 * So are the transactions. One begins when the one before it on the database
 * has finished, and has finished when a request of its own has settled with no
 * other asked for: a record read in one is not read in the next until whatever
 * the first went on to write is written. A fake without that would call two
 * transactions begun together a race that a real database does not have.
 */

type FakeRequest = { result: unknown; onsuccess: null | (() => void); onerror: null };

class FakeTransaction {
  private pending = 0;
  private finish: () => void = () => undefined;
  readonly done = new Promise<void>((resolve) => {
    this.finish = resolve;
  });

  constructor(private readonly begun: Promise<void>) {
    // One that asked for nothing is over as soon as it began.
    queueMicrotask(() => {
      if (this.pending === 0) this.finish();
    });
  }

  request(run: () => unknown): FakeRequest {
    const request: FakeRequest = { result: undefined, onsuccess: null, onerror: null };
    this.pending += 1;
    void this.begun.then(() => {
      request.result = run();
      queueMicrotask(() => {
        // Whatever this asks for next is asked for before the count is taken.
        request.onsuccess?.();
        this.pending -= 1;
        if (this.pending === 0) this.finish();
      });
    });
    return request;
  }
}

export class FakeStore {
  constructor(
    private readonly data: Map<string, unknown>,
    private readonly within: FakeTransaction,
  ) {}

  get(key: string): unknown {
    return this.within.request(() => this.data.get(key) ?? null);
  }

  getAll(): unknown {
    return this.within.request(() => [...this.data.values()]);
  }

  put(value: unknown, key: string): unknown {
    return this.within.request(() => {
      this.data.set(key, value);
      return null;
    });
  }

  delete(key: string): unknown {
    return this.within.request(() => {
      this.data.delete(key);
      return null;
    });
  }
}

export class FakeDatabase {
  readonly stores = new Map<string, Map<string, unknown>>();
  readonly objectStoreNames = { contains: (name: string): boolean => this.stores.has(name) };

  createObjectStore(name: string): void {
    this.stores.set(name, new Map());
  }

  /** The contents of one store, for a test that wants to look or to seed. */
  store(name: string): Map<string, unknown> {
    let found = this.stores.get(name);
    if (found === undefined) {
      found = new Map();
      this.stores.set(name, found);
    }
    return found;
  }

  /** When the last transaction begun here has finished. */
  private last: Promise<void> = Promise.resolve();

  transaction(_name: string, _mode: string): { objectStore: (name: string) => FakeStore } {
    const within = new FakeTransaction(this.last);
    this.last = within.done;
    return { objectStore: (name) => new FakeStore(this.store(name), within) };
  }

  close(): void {}
}

export class FakeFactory {
  readonly databasesByName = new Map<string, FakeDatabase>();

  databases(): Promise<{ name: string }[]> {
    return Promise.resolve([...this.databasesByName.keys()].map((name) => ({ name })));
  }

  open(name: string): unknown {
    const fresh = !this.databasesByName.has(name);
    const database = this.databasesByName.get(name) ?? new FakeDatabase();
    this.databasesByName.set(name, database);

    const request = {
      result: database,
      onsuccess: null as null | (() => void),
      onupgradeneeded: null as null | (() => void),
      onerror: null,
    };
    queueMicrotask(() => {
      if (fresh) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }

  /** A database that already exists, so a test can put something in it. */
  make(name: string): FakeDatabase {
    const database = new FakeDatabase();
    this.databasesByName.set(name, database);
    return database;
  }
}

/** Install a fresh fake as `globalThis.indexedDB`, and hand back how to undo it. */
export function installFakeIdb(): { factory: FakeFactory; restore: () => void } {
  const factory = new FakeFactory();
  const previous = (globalThis as { indexedDB?: unknown }).indexedDB;
  (globalThis as { indexedDB?: unknown }).indexedDB = factory;

  return {
    factory,
    restore: () => {
      (globalThis as { indexedDB?: unknown }).indexedDB = previous;
    },
  };
}
