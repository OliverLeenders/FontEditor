/**
 * A small IndexedDB, enough for the handful of calls this package makes.
 *
 * Hand-rolled rather than pulled in: what is exercised is `get`, `getAll`,
 * `put` and `delete`, plus the question of which databases exist, and a fake
 * that size is easier to read than the contract of a real one. The asynchrony
 * is real, though — every request settles in a later microtask, because the
 * code under test assigns its handlers after the call returns, and a fake that
 * settled synchronously would never run them.
 */

function settled(result: unknown): unknown {
  const request = { result, onsuccess: null as null | (() => void), onerror: null };
  queueMicrotask(() => request.onsuccess?.());
  return request;
}

export class FakeStore {
  constructor(private readonly data: Map<string, unknown>) {}

  get(key: string): unknown {
    return settled(this.data.get(key) ?? null);
  }

  getAll(): unknown {
    return settled([...this.data.values()]);
  }

  put(value: unknown, key: string): unknown {
    this.data.set(key, value);
    return settled(null);
  }

  delete(key: string): unknown {
    this.data.delete(key);
    return settled(null);
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

  transaction(_name: string, _mode: string): { objectStore: (name: string) => FakeStore } {
    return { objectStore: (name) => new FakeStore(this.store(name)) };
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
