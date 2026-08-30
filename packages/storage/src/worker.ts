/// <reference lib="webworker" />

import { decodeGlyph, encodeFontInfo, encodeGlyph } from "./schema.js";
import { fontDocument } from "@fonteditor/font-model";

import type { FileStore } from "./file-store.js";
import { OpfsFileStore } from "./opfs.js";
import type { LoadedPayload, StorageRequest, StorageResponse } from "./protocol.js";
import {
  FONT_INFO_PATH,
  appendJournal,
  clearJournal,
  glyphPath,
  loadDocument,
  wipe,
} from "./project.js";

/**
 * The storage worker.
 *
 * Owns the OPFS handles and does every read and write, so file work never
 * competes with rendering — a save cannot stutter a drag no matter how large the
 * project grows. It is also the only place `createSyncAccessHandle` is
 * available, which is what made the Worker mandatory rather than merely tidy.
 *
 * Errors here become rejected replies rather than thrown exceptions. That is the
 * real cost of the Worker: a failed write surfaces as a message on the client's
 * promise, one frame later than it happened.
 */

let store: FileStore | null = null;

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener("message", (event: MessageEvent<StorageRequest>) => {
  void handle(event.data);
});

async function handle(request: StorageRequest): Promise<void> {
  try {
    const value = await run(request);
    reply({ id: request.id, ok: true, value });
  } catch (error) {
    reply({
      id: request.id,
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function reply(response: StorageResponse): void {
  scope.postMessage(response);
}

function required(): FileStore {
  if (store === null) throw new Error("Storage has not been opened yet.");
  return store;
}

async function run(request: StorageRequest): Promise<unknown> {
  switch (request.kind) {
    case "open":
      store = await OpfsFileStore.open(request.directory);
      return null;

    case "load": {
      const result = await loadDocument(required());
      if (result.kind === "empty") {
        const payload: LoadedPayload = { glyph: null, recovered: false, problems: [] };
        return payload;
      }
      const payload: LoadedPayload = {
        glyph: encodeGlyph(result.document.glyph),
        recovered: result.recovered,
        problems: result.problems,
      };
      return payload;
    }

    case "saveGlyphs": {
      const written: string[] = [];
      for (const stored of request.glyphs) {
        // Decode and re-encode rather than writing what arrived: the round trip
        // is the same validation a load performs, so a glyph that could not be
        // read back is caught while the good copy is still in memory, not on the
        // next launch.
        const decoded = decodeGlyph(stored);
        if (!decoded.ok) throw new Error(`refusing to save ${stored.name}: ${decoded.reason}`);
        const path = glyphPath(decoded.value.name);
        await required().write(path, JSON.stringify(encodeGlyph(decoded.value)));
        written.push(path);
      }
      return written;
    }

    case "saveFontInfo": {
      const first = request.glyphOrder[0] ?? "";
      const info = encodeFontInfo(fontDocument({ name: first, unicodes: [], advance: 0, contours: [] }));
      await required().write(FONT_INFO_PATH, JSON.stringify(info));
      return null;
    }

    case "journal": {
      const decoded = decodeGlyph(request.glyph);
      if (!decoded.ok) throw new Error(`refusing to journal: ${decoded.reason}`);
      await appendJournal(required(), decoded.value, request.at);
      return null;
    }

    case "clearJournal":
      await clearJournal(required());
      return null;

    case "wipe":
      await wipe(required());
      return null;
  }
}
