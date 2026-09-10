import {
  decodeFontInfo,
  decodeGlyph,
  decodeKerning,
  encodeFontInfo,
  encodeGlyph,
  encodeKerning,
} from "./schema.js";
import {
  type Glyph,
  fontDocument,
  orderedGlyphs,
  setFeatures,
  setGlyphOrder,
  setKerning,
} from "@typewright/font-model";

import type { FileStore } from "./file-store.js";
import type { LoadedPayload, StorageRequest, StorageResponse } from "./protocol.js";
import { listSnapshots, pruneSnapshots, readSnapshot, writeSnapshot } from "./snapshots.js";
import { listImages, readImage, removeImage, writeImage } from "./images.js";
import { readLayers, writeLayers } from "./layers.js";
import { readDesignspace, writeDesignspace } from "./masters.js";
import {
  FONT_INFO_PATH,
  KERNING_PATH,
  appendJournal,
  clearJournal,
  glyphPath,
  loadDocument,
  replaceDocument,
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

/**
 * How the handler gets a store to work in.
 *
 * A parameter rather than a hard reference to OPFS, so the request handling can
 * be driven over a store that is not a browser's — which is the only way this
 * layer gets tested at all. The shell below supplies the real one.
 */
export type OpenStore = (directory: string) => Promise<FileStore>;

/**
 * The request handling, with no worker globals in sight.
 *
 * Returns the reply rather than posting it. Posting is the shell's job, and
 * separating them is what lets a test ask "what would this answer" without a
 * `Worker` to answer into.
 */
export function storageHandler(
  open: OpenStore,
): (request: StorageRequest) => Promise<StorageResponse> {
  let store: FileStore | null = null;

  const required = (): FileStore => {
    if (store === null) throw new Error("Storage has not been opened yet.");
    return store;
  };

  const run = async (request: StorageRequest): Promise<unknown> => {
    switch (request.kind) {
      case "open":
        store = await open(request.directory);
        return null;
      default:
        return runOn(required(), request);
    }
  };

  return async (request: StorageRequest): Promise<StorageResponse> => {
    try {
      return { id: request.id, ok: true, value: await run(request) };
    } catch (error) {
      // Every failure becomes a rejected reply rather than an exception. That is
      // the real cost of the Worker: a failed write surfaces on the client's
      // promise, one frame later than it happened.
      return {
        id: request.id,
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

async function runOn(store: FileStore, request: StorageRequest): Promise<unknown> {
  const required = (): FileStore => store;

  switch (request.kind) {
    // Handled before this is reached; it is the one request that decides which
    // store there is rather than acting on one.
    case "open":
      return null;

    case "load": {
      const result = await loadDocument(required());
      if (result.kind === "empty") {
        const payload: LoadedPayload = {
          glyphs: [],
          info: null,
          kerning: null,
          recovered: false,
          problems: [],
        };
        return payload;
      }
      const payload: LoadedPayload = {
        glyphs: orderedGlyphs(result.document).map(encodeGlyph),
        info: encodeFontInfo(result.document),
        kerning: encodeKerning(result.document.kerning),
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

    case "removeGlyphs": {
      const removed: string[] = [];
      for (const name of request.names) {
        const path = glyphPath(name);
        // A file that is not there is the state being asked for, so removing it
        // twice is not an error worth failing a save over.
        await required().remove(path);
        removed.push(path);
      }
      return removed;
    }

    case "replaceAll": {
      // Validated the same way a single save is, and *before* anything is
      // written: a font that fails to round-trip should leave the existing
      // project untouched rather than half-replaced.
      const glyphs: Glyph[] = [];
      for (const stored of request.glyphs) {
        const decoded = decodeGlyph(stored);
        if (!decoded.ok) throw new Error(`refusing to import ${stored.name}: ${decoded.reason}`);
        glyphs.push(decoded.value);
      }
      // The stored order is authoritative: `fontDocument` would otherwise
      // order by the array it was handed, losing the font's own arrangement.
      const { info, glyphOrder, features } = decodeFontInfo(request.info);
      // Everything the document carries, not only its glyphs: `replaceDocument`
      // writes every file the project has, so whatever is left out here is
      // written over as empty.
      const document = setFeatures(
        setKerning(
          setGlyphOrder(fontDocument(glyphs, info), glyphOrder),
          decodeKerning(request.kerning),
        ),
        features,
      );
      const report = await replaceDocument(required(), document);
      return report;
    }

    case "saveKerning":
      await required().write(KERNING_PATH, JSON.stringify(request.kerning));
      return null;

    case "saveFontInfo":
      await required().write(FONT_INFO_PATH, JSON.stringify(request.info));
      return null;

    case "journal": {
      const decoded = decodeGlyph(request.glyph);
      if (!decoded.ok) throw new Error(`refusing to journal: ${decoded.reason}`);
      await appendJournal(required(), decoded.value, request.at);
      return null;
    }

    case "snapshot": {
      await writeSnapshot(required(), request.snapshot);
      // Pruned here rather than on a timer: the moment a new copy exists is the
      // moment the oldest one stops being worth keeping.
      await pruneSnapshots(required());
      return await listSnapshots(required());
    }

    case "putImage":
      return await writeImage(required(), request.name, new Uint8Array(request.bytes));

    case "getImage": {
      const bytes = await readImage(required(), request.name);
      // The buffer itself, so the main thread can decode it without a copy.
      // Copied out: the store may hand back a view over a larger buffer, and
      // posting that would carry the rest of it across the thread.
      return bytes === null ? null : new Uint8Array(bytes).buffer;
    }

    case "images":
      return await listImages(required());

    case "removeImage": {
      await removeImage(required(), request.name);
      return null;
    }

    case "putLayers": {
      await writeLayers(required(), request.layers);
      return null;
    }

    case "layers":
      return await readLayers(required());

    case "putMaster": {
      await required().write(`masters/${request.master}.json`, JSON.stringify(request.snapshot));
      return null;
    }

    case "getMaster":
      return await required().read(`masters/${request.master}.json`);

    case "dropMaster": {
      await required().remove(`masters/${request.master}.json`);
      return null;
    }

    case "putDesignspace": {
      await writeDesignspace(required(), {
        axes: request.designspace.axes as never,
        masters: request.designspace.masters as never,
        current: request.designspace.current,
        instances: request.designspace.instances as never,
      });
      return null;
    }

    case "getDesignspace":
      return await readDesignspace(required());

    case "snapshots":
      return await listSnapshots(required());

    case "readSnapshot":
      return await readSnapshot(required(), request.at);

    case "clearJournal":
      await clearJournal(required());
      return null;

    case "wipe":
      await wipe(required());
      return null;
  }
}
