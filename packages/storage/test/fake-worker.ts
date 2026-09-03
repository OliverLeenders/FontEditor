import { MemoryFileStore } from "../src/file-store.js";
import type { StorageRequest, StorageResponse } from "../src/protocol.js";
import { storageHandler } from "../src/worker.js";

/**
 * A `Worker` that is not one, so the client and the worker can be tested
 * together.
 *
 * The pair is the part of this package that no test reached, and it is where
 * both of the worst bugs in the project lived — a save landing after the font it
 * belonged to had been replaced, and glyph files that were never deleted. Both
 * were failures of the *conversation* rather than of either side alone, which is
 * exactly what a test of one side in isolation cannot catch.
 *
 * So this is deliberately not a mock. It runs the real request handling over a
 * real in-memory store; the only pretence is the message channel, and that is
 * asynchronous here as it is in a browser. A synchronous stand-in would hide
 * every ordering bug there is.
 *
 * Not declared as implementing `Worker`. Doing so would mean satisfying the
 * whole of a DOM interface — every overload of `addEventListener` included —
 * for the three methods the client actually calls, which is a lot of stub to
 * write in order to say less than the cast at the call site says.
 */
export class FakeWorker {
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  private readonly handle: (request: StorageRequest) => Promise<StorageResponse>;

  /** Requests seen, in order, so a test can assert what was actually asked. */
  readonly requests: StorageRequest[] = [];

  /** Set to hold replies until `flush`, for testing what happens in between. */
  paused = false;
  private held: StorageResponse[] = [];

  constructor(readonly store = new MemoryFileStore()) {
    this.handle = storageHandler(() => Promise.resolve(this.store));
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener as (event: unknown) => void);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: never) => void): void {
    this.listeners.get(type)?.delete(listener as (event: unknown) => void);
  }

  postMessage(request: StorageRequest): void {
    this.requests.push(request);
    void this.handle(request).then((response) => {
      if (this.paused) this.held.push(response);
      else this.deliver(response);
    });
  }

  /** Let go of everything held while paused, in the order it was answered. */
  flush(): void {
    this.paused = false;
    const held = this.held;
    this.held = [];
    for (const response of held) this.deliver(response);
  }

  /** Deliver held replies in reverse, which is what a slow first write looks like. */
  flushReversed(): void {
    this.paused = false;
    const held = [...this.held].reverse();
    this.held = [];
    for (const response of held) this.deliver(response);
  }

  /** Pretend the worker died, which is the one failure the client must not hang on. */
  fail(message: string): void {
    for (const listener of this.listeners.get("error") ?? []) listener({ message });
  }

  terminate(): void {
    this.listeners.clear();
  }

  private deliver(response: StorageResponse): void {
    for (const listener of this.listeners.get("message") ?? []) listener({ data: response });
  }
}
