import type { FontDocument, Glyph } from "@fonteditor/font-model";
import { fontDocument, setFeatures, setGlyphOrder, setKerning } from "@fonteditor/font-model";

import type { LoadedPayload, StorageRequest, StorageResponse } from "./protocol.js";
import { type SnapshotEntry, type StoredSnapshot, documentOf, snapshotOf } from "./snapshots.js";
import {
  decodeFontInfo,
  decodeGlyph,
  decodeKerning,
  encodeFontInfo,
  encodeGlyph,
  encodeKerning,
} from "./schema.js";

/**
 * `Omit<StorageRequest, "id">` looks right and is not: applied to a union, Omit
 * keeps only the keys every member shares, so every payload field vanished and
 * the client was typed to reject its own messages. The conditional distributes
 * over the union first, which is what was meant.
 */
type WithoutId<T> = T extends { id: number } ? Omit<T, "id"> : never;

export type LoadedProject =
  | { readonly kind: "empty" }
  | {
      readonly kind: "loaded";
      readonly document: FontDocument;
      readonly recovered: boolean;
      readonly problems: readonly string[];
    };

/**
 * The main thread's handle on the storage worker.
 *
 * One promise per request, matched by id. The worker is constructed by the
 * caller rather than here, because how a worker URL is spelled is a bundler
 * question and this package should not have an opinion about it.
 */
export class StorageClient {
  private nextId = 1;
  private readonly waiting = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();

  constructor(private readonly worker: Worker) {
    this.worker.addEventListener("message", (event: MessageEvent<StorageResponse>) => {
      const response = event.data;
      const pending = this.waiting.get(response.id);
      if (pending === undefined) return;
      this.waiting.delete(response.id);
      if (response.ok) pending.resolve(response.value);
      else pending.reject(new Error(response.reason));
    });

    this.worker.addEventListener("error", (event) => {
      // A worker that has died will never reply, so anything outstanding has to
      // be failed rather than left hanging forever.
      const error = new Error(`Storage worker failed: ${event.message}`);
      for (const pending of this.waiting.values()) pending.reject(error);
      this.waiting.clear();
    });
  }

  async open(directory = "project"): Promise<void> {
    await this.send({ kind: "open", directory });
  }

  async load(): Promise<LoadedProject> {
    const payload = (await this.send({ kind: "load" })) as LoadedPayload;
    if (payload.glyphs.length === 0) return { kind: "empty" };

    const glyphs = [];
    const problems = [...payload.problems];
    for (const stored of payload.glyphs) {
      const decoded = decodeGlyph(stored);
      if (decoded.ok) glyphs.push(decoded.value);
      else problems.push(`${stored.name}: ${decoded.reason}`);
    }
    if (glyphs.length === 0) return { kind: "empty" };

    // Every field the document carries, not only its glyphs. This is the third
    // place a document is taken apart and put back together — the worker does it
    // for `replaceAll`, the project does it for a load from disk, and this does
    // it for a load across the wire — and each is a place where a field added to
    // the model can be quietly left behind.
    const { info, features } = decodeFontInfo(payload.info);
    const document = setFeatures(
      setKerning(
        setGlyphOrder(
          fontDocument(glyphs, info),
          glyphs.map((g) => g.name),
        ),
        decodeKerning(payload.kerning),
      ),
      features,
    );

    return { kind: "loaded", document, recovered: payload.recovered, problems };
  }

  async saveGlyphs(glyphs: readonly Glyph[]): Promise<readonly string[]> {
    if (glyphs.length === 0) return [];
    const written = await this.send({ kind: "saveGlyphs", glyphs: glyphs.map(encodeGlyph) });
    return written as readonly string[];
  }

  /**
   * Delete the files of glyphs that are no longer in the font.
   *
   * Without this a deleted glyph's file stays where it was, and `loadDocument`
   * reads every file in the directory — so the glyph comes back on the next
   * launch, appended to the end of an order that no longer mentions it.
   */
  async removeGlyphs(names: readonly string[]): Promise<readonly string[]> {
    if (names.length === 0) return [];
    const removed = await this.send({ kind: "removeGlyphs", names });
    return removed as readonly string[];
  }

  /**
   * Replace everything on disk with this document, in one message.
   *
   * Returns what the worker actually did, so an import can report how many
   * glyphs landed and how many belonged to the font being replaced.
   */
  async replaceAll(document: FontDocument): Promise<{ written: number; removed: number }> {
    const glyphs = document.glyphOrder
      .map((name) => document.glyphs[name])
      .filter((g): g is Glyph => g !== undefined);
    const result = await this.send({
      kind: "replaceAll",
      glyphs: glyphs.map(encodeGlyph),
      info: encodeFontInfo(document),
      kerning: encodeKerning(document.kerning),
    });
    return result as { written: number; removed: number };
  }

  /**
   * Keep a copy of the whole font, and return the copies there are now.
   *
   * The one call here that sends everything: a snapshot is a copy of the whole
   * document or it is not a copy. It is also the one whose cost is worth
   * thinking about — a large font is a megabyte or two of JSON — which is why
   * the caller decides when, not this.
   */
  async snapshot(document: FontDocument, at: number): Promise<readonly SnapshotEntry[]> {
    const entries = await this.send({ kind: "snapshot", snapshot: snapshotOf(document, at) });
    return entries as readonly SnapshotEntry[];
  }

  async snapshots(): Promise<readonly SnapshotEntry[]> {
    return (await this.send({ kind: "snapshots" })) as readonly SnapshotEntry[];
  }

  /**
   * One snapshot, as a document again, or `null` where it has gone.
   *
   * Glyphs that will not decode are named rather than thrown: most of a font
   * back is the whole point.
   */
  async readSnapshot(
    at: number,
  ): Promise<{ document: FontDocument; problems: readonly string[] } | null> {
    const stored = (await this.send({ kind: "readSnapshot", at })) as StoredSnapshot | null;
    return stored === null ? null : documentOf(stored);
  }

  async saveKerning(document: FontDocument): Promise<void> {
    await this.send({ kind: "saveKerning", kerning: encodeKerning(document.kerning) });
  }

  async saveFontInfo(document: FontDocument): Promise<void> {
    await this.send({ kind: "saveFontInfo", info: encodeFontInfo(document) });
  }

  async journal(glyph: Glyph, at: number = Date.now()): Promise<void> {
    await this.send({ kind: "journal", glyph: encodeGlyph(glyph), at });
  }

  async clearJournal(): Promise<void> {
    await this.send({ kind: "clearJournal" });
  }

  async wipe(): Promise<void> {
    await this.send({ kind: "wipe" });
  }

  terminate(): void {
    this.worker.terminate();
  }

  private send(request: WithoutId<StorageRequest>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker.postMessage({ ...request, id });
    });
  }
}
