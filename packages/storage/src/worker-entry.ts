/// <reference lib="webworker" />

import { OpfsFileStore } from "./opfs.js";
import type { StorageRequest } from "./protocol.js";
import { storageHandler } from "./worker.js";

/**
 * The worker's entry point: globals in, replies out, and nothing else.
 *
 * Its own module rather than the foot of `worker.ts`, because touching `self` at
 * import time is exactly what stops the request handling from being importable
 * anywhere else — including a test. Everything with a decision in it lives next
 * door; this is the part that cannot be tested, so it is the part with nothing
 * to test.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;
const handle = storageHandler((directory) => OpfsFileStore.open(directory));

scope.addEventListener("message", (event: MessageEvent<StorageRequest>) => {
  void handle(event.data).then((response) => {
    scope.postMessage(response);
  });
});
